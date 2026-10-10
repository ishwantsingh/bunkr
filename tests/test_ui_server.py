from hashlib import sha256
from pathlib import Path
import tempfile
import unittest

from bunkr.contract import Ack, Bounds, Manifest, Packet, Request
from bunkr.media import Store
from bunkr.ui_server import DemoModel


class UIModelTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.model = DemoModel(Path(cls.temp.name) / 'media.db')

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_preview_uses_real_bounded_wire_and_independent_image(self):
        demo = self.model.initial()
        manifest = Manifest.decode(bytes.fromhex(demo['preview']['manifest']))
        self.assertLessEqual(manifest.byte_count, 300)
        self.assertGreater(manifest.byte_count, 0)
        self.assertEqual(manifest.image_id, demo['image_id'])
        for wire in demo['preview']['packets']:
            self.assertLessEqual(len(bytes.fromhex(wire)), 220)
            Packet.decode(bytes.fromhex(wire))

    def test_six_independently_verified_tiles_cover_selection(self):
        selected = [.18, .25, .84, .59]
        response = self.model.crop({'bounds': selected, 'request_id': 'ab' * 16})
        request = Request.decode(bytes.fromhex(response['request']))
        bounds = Bounds.normalized(*selected)
        self.assertEqual(request.bounds, bounds)
        self.assertEqual(len(response['tiles']), 6)
        receiver = Store(':memory:')
        manifests, acks = [], []
        try:
            for tile in response['tiles']:
                manifest = Manifest.decode(bytes.fromhex(tile['manifest']))
                manifests.append(manifest)
                receiver.register(manifest)
                self.assertIsNone(receiver.completed(manifest.representation_id))
                for wire in reversed(tile['packets']):
                    receiver.receive(bytes.fromhex(wire))
                data = receiver.completed(manifest.representation_id)
                self.assertEqual(sha256(data).hexdigest(), manifest.sha256)
                acks.append(receiver.completion_ack(manifest.representation_id).hex())
            self.assertEqual(len({m.representation_id for m in manifests}), 6)
            self.assertEqual(manifests[0].bounds.left, bounds.left)
            self.assertEqual(manifests[-1].bounds.right, bounds.right)
            self.assertEqual(manifests[0].bounds.top, bounds.top)
            self.assertEqual(manifests[-1].bounds.bottom, bounds.bottom)
            for row in range(2):
                for col in range(2):
                    self.assertEqual(manifests[row*3+col].bounds.right, manifests[row*3+col+1].bounds.left)
            for col in range(3):
                self.assertEqual(manifests[col].bounds.bottom, manifests[col+3].bounds.top)
            with self.model.store() as sender:
                self.assertFalse(sender.confirmed(manifests[0].representation_id))
            self.assertTrue(self.model.confirm({'acks': acks})['confirmed'])
        finally:
            receiver.close()

    def test_invalid_selection_or_ack_cannot_claim_completion(self):
        for bounds in ([0, 0, 0, 0], [-.1, 0, 1, 1], [0, 0, 1.1, 1]):
            with self.assertRaises(ValueError):
                self.model.crop({'bounds': bounds, 'request_id': 'cd' * 16})
        with self.assertRaises(ValueError):
            self.model.confirm({'acks': []})
        with self.assertRaises((KeyError, ValueError)):
            self.model.confirm({'acks': [Ack('00' * 16, 2, '00' * 32).encode().hex()]})

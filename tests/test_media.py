import math
from pathlib import Path
import random
import tempfile
import unittest
from dataclasses import replace
from io import BytesIO

from PIL import Image, ImageOps

from imageoverbt.contract import (Ack, Bounds, Codec, FULL_BOUNDS, Kind, Manifest,
    MAX_PACKET, PAYLOAD, Packet, Request, decode_missing, frame, missing_frames)
from imageoverbt.media import Store, digest, encode_budget


class MediaTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.sender = Store(self.root / 'sender.db')
        self.receiver = Store(self.root / 'receiver.db')
        # Deterministic textured source, so recovery tests exercise many chunks.
        rng = random.Random(42)
        image = Image.frombytes('RGB', (128, 96), rng.randbytes(128 * 96 * 3))
        path = self.root / 'source.png'
        image.save(path)
        self.image_id = self.sender.retain(path)
        self.request = Request('01' * 16, self.image_id, 2,
                               Bounds.normalized(.1, .2, .9, .8), 128)
        self.rep = self.sender.produce(self.image_id, 1, 2, request=self.request)
        self.receiver.register(self.rep.manifest)

    def tearDown(self):
        self.sender.close()
        self.receiver.close()
        self.tmp.cleanup()

    def deliver(self, rep=None):
        rep = rep or self.rep
        ack = None
        for wire in rep.packets():
            ack = self.receiver.receive(wire)
        return ack

    def test_wire_roundtrips_and_packet_cap(self):
        self.assertEqual(Manifest.decode(self.rep.manifest.encode()), self.rep.manifest)
        self.assertEqual(Request.decode(self.request.encode()), self.request)
        frames = [self.rep.manifest.encode(), self.request.encode(), *self.rep.packets()]
        for wire in frames:
            self.assertLessEqual(len(wire), MAX_PACKET)
        for wire in self.rep.packets():
            self.assertEqual(Packet.decode(wire).encode(), wire)
        self.assertEqual(max(map(len, self.rep.packets())), MAX_PACKET)

    def test_exact_reconstruction_reordered_duplicates(self):
        packets = list(self.rep.packets())
        packets += packets[::2]
        random.Random(9).shuffle(packets)
        for wire in packets:
            self.receiver.receive(wire)
        self.assertEqual(self.receiver.completed(self.rep.manifest.representation_id), self.rep.data)
        image, bounds = self.receiver.decoded(self.rep.manifest.representation_id)
        self.assertEqual(image.size, (self.rep.manifest.width, self.rep.manifest.height))
        self.assertEqual(bounds, self.request.bounds)

    def test_missing_chunks_resume_after_restart(self):
        packets = list(self.rep.packets())
        for wire in packets[::2]:
            self.receiver.receive(wire)
        rep_id = self.rep.manifest.representation_id
        missing = self.receiver.missing(rep_id)
        self.assertEqual(missing, list(range(1, len(packets), 2)))
        self.receiver.close()
        self.receiver = Store(self.root / 'receiver.db')
        self.assertEqual(self.receiver.missing(rep_id), missing)
        for index in missing:
            self.receiver.receive(packets[index])
        self.assertEqual(self.receiver.completed(rep_id), self.rep.data)

    def test_corrupt_wire_does_not_advance(self):
        wire = bytearray(next(self.rep.packets()))
        wire[-8] ^= 1
        with self.assertRaisesRegex(ValueError, 'CRC'):
            self.receiver.receive(bytes(wire))
        self.assertEqual(len(self.receiver.missing(self.rep.manifest.representation_id)), self.rep.manifest.chunk_count)

    def test_crc_valid_corruption_fails_hash_and_can_recover(self):
        packets = list(self.rep.packets())
        packet = Packet.decode(packets[0])
        packets[0] = replace(packet, payload=bytes([packet.payload[0] ^ 1]) + packet.payload[1:]).encode()
        with self.assertRaisesRegex(ValueError, 'hash'):
            for wire in packets:
                self.receiver.receive(wire)
        self.assertIsNone(self.receiver.completed(self.rep.manifest.representation_id))
        self.assertEqual(len(self.receiver.missing(self.rep.manifest.representation_id)), len(packets))
        self.deliver()
        self.assertEqual(self.receiver.completed(self.rep.manifest.representation_id), self.rep.data)

    def test_conflicting_duplicate_rejected(self):
        wire = next(self.rep.packets())
        self.receiver.receive(wire)
        packet = Packet.decode(wire)
        bad = replace(packet, payload=bytes([packet.payload[0] ^ 1]) + packet.payload[1:]).encode()
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            self.receiver.receive(bad)
        self.deliver()

    def test_wrong_image_count_and_length_rejected(self):
        packet = Packet.decode(next(self.rep.packets()))
        for bad in (replace(packet, image_id='ff' * 16), replace(packet, count=packet.count + 1),
                    replace(packet, payload=packet.payload[:-1])):
            with self.assertRaises(ValueError):
                self.receiver.receive(bad.encode())

    def test_unregistered_packet_rejected(self):
        with self.assertRaises(KeyError):
            self.receiver.receive(replace(Packet.decode(next(self.rep.packets())),
                                          representation_id='ff' * 16).encode())

    def test_completion_requires_verification_and_ack_delivery(self):
        rep_id = self.rep.manifest.representation_id
        with self.assertRaises(ValueError):
            self.receiver.completion_ack(rep_id)
        with self.assertRaises(ValueError):
            self.receiver.decoded(rep_id)
        ack = self.deliver()
        self.assertFalse(self.sender.confirmed(rep_id))
        self.assertEqual(Ack.decode(ack).encode(), ack)
        # Lost ACK is regenerated without re-sending the image.
        self.receiver.close()
        self.receiver = Store(self.root / 'receiver.db')
        self.sender.confirm(self.receiver.completion_ack(rep_id))
        self.sender.confirm(ack)
        self.assertTrue(self.sender.confirmed(rep_id))
        self.assertEqual(self.receiver.receive(next(self.rep.packets())), ack)

    def test_hop_wrong_recipient_and_hash_do_not_confirm(self):
        ack = Ack.decode(self.deliver())
        for bad in (replace(ack, complete=False), replace(ack, recipient=3), replace(ack, sha256='00' * 32)):
            with self.assertRaises(ValueError):
                self.sender.confirm(bad.encode())
        self.assertFalse(self.sender.confirmed(ack.representation_id))

    def test_repeated_request_and_persistent_encoding_cache(self):
        again = self.sender.produce(self.image_id, 1, 2, request=self.request)
        self.assertEqual(again, self.rep)
        self.sender.close()
        self.sender = Store(self.root / 'sender.db')
        self.assertEqual(self.sender.produce(self.image_id, 1, 2, request=self.request), self.rep)
        self.assertEqual(self.sender.db.execute('SELECT count(*) FROM encodings').fetchone()[0], 1)
        equivalent = replace(self.request, request_id='02' * 16)
        rep2 = self.sender.produce(self.image_id, 1, 2, request=equivalent)
        self.assertEqual(rep2.data, self.rep.data)
        self.assertNotEqual(rep2.manifest.representation_id, self.rep.manifest.representation_id)
        self.assertEqual(self.sender.db.execute('SELECT count(*) FROM encodings').fetchone()[0], 1)

    def test_request_id_collision_rejected(self):
        with self.assertRaises(ValueError):
            self.sender.produce(self.image_id, 1, 2, request=replace(self.request, bounds=FULL_BOUNDS))

    def test_overlapping_transfers_are_independent(self):
        second = self.sender.produce(self.image_id, 1, 2,
            request=replace(self.request, request_id='03' * 16, bounds=Bounds.normalized(.2, .3, 1, 1)))
        self.receiver.register(second.manifest)
        for a, b in zip(self.rep.packets(), second.packets()):
            self.receiver.receive(a)
            self.receiver.receive(b)
        self.deliver()
        self.deliver(second)
        self.assertEqual(self.receiver.completed(second.manifest.representation_id), second.data)
        self.assertEqual(self.receiver.completed(self.rep.manifest.representation_id), self.rep.data)

    def test_manifest_collision_and_invalid_metadata(self):
        with self.assertRaises(ValueError):
            self.receiver.register(replace(self.rep.manifest, sender=9))
        with self.assertRaises(ValueError):
            replace(self.rep.manifest, chunk_count=1)
        with self.assertRaises(ValueError):
            replace(self.rep.manifest, byte_count=0)
        with self.assertRaises(ValueError):
            replace(self.rep.manifest, width=0)
        bad = replace(self.rep.manifest, width=self.rep.manifest.width + 1,
                      representation_id='fe' * 16)
        self.receiver.register(bad)
        with self.assertRaisesRegex(ValueError, 'Decoded'):
            for wire in self.rep.packets():
                self.receiver.receive(replace(Packet.decode(wire), representation_id=bad.representation_id).encode())

    def test_preview_and_full_are_independent(self):
        preview = self.sender.produce(self.image_id, 1, 2)
        full = self.sender.produce(self.image_id, 1, 2,
            request=Request('04' * 16, self.image_id, 2, kind=Kind.FULL))
        self.receiver.register(preview.manifest)
        self.receiver.register(full.manifest)
        self.sender.confirm(self.deliver(preview))
        self.assertFalse(self.sender.confirmed(full.manifest.representation_id))
        self.deliver(full)
        self.assertEqual(full.manifest.bounds, FULL_BOUNDS)

    def test_bounds_edges_and_display_mapping(self):
        self.assertEqual(FULL_BOUNDS.pixels(101, 79), (0, 0, 101, 79))
        bounds = Bounds.normalized(.25, .25, .75, .75)
        self.assertEqual(bounds.pixels(100, 100), (25, 25, 75, 75))
        rect = bounds.overlay(200, 100)
        self.assertAlmostEqual(rect[0], 50, delta=.01)
        self.assertAlmostEqual(rect[3], 75, delta=.01)
        self.assertEqual(Bounds(65534, 65534, 65535, 65535).pixels(100, 100), (99, 99, 100, 100))
        for values in ((0, 0, 0, 1), (-.1, 0, 1, 1), (0, 0, math.nan, 1), (0, 0, 1.1, 1)):
            with self.assertRaises(ValueError):
                Bounds.normalized(*values)

    def test_all_exif_orientations_select_correct_pixels(self):
        base = Image.new('RGB', (40, 20), 'red')
        for x in range(20, 40):
            for y in range(20):
                base.putpixel((x, y), (0, 0, 255))
        for orientation in range(1, 9):
            with self.subTest(orientation=orientation):
                path = self.root / f'rotated-{orientation}.png'
                exif = Image.Exif(); exif[274] = orientation
                base.save(path, exif=exif)
                image_id = self.sender.retain(path)
                with Image.open(path) as original:
                    expected = ImageOps.exif_transpose(original).convert('RGB')
                self.assertEqual(self.sender.source(image_id).tobytes(), expected.tobytes())
                bounds = Bounds.normalized(0, 0, .5, .5)
                req = Request(f'{orientation:032x}', image_id, 2, bounds, 40)
                rep = self.sender.produce(image_id, 1, 2, request=req)
                self.assertEqual((rep.manifest.source_width, rep.manifest.source_height), expected.size)
                with Image.open(BytesIO(rep.data)) as crop:
                    self.assertEqual(crop.size, expected.crop(bounds.pixels(*expected.size)).size)
                    for a, b in zip(crop.getpixel((0, 0)), expected.getpixel((0, 0))):
                        self.assertLess(abs(a - b), 20)

    def test_both_codecs_meet_budget_and_decode(self):
        for codec in Codec:
            encoded = encode_budget(self.sender.source(self.image_id), 1000, 96, codec)
            self.assertLessEqual(len(encoded.data), 1000)
            with Image.open(BytesIO(encoded.data)) as image:
                image.load()
                self.assertEqual(image.format, codec.name)
        with self.assertRaises(ValueError):
            encode_budget(self.sender.source(self.image_id), 64, 96, Codec.JPEG)

    def test_control_batches_and_malformed_frames(self):
        indices = list(range(1000))
        frames = list(missing_frames(self.rep.manifest.representation_id, indices))
        self.assertEqual([i for wire in frames for i in decode_missing(wire)[1]], indices)
        self.assertTrue(all(len(wire) <= MAX_PACKET for wire in frames))
        for decoder, tag in ((Request.decode, 2), (Manifest.decode, 1), (Packet.decode, 3),
                             (Ack.decode, 4), (decode_missing, 6)):
            for wire in (b'', b'X' * 231, frame(tag, b'X')):
                with self.assertRaises(ValueError):
                    decoder(wire)

    def test_real_trail_sign_preview_then_crop(self):
        fixture = Path(__file__).resolve().parents[1] / 'fixtures' / 'trail-sign.jpg'
        image_id = self.sender.retain(fixture)
        preview = self.sender.produce(image_id, 1, 2, budget=300)
        crop = self.sender.produce(image_id, 1, 2, request=Request('05' * 16, image_id, 2,
            Bounds.normalized(.18, .25, .84, .59), 1024))
        for rep in (preview, crop):
            self.receiver.register(rep.manifest)
            self.deliver(rep)
            self.assertEqual(self.receiver.completed(rep.manifest.representation_id), rep.data)
        self.assertLessEqual(preview.manifest.byte_count, 300)
        self.assertGreater(crop.manifest.width, preview.manifest.width * 5)
        self.assertEqual(crop.manifest.bounds, Bounds.normalized(.18, .25, .84, .59))
        # Readability is manually checked in the generated comparison; dimensions
        # and hashes alone cannot prove that a human can read lettering.


if __name__ == '__main__':
    unittest.main()

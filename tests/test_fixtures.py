"""Golden fixtures can be consumed without running the encoder."""
import json
from pathlib import Path
import unittest

from imageoverbt.contract import Manifest, Request
from imageoverbt.events import Event, EventType
from imageoverbt.media import Store

FIXTURES = Path(__file__).resolve().parents[1] / 'fixtures'


class FixtureTests(unittest.TestCase):
    def test_wire_fixture_reconstruction(self):
        store = Store(':memory:')
        try:
            request = Request.decode((FIXTURES / 'wire/crop.request.bin').read_bytes())
            for name in ('preview', 'crop'):
                manifest = Manifest.decode((FIXTURES / f'wire/{name}.manifest.bin').read_bytes())
                store.register(manifest)
                packets = json.loads((FIXTURES / f'wire/{name}.packets.json').read_text())
                for packet in reversed(packets):
                    store.receive(bytes.fromhex(packet))
                self.assertEqual(store.completed(manifest.representation_id),
                                 (FIXTURES / f'wire/{name}.webp').read_bytes())
                if name == 'crop':
                    self.assertEqual(request.request_id, manifest.request_id)
                    self.assertEqual(request.bounds, manifest.bounds)
        finally:
            store.close()

    def test_endpoint_event_fixture_preserves_confirmation_order(self):
        entries = json.loads((FIXTURES / 'events.json').read_text())['events']
        events = [Event(**dict(entry, type=EventType(entry['type']))) for entry in entries]
        crop = Manifest.decode((FIXTURES / 'wire/crop.manifest.bin').read_bytes())
        self.assertTrue(all(event.representation_id == crop.representation_id for event in events))
        self.assertEqual(events[-2].type, EventType.VERIFIED_LOCALLY)
        self.assertEqual(events[-2].node_id, 2)
        self.assertEqual(events[-1].type, EventType.SENDER_CONFIRMED)
        self.assertEqual(events[-1].node_id, 1)
        self.assertLess(events[-2].time_ms, events[-1].time_ms)
        self.assertTrue(all(event.airtime_ms is None for event in events))

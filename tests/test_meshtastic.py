"""Exercise upstream SDK methods and protobuf serialization without radio hardware."""
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import Mock

AVAILABLE = importlib.util.find_spec('meshtastic') is not None
if AVAILABLE:
    from meshtastic.mesh_interface import MeshInterface
    from meshtastic.protobuf import mesh_pb2, portnums_pb2
    from pubsub import pub
    from bunkr.meshtastic_transport import (Bridge, PORT, data_message,
        packet_priority, radio_size, unpack)
from bunkr.contract import MAX_PACKET, frame

FIXTURES = Path(__file__).resolve().parents[1] / 'fixtures/wire'


@unittest.skipUnless(AVAILABLE, 'Install bunkr[meshtastic] for upstream integration checks')
class MeshtasticTests(unittest.TestCase):
    def setUp(self):
        # Actual upstream methods generate ToRadio packets; the hardware write is
        # the only mocked boundary. No socket, radio or connection is opened.
        self.interface = MeshInterface()
        self.interface._sendToRadio = Mock()
        self.received = []
        self.bridge = Bridge(self.interface, 1, self.received.append)
        self.wire = bytes.fromhex(json.loads((FIXTURES / 'crop.packets.json').read_text())[0])

    def tearDown(self):
        self.bridge.close()
        self.interface.close()

    def inbound(self, wire=None, **fields):
        packet = mesh_pb2.MeshPacket(to=1, id=7, hop_start=3, hop_limit=1)
        setattr(packet, 'from', 2)
        packet.decoded.CopyFrom(data_message(wire or self.wire))
        for name, value in fields.items():
            setattr(packet, name, value)
        return packet

    def test_all_fixture_frames_fit_actual_protobuf_with_encryption(self):
        self.assertEqual(PORT, portnums_pb2.PRIVATE_APP)
        self.assertEqual(PORT, 256)
        wires = [(FIXTURES / name).read_bytes() for name in
                 ('preview.manifest.bin', 'crop.manifest.bin', 'crop.request.bin')]
        for name in ('preview', 'crop'):
            wires += [bytes.fromhex(p) for p in json.loads((FIXTURES / f'{name}.packets.json').read_text())]
        for wire in wires:
            protobuf = data_message(wire)
            self.assertLessEqual(protobuf.ByteSize() + 12, 239)
            self.assertLessEqual(radio_size(wire), 255)
            self.assertEqual(mesh_pb2.Data.FromString(protobuf.SerializeToString()).payload, wire)
        self.assertEqual(len(self.wire), MAX_PACKET)
        self.assertEqual(radio_size(self.wire), 254)

    def test_sdk_send_data_uses_private_port_and_no_receipt_shortcut(self):
        sent = self.bridge.send(self.wire, 2, pki_encrypted=True)
        to_radio = self.interface._sendToRadio.call_args.args[0]
        decoded = mesh_pb2.ToRadio.FromString(to_radio.SerializeToString()).packet
        self.assertEqual(decoded.decoded.portnum, PORT)
        self.assertEqual(decoded.decoded.payload, self.wire)
        self.assertEqual(decoded.to, 2)
        self.assertEqual(decoded.hop_limit, 3)
        self.assertEqual(decoded.priority, mesh_pb2.MeshPacket.DEFAULT)
        self.assertFalse(decoded.want_ack)
        self.assertFalse(decoded.decoded.want_response)
        self.assertTrue(decoded.pki_encrypted)
        self.assertGreater(sent.id, 0)
        self.assertEqual(self.received, [])

    def test_text_and_voice_frames_use_actual_sdk_send_path(self):
        fixtures = json.loads((FIXTURES.parent / 'messages/messages.json').read_text())
        for sample in fixtures.values():
            for wire in [sample['manifest'], *sample['packets'], sample['ack']]:
                wire = bytes.fromhex(wire)
                self.bridge.send(wire, 2)
                message = self.interface._sendToRadio.call_args.args[0]
                packet = mesh_pb2.ToRadio.FromString(message.SerializeToString()).packet
                self.assertEqual(packet.decoded.payload, wire)
                self.assertEqual(packet.decoded.portnum, PORT)
                expected = mesh_pb2.MeshPacket.DEFAULT if wire[1] == 3 else mesh_pb2.MeshPacket.RESPONSE
                self.assertEqual(packet.priority, expected)
                self.assertFalse(packet.want_ack)

    def test_priority_maps_to_sdk_and_keeps_background_separate(self):
        request = (FIXTURES / 'crop.request.bin').read_bytes()
        self.assertEqual(packet_priority(request), mesh_pb2.MeshPacket.RESPONSE)
        self.assertEqual(packet_priority(self.wire, background=True), mesh_pb2.MeshPacket.BACKGROUND)
        self.bridge.send(self.wire, 2, background=True)
        self.assertEqual(self.interface._sendToRadio.call_args.args[0].packet.priority,
                         mesh_pb2.MeshPacket.BACKGROUND)

    def test_receive_sdk_raw_dict_and_official_from_radio(self):
        packet = self.inbound()
        radio = mesh_pb2.FromRadio.FromString(mesh_pb2.FromRadio(packet=packet).SerializeToString())
        self.bridge.receive({'raw': radio.packet}, self.interface)
        self.assertEqual(len(self.received), 1)
        self.assertEqual(self.received[0].wire, self.wire)
        self.assertEqual(self.received[0].source, 2)
        self.assertEqual(self.received[0].destination, 1)
        self.assertEqual((self.received[0].hop_start, self.received[0].hop_limit), (3, 1))

    def test_filter_other_endpoints_channels_interfaces_and_routing_acks(self):
        self.bridge.receive(self.inbound(to=3), self.interface)
        self.bridge.receive(self.inbound(channel=1), self.interface)
        self.bridge.receive(self.inbound(), object())
        packet = self.inbound()
        packet.decoded.portnum = portnums_pb2.ROUTING_APP
        self.bridge.receive(packet, self.interface)
        packet = self.inbound()
        packet.encrypted = b'opaque encrypted packet'
        self.bridge.receive(packet, self.interface)
        self.assertEqual(self.received, [])

    def test_pubsub_subscription_and_cleanup(self):
        self.bridge.start().start()
        pub.sendMessage('meshtastic.receive', packet={'raw': self.inbound()}, interface=self.interface)
        self.assertEqual(len(self.received), 1)
        self.bridge.close()
        self.bridge.close()
        pub.sendMessage('meshtastic.receive', packet={'raw': self.inbound()}, interface=self.interface)
        self.assertEqual(len(self.received), 1)

    def test_reject_previous_draft_wire_version(self):
        import struct
        import zlib
        body = bytes([1]) + self.wire[1:-4]
        old_wire = body + struct.pack('>I', zlib.crc32(body))
        with self.assertRaisesRegex(ValueError, 'version'):
            data_message(old_wire)

    def test_reject_bad_frames_before_sdk_send(self):
        oversized = frame(3, b'x' * (MAX_PACKET - 6))
        # CRC-valid does not imply a valid image packet.
        for wire in (b'X' * 230, self.wire[:-1], frame(99, b''), oversized):
            with self.assertRaises(ValueError):
                self.bridge.send(wire, 2)
        self.interface._sendToRadio.assert_not_called()
        corrupt = bytearray(self.wire); corrupt[-5] ^= 1
        packet = self.inbound()
        packet.decoded.payload = bytes(corrupt)
        with self.assertRaisesRegex(ValueError, 'CRC'):
            self.bridge.receive(packet, self.interface)
        self.assertEqual(self.received, [])

    def test_reject_invalid_nodes_and_missing_metadata(self):
        for destination in (0, 0xffffffff, 1, -1, True, '!12345678'):
            with self.assertRaises(ValueError):
                self.bridge.send(self.wire, destination)
        for fields in ({'id': 0}, {'from': 0}, {'from': 0xffffffff}):
            with self.assertRaises(ValueError):
                unpack(self.inbound(**fields), local_node=1)
        with self.assertRaises(ValueError):
            unpack({'decoded': {'payload': self.wire}}, local_node=1)

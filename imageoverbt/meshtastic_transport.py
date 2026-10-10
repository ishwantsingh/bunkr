"""Official Meshtastic SDK/protobuf adapter; imports require the meshtastic extra.

No connection opens on import. Scheduling, retries and endpoint stores stay with
our caller; native routing ACKs never become image completion acknowledgments.
"""
import argparse
from dataclasses import dataclass
import json
from pathlib import Path
from typing import Callable

from meshtastic.protobuf import mesh_pb2, portnums_pb2
from pubsub import pub

from .contract import (Ack, Manifest, MAX_PACKET, Packet, Request,
                       decode_missing)

PORT = portnums_pb2.PRIVATE_APP
RADIO_HEADER_BYTES = 16
RADIO_BODY_LIMIT = 239
ENCRYPTION_OVERHEAD_BYTES = 12


def validate_frame(wire):
    """Validate full application structure and CRC before queuing or delivering."""
    if not isinstance(wire, bytes) or not 6 <= len(wire) <= MAX_PACKET:
        raise ValueError('Invalid imageoverbt frame size or type')
    decoders = {1: Manifest.decode, 2: Request.decode, 3: Packet.decode,
                4: Ack.decode, 5: Ack.decode, 6: decode_missing}
    decoder = decoders.get(wire[1])
    if decoder is None:
        raise ValueError('Unknown imageoverbt frame type')
    return decoder(wire)


def data_message(wire):
    validate_frame(wire)
    message = mesh_pb2.Data(portnum=PORT, payload=wire)
    # Reserve encryption overhead even for channel-encrypted sessions. Checking
    # the actual protobuf avoids confusing Data.payload with total radio bytes.
    if (len(wire) > mesh_pb2.DATA_PAYLOAD_LEN or
            message.ByteSize() + ENCRYPTION_OVERHEAD_BYTES > RADIO_BODY_LIMIT):
        raise ValueError('Frame exceeds encrypted Meshtastic radio envelope')
    return message


def radio_size(wire):
    """Conservative bytes per single radio transmission, before LoRa PHY overhead."""
    return RADIO_HEADER_BYTES + data_message(wire).ByteSize() + ENCRYPTION_OVERHEAD_BYTES


def packet_priority(wire, *, background=False):
    validate_frame(wire)
    if wire[1] != 3:
        return mesh_pb2.MeshPacket.RESPONSE
    return mesh_pb2.MeshPacket.BACKGROUND if background else mesh_pb2.MeshPacket.DEFAULT


@dataclass(frozen=True)
class ReceivedFrame:
    source: int
    destination: int
    wire: bytes
    packet_id: int
    hop_start: int
    hop_limit: int


def unpack(packet, *, local_node, channel=0):
    """Decode an SDK receive dict or official MeshPacket, filtering unrelated data.

    SDK dictionaries contain the official protobuf under 'raw'. We intentionally
    use that instead of string port names and base64/log representations.
    """
    if isinstance(packet, dict):
        packet = packet.get('raw')
    if not isinstance(packet, mesh_pb2.MeshPacket):
        raise ValueError('Expected an official MeshPacket or SDK packet with raw protobuf')
    if (packet.WhichOneof('payload_variant') != 'decoded' or
            packet.decoded.portnum != PORT or packet.to != local_node or
            packet.channel != channel):
        return None
    if not 0 < getattr(packet, 'from') < 0xffffffff or not packet.id:
        raise ValueError('Missing source or packet ID')
    wire = bytes(packet.decoded.payload)
    data_message(wire)
    return ReceivedFrame(getattr(packet, 'from'), packet.to, wire, packet.id,
                         packet.hop_start, packet.hop_limit)


class Bridge:
    """Use an already-connected official TCP/serial/BLE MeshInterface.

    The bridge never opens/closes the caller's connection or drains whole image
    transfers. Send one scheduled frame at a time. Receive callbacks should queue
    work onto the endpoint owner's thread; Store uses a single-thread SQLite DB.
    """
    def __init__(self, interface, local_node, on_frame: Callable[[ReceivedFrame], None],
                 *, channel=0, hop_limit=3):
        if type(local_node) is not int or not 0 < local_node < 0xffffffff:
            raise ValueError('Use a concrete uint32 endpoint node number')
        if not 0 <= channel <= 7 or not 0 <= hop_limit <= 7:
            raise ValueError('Invalid channel index or hop limit')
        self.interface = interface
        self.local_node = local_node
        self.on_frame = on_frame
        self.channel = channel
        self.hop_limit = hop_limit
        self.subscribed = False

    def send(self, wire, destination, *, background=False, pki_encrypted=False):
        if type(destination) is not int or not 0 < destination < 0xffffffff or destination == self.local_node:
            raise ValueError('Send to a concrete remote node, not broadcast or self')
        data_message(wire)
        # Application verification/ACKs provide receipt evidence; a firmware ACK
        # only describes a network packet and is never forwarded to Store.confirm.
        return self.interface.sendData(wire, destinationId=destination, portNum=PORT,
            wantAck=False, wantResponse=False, channelIndex=self.channel,
            hopLimit=self.hop_limit, pkiEncrypted=pki_encrypted,
            priority=packet_priority(wire, background=background))

    def receive(self, packet, interface):
        if interface is not self.interface:
            return
        received = unpack(packet, local_node=self.local_node, channel=self.channel)
        if received is not None:
            self.on_frame(received)

    def start(self):
        if not self.subscribed:
            pub.subscribe(self.receive, 'meshtastic.receive')
            self.subscribed = True
        return self

    def close(self):
        if self.subscribed:
            pub.unsubscribe(self.receive, 'meshtastic.receive')
            self.subscribed = False

    def __enter__(self):
        return self.start()

    def __exit__(self, *_):
        self.close()


def main():
    """Offline interoperability demo using the official generated protobufs."""
    from .media import Store
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fixtures', type=Path, default=Path('fixtures/wire'))
    parser.add_argument('--output', type=Path, default=Path('demo-output/meshtastic.json'))
    args = parser.parse_args()
    sender = Store(':memory:')
    receiver = Store(':memory:')
    report = {'port': PORT, 'application_cap': MAX_PACKET,
              'encryption_reserve_bytes': ENCRYPTION_OVERHEAD_BYTES,
              'hardware_connected': False, 'transfers': []}
    sequence = 0

    def roundtrip(wire, source, destination):
        nonlocal sequence
        sequence += 1
        packet = mesh_pb2.MeshPacket(to=destination, id=sequence, hop_start=3, hop_limit=3)
        setattr(packet, 'from', source)
        packet.decoded.CopyFrom(data_message(wire))
        to_radio = mesh_pb2.ToRadio(packet=packet)
        from_radio = mesh_pb2.FromRadio(packet=mesh_pb2.ToRadio.FromString(to_radio.SerializeToString()).packet)
        decoded = mesh_pb2.FromRadio.FromString(from_radio.SerializeToString()).packet
        return unpack(decoded, local_node=destination).wire

    try:
        request = Request.decode((args.fixtures / 'crop.request.bin').read_bytes())
        received_request = Request.decode(roundtrip(request.encode(), request.recipient, 1))
        for name in ('preview', 'crop'):
            manifest = Manifest.decode((args.fixtures / f'{name}.manifest.bin').read_bytes())
            sender.register(manifest)
            receiver.register(Manifest.decode(roundtrip(manifest.encode(), manifest.sender, manifest.recipient)))
            if name == 'crop':
                assert manifest.request_id == received_request.request_id
            packets = [bytes.fromhex(p) for p in json.loads((args.fixtures / f'{name}.packets.json').read_text())]
            for wire in reversed(packets):
                receiver.receive(roundtrip(wire, manifest.sender, manifest.recipient))
            assert receiver.completed(manifest.representation_id) == (args.fixtures / f'{name}.webp').read_bytes()
            assert not sender.confirmed(manifest.representation_id)
            ack = receiver.completion_ack(manifest.representation_id)
            sender.confirm(roundtrip(ack, manifest.recipient, manifest.sender))
            assert sender.confirmed(manifest.representation_id)
            report['transfers'].append(dict(kind=name, frames=len(packets),
                max_application_bytes=max(map(len, packets)),
                max_radio_bytes_with_encryption=max(map(radio_size, packets)),
                verified=True, sender_confirmed=True))
    finally:
        sender.close()
        receiver.close()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()

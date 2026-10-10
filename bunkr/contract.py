"""Version 2 binary application contract. All serialized frames fit 220 bytes."""
from dataclasses import dataclass
from enum import IntEnum
import math
import struct
import zlib

WIRE_VERSION = 2
MAX_PACKET = 220
MAX_BYTES = 12 * 1024 * 1024
DATA_HEADER = struct.Struct('>16s16sII')
PAYLOAD = MAX_PACKET - 6 - DATA_HEADER.size
MAX_CHUNKS = math.ceil(MAX_BYTES / PAYLOAD)
ZERO_ID = '00' * 16


class Kind(IntEnum):
    PREVIEW = 0
    CROP = 1
    FULL = 2


class Codec(IntEnum):
    JPEG = 0
    WEBP = 1


@dataclass(frozen=True)
class Bounds:
    """Unsigned 16-bit normalized, half-open bounds on oriented source pixels."""
    left: int
    top: int
    right: int
    bottom: int

    def __post_init__(self):
        if not all(type(v) is int for v in self.values):
            raise ValueError('Bounds must be integer ticks')
        if not (0 <= self.left < self.right <= 65535 and
                0 <= self.top < self.bottom <= 65535):
            raise ValueError('Bounds must describe a nonempty region inside the image')

    @property
    def values(self):
        return self.left, self.top, self.right, self.bottom

    @classmethod
    def normalized(cls, left, top, right, bottom):
        values = (left, top, right, bottom)
        if not all(math.isfinite(v) and 0 <= v <= 1 for v in values):
            raise ValueError('Normalized coordinates must be finite and in [0, 1]')
        return cls(*(round(v * 65535) for v in values))

    def pixels(self, width, height):
        if width <= 0 or height <= 0:
            raise ValueError('Invalid source dimensions')
        return (self.left * width // 65535, self.top * height // 65535,
                math.ceil(self.right * width / 65535),
                math.ceil(self.bottom * height / 65535))

    def overlay(self, width, height):
        """Floating point display rectangle; dimensions exclude letterbox margins."""
        return tuple(v / 65535 * size for v, size in
                     zip(self.values, (width, height, width, height)))


FULL_BOUNDS = Bounds(0, 0, 65535, 65535)


def identifier(value):
    if len(value) != 32 or value != value.lower():
        raise ValueError('IDs must be 32 lowercase hexadecimal characters')
    return bytes.fromhex(value)


def frame(tag, body):
    data = bytes((WIRE_VERSION, tag)) + body
    wire = data + struct.pack('>I', zlib.crc32(data))
    if len(wire) > MAX_PACKET:
        raise ValueError('Application packet exceeds 220 bytes')
    return wire


def unframe(wire, tag):
    if not 6 <= len(wire) <= MAX_PACKET or wire[:2] != bytes((WIRE_VERSION, tag)):
        raise ValueError('Invalid packet size, version, or type')
    if zlib.crc32(wire[:-4]) != struct.unpack('>I', wire[-4:])[0]:
        raise ValueError('Packet CRC mismatch')
    return wire[2:-4]


@dataclass(frozen=True)
class Request:
    request_id: str
    image_id: str
    recipient: int
    bounds: Bounds = FULL_BOUNDS
    detail: int = 1024
    kind: Kind = Kind.CROP
    STRUCT = struct.Struct('>16s16sI4HIB')

    def __post_init__(self):
        identifier(self.request_id)
        identifier(self.image_id)
        if not 0 <= self.recipient <= 0xffffffff or not 1 <= self.detail <= 8192:
            raise ValueError('Invalid recipient or requested maximum dimension')
        if self.request_id == ZERO_ID:
            raise ValueError('Request ID must be nonzero')
        if self.kind not in (Kind.CROP, Kind.FULL):
            raise ValueError('Requests must ask for crop or full detail')
        if self.kind == Kind.FULL and self.bounds != FULL_BOUNDS:
            raise ValueError('Full-image requests must cover the full image')

    def encode(self):
        return frame(2, self.STRUCT.pack(identifier(self.request_id),
                     identifier(self.image_id), self.recipient, *self.bounds.values,
                     self.detail, self.kind))

    @classmethod
    def decode(cls, wire):
        try:
            r, i, recipient, l, t, right, b, detail, kind = cls.STRUCT.unpack(unframe(wire, 2))
            return cls(r.hex(), i.hex(), recipient, Bounds(l, t, right, b), detail, Kind(kind))
        except struct.error as exc:
            raise ValueError('Invalid request length') from exc


@dataclass(frozen=True)
class Manifest:
    image_id: str
    representation_id: str
    sender: int
    recipient: int
    kind: Kind
    codec: Codec
    width: int
    height: int
    byte_count: int
    chunk_count: int
    sha256: str
    request_id: str = ZERO_ID
    bounds: Bounds = FULL_BOUNDS
    source_width: int = 1
    source_height: int = 1
    STRUCT = struct.Struct('>16s16sIIBBIIQI32s16s4HII')

    def __post_init__(self):
        for value in (self.image_id, self.representation_id, self.request_id):
            identifier(value)
        if len(self.sha256) != 64 or len(bytes.fromhex(self.sha256)) != 32:
            raise ValueError('Invalid content hash')
        if not 1 <= self.byte_count <= MAX_BYTES:
            raise ValueError('Representation exceeds media limit')
        if self.chunk_count != math.ceil(self.byte_count / PAYLOAD):
            raise ValueError('Invalid chunk count')
        if any(not 1 <= v <= 65535 for v in
               (self.width, self.height, self.source_width, self.source_height)):
            raise ValueError('Invalid dimensions')
        if any(not 0 <= v <= 0xffffffff for v in (self.sender, self.recipient)):
            raise ValueError('Invalid endpoint')
        Kind(self.kind)
        Codec(self.codec)
        if self.kind == Kind.PREVIEW and self.request_id != ZERO_ID:
            raise ValueError('Previews do not have requests')
        if self.kind != Kind.PREVIEW and self.request_id == ZERO_ID:
            raise ValueError('Requested representations require a request ID')
        if self.kind != Kind.CROP and self.bounds != FULL_BOUNDS:
            raise ValueError('Preview/full representations cover the source')

    def encode(self):
        return frame(1, self.STRUCT.pack(identifier(self.image_id), identifier(self.representation_id),
                     self.sender, self.recipient, self.kind, self.codec, self.width, self.height,
                     self.byte_count, self.chunk_count, bytes.fromhex(self.sha256),
                     identifier(self.request_id), *self.bounds.values, self.source_width, self.source_height))

    @classmethod
    def decode(cls, wire):
        try:
            v = cls.STRUCT.unpack(unframe(wire, 1))
            return cls(v[0].hex(), v[1].hex(), v[2], v[3], Kind(v[4]), Codec(v[5]),
                       *v[6:10], v[10].hex(), v[11].hex(), Bounds(*v[12:16]), *v[16:18])
        except struct.error as exc:
            raise ValueError('Invalid manifest length') from exc


@dataclass(frozen=True)
class Packet:
    image_id: str
    representation_id: str
    index: int
    count: int
    payload: bytes

    def encode(self):
        identifier(self.image_id)
        identifier(self.representation_id)
        if not 0 <= self.index < self.count <= MAX_CHUNKS or not 1 <= len(self.payload) <= PAYLOAD:
            raise ValueError('Invalid chunk')
        return frame(3, DATA_HEADER.pack(identifier(self.image_id), identifier(self.representation_id),
                     self.index, self.count) + self.payload)

    @classmethod
    def decode(cls, wire):
        body = unframe(wire, 3)
        try:
            i, r, index, count = DATA_HEADER.unpack(body[:DATA_HEADER.size])
            packet = cls(i.hex(), r.hex(), index, count, body[DATA_HEADER.size:])
            packet.encode()
            return packet
        except struct.error as exc:
            raise ValueError('Invalid data header') from exc


@dataclass(frozen=True)
class Ack:
    """Hop receipt is never evidence of end-to-end completion."""
    representation_id: str
    recipient: int
    sha256: str
    complete: bool = True

    def __post_init__(self):
        identifier(self.representation_id)
        if not 0 <= self.recipient <= 0xffffffff or type(self.complete) is not bool:
            raise ValueError('Invalid acknowledgment recipient or type')
        if len(self.sha256) != 64 or len(bytes.fromhex(self.sha256)) != 32:
            raise ValueError('Invalid acknowledgment hash')

    def encode(self):
        return frame(4 if self.complete else 5, struct.pack('>16sI32s',
                     identifier(self.representation_id), self.recipient, bytes.fromhex(self.sha256)))

    @classmethod
    def decode(cls, wire):
        if len(wire) < 2 or wire[1] not in (4, 5):
            raise ValueError('Invalid acknowledgment type')
        try:
            r, recipient, digest = struct.unpack('>16sI32s', unframe(wire, wire[1]))
            return cls(r.hex(), recipient, digest.hex(), wire[1] == 4)
        except struct.error as exc:
            raise ValueError('Invalid acknowledgment length') from exc


def missing_frames(representation_id, indices):
    """Batch uint32 missing indices so every selective retry request fits the cap."""
    indices = list(indices)
    if any(type(i) is not int or not 0 <= i < MAX_CHUNKS for i in indices):
        raise ValueError('Invalid missing index')
    batch_size = (MAX_PACKET - 6 - 16) // 4
    for start in range(0, len(indices), batch_size):
        batch = indices[start:start + batch_size]
        yield frame(6, identifier(representation_id) + struct.pack(f'>{len(batch)}I', *batch))


def decode_missing(wire):
    body = unframe(wire, 6)
    if len(body) < 20 or (len(body) - 16) % 4:
        raise ValueError('Invalid missing-chunk request')
    indices = struct.unpack(f'>{(len(body) - 16) // 4}I', body[16:])
    if any(i >= MAX_CHUNKS for i in indices):
        raise ValueError('Invalid missing index')
    return body[:16].hex(), indices

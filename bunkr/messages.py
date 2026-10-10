"""Text and voice representations over the existing bounded packet transport.

Tag 7 adds a message manifest without changing image tags 1–6 or wire version 2.
Data packets use the message ID in both ID fields; completion uses the existing ACK.
"""
from dataclasses import dataclass
from enum import IntEnum
from hashlib import sha256
import math
import shutil
import sqlite3
import struct
import subprocess
from uuid import uuid4
import zlib

from .contract import Ack, Packet, PAYLOAD, ZERO_ID, frame, identifier, unframe

MAX_TEXT = 16 * 1024
MAX_VOICE = 200 * 1024
MAX_UPLOAD = 8 * 1024 * 1024
MAX_SECONDS = 60
SAMPLE_RATE = 16000


class MessageKind(IntEnum):
    TEXT = 0
    VOICE = 1


class MessageCodec(IntEnum):
    UTF8 = 0
    ZLIB_UTF8 = 1
    OPUS = 2


@dataclass(frozen=True)
class MessageManifest:
    message_id: str
    sender: int
    recipient: int
    kind: MessageKind
    codec: MessageCodec
    byte_count: int
    chunk_count: int
    duration_ms: int
    sample_rate: int
    sha256: str
    STRUCT = struct.Struct('>16sIIBBIIII32s')

    def __post_init__(self):
        identifier(self.message_id)
        if self.message_id == ZERO_ID:
            raise ValueError('Message ID must be nonzero')
        if any(type(v) is not int or not 0 < v < 0xffffffff for v in (self.sender, self.recipient)) or self.sender == self.recipient:
            raise ValueError('Invalid message endpoints')
        MessageKind(self.kind)
        MessageCodec(self.codec)
        if len(self.sha256) != 64 or len(bytes.fromhex(self.sha256)) != 32 or self.sha256 != self.sha256.lower():
            raise ValueError('Invalid message hash')
        limit = MAX_TEXT if self.kind == MessageKind.TEXT else MAX_VOICE
        if not 1 <= self.byte_count <= limit or self.chunk_count != math.ceil(self.byte_count / PAYLOAD):
            raise ValueError('Invalid message size or chunk count')
        if self.kind == MessageKind.TEXT:
            if self.codec not in (MessageCodec.UTF8, MessageCodec.ZLIB_UTF8) or self.duration_ms != 0 or self.sample_rate != 0:
                raise ValueError('Invalid text metadata')
        elif self.codec != MessageCodec.OPUS or not 1 <= self.duration_ms <= MAX_SECONDS*1000 or self.sample_rate != SAMPLE_RATE:
            raise ValueError('Invalid voice metadata')

    def encode(self):
        return frame(7, self.STRUCT.pack(identifier(self.message_id), self.sender, self.recipient,
            self.kind, self.codec, self.byte_count, self.chunk_count, self.duration_ms,
            self.sample_rate, bytes.fromhex(self.sha256)))

    @classmethod
    def decode(cls, wire):
        try:
            v = cls.STRUCT.unpack(unframe(wire, 7))
            return cls(v[0].hex(), *v[1:-1], v[-1].hex())
        except struct.error as exc:
            raise ValueError('Invalid message manifest length') from exc


def voice_available():
    return shutil.which('ffmpeg') is not None


def _ffmpeg(data, args):
    if not voice_available():
        raise ValueError('Voice notes require FFmpeg with libopus installed on the local server')
    try:
        process = subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-nostdin',
            '-protocol_whitelist', 'pipe', *args], input=data, capture_output=True, timeout=25)
    except subprocess.TimeoutExpired as exc:
        raise ValueError('Audio processing timed out') from exc
    except OSError as exc:
        raise ValueError('FFmpeg could not be started on the local server') from exc
    if process.returncode:
        raise ValueError('Audio could not be decoded or encoded')
    return process.stdout


def _pcm(data, format=None):
    args = ([] if format is None else ['-f', format]) + ['-i', 'pipe:0', '-map', '0:a:0',
        '-t', str(MAX_SECONDS+1), '-ac', '1', '-ar', str(SAMPLE_RATE), '-f', 's16le', 'pipe:1']
    pcm = _ffmpeg(data, args)
    if not 0 < len(pcm) <= MAX_SECONDS*SAMPLE_RATE*2:
        raise ValueError('Voice notes must be between 0 and 60 seconds')
    return pcm


def encode_voice(data):
    if not isinstance(data, bytes) or not 0 < len(data) <= MAX_UPLOAD:
        raise ValueError('Audio upload must be between 1 byte and 8 MiB')
    pcm = _pcm(data)
    encoded = _ffmpeg(pcm, ['-f', 's16le', '-ar', str(SAMPLE_RATE), '-ac', '1', '-i', 'pipe:0',
        '-c:a', 'libopus', '-b:a', '12000', '-vbr', 'on', '-application', 'voip',
        '-compression_level', '10', '-frame_duration', '60', '-map_metadata', '-1', '-f', 'ogg', 'pipe:1'])
    if len(encoded) > MAX_VOICE:
        raise ValueError('Encoded voice note exceeds 200 KiB')
    return encoded, max(1, round(len(_pcm(encoded, 'ogg')) / (SAMPLE_RATE*2) * 1000))


def decode_text(data, codec):
    if codec == MessageCodec.ZLIB_UTF8:
        decoder = zlib.decompressobj()
        try:
            data = decoder.decompress(data, MAX_TEXT+1)
        except zlib.error as exc:
            raise ValueError('Invalid compressed text') from exc
        if not decoder.eof or decoder.unused_data or decoder.unconsumed_tail:
            raise ValueError('Invalid or oversized compressed text')
    elif codec != MessageCodec.UTF8:
        raise ValueError('Invalid text codec')
    if not 0 < len(data) <= MAX_TEXT:
        raise ValueError('Text must be between 1 byte and 16 KiB')
    text = data.decode('utf-8', errors='strict')
    if not text.strip():
        raise ValueError('Text cannot be blank')
    return text


def verify_content(manifest, data):
    if len(data) != manifest.byte_count or sha256(data).hexdigest() != manifest.sha256:
        raise ValueError('Message hash or length mismatch')
    if manifest.kind == MessageKind.TEXT:
        return decode_text(data, manifest.codec)
    # Enforce Ogg Opus mono before decoding, not just a declared MIME type.
    head = data.find(b'OpusHead', 0, 128)
    if not data.startswith(b'OggS') or head < 0 or len(data) < head+19 or data[head+9] != 1:
        raise ValueError('Expected mono Ogg Opus voice note')
    pcm = _pcm(data, 'ogg')
    if abs(len(pcm)/(SAMPLE_RATE*2)*1000-manifest.duration_ms) > 2:
        raise ValueError('Decoded voice duration does not match manifest')
    return data


@dataclass(frozen=True)
class Message:
    manifest: MessageManifest
    data: bytes

    def packets(self):
        m = self.manifest
        for index in range(m.chunk_count):
            yield Packet(m.message_id, m.message_id, index, m.chunk_count,
                self.data[index*PAYLOAD:(index+1)*PAYLOAD]).encode()


class MessageStore:
    """Durable outgoing messages, partial reconstruction and verified receipt state."""
    def __init__(self, database):
        self.db = sqlite3.connect(database)
        self.db.executescript('''
            CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, manifest BLOB NOT NULL,
                data BLOB, outgoing INTEGER NOT NULL DEFAULT 0, confirmed INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS message_chunks (id TEXT, idx INTEGER, data BLOB NOT NULL,
                PRIMARY KEY (id, idx));
        ''')

    def close(self):
        self.db.close()

    def register(self, manifest):
        wire = manifest.encode()
        existing = self.db.execute('SELECT manifest FROM messages WHERE id=?', (manifest.message_id,)).fetchone()
        if existing and bytes(existing[0]) != wire:
            raise ValueError('Conflicting message manifest')
        with self.db:
            self.db.execute('INSERT OR IGNORE INTO messages(id,manifest) VALUES (?,?)', (manifest.message_id, wire))

    def manifest(self, message_id):
        row = self.db.execute('SELECT manifest FROM messages WHERE id=?', (message_id,)).fetchone()
        if row is None:
            raise ValueError('Unknown message')
        return MessageManifest.decode(bytes(row[0]))

    def _produce(self, data, kind, codec, sender, recipient, duration=0, message_id=None):
        m = MessageManifest(message_id or uuid4().hex, sender, recipient, kind, codec, len(data),
            math.ceil(len(data)/PAYLOAD), duration, SAMPLE_RATE if kind == MessageKind.VOICE else 0, sha256(data).hexdigest())
        verify_content(m, data)
        self.register(m)
        with self.db:
            self.db.execute('UPDATE messages SET data=?,outgoing=1 WHERE id=?', (data,m.message_id))
        return Message(m,data)

    def produce_text(self, text, sender=1, recipient=2, *, message_id=None):
        if not isinstance(text, str):
            raise ValueError('Text must be a string')
        raw = text.encode('utf-8')
        decode_text(raw, MessageCodec.UTF8)
        compressed = zlib.compress(raw, 9)
        data,codec = (compressed,MessageCodec.ZLIB_UTF8) if len(compressed)+8 < len(raw) else (raw,MessageCodec.UTF8)
        return self._produce(data,MessageKind.TEXT,codec,sender,recipient,message_id=message_id)

    def produce_voice(self, data, sender=1, recipient=2, *, message_id=None):
        encoded,duration = encode_voice(data)
        return self._produce(encoded,MessageKind.VOICE,MessageCodec.OPUS,sender,recipient,duration,message_id)

    def completed(self, message_id):
        row = self.db.execute('SELECT data FROM messages WHERE id=?', (message_id,)).fetchone()
        return None if row is None or row[0] is None else bytes(row[0])

    def missing(self, message_id):
        m = self.manifest(message_id)
        if self.completed(message_id) is not None:
            return []
        received = {r[0] for r in self.db.execute('SELECT idx FROM message_chunks WHERE id=?',(message_id,))}
        return [i for i in range(m.chunk_count) if i not in received]

    def receive(self, wire):
        p = Packet.decode(wire)
        m = self.manifest(p.representation_id)
        expected = min(PAYLOAD,m.byte_count-p.index*PAYLOAD)
        if p.image_id != m.message_id or p.count != m.chunk_count or len(p.payload) != expected:
            raise ValueError('Chunk does not match message manifest')
        old = self.db.execute('SELECT data FROM message_chunks WHERE id=? AND idx=?',(m.message_id,p.index)).fetchone()
        if old and bytes(old[0]) != p.payload:
            raise ValueError('Conflicting duplicate message chunk')
        if self.completed(m.message_id) is not None:
            return self.completion_ack(m.message_id)
        with self.db:
            self.db.execute('INSERT OR IGNORE INTO message_chunks VALUES (?,?,?)',(m.message_id,p.index,p.payload))
        if self.missing(m.message_id):
            return None
        data = b''.join(bytes(row[0]) for row in self.db.execute('SELECT data FROM message_chunks WHERE id=? ORDER BY idx',(m.message_id,)))
        try:
            verify_content(m,data)
        except ValueError:
            with self.db:
                self.db.execute('DELETE FROM message_chunks WHERE id=?',(m.message_id,))
            raise
        with self.db:
            self.db.execute('UPDATE messages SET data=? WHERE id=?',(data,m.message_id))
        return self.completion_ack(m.message_id)

    def completion_ack(self, message_id):
        m = self.manifest(message_id)
        if self.completed(message_id) is None:
            raise ValueError('Cannot acknowledge an incomplete message')
        return Ack(m.message_id,m.recipient,m.sha256).encode()

    def confirm(self, wire):
        ack = Ack.decode(wire)
        m = self.manifest(ack.representation_id)
        outgoing = self.db.execute('SELECT outgoing FROM messages WHERE id=?',(m.message_id,)).fetchone()[0]
        if not outgoing or not ack.complete or ack.recipient != m.recipient or ack.sha256 != m.sha256:
            raise ValueError('Not a matching message completion ACK')
        with self.db:
            self.db.execute('UPDATE messages SET confirmed=1 WHERE id=?',(m.message_id,))

    def confirmed(self, message_id):
        row = self.db.execute('SELECT confirmed FROM messages WHERE id=?',(message_id,)).fetchone()
        return bool(row and row[0])

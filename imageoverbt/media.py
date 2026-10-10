"""Pillow encoding and restart-safe SQLite source/representation/chunk storage."""
from dataclasses import dataclass
from hashlib import sha256
from io import BytesIO
import json
import math
import sqlite3

from PIL import Image, ImageOps

from .contract import (Ack, Bounds, Codec, FULL_BOUNDS, Kind, Manifest,
                       MAX_BYTES, MAX_PACKET, PAYLOAD, Packet, Request, WIRE_VERSION, ZERO_ID)


def digest(data):
    return sha256(data).hexdigest()


def image_bytes(image, codec, quality):
    output = BytesIO()
    options = {'quality': quality}
    if codec == Codec.JPEG:
        options.update(optimize=True, progressive=False, subsampling=2)
    else:
        options.update(method=6)
    image.save(output, format=codec.name, **options)
    return output.getvalue()


@dataclass(frozen=True)
class Encoding:
    data: bytes
    codec: Codec
    width: int
    height: int
    quality: int


def encode_budget(image, budget, max_dimension, codec):
    """Choose largest allowed dimensions, then highest tested quality within budget."""
    if not 64 <= budget <= MAX_BYTES or not 1 <= max_dimension <= 8192:
        raise ValueError('Invalid byte budget or maximum dimension')
    codec = Codec(codec)
    candidate = image.convert('RGB').copy()
    candidate.thumbnail((max_dimension, max_dimension), Image.Resampling.LANCZOS)
    while True:
        for quality in (85, 70, 55, 40, 25, 10):
            data = image_bytes(candidate, codec, quality)
            if len(data) <= budget:
                return Encoding(data, codec, *candidate.size, quality)
        if candidate.size == (1, 1):
            raise ValueError('Budget too small for this codec')
        candidate = candidate.resize(tuple(max(1, int(v * .75)) for v in candidate.size),
                                     Image.Resampling.LANCZOS)


@dataclass(frozen=True)
class Representation:
    manifest: Manifest
    data: bytes

    def packets(self):
        for index in range(self.manifest.chunk_count):
            yield Packet(self.manifest.image_id, self.manifest.representation_id, index,
                         self.manifest.chunk_count, self.data[index * PAYLOAD:(index + 1) * PAYLOAD]).encode()


class Store:
    """Single-process endpoint store. Use one database per endpoint, close on shutdown."""
    def __init__(self, path):
        self.db = sqlite3.connect(path)
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.executescript('''
            CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY, data BLOB NOT NULL);
            CREATE TABLE IF NOT EXISTS encodings (key TEXT PRIMARY KEY, data BLOB NOT NULL,
                codec INTEGER, width INTEGER, height INTEGER, quality INTEGER);
            CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, wire BLOB NOT NULL);
            CREATE TABLE IF NOT EXISTS manifests (id TEXT PRIMARY KEY, wire BLOB NOT NULL);
            CREATE TABLE IF NOT EXISTS chunks (rep TEXT, idx INTEGER, data BLOB NOT NULL,
                PRIMARY KEY(rep, idx));
            CREATE TABLE IF NOT EXISTS completed (rep TEXT PRIMARY KEY, data BLOB NOT NULL);
            CREATE TABLE IF NOT EXISTS confirmations (rep TEXT PRIMARY KEY);
        ''')

    def close(self):
        self.db.close()

    def retain(self, path):
        """Keep a lossless, orientation-corrected local source; never crop the preview."""
        with Image.open(path) as original:
            image = ImageOps.exif_transpose(original).convert('RGB')
            if max(image.size) > 65535:
                raise ValueError('Source dimensions exceed contract')
            out = BytesIO()
            image.save(out, format='PNG')
        data = out.getvalue()
        image_id = digest(data)[:32]
        with self.db:
            self.db.execute('INSERT OR IGNORE INTO sources VALUES (?, ?)', (image_id, data))
        return image_id

    def source(self, image_id):
        row = self.db.execute('SELECT data FROM sources WHERE id=?', (image_id,)).fetchone()
        if row is None:
            raise KeyError('Source photo is not retained locally')
        image = Image.open(BytesIO(row[0]))
        image.load()
        return image

    def produce(self, image_id, sender, recipient, *, request=None,
                codec=Codec.WEBP, budget=None):
        """Call for detail only after transport delivers a decoded request to sender."""
        source = self.source(image_id)
        kind, bounds, detail, request_id = Kind.PREVIEW, FULL_BOUNDS, 96, ZERO_ID
        if request is not None:
            # Validate even when the caller constructed a request in memory.
            request = Request.decode(request.encode())
            if request.image_id != image_id or request.recipient != recipient:
                raise ValueError('Request targets a different image or recipient')
            kind, bounds, detail, request_id = request.kind, request.bounds, request.detail, request.request_id
        budget = budget if budget is not None else (1500 if kind == Kind.PREVIEW else 48000)
        key = digest(json.dumps([image_id, bounds.values, detail, int(codec), budget]).encode())
        row = self.db.execute('SELECT data, codec, width, height, quality FROM encodings WHERE key=?',
                              (key,)).fetchone()
        if row:
            encoded = Encoding(row[0], Codec(row[1]), *row[2:])
        else:
            encoded = encode_budget(source.crop(bounds.pixels(*source.size)), budget, detail, codec)
        rep_id = digest(json.dumps([key, sender, recipient, request_id, int(kind), WIRE_VERSION, MAX_PACKET]).encode())[:32]
        manifest = Manifest(image_id, rep_id, sender, recipient, kind, encoded.codec,
                            encoded.width, encoded.height, len(encoded.data),
                            math.ceil(len(encoded.data) / PAYLOAD), digest(encoded.data),
                            request_id, bounds, *source.size)
        with self.db:
            if request:
                old = self.db.execute('SELECT wire FROM requests WHERE id=?', (request_id,)).fetchone()
                if old and old[0] != request.encode():
                    raise ValueError('Request ID reused with different selection')
                self.db.execute('INSERT OR IGNORE INTO requests VALUES (?, ?)', (request_id, request.encode()))
            self.db.execute('INSERT OR IGNORE INTO encodings VALUES (?, ?, ?, ?, ?, ?)',
                            (key, encoded.data, encoded.codec, encoded.width, encoded.height, encoded.quality))
            self._register(manifest)
        return Representation(manifest, encoded.data)

    def register(self, manifest):
        with self.db:
            self._register(manifest)

    def _register(self, manifest):
        wire = manifest.encode()
        old = self.db.execute('SELECT wire FROM manifests WHERE id=?', (manifest.representation_id,)).fetchone()
        if old and old[0] != wire:
            raise ValueError('Representation ID reused with different manifest')
        self.db.execute('INSERT OR IGNORE INTO manifests VALUES (?, ?)', (manifest.representation_id, wire))

    def manifest(self, rep_id):
        row = self.db.execute('SELECT wire FROM manifests WHERE id=?', (rep_id,)).fetchone()
        if row is None:
            raise KeyError('Manifest must arrive before representation chunks')
        return Manifest.decode(row[0])

    def missing(self, rep_id):
        manifest = self.manifest(rep_id)
        if self.completed(rep_id) is not None:
            return []
        received = {r[0] for r in self.db.execute('SELECT idx FROM chunks WHERE rep=?', (rep_id,))}
        return [i for i in range(manifest.chunk_count) if i not in received]

    def completed(self, rep_id):
        row = self.db.execute('SELECT data FROM completed WHERE rep=?', (rep_id,)).fetchone()
        return row[0] if row else None

    def receive(self, wire):
        """Return a verified completion ACK or None; never acknowledge incomplete bytes."""
        packet = Packet.decode(wire)
        manifest = self.manifest(packet.representation_id)
        expected = min(PAYLOAD, manifest.byte_count - packet.index * PAYLOAD)
        if (packet.image_id != manifest.image_id or packet.count != manifest.chunk_count
                or len(packet.payload) != expected):
            raise ValueError('Chunk does not match manifest')
        if self.completed(packet.representation_id) is not None:
            return self.completion_ack(packet.representation_id)
        with self.db:
            old = self.db.execute('SELECT data FROM chunks WHERE rep=? AND idx=?',
                                  (packet.representation_id, packet.index)).fetchone()
            if old and old[0] != packet.payload:
                raise ValueError('Conflicting duplicate chunk')
            self.db.execute('INSERT OR IGNORE INTO chunks VALUES (?, ?, ?)',
                            (packet.representation_id, packet.index, packet.payload))
        if self.missing(packet.representation_id):
            return None
        data = b''.join(row[0] for row in self.db.execute(
            'SELECT data FROM chunks WHERE rep=? ORDER BY idx', (packet.representation_id,)))
        try:
            if len(data) != manifest.byte_count or digest(data) != manifest.sha256:
                raise ValueError('Representation hash mismatch')
            with Image.open(BytesIO(data)) as decoded:
                decoded.load()
                if decoded.size != (manifest.width, manifest.height) or decoded.format != manifest.codec.name:
                    raise ValueError('Decoded representation does not match manifest')
        except Exception:
            # Hash failure cannot identify which CRC-valid chunk was wrong. Restart this
            # representation only; unrelated partial/completed representations survive.
            with self.db:
                self.db.execute('DELETE FROM chunks WHERE rep=?', (packet.representation_id,))
            raise
        with self.db:
            self.db.execute('INSERT INTO completed VALUES (?, ?)', (packet.representation_id, data))
            self.db.execute('DELETE FROM chunks WHERE rep=?', (packet.representation_id,))
        return self.completion_ack(packet.representation_id)

    def completion_ack(self, rep_id):
        if self.completed(rep_id) is None:
            raise ValueError('Cannot acknowledge an unverified representation')
        manifest = self.manifest(rep_id)
        return Ack(rep_id, manifest.recipient, manifest.sha256).encode()

    def confirm(self, wire):
        ack = Ack.decode(wire)
        manifest = self.manifest(ack.representation_id)
        if not ack.complete or ack.recipient != manifest.recipient or ack.sha256 != manifest.sha256:
            raise ValueError('Acknowledgment is not matching receiver completion')
        with self.db:
            self.db.execute('INSERT OR IGNORE INTO confirmations VALUES (?)', (ack.representation_id,))

    def confirmed(self, rep_id):
        return self.db.execute('SELECT 1 FROM confirmations WHERE rep=?', (rep_id,)).fetchone() is not None

    def decoded(self, rep_id):
        data = self.completed(rep_id)
        if data is None:
            raise ValueError('Representation is not verified')
        image = Image.open(BytesIO(data))
        image.load()
        return image, self.manifest(rep_id).bounds

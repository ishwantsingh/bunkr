"""Local messaging demo backed by real text, voice and image codecs."""
import argparse
import base64
from functools import partial
from hashlib import sha256
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import parse_qs, urlsplit

from PIL import Image
from pillow_heif import register_heif_opener

from .contract import Ack, Bounds, Request
from .media import Store
from .messages import MessageStore, MAX_UPLOAD, voice_available

register_heif_opener(thumbnails=False)

UI_DIR = Path(__file__).with_name('ui')
SOURCE = Path(__file__).resolve().parents[1] / 'fixtures/trail-sign.jpg'
MAX_PHOTO_UPLOAD = 12 * 1024 * 1024
MAX_PHOTO_PIXELS = 50_000_000
PHOTO_FORMATS = {'JPEG', 'PNG', 'WEBP', 'HEIF'}


class DemoModel:
    def __init__(self, database, source=SOURCE):
        self.database = database
        with self.store() as store:
            self.image_id = store.retain(source)
        try:
            from .meshtastic_transport import data_message, radio_size
            self.wrap, self.radio_size = data_message, radio_size
            self.transport = 'Meshtastic protobufs · private app 256'
        except ImportError:
            self.wrap = None
            self.radio_size = lambda wire: len(wire)
            self.transport = 'imageoverbt v2 · install Meshtastic extra for protobuf wrapping'

    def store(self):
        from contextlib import contextmanager
        @contextmanager
        def opened():
            store = Store(self.database)
            try:
                yield store
            finally:
                store.close()
        return opened()

    def envelope(self, wire):
        if self.wrap:
            message = self.wrap(wire)
            # Use the upstream generated protobuf rather than copying its schema.
            wire = type(message).FromString(message.SerializeToString()).payload
        return bytes(wire).hex()

    def representation(self, rep):
        packets = list(rep.packets())
        return dict(manifest=self.envelope(rep.manifest.encode()),
                    packets=[self.envelope(p) for p in packets],
                    radio_bytes=[self.radio_size(p) for p in packets])

    def source_image(self, image_id=None):
        with self.store() as store:
            image = store.source(image_id or self.image_id)
            image.thumbnail((1600, 1600))
            output = BytesIO()
            image.save(output, format='JPEG', quality=90)
            return output.getvalue()

    def initial(self, image_id=None):
        image_id = image_id or self.image_id
        with self.store() as store:
            preview = store.produce(image_id, 1, 2, budget=300)
            return dict(image_id=image_id, transport=self.transport,
                        source_url=f'/api/source.jpg?image_id={image_id}',
                        preview=self.representation(preview),
                        default_bounds=([.18, .25, .84, .59] if image_id == self.image_id
                                        else [.2, .2, .8, .8]),
                        voice_available=voice_available())

    def import_photo(self, data):
        if not 0 < len(data) <= MAX_PHOTO_UPLOAD:
            raise ValueError('Choose a photo up to 12 MiB.')
        try:
            with Image.open(BytesIO(data)) as image:
                if image.format not in PHOTO_FORMATS:
                    raise ValueError('Choose a JPG, PNG, WebP or HEIC photo.')
                if image.width * image.height > MAX_PHOTO_PIXELS:
                    raise ValueError('Choose a photo up to 50 megapixels.')
                if max(image.size) > 65535:
                    raise ValueError('Photo dimensions exceed the supported limit.')
                if getattr(image, 'is_animated', False):
                    raise ValueError('Choose a still photo, not an animation.')
                image.load()  # Fully decode before retaining or changing the UI.
            with self.store() as store:
                image_id = store.retain(BytesIO(data))
            # Sources are immutable and requests name their image explicitly.
            # A cancelled upload cannot silently replace another photo's crops.
            return self.initial(image_id)
        except (OSError, Image.DecompressionBombError) as exc:
            raise ValueError('This photo could not be read. Choose a JPG, PNG, WebP or HEIC photo.') from exc

    def message(self, payload):
        sender = payload.get('sender', 1)
        if type(sender) is not int or sender not in (1, 2):
            raise ValueError('Choose sender 1 or 2')
        store = MessageStore(self.database)
        try:
            kind = payload['kind']
            if kind == 'text':
                original = payload['text']
                message = store.produce_text(original, sender, 3-sender)
                input_bytes = len(original.encode('utf-8'))
            elif kind in ('voice', 'voice_sample'):
                if kind == 'voice_sample':
                    data = (SOURCE.parent / 'trail-voice.ogg').read_bytes()
                else:
                    encoded = payload['audio']
                    if not isinstance(encoded, str) or len(encoded) > (MAX_UPLOAD+2)//3*4:
                        raise ValueError('Audio upload exceeds 8 MiB')
                    data = base64.b64decode(encoded, validate=True)
                input_bytes = len(data)
                message = store.produce_voice(data, sender, 3-sender)
            else:
                raise ValueError('Choose text or voice')
            result = self.representation(message)
            result['input_bytes'] = input_bytes
            return result
        finally:
            store.close()

    def confirm_message(self, payload):
        wire = bytes.fromhex(payload['ack'])
        store = MessageStore(self.database)
        try:
            store.confirm(wire)
            return dict(confirmed=store.confirmed(Ack.decode(wire).representation_id))
        finally:
            store.close()

    def crop(self, payload):
        bounds = Bounds.normalized(*payload['bounds'])
        image_id = payload.get('image_id', self.image_id)
        request = Request(payload['request_id'], image_id, 2, bounds, 1024)
        # A UI request arrives here only after its simulated reverse-path delivery.
        request = Request.decode(bytes.fromhex(self.envelope(request.encode())))
        tiles = []
        with self.store() as store:
            for row in range(2):
                for col in range(3):
                    x = [bounds.left + (bounds.right - bounds.left) * n // 3 for n in range(4)]
                    y = [bounds.top + (bounds.bottom - bounds.top) * n // 2 for n in range(3)]
                    tile_bounds = Bounds(x[col], y[row], x[col + 1], y[row + 1])
                    tile_id = sha256(f'{request.request_id}:{row}:{col}'.encode()).hexdigest()[:32]
                    tile_request = Request(tile_id, image_id, 2, tile_bounds, 512)
                    rep = store.produce(image_id, 1, 2, request=tile_request, budget=8000)
                    tiles.append(self.representation(rep))
        return dict(request=self.envelope(request.encode()), tiles=tiles)

    def confirm(self, payload):
        acknowledgments = payload['acks']
        if not isinstance(acknowledgments, list) or not 1 <= len(acknowledgments) <= 6:
            raise ValueError('Expected one to six verified receipt acknowledgments')
        with self.store() as store:
            for wire in acknowledgments:
                store.confirm(bytes.fromhex(wire))
            return dict(confirmed=all(store.confirmed(Ack.decode(bytes.fromhex(w)).representation_id)
                                      for w in acknowledgments))


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, model, **kwargs):
        self.model = model
        super().__init__(*args, directory=str(UI_DIR), **kwargs)

    def end_headers(self):
        # The demo serves editable ES modules directly. Never combine a cached
        # dependency with a newer importing module after a local code change.
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def respond(self, value, status=200):
        data = json.dumps(value).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        target = urlsplit(self.path)
        try:
            if target.path == '/api/demo':
                self.respond(self.model.initial())
            elif target.path == '/api/source.jpg':
                image_id = parse_qs(target.query).get('image_id', [None])[0]
                data = self.model.source_image(image_id)
                self.send_response(200)
                self.send_header('Content-Type', 'image/jpeg')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            elif target.path.startswith('/api/'):
                self.respond({'error': 'Not found'}, 404)
            else:
                super().do_GET()
        except (ValueError, KeyError, TypeError) as exc:
            self.respond({'error': str(exc)}, 400)

    def do_POST(self):
        try:
            size = int(self.headers.get('Content-Length', '0'))
            limit = MAX_PHOTO_UPLOAD if self.path in ('/api/message', '/api/photo') else 65536
            if not 0 < size <= limit:
                raise ValueError('Invalid request size')
            body = self.rfile.read(size)
            if len(body) != size:
                raise ValueError('Incomplete upload')
            if self.path == '/api/photo':
                self.respond(self.model.import_photo(body))
                return
            payload = json.loads(body)
            if self.path == '/api/crop':
                self.respond(self.model.crop(payload))
            elif self.path == '/api/confirm':
                self.respond(self.model.confirm(payload))
            elif self.path == '/api/message':
                self.respond(self.model.message(payload))
            elif self.path == '/api/message/confirm':
                self.respond(self.model.confirm_message(payload))
            else:
                self.respond({'error': 'Not found'}, 404)
        except (ValueError, KeyError, TypeError, OverflowError) as exc:
            self.respond({'error': str(exc)}, 400)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--source', type=Path, default=SOURCE)
    args = parser.parse_args()
    with TemporaryDirectory(prefix='imageoverbt-ui-') as work:
        model = DemoModel(Path(work) / 'media.sqlite3', args.source)
        server = ThreadingHTTPServer(('127.0.0.1', args.port), partial(Handler, model=model))
        print(f'imageoverbt UI: http://127.0.0.1:{server.server_port}', flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            server.server_close()


if __name__ == '__main__':
    main()

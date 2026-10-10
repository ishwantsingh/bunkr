from functools import partial
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from io import BytesIO
import json
from pathlib import Path
import tempfile
from threading import Thread
import unittest
from unittest.mock import patch

from PIL import Image

from imageoverbt.contract import Manifest
from imageoverbt.media import Store
from imageoverbt.ui_server import DemoModel, Handler, MAX_PHOTO_UPLOAD


def photo(format='PNG', size=(240, 360), color=(25, 125, 220), **kwargs):
    output = BytesIO()
    Image.new('RGB', size, color).save(output, format=format, **kwargs)
    return output.getvalue()


class PhotoImportTests(unittest.TestCase):
    def setUp(self):
        self.work = tempfile.TemporaryDirectory()
        self.model = DemoModel(Path(self.work.name) / 'media.sqlite3')
        self.addCleanup(self.work.cleanup)

    def test_supported_photos_produce_bounded_preview_and_browser_jpeg(self):
        for format in ('JPEG', 'PNG', 'WEBP', 'HEIF'):
            with self.subTest(format=format):
                result = self.model.import_photo(photo(format))
                manifest = Manifest.decode(bytes.fromhex(result['preview']['manifest']))
                self.assertEqual(manifest.image_id, result['image_id'])
                self.assertEqual((manifest.source_width, manifest.source_height), (240, 360))
                self.assertLessEqual(manifest.byte_count, 300)
                self.assertTrue(all(len(bytes.fromhex(w)) <= 220 for w in result['preview']['packets']))
                image = Image.open(BytesIO(self.model.source_image(result['image_id'])))
                self.assertEqual(image.size, (240, 360))
                self.assertEqual(image.format, 'JPEG')
                self.assertEqual(result['default_bounds'], [.2, .2, .8, .8])

    def test_exif_orientation_is_preserved_in_preview_source_and_crops(self):
        exif = Image.Exif()
        exif[274] = 6
        result = self.model.import_photo(photo('JPEG', size=(360, 240), exif=exif))
        m = Manifest.decode(bytes.fromhex(result['preview']['manifest']))
        self.assertEqual((m.source_width, m.source_height), (240, 360))
        with self.model.store() as store:
            self.assertEqual(store.source(result['image_id']).size, (240, 360))

    def test_crops_keep_the_explicit_source_after_another_import(self):
        first = self.model.import_photo(photo(color=(255, 0, 0)))
        second = self.model.import_photo(photo(color=(0, 0, 255)))
        self.assertNotEqual(first['image_id'], second['image_id'])
        for result in (first, second):
            response = self.model.crop(dict(image_id=result['image_id'], bounds=[.2, .2, .8, .8],
                                            request_id=result['image_id']))
            receiver = Store(':memory:')
            self.addCleanup(receiver.close)
            acks = []
            for tile in response['tiles']:
                m = Manifest.decode(bytes.fromhex(tile['manifest']))
                self.assertEqual(m.image_id, result['image_id'])
                receiver.register(m)
                for wire in reversed(tile['packets']):
                    receiver.receive(bytes.fromhex(wire))
                self.assertIsNotNone(receiver.completed(m.representation_id))
                acks.append(receiver.completion_ack(m.representation_id).hex())
            self.assertTrue(self.model.confirm({'acks': acks})['confirmed'])
        # Import is preparation, not a global mutation that survives cancellation.
        self.assertNotEqual(self.model.initial()['image_id'], first['image_id'])

    def test_bad_uploads_leave_the_current_photo_unchanged(self):
        original = self.model.initial()['image_id']
        for data in (b'', b'not an image', photo('GIF'), photo()[:40]):
            with self.subTest(data=data[:10]), self.assertRaises(ValueError):
                self.model.import_photo(data)
        with patch('imageoverbt.ui_server.MAX_PHOTO_UPLOAD', 10):
            with self.assertRaisesRegex(ValueError, '12 MiB'):
                self.model.import_photo(photo())
        with patch('imageoverbt.ui_server.MAX_PHOTO_PIXELS', 100):
            with self.assertRaisesRegex(ValueError, 'megapixels'):
                self.model.import_photo(photo())
        animated = BytesIO()
        Image.new('RGB', (10, 10), 'red').save(animated, format='WEBP', save_all=True,
                                             append_images=[Image.new('RGB', (10, 10), 'blue')], duration=100)
        with self.assertRaisesRegex(ValueError, 'animation'):
            self.model.import_photo(animated.getvalue())
        self.assertEqual(self.model.initial()['image_id'], original)

    def test_http_upload_source_and_crop_contract(self):
        class QuietHandler(Handler):
            def log_message(self, *args):
                pass
        server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, model=self.model))
        worker = Thread(target=server.serve_forever, daemon=True)
        worker.start()
        self.addCleanup(server.server_close)
        self.addCleanup(worker.join, 2)
        self.addCleanup(server.shutdown)
        def request(method, path, body=None, headers=None):
            connection = HTTPConnection(*server.server_address, timeout=5)
            try:
                connection.request(method, path, body, headers or {})
                response = connection.getresponse()
                return response.status, response.read(), response.getheader('Content-Type')
            finally:
                connection.close()
        status, body, _ = request('POST', '/api/photo', photo(), {'Content-Type': 'application/octet-stream'})
        self.assertEqual(status, 200)
        result = json.loads(body)
        status, body, content_type = request('GET', result['source_url'])
        self.assertEqual((status, content_type), (200, 'image/jpeg'))
        self.assertEqual(Image.open(BytesIO(body)).size, (240, 360))
        payload = dict(image_id=result['image_id'], bounds=[.2, .2, .8, .8], request_id='ab'*16)
        status, body, _ = request('POST', '/api/crop', json.dumps(payload))
        self.assertEqual(status, 200)
        self.assertEqual(len(json.loads(body)['tiles']), 6)
        self.assertEqual(request('POST', '/api/photo', b'invalid')[0], 400)
        self.assertEqual(request('POST', '/api/photo', b'', {'Content-Length': str(MAX_PHOTO_UPLOAD+1)})[0], 400)
        self.assertEqual(request('GET', '/api/source.jpg?image_id=unknown')[0], 400)

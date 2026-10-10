from dataclasses import replace
from hashlib import sha256
from pathlib import Path
import tempfile
import unittest
import zlib

from imageoverbt.contract import Ack, Packet, PAYLOAD
from imageoverbt.messages import (MessageStore, MessageManifest, MessageKind, MessageCodec,
    MAX_TEXT, decode_text, voice_available)
from imageoverbt.ui_server import DemoModel

FIXTURE = Path(__file__).resolve().parents[1] / 'fixtures/trail-voice.ogg'


class MessageTests(unittest.TestCase):
    def setUp(self):
        self.sender=MessageStore(':memory:')
        self.receiver=MessageStore(':memory:')

    def tearDown(self):
        self.sender.close();self.receiver.close()

    def transfer(self,message):
        m=MessageManifest.decode(message.manifest.encode())
        self.receiver.register(m)
        wires=list(message.packets())
        for wire in reversed(wires+wires[:1]):
            self.assertLessEqual(len(wire),220)
            self.receiver.receive(wire)
        self.assertEqual(self.receiver.completed(m.message_id),message.data)
        self.assertFalse(self.sender.confirmed(m.message_id))
        self.sender.confirm(self.receiver.completion_ack(m.message_id))
        self.assertTrue(self.sender.confirmed(m.message_id))

    def test_unicode_roundtrip_and_packet_boundaries(self):
        for text in ['Hi 🌲 नमस्ते', '🌲'*4096, 'x'*174, 'x'*175]:
            msg=self.sender.produce_text(text)
            self.transfer(msg)
            self.assertEqual(decode_text(msg.data,msg.manifest.codec),text)

    def test_compression_only_when_it_saves_bytes(self):
        short=self.sender.produce_text('Hi')
        self.assertEqual(short.manifest.codec,MessageCodec.UTF8)
        long=self.sender.produce_text('Meet at the junction. '*400)
        self.assertEqual(long.manifest.codec,MessageCodec.ZLIB_UTF8)
        self.assertLess(len(long.data),len(('Meet at the junction. '*400).encode())//10)

    def test_blank_oversize_and_invalid_utf8_rejected(self):
        for text in ['', ' \n', '🌲'*(MAX_TEXT//4+1), None]:
            with self.assertRaises((ValueError,TypeError)):
                self.sender.produce_text(text)
        for data,codec in [(b'\xff',0),(zlib.compress(b'x'*(MAX_TEXT+1)),1),(zlib.compress(b'hi')+b'extra',1),(b'not zlib',1)]:
            with self.assertRaises(ValueError):decode_text(data,codec)

    def test_manifest_constraints_and_crc(self):
        m=self.sender.produce_text('hello').manifest
        self.assertEqual(len(m.encode()),80)
        for changes in [{'codec':2},{'duration_ms':2},{'sample_rate':16000},{'chunk_count':2},
                        {'recipient':m.sender},{'message_id':'00'*16},{'kind':8},{'byte_count':0}]:
            with self.assertRaises(ValueError):replace(m,**changes)
        wire=bytearray(m.encode());wire[-1]^=1
        with self.assertRaises(ValueError):MessageManifest.decode(bytes(wire))

    def test_partial_receive_and_ack_semantics(self):
        msg=self.sender.produce_text(''.join(chr(0x400+i) for i in range(1000)))
        m=msg.manifest;self.receiver.register(m)
        self.receiver.receive(next(msg.packets()))
        self.assertIsNone(self.receiver.completed(m.message_id))
        self.assertTrue(self.receiver.missing(m.message_id))
        with self.assertRaises(ValueError):self.receiver.completion_ack(m.message_id)
        for ack in [Ack(m.message_id,2,m.sha256,False),Ack(m.message_id,1,m.sha256),Ack(m.message_id,2,'00'*32)]:
            with self.assertRaises(ValueError):self.sender.confirm(ack.encode())
        self.assertFalse(self.sender.confirmed(m.message_id))

    def test_conflicting_manifest_and_chunks_rejected(self):
        msg=self.sender.produce_text('hello');m=msg.manifest;self.receiver.register(m)
        with self.assertRaises(ValueError):self.receiver.register(replace(m,sha256='ff'*32))
        packet=Packet.decode(next(msg.packets()));self.receiver.receive(packet.encode())
        with self.assertRaises(ValueError):self.receiver.receive(replace(packet,payload=b'jello').encode())
        with self.assertRaises(ValueError):self.receiver.receive(replace(packet,image_id='ff'*16).encode())

    def test_crc_valid_bad_hash_clears_chunks_for_retry(self):
        msg=self.sender.produce_text('hello');m=msg.manifest;self.receiver.register(m)
        packet=Packet.decode(next(msg.packets()))
        with self.assertRaises(ValueError):self.receiver.receive(replace(packet,payload=b'jello').encode())
        self.assertEqual(self.receiver.missing(m.message_id),[0])
        self.receiver.receive(packet.encode())
        self.assertEqual(self.receiver.completed(m.message_id),b'hello')

    def test_restart_recovers_partial_and_confirmation(self):
        msg=self.sender.produce_text(''.join(chr(0x400+i) for i in range(1000)))
        with tempfile.TemporaryDirectory() as work:
            path=Path(work)/'messages.db';store=MessageStore(path);store.register(msg.manifest)
            wires=list(msg.packets());store.receive(wires[0]);store.close()
            store=MessageStore(path)
            self.assertNotIn(0,store.missing(msg.manifest.message_id))
            for wire in wires[1:]:store.receive(wire)
            ack=store.completion_ack(msg.manifest.message_id);store.close()
            store=MessageStore(path);self.assertEqual(store.completion_ack(msg.manifest.message_id),ack);store.close()
            sender=MessageStore(path);out=sender.produce_text('durable receipt');sender.confirm(Ack(out.manifest.message_id,2,out.manifest.sha256).encode());sender.close()
            sender=MessageStore(path);self.assertTrue(sender.confirmed(out.manifest.message_id));sender.close()

    @unittest.skipUnless(voice_available(),'FFmpeg is optional for text-only installs')
    def test_real_voice_compression_playable_roundtrip(self):
        from imageoverbt.messages import _pcm
        import io,wave
        pcm=_pcm(FIXTURE.read_bytes(),'ogg');buffer=io.BytesIO()
        with wave.open(buffer,'wb') as w:w.setnchannels(1);w.setsampwidth(2);w.setframerate(16000);w.writeframes(pcm)
        source=buffer.getvalue();msg=self.sender.produce_voice(source,sender=2,recipient=1)
        self.assertLess(len(msg.data),len(source)//8)
        self.assertEqual(msg.manifest.codec,MessageCodec.OPUS)
        self.assertGreater(msg.manifest.duration_ms,1000)
        self.transfer(msg)

    @unittest.skipUnless(voice_available(),'FFmpeg is optional for text-only installs')
    def test_invalid_audio_and_overlong_notes_rejected(self):
        from imageoverbt.messages import encode_voice
        import io,wave
        for data in [b'',b'not audio',b'\0'*(8*1024*1024+1)]:
            with self.assertRaises(ValueError):encode_voice(data)
        buf=io.BytesIO()
        with wave.open(buf,'wb') as w:w.setnchannels(1);w.setsampwidth(2);w.setframerate(16000);w.writeframes(b'\0'*(61*16000*2))
        with self.assertRaises(ValueError):encode_voice(buf.getvalue())

    def test_official_meshtastic_envelope(self):
        try:
            from imageoverbt.meshtastic_transport import data_message,radio_size
        except ImportError:self.skipTest('Meshtastic extra not installed')
        msg=self.sender.produce_text('hello'*100)
        for wire in [msg.manifest.encode(),*msg.packets()]:
            self.assertEqual(bytes(data_message(wire).payload),wire)
            self.assertLessEqual(radio_size(wire),255)


class MessageAPIModelTests(unittest.TestCase):
    def test_text_api_and_matching_ack(self):
        with tempfile.TemporaryDirectory() as work:
            model=DemoModel(Path(work)/'demo.db')
            result=model.message({'sender':2,'kind':'text','text':'Take the left trail 🌲'})
            m=MessageManifest.decode(bytes.fromhex(result['manifest']))
            self.assertEqual((m.sender,m.recipient),(2,1))
            receiver=MessageStore(':memory:');receiver.register(m)
            for wire in result['packets']:receiver.receive(bytes.fromhex(wire))
            ack=receiver.completion_ack(m.message_id);receiver.close()
            self.assertTrue(model.confirm_message({'ack':ack.hex()})['confirmed'])
            for payload in [{'sender':3,'kind':'text','text':'hi'},{'kind':'video'},{'kind':'voice','audio':'not-base64'}]:
                with self.assertRaises(ValueError):model.message(payload)

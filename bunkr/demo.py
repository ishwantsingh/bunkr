"""Offline Phase 1 acceptance demo; no mesh timing or delivery claims are simulated."""
import argparse
from dataclasses import asdict
import json
from pathlib import Path
import random
import tempfile

from PIL import Image, ImageDraw

from .contract import Bounds, Codec, Manifest, MAX_PACKET, Request, missing_frames
from .media import Store, encode_budget

SIGN_BOUNDS = Bounds.normalized(.18, .25, .84, .59)


def run(source, output):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as work:
        sender = Store(Path(work) / 'sender.db')
        receiver = Store(Path(work) / 'receiver.db')
        try:
            image_id = sender.retain(source)
            preview = sender.produce(image_id, 1, 2, budget=300)
            request = Request('10' * 16, image_id, 2, SIGN_BOUNDS, 1024)
            # Explicit wire round trip: generating a request in the recipient UI
            # must not itself cause the sender to produce a crop.
            crop = sender.produce(image_id, 1, 2, request=Request.decode(request.encode()))
            report = {'source_image_id': image_id, 'packet_cap': MAX_PACKET, 'seed': 42,
                      'representations': [], 'codec_comparison': []}
            for name, rep in (('preview', preview), ('crop', crop)):
                receiver.register(Manifest.decode(rep.manifest.encode()))
                packets = list(rep.packets())
                # Reordering, duplicate chunks, deterministic gaps, process restart.
                shuffled = packets[1::2] + packets[1::4]
                random.Random(42).shuffle(shuffled)
                for wire in shuffled:
                    receiver.receive(wire)
                missing = receiver.missing(rep.manifest.representation_id)
                receiver.close()
                receiver = Store(Path(work) / 'receiver.db')
                for index in missing:
                    receiver.receive(packets[index])
                assert receiver.completed(rep.manifest.representation_id) == rep.data
                assert not sender.confirmed(rep.manifest.representation_id)
                # Model a lost completion ACK by leaving it undelivered. A fresh
                # completion ACK confirms without retransmission of image chunks.
                sender.confirm(receiver.completion_ack(rep.manifest.representation_id))
                assert sender.confirmed(rep.manifest.representation_id)
                suffix = 'jpg' if rep.manifest.codec == Codec.JPEG else 'webp'
                (output / f'{name}.{suffix}').write_bytes(rep.data)
                (output / f'{name}.manifest.bin').write_bytes(rep.manifest.encode())
                (output / f'{name}.packets.json').write_text(json.dumps([p.hex() for p in packets], indent=2) + '\n')
                entry = asdict(rep.manifest)
                entry.update(name=name, serialized_data_bytes=sum(map(len, packets)),
                             max_packet_bytes=max(map(len, packets)), resumed_missing_chunks=len(missing),
                             missing_request_bytes=sum(map(len, missing_frames(rep.manifest.representation_id, missing))))
                report['representations'].append(entry)
            (output / 'crop.request.bin').write_bytes(request.encode())
            source_image = sender.source(image_id)
            for name, image, budget, dimension in (
                    ('preview', source_image, 300, 96),
                    ('crop', source_image.crop(SIGN_BOUNDS.pixels(*source_image.size)), 48000, 1024)):
                for codec in Codec:
                    encoded = encode_budget(image, budget, dimension, codec)
                    report['codec_comparison'].append(dict(kind=name, codec=codec.name,
                        bytes=len(encoded.data), width=encoded.width, height=encoded.height,
                        quality=encoded.quality, budget=budget, max_dimension=dimension))
            preview_image, _ = receiver.decoded(preview.manifest.representation_id)
            crop_image, _ = receiver.decoded(crop.manifest.representation_id)
            canvas = Image.new('RGB', (1100, 700), '#f1efe8')
            draw = ImageDraw.Draw(canvas)
            draw.text((30, 20), 'PHASE 1 / Original photo -> tiny preview -> verified source crop', fill='#202020', font_size=24)
            draw.text((30, 70), f'Preview: {len(preview.data)} bytes, {preview_image.width} x {preview_image.height}', fill='#202020', font_size=20)
            draw.text((570, 70), f'Crop: {len(crop.data):,} bytes, SHA-256 verified', fill='#202020', font_size=20)
            small = preview_image.resize((500, 333), Image.Resampling.NEAREST)
            canvas.paste(small, (30, 110))
            visible = crop_image.copy()
            visible.thumbnail((500, 333))
            canvas.paste(visible, (570, 110))
            draw.text((30, 480), 'Detail is extracted automatically from the retained original.', fill='#202020', font_size=22)
            draw.text((30, 525), 'Reordered + duplicated packets; missing chunks retained across restart.', fill='#202020', font_size=22)
            draw.text((30, 570), 'Receiver verifies first. Sender confirms only after the completion ACK arrives.', fill='#202020', font_size=22)
            draw.text((30, 620), 'Media demo only. Mesh routing, airtime, and app UI are Phase 2 / 3.', fill='#555555', font_size=20)
            canvas.save(output / 'comparison.png')
            # Snap the overlay to the actual floor/ceil source crop rectangle.
            overlay = preview_image.resize((1000, 667), Image.Resampling.NEAREST)
            left, top, right, bottom = SIGN_BOUNDS.pixels(*source_image.size)
            rectangle = tuple(round(v * target / source) for v, target, source in
                              zip((left, top, right, bottom), (1000, 667, 1000, 667),
                                  (*source_image.size, *source_image.size)))
            x0, y0, x1, y1 = rectangle
            overlay.paste(crop_image.resize((x1 - x0, y1 - y0), Image.Resampling.LANCZOS), (x0, y0))
            overlay.save(output / 'overlay.png')
            (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
            return report
        finally:
            sender.close()
            receiver.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('fixtures/trail-sign.jpg'))
    parser.add_argument('--output', type=Path, default=Path('demo-output'))
    args = parser.parse_args()
    report = run(args.source, args.output)
    print(json.dumps(report['codec_comparison'], indent=2))
    print(f'Verified comparison and wire fixtures: {args.output.resolve()}')


if __name__ == '__main__':
    main()

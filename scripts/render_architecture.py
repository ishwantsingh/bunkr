"""Render the concise architecture overview with Pillow; no browser required."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SCALE = 2
WIDTH, HEIGHT = 1600, 1120
im = Image.new('RGB', (WIDTH*SCALE, HEIGHT*SCALE), '#ffffff')
d = ImageDraw.Draw(im)
FONT_DIR = Path('/System/Library/Fonts/Supplemental')
REGULAR = str(FONT_DIR / 'Arial.ttf') if (FONT_DIR / 'Arial.ttf').exists() else 'DejaVuSans.ttf'
BOLD = str(FONT_DIR / 'Arial Bold.ttf') if (FONT_DIR / 'Arial Bold.ttf').exists() else 'DejaVuSans-Bold.ttf'
INK, MUTED, RULE = '#182824', '#65716d', '#e3e8e5'
GREEN, BLUE, AMBER = '#32755c', '#436fa1', '#926d32'


def text(x, y, value, size=22, color=INK, bold=False, center=False, max_width=None):
    font = ImageFont.truetype(BOLD if bold else REGULAR, size*SCALE)
    width = d.textlength(value, font=font)
    if max_width is not None:
        assert width <= max_width*SCALE, f'Text overflows: {value}'
    if center:
        x -= width / (2*SCALE)
    d.text((x*SCALE, y*SCALE), value, font=font, fill=color)


def line(points, color=RULE, width=2):
    d.line([(x*SCALE, y*SCALE) for x, y in points], fill=color, width=width*SCALE)


def arrow(points, color=GREEN):
    line(points, color)
    x, y = points[-1]
    px, py = points[-2]
    if x != px:
        k = 1 if x > px else -1
        line([(x-k*8, y-5), (x, y), (x-k*8, y+5)], color)
    else:
        k = 1 if y > py else -1
        line([(x-5, y-k*8), (x, y), (x+5, y-k*8)], color)


def endpoint(x, number, title, subtitle, lines):
    d.rounded_rectangle((x*SCALE, 280*SCALE, (x+380)*SCALE, 520*SCALE),
                        radius=16*SCALE, fill='#f6f8f6', outline=RULE, width=SCALE)
    text(x+28, 305, number, 17, GREEN, bold=True)
    text(x+28, 344, title, 30, bold=True)
    text(x+28, 389, subtitle, 21, MUTED, max_width=324)
    for i, value in enumerate(lines):
        text(x+28, 441+i*30, value, 21, max_width=324)


text(80, 54, 'BUNKR  /  ARCHITECTURE', 17, GREEN, bold=True)
text(80, 99, 'A little first. The detail you need next.', 46, bold=True)
text(80, 166, 'Local text, voice and photos. Recipient-directed delivery over a mesh.', 24, MUTED)
line([(80, 224), (1520, 224)])

endpoint(80, '01  /  PREPARE', 'Sender', 'Keep the source locally.', [
    'Encode a tiny preview.', 'Packetize media (220 B max).',
])
endpoint(1140, '03  /  VERIFY', 'Recipient', 'Reassemble and check integrity.', [
    'Reveal each verified detail tile.', 'Send a completion receipt.',
])
text(800, 305, '02  /  RELAY', 17, GREEN, bold=True, center=True)
text(800, 344, 'Software mesh', 30, bold=True, center=True)
# A minimal network glyph: route plus two alternate relays.
nodes = [(660, 425), (800, 425), (940, 425), (800, 390), (800, 460)]
for a, b in [(0,1), (1,2), (0,3), (3,2), (0,4), (4,2)]:
    line([nodes[a], nodes[b]], '#d5e1d9', 2)
line([nodes[0], nodes[1], nodes[2]], GREEN, 3)
for i, (x,y) in enumerate(nodes):
    radius = 8 if i < 3 else 5
    d.ellipse(((x-radius)*SCALE, (y-radius)*SCALE,
               (x+radius)*SCALE, (y+radius)*SCALE),
              fill=GREEN if i < 3 else '#a3b9ab')
text(800, 493, 'Route · prioritize · retry', 21, MUTED, center=True)
arrow([(460, 425), (642, 425)])
arrow([(958, 425), (1140, 425)])
text(550, 390, 'Preview / detail', 17, MUTED, center=True)
text(1049, 390, 'Media frames', 17, MUTED, center=True)

arrow([(1330, 520), (1330, 580), (270, 580), (270, 520)])
d.rectangle((465*SCALE, 563*SCALE, 1135*SCALE, 598*SCALE), fill='#ffffff')
text(800, 566, 'Crop requests + verified receipts return through the same mesh',
     21, GREEN, center=True)
text(800, 623, 'Current demo: both views share one browser, local API and temporary database.',
     21, MUTED, center=True)
line([(80, 682), (1520, 682)])

text(80, 719, 'Privacy', 28, bold=True)
text(880, 719, 'When things fail', 28, bold=True)
text(80, 770, 'TODAY', 15, AMBER, bold=True)
text(80, 801, 'Local processing. Plaintext storage and packets.', 23, max_width=700)
text(80, 833, 'CRC + SHA-256 check corruption; no end-to-end encryption.', 21, MUTED, max_width=700)
text(80, 889, 'PROPOSED', 15, BLUE, bold=True)
text(80, 920, 'Verified identities, encrypted media and receipts.', 23, max_width=700)
text(80, 952, 'Encrypted device storage. Relays carry only ciphertext.', 21, MUTED, max_width=700)
text(80, 995, 'Radio timing, size and addresses would still be visible.', 19, MUTED, max_width=700)

failures = [
    ('Packet loss', 'Retry missing frames; use an alternate route.'),
    ('No route', 'Wait for a route; arrival time is unknown.'),
    ('Lost receipt', 'Recipient has content; sender stays unconfirmed.'),
    ('Reload', 'Demo receive progress is lost.'),
]
for y, (label, description) in zip([775, 840, 905, 970], failures):
    text(880, y, label, 21, bold=True, max_width=620)
    text(880, y+28, description, 20, MUTED, max_width=620)

line([(80, 1050), (1520, 1050)])
text(80, 1073, 'Software prototype · firmware integration and proposed security remain unfinished.', 18, MUTED)
text(1520, 1073, 'bunkr', 18, GREEN, bold=True, center=False)

out = ROOT / 'docs/assets/architecture.png'
out.parent.mkdir(parents=True, exist_ok=True)
im.save(out)
print(f'Rendered {out.relative_to(ROOT)} ({im.width} x {im.height})')

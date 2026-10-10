"""Render the documentation diagram with Pillow; no Mermaid extension required."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SCALE = 2
im = Image.new('RGB', (1800 * SCALE, 920 * SCALE), '#f8fafc')
d = ImageDraw.Draw(im)
font_path = '/System/Library/Fonts/Supplemental/Arial.ttf'
if not Path(font_path).exists():
    font_path = 'DejaVuSans.ttf'

def text(x, y, value, size=20, fill='#334155'):
    font = ImageFont.truetype(font_path, size * SCALE)
    d.text((x*SCALE, y*SCALE), value, font=font, fill=fill)

def line(points, color='#64748b', width=2):
    d.line([(x*SCALE,y*SCALE) for x,y in points], fill=color, width=width*SCALE)

def arrow(points, color='#64748b', width=2):
    line(points, color, width)
    x,y = points[-1]; px,py = points[-2]
    if x != px:
        k = 1 if x>px else -1
        line([(x-k*9,y-6),(x,y),(x-k*9,y+6)],color,width)
    else:
        k = 1 if y>py else -1
        line([(x-6,y-k*9),(x,y),(x+6,y-k*9)],color,width)

def box(x,y,w,h,title,body,status='built'):
    fill,stroke = {'built':('#e8f5ed','#26834a'),'mock':('#fff3d6','#b67b13'),'planned':('#eaf2ff','#4573b9')}[status]
    d.rounded_rectangle((x*SCALE,y*SCALE,(x+w)*SCALE,(y+h)*SCALE),radius=14*SCALE,fill=fill,outline=stroke,width=2*SCALE)
    text(x+16,y+18,title,22,'#172b42')
    for i,s in enumerate(body): text(x+16,y+60+i*29,s,19)

def boundary(x,y,w,h,label,color):
    d.rounded_rectangle((x*SCALE,y*SCALE,(x+w)*SCALE,(y+h)*SCALE),radius=18*SCALE,outline=color,width=3*SCALE)
    text(x+18,y+14,label,19,color)

text(40,25,'Imageoverbt | text, voice and image delivery',34,'#13253b')
text(40,77,'LEFT TO RIGHT: encode locally, send actual packet bytes, verify on receipt, then display text / play voice / reveal detail.',22)
text(40,120,'GREEN = built     AMBER = mock / replace     BLUE = planned integration',19)
xs=[40,330,620,910,1200,1490]
items=[
 ('1  Sender UI',['Type / record / send photo','Built chat interaction','Shared demo session'],'built'),
 ('2  Media engine',['Store source and messages','Text / Opus / image encoding','Local Python API'],'built'),
 ('3  Packet encoding',['220-byte binary frames','CRC + SHA-256 metadata','Official protobuf wrapping'],'built'),
 ('4  Browser mesh',['A > B > C > D hops','Synthetic loss and retries','Illustrative timing'],'mock'),
 ('5  Receive + verify',['Reassemble actual bytes','Check hash and decode','Decode text / audio / tiles'],'built'),
 ('6  Recipient UI',['Read text / play voice','Select / Request section','Reveal verified image tiles'],'built')]
for x,(title,body,status) in zip(xs,items): box(x,220,260,190,title,body,status)
boundary(898,166,284,258,'MOCK TRANSPORT', '#b67b13')
for x in xs[:-1]: arrow([(x+260,315),(x+290,315)])
text(42,185,'START',18,'#26834a');text(1492,185,'END: VERIFIED CONTENT',18,'#26834a')
# Reverse control messages, with explicit mesh traversal.
arrow([(1620,410),(1620,465),(460,465),(460,410)],'#64748b')
text(530,437,'Crop request via mesh: create selected detail',20)
arrow([(1330,410),(1330,522),(170,522),(170,410)],'#64748b')
text(305,494,'Verified completion ACK returns through the mesh; sender then confirms receipt',20)
arrow([(1040,424),(1040,587)],'#b67b13',3)
text(1060,548,'REPLACE MOCK WITH THE PATH BELOW',18,'#986610')
boundary(306,587,1454,246,'ACTUAL TRANSPORT PATH — END-TO-END INTEGRATION NOT BUILT', '#4573b9')
future=[
 (330,'Dispatcher + scheduler',['NOT BUILT','Priority, fairness, retries','Expiry and backpressure'],'planned'),
 (690,'Meshtastic SDK Bridge',['BUILT / OFFLINE TESTED','Send and receive adapter','Connected interface needed'],'built'),
 (1050,'Meshtasticator nodes',['NOT INTEGRATED','Native firmware + TCP','Radio-model behavior'],'planned'),
 (1410,'Independent receiver',['NOT INTEGRATED','Durable receive state','Verification + ACK dispatch'],'planned')]
for x,title,body,status in future: box(x,636,326,174,title,body,status)
for x in [330,690,1050]: arrow([(x+326,723),(x+360,723)],'#4573b9')
text(40,860,'KEEP: media engine, wire format, verification, SQLite recovery, SDK adapter, and crop-selection UI.',21)
text(40,892,'Also replace shared demo sessions and temporary state with independent, persistent endpoints. Physical radios are outside initial scope.',18)
im.save(ROOT/'docs/assets/architecture.png')
print('Rendered docs/assets/architecture.png')

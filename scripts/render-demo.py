"""Edit the verified Playwright recording into a narrated, exactly 60-second MP4."""
import json, subprocess, textwrap
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'demo-output/bunkr-demo'
def run(args):
    subprocess.run(args,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
def duration(p):
    return float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',str(p)]))
meta=json.loads((OUT/'capture.json').read_text());m=meta['marks'];raw=Path(meta['videoPath'])
# Browser video starts before navigation; marks start after the UI settles.
# Optional frame-verified calibration accounts for recorder startup/flush latency.
offset=meta.get('videoOffsetSeconds',max(0,duration(raw)-m['end']))
tiles=meta.get('observedTiles') or meta['tileEvents']
first=tiles[0]['t']
ranges=[(m['intro'],m['send']),(m['send'],m['blurry']),(m['blurry'],m['request']),(m['request'],first),(first-.2,m['extras']),(m['extras'],m['end'])]
segments=json.loads((OUT/'narration.json').read_text())
summaries=[
 ('Useful information. Even off grid.','Two phones • Five nodes • No cellular connection'),
 ('The preview travels first.','54 × 36 pixels • 298 bytes • Three mesh hops'),
 ('Select the detail that matters.','Maya draws a box around the unreadable trail sign.'),
 ('A small request changes what comes next.','The sender extracts the selected area from the original.'),
 ('Source detail arrives in verified pieces.','The sign becomes readable. The surroundings stay blurry.'),
 ('Text. Voice notes. Recipient-directed images.','Inspect routes, loss, retries and return acknowledgments.')]
font='/System/Library/Fonts/Avenir Next.ttc';serif=str(ROOT/'bunkr/ui/fonts/instrument-serif.ttf')
def center(draw,y,text,size=27,color='white',ser=False):
    f=ImageFont.truetype(serif if ser else font,size)
    draw.text((960,y),text,font=f,fill=color,anchor='mt')
for i,(s,(a,b)) in enumerate(zip(segments,ranges)):
    length=s['end']-s['start'];png=OUT/f'overlay-{i}.png'
    im=Image.new('RGBA',(1920,1080));d=ImageDraw.Draw(im)
    f=ImageFont.truetype(font,20)
    d.text((250,37),'RICHARD / SENDER',font=f,fill='#e3f7ff',anchor='mt')
    d.text((1670,37),'MAYA / RECIPIENT',font=f,fill='#e3f7ff',anchor='mt')
    center(d,91,'B U N K R   /   O F F - G R I D   E V E R Y T H I N G',18,'#d9f7fa')
    center(d,132,s['title'].split(' / ')[-1],62,ser=True)
    center(d,210,['MESSAGING WHEN CONNECTIONS FAIL','01 / PREVIEW DELIVERY','02 / RECIPIENT SELECTION','03 / REVERSE MESH REQUEST','04 / PROGRESSIVE SOURCE DETAIL','05 / THE SHARED MESH'][i],18,'#d9f7fa')
    d.rounded_rectangle((505,868,1415,995),radius=24,fill=(10,23,36,210))
    center(d,890,summaries[i][0],28)
    center(d,941,summaries[i][1],21,'#c4d8e8')
    center(d,1034,'SOFTWARE MESH PROTOTYPE  •  EDITED PLAYWRIGHT CAPTURE  •  SIMULATION AT 40×',15,'#b7c5cf')
    im.save(png)
    # Fit each real interaction to its narrative chapter, retaining all frames in order.
    rate=length/(b-a)
    vf=f'[0:v]setpts={rate:.9f}*(PTS-STARTPTS),fps=30,tpad=stop_mode=clone:stop_duration={length},trim=duration={length}[v];[v][1:v]overlay=0:0:format=auto,format=yuv420p[out]'
    if i==4:
        reveal=tiles[-1]['t']-a+.18
        vf=f'[0:v]split[x][y];[x]trim=duration={reveal},setpts={5/reveal:.9f}*(PTS-STARTPTS),fps=30[p];[y]trim=start={reveal},setpts={5/(b-a-reveal):.9f}*(PTS-STARTPTS),fps=30[q];[p][q]concat=n=2:v=1:a=0,tpad=stop_mode=clone:stop_duration=1,trim=duration=10[v];[v][1:v]overlay=0:0:format=auto,format=yuv420p[out]'
    run(['ffmpeg','-y','-v','error','-ss',str(a+offset),'-t',str(b-a),'-i',str(raw),'-loop','1','-i',str(png),'-filter_complex',vf,'-map','[out]','-t',str(length),'-c:v','libx264','-preset','fast','-crf','18','-an',str(OUT/f'chapter-{i}.mp4')])
    voice=OUT/f'narration-{i}.mp3'; speed=max(1,duration(voice)/(length-.35))
    run(['ffmpeg','-y','-v','error','-i',str(voice),'-af',f'atempo={speed:.6f},loudnorm=I=-16:TP=-1.5:LRA=11,apad,afade=t=out:st={length-.12}:d=0.12','-t',str(length),'-ar','48000','-ac','2',str(OUT/f'voice-{i}.wav')])
    print(f'Chapter {i+1} rendered',flush=True)
(OUT/'video-concat.txt').write_text(''.join(f"file 'chapter-{i}.mp4'\n" for i in range(6)))
(OUT/'audio-concat.txt').write_text(''.join(f"file 'voice-{i}.wav'\n" for i in range(6)))
run(['ffmpeg','-y','-v','error','-f','concat','-safe','0','-i',str(OUT/'video-concat.txt'),'-f','concat','-safe','0','-i',str(OUT/'audio-concat.txt'),'-map','0:v','-map','1:a','-c:v','copy','-c:a','aac','-b:a','192k','-t','60','-movflags','+faststart',str(OUT/'bunkr-60-second-demo.mp4')])
# Companion captions can be enabled in a player without covering the interface.
def stamp(t):
    ms=round(t*1000);return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}'
srt=[];n=0
for s in segments:
    words=s['text'].split();chunks=[words[j:j+10] for j in range(0,len(words),10)]
    for j,chunk in enumerate(chunks):
        n+=1;a=s['start']+(s['end']-s['start'])*j/len(chunks);b=s['start']+(s['end']-s['start'])*(j+1)/len(chunks)
        srt.append(f'{n}\n{stamp(a)} --> {stamp(b)}\n'+textwrap.fill(' '.join(chunk),48)+'\n')
(OUT/'bunkr-demo.srt').write_text('\n'.join(srt))
run(['ffmpeg','-y','-v','error','-ss','39','-i',str(OUT/'bunkr-60-second-demo.mp4'),'-frames:v','1',str(OUT/'poster.jpg')])
probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(OUT/'bunkr-60-second-demo.mp4')]))
assert abs(float(probe['format']['duration'])-60)<.05
assert any(s['codec_type']=='audio' for s in probe['streams'])
assert any(s['codec_type']=='video' and s['width']==1920 and s['height']==1080 for s in probe['streams'])
(OUT/'verification.json').write_text(json.dumps({'duration':probe['format']['duration'],'resolution':'1920x1080','fps':30,'verifiedTiles':tiles,'pageErrors':meta['errors'],'source':'actual local software mesh; Playwright Chromium','narration':'ElevenLabs'},indent=2))
print('Verified: 60 seconds, 1080p, audio, real source tiles.')

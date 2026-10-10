import json, os, urllib.request, urllib.error
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
root=Path(__file__).resolve().parents[1]
env={}
for line in (root/'.env').read_text().splitlines():
    if '=' in line and not line.lstrip().startswith('#'):
        k,v=line.split('=',1);env[k.strip()]=v.strip().strip('\"').strip("'")
out=root/'demo-output/bunkr-demo'
out.mkdir(parents=True,exist_ok=True)
(out/'narration.json').write_text((root/'scripts/demo-narration.json').read_text())
segments=json.loads((root/'scripts/demo-narration.json').read_text())
def generate(pair):
    i,s=pair
    payload={'text':s['text'],'model_id':env.get('ELEVENLABS_MODEL','eleven_multilingual_v2'),'voice_settings':{'stability':0.55,'similarity_boost':0.75,'style':0.15,'use_speaker_boost':True}}
    url='https://api.elevenlabs.io/v1/text-to-speech/'+env.get('ELEVENLABS_VOICE_ID','JBFqnCBsd6RMkjVDRZzb')+'?output_format=mp3_44100_128'
    request=urllib.request.Request(url,json.dumps(payload).encode(),{'xi-api-key':env['ELEVENLABS_API_KEY'],'Content-Type':'application/json'})
    try:
        with urllib.request.urlopen(request,timeout=90) as response: (out/f'narration-{i}.mp3').write_bytes(response.read())
        return f'Segment {i+1} generated'
    except urllib.error.HTTPError as e: raise RuntimeError(f'ElevenLabs segment {i+1}: HTTP {e.code}') from None
with ThreadPoolExecutor(max_workers=2) as pool:
    for result in pool.map(generate,enumerate(segments)): print(result)

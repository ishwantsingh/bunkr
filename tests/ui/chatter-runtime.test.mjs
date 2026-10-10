import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto,createHash} from 'node:crypto';
import {MediaRuntime,framesFor} from '../../chatterbot/src/mesh/runtime.mjs';
import {parseManifest} from '../../imageoverbt/ui/protocol.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const rep=kind=>({manifest:readFileSync(new URL(`../../fixtures/wire/${kind}.manifest.bin`,import.meta.url)).toString('hex'),packets:JSON.parse(readFileSync(new URL(`../../fixtures/wire/${kind}.packets.json`,import.meta.url)))});
const preview=rep('preview'),crop=rep('crop');
const message=JSON.parse(readFileSync(new URL('../../fixtures/messages/messages.json',import.meta.url))).unicode;
const setup=(responses={})=>{
  const calls=[],events=[];
  const runtime=new MediaRuntime({onEvent:e=>events.push(e)},{wait:async()=>{},decodeImage:async(bytes,m)=>`blob:verified-${m.id}`,fetch:async(path,options)=>{
    calls.push({path,options});return {ok:true,json:async()=>responses[path]||{confirmed:true}};
  }});
  runtime.settings({lossPct:0});return {runtime,calls,events};
};
const callbacks={onTransit(){},onChunk(){},onDelivered(){}};
test('reference UI receives verified preview bytes before sending its return ACK',async()=>{
  const {runtime,calls}=setup();let arrived=false,delivered=false;
  await runtime.sendImage({envelope:{preview}},false,{...callbacks,onArrive(content){arrived=true;assert.match(content.previewSrc,/^blob:verified/);assert.equal(calls.length,0);},onDelivered(){delivered=true;}},runtime.version);
  assert.ok(arrived&&delivered);assert.equal(calls[0].path,'/api/confirm');
  assert.equal(runtime.network.representations.get(parseManifest(preview.manifest).id).senderConfirmed,true);
});
test('selected areas reveal each verified piece before whole-region completion',async()=>{
  const {runtime}=setup({'/api/crop':{tiles:[preview,crop]}});const seen=[];let complete=false;
  await runtime.pull({imageId:parseManifest(preview.manifest).imageId},{x:0,y:0,w:1,h:1},false,{
    onTransit(){},onTile(tile){assert.equal(complete,false);seen.push(tile);},onVerified(){complete=true;assert.equal(seen.length,2);},
  },runtime.version);
  assert.ok(complete);assert.equal(new Set(seen.map(t=>t.id)).size,2);
  assert.ok(seen.every(t=>t.src.startsWith('blob:verified-')));
});
test('disconnected topology waits without revealing content and resumes when restored',async()=>{
  const {runtime}=setup();runtime.network.setNode('A',{online:false});let waiting=false;
  await runtime.receive(preview,{version:runtime.version,onTransit(t){if(t.waiting){waiting=true;assert.equal(t.etaMs,null);runtime.network.setNode('A',{online:true});}}});
  assert.ok(waiting);assert.equal(runtime.network.pending,0);
});
test('text uses the real API, wire reassembly and verified return acknowledgment',async()=>{
  const {runtime,calls}=setup({'/api/message':message});let value;
  await runtime.sendTextOrVoice({sender:1,text:'test'}, {...callbacks,onArrive(content){value=content.text;}},runtime.version);
  assert.equal(value,'At the junction 🌲 — नमस्ते');assert.deepEqual(calls.map(c=>c.path),['/api/message','/api/message/confirm']);
});
test('reset cancels queued and active work without publishing a late success',async()=>{
  const {runtime}=setup();let release,delivered=false;
  runtime.wait=()=>new Promise(resolve=>release=resolve);
  const version=runtime.version,pending=runtime.receive(preview,{version}).then(()=>delivered=true,error=>assert.equal(error.name,'AbortError'));
  runtime.reset();release();await pending;assert.equal(delivered,false);assert.equal(runtime.network.pending,0);
  await assert.rejects(runtime.run(framesFor(preview),{version}),{name:'AbortError'});
});

test('browser fetch retains its required global receiver',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=function(){assert.equal(this,globalThis);return Promise.resolve({ok:true,json:async()=>({confirmed:true})});};
  try{assert.deepEqual(await new MediaRuntime().api('/api/confirm'),{confirmed:true});}
  finally{globalThis.fetch=original;}
});
test('a reset during image decoding revokes late URLs and prevents success',async()=>{
  const {runtime}=setup();let release;const revoked=[];const revoke=URL.revokeObjectURL;
  URL.revokeObjectURL=url=>revoked.push(url);
  runtime.decodeImage=()=>new Promise(resolve=>release=resolve);
  const pending=runtime.imageURL(new Uint8Array(),{},runtime.version);
  runtime.reset();release('blob:late');
  try{await assert.rejects(pending,{name:'AbortError'});assert.deepEqual(revoked,['blob:late']);assert.equal(runtime.urls.size,0);}
  finally{URL.revokeObjectURL=revoke;}
});
test('corrupt selected detail cannot reveal pixels or acknowledge success',async()=>{
  const bad={...crop,packets:[...crop.packets]};bad.packets[0]=bad.packets[0].slice(0,-2)+'00';
  const {runtime,calls}=setup({'/api/crop':{tiles:[bad]}});let revealed=false;
  await assert.rejects(runtime.pull({imageId:parseManifest(preview.manifest).imageId},{x:0,y:0,w:1,h:1},false,{
    onTransit(){},onTile(){revealed=true;},onVerified(){assert.fail('Corrupt content completed');},
  },runtime.version));
  assert.equal(revealed,false);assert.deepEqual(calls.map(c=>c.path),['/api/crop']);
});
test('voice playback URL is published only after verified Opus reconstruction',async()=>{
  const voice=JSON.parse(readFileSync(new URL('../../fixtures/messages/messages.json',import.meta.url))).voice;
  const {runtime,calls}=setup({'/api/message':voice});const fetch=runtime.fetch;
  runtime.fetch=(path,options)=>path==='blob:recording'?Promise.resolve({blob:async()=>new Blob(['recorded audio'])}):fetch(path,options);
  let decoded=false,arrived=false;
  runtime.decodeVoice=async(bytes,m)=>{assert.equal(createHash('sha256').update(bytes).digest('hex'),'9662216eb99c62d0712ce58f4df3388ee09d8becc175acb8f3806eaf65e1ef69');assert.equal(m.bytes,bytes.length);decoded=true;return {audioUrl:'blob:verified-voice'};};
  await runtime.sendTextOrVoice({sender:1,voice:{audioUrl:'blob:recording',levels:[.2,.7],durationMs:4525}}, {...callbacks,
    onChunk(){assert.equal(arrived,false);},onArrive({voice}){assert.ok(decoded);assert.equal(voice.audioUrl,'blob:verified-voice');assert.equal(voice.bytes,6607);arrived=true;},
  },runtime.version);
  assert.ok(arrived);assert.deepEqual(calls.map(c=>c.path),['/api/message','/api/message/confirm']);
});

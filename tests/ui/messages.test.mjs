import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {parseMessageManifest,Reassembler,decodeMessageText,makeAck,fromHex,toHex,crc32,validateVoiceHeader} from '../../bunkr/ui/protocol.mjs';
import {Network} from '../../bunkr/ui/network.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const fixtures=JSON.parse(readFileSync(new URL('../../fixtures/messages/messages.json',import.meta.url)));
for(const [name,f] of Object.entries(fixtures))test(`Python ${name} packets reconstruct exactly through 20% loss on three hops`,async()=>{
  const m=parseMessageManifest(f.manifest),assembler=new Reassembler(m),network=new Network({loss:.2,seed:41});
  network.enqueue([{wire:f.manifest,manifest:true},...f.packets.map(wire=>({wire}))]);let count=0;
  while(network.pending&&count++<10000)for(const frame of (await network.advance({seconds:100})).received)if(!frame.manifest)assembler.add(frame.wire);
  assert.equal(network.pending,0);const bytes=await assembler.verifiedBytes();
  assert.equal(makeAck(m),f.ack);
  if(m.kind===0){const text=await decodeMessageText(bytes,m.codec);assert.equal(text,name==='unicode'?'At the junction 🌲 — नमस्ते':'Meet at the junction. '.repeat(100));}
  else{validateVoiceHeader(bytes);assert.equal(new TextDecoder().decode(bytes.slice(0,4)),'OggS');assert.equal(m.sampleRate,16000);assert.ok(m.duration>1000);}
  network.enqueue([{wire:makeAck(m)}],true);let received=0;
  while(network.pending)received+=(await network.advance({seconds:100})).received.length;
  assert.equal(received,1);
});
test('incomplete or modified message cannot produce verified bytes',async()=>{
  const f=fixtures.voice,m=parseMessageManifest(f.manifest),a=new Reassembler(m);
  a.add(f.packets[0]);await assert.rejects(a.verifiedBytes(),/incomplete/);
  const bad=fromHex(f.packets[0]);bad[42]^=1;new DataView(bad.buffer).setUint32(bad.length-4,crc32(bad.slice(0,-4)));
  const b=new Reassembler(m);b.add(toHex(bad));for(const p of f.packets.slice(1))b.add(p);
  await assert.rejects(b.verifiedBytes(),/hash mismatch/);
});
test('bad codec, endpoints and duration fail before receive',()=>{
  const f=fixtures.unicode;
  for(const [offset,value] of [[27,2],[26,9]]){
    const b=fromHex(f.manifest);b[offset]=value;new DataView(b.buffer).setUint32(76,crc32(b.slice(0,76)));
    assert.throws(()=>parseMessageManifest(toHex(b)),/Invalid/);
  }
});
test('text decompression and UTF-8 decoding are bounded and strict',async()=>{
  await assert.rejects(decodeMessageText(new Uint8Array(deflateSync('x'.repeat(16385))),1),/exceeds/);
  await assert.rejects(decodeMessageText(new Uint8Array([255]),0));
  await assert.rejects(decodeMessageText(new TextEncoder().encode('  '),0),/blank/);
});
test('voice transfer interrupted mid-route retains received chunks',async()=>{
  const f=fixtures.voice,m=parseMessageManifest(f.manifest),a=new Reassembler(m),n=new Network({loss:.2,seed:4});
  n.enqueue(f.packets.map(wire=>({wire})));await n.advance({seconds:.01});n.enabled.delete('C');n.online=false;
  const pending=n.pending;assert.equal((await n.advance()).state,'waiting');assert.equal(n.pending,pending);
  n.online=true;while(n.pending)for(const frame of (await n.advance({seconds:100})).received)a.add(frame.wire);
  assert.equal((await a.verifiedBytes()).length,m.bytes);
});

test('voice codec claims must match an actual mono Ogg Opus header',()=>{
  assert.throws(()=>validateVoiceHeader(new TextEncoder().encode('ID3 not Opus')),/Expected/);
  const header=new Uint8Array(60);header.set(new TextEncoder().encode('OggS'));header.set(new TextEncoder().encode('OpusHead'),28);header[37]=2;
  assert.throws(()=>validateVoiceHeader(header),/mono/);
});

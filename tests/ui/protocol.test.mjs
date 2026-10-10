import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {parseManifest,Reassembler,makeAck,makeRequest,makeMissing,fromHex,validate,toHex} from '../../imageoverbt/ui/protocol.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const root=new URL('../../fixtures/wire/',import.meta.url);
test('browser reassembles actual Python golden frames exactly after reordering and duplicates',async()=>{
  for(const kind of ['preview','crop']){
    const manifest=parseManifest(toHex(await readFile(new URL(`${kind}.manifest.bin`,root))));
    const packets=JSON.parse(await readFile(new URL(`${kind}.packets.json`,root),'utf8'));
    const assembler=new Reassembler(manifest);
    for(const wire of [...packets].reverse())assembler.add(wire);
    assembler.add(packets[0]);
    assert.deepEqual(Buffer.from(await assembler.verifiedBytes()),await readFile(new URL(`${kind}.webp`,root)));
    const ack=fromHex(makeAck(manifest));validate(ack,4);assert.equal(ack.length,58);
  }
});
test('browser creates byte-for-byte identical Python request',async()=>{
  const original=await readFile(new URL('crop.request.bin',root));
  const m=parseManifest(toHex(await readFile(new URL('crop.manifest.bin',root))));
  assert.deepEqual(Buffer.from(fromHex(makeRequest(m.imageId,m.requestId,m.bounds))),original);
});
test('corrupt and incomplete data never publishes verified detail',async()=>{
  const m=parseManifest(toHex(await readFile(new URL('preview.manifest.bin',root))));
  const packets=JSON.parse(await readFile(new URL('preview.packets.json',root),'utf8'));
  const assembler=new Reassembler(m);assembler.add(packets[0]);
  await assert.rejects(()=>assembler.verifiedBytes(),/incomplete/);
  const bad=fromHex(packets[0]);bad[44]^=1;
  assert.throws(()=>assembler.add(toHex(bad)),/integrity/);
  assert.equal(assembler.chunks.size,1);
});

test('missing-chunk request matches Python binary contract and respects frame bounds',async()=>{
  assert.deepEqual(Buffer.from(fromHex(makeMissing('12'.repeat(16),[0,3,49,65535]))),await readFile(new URL('missing.request.bin',root)));
  const max=fromHex(makeMissing('12'.repeat(16),Array.from({length:49},(_,i)=>i)));validate(max,6);assert.equal(max.length,218);
  for(const indices of [[],Array(50).fill(0),[-1],[1.5],[100000]])assert.throws(()=>makeMissing('12'.repeat(16),indices));
  assert.throws(()=>makeMissing('12',[0]),/representation ID/);
});

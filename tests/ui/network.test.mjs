import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Network,route,radioBytes} from '../../bunkr/ui/network.mjs';
import {clampBounds,parseManifest,Reassembler,makeAck,validate,fromHex} from '../../bunkr/ui/protocol.mjs';
const image=JSON.parse(readFileSync(new URL('../../fixtures/wire/crop.packets.json',import.meta.url)));
const previewManifest=readFileSync(new URL('../../fixtures/wire/preview.manifest.bin',import.meta.url)).toString('hex');
const previewPackets=JSON.parse(readFileSync(new URL('../../fixtures/wire/preview.packets.json',import.meta.url)));
const frames=()=>Array.from({length:100},(_,i)=>({wire:image[0],id:i}));
async function drain(n,limit=10000){const results=[];for(let i=0;n.pending&&i<limit;i++){const r=await n.advance({seconds:100});results.push(r);if(r.failed.length)break;}return results;}

test('branch topology derives primary and alternate routes from range',()=>{
  assert.deepEqual(route(new Set(['A','B','C','D','E'])),['A','B','C','D']);
  assert.deepEqual(route(new Set(['A','B','D','E'])),['A','B','E','D']);
  assert.deepEqual(route(new Set(['A','B','D','E']),true),['D','E','B','A']);
  assert.equal(route(new Set(['A','C','D','E'])),null);
  const n=new Network();n.setNode('B',{range:80});assert.equal(n.getRoute(),null);
});
test('20% per-hop loss relays exact frames with measured radio overhead',async()=>{
  const n=new Network({loss:.2,seed:42});n.enqueue(frames());const received=(await drain(n)).flatMap(r=>r.received);
  assert.equal(n.pending,0);assert.equal(received.length,100);assert.equal(new Set(received.map(f=>f.id)).size,100);
  assert.ok(n.lost>0);assert.ok(n.airtime>0);assert.equal(n.bytes,n.sent*254);
});
test('disconnect and pause preserve queued frames and receive progress',async()=>{
  const n=new Network({loss:0});n.enqueue(frames());await n.advance({seconds:3});n.online=false;const pending=n.pending;
  assert.equal((await n.advance()).state,'waiting');assert.equal(n.pending,pending);
  n.online=true;n.paused=true;assert.equal((await n.advance()).state,'paused');
  n.paused=false;const received=(await drain(n)).flatMap(r=>r.received);assert.equal(n.pending,0);assert.ok(received.length>0);
});
test('relay removal during a hop recomputes the remaining physical route',async()=>{
  const n=new Network({loss:0});n.enqueue(frames());await n.advance({seconds:.01});n.setNode('C',{online:false});
  const received=(await drain(n)).flatMap(r=>r.received);assert.equal(received.length,100);
  assert.ok(n.events.some(e=>e.type==='tx_started'&&e.route.includes('E')));
});
test('100% loss exhausts bounded hop and application recovery without success',async()=>{
  const n=new Network({loss:1,retries:2,missingRounds:1});n.enqueue(frames().slice(0,1));
  const results=await drain(n);assert.equal(results.flatMap(r=>r.received).length,0);assert.equal(results.flatMap(r=>r.failed).length,1);n.cancel();assert.equal(n.pending,0);
});
test('reverse application ACK reaches sender across all three hops',async()=>{
  const m=parseManifest(previewManifest),n=new Network({loss:0});n.enqueue([{wire:makeAck(m)}],true);
  const result=await drain(n);assert.equal(result.flatMap(r=>r.received).length,1);
  assert.deepEqual(n.lastPath,['D','C','B','A']);
});
test('missing data uses actual tag-6 request across the reverse mesh before retransmission',async()=>{
  const n=new Network({loss:.2,retries:1,missingRounds:3});
  n.simulator.random=()=>n.simulator.events.at(-1)?.packetId==='wire-2-r0'?0:.99;
  n.enqueue([{wire:previewManifest,manifest:true},...previewPackets.map(wire=>({wire}))]);
  const received=(await drain(n)).flatMap(r=>r.received);assert.equal(n.pending,0);
  const assembler=new Reassembler(parseManifest(previewManifest));for(const f of received)if(!f.manifest)assembler.add(f.wire);
  assert.equal((await assembler.verifiedBytes()).length,assembler.manifest.bytes);
  const missing=[...n.packets.values()].find(p=>p.type==='missing_request');assert.ok(missing);validate(missing.bytes,6);
  assert.equal(missing.source,'D');assert.equal(missing.destination,'A');
  const requested=n.events.findIndex(e=>e.type==='packet_received'&&e.packetType==='missing_request');
  const resend=n.events.findIndex(e=>e.type==='tx_started'&&e.packetId==='wire-2-r1');assert.ok(resend>requested);
});
test('lost manifest and completion ACK retry on timeout without invented delivery',async()=>{
  for(const wire of [previewManifest,makeAck(parseManifest(previewManifest))]){
    const n=new Network({loss:.2,retries:1});n.simulator.random=()=>n.simulator.events.at(-1)?.packetId==='wire-1-r0'?0:.99;
    n.enqueue([{wire}],wire!==previewManifest);const results=await drain(n);
    assert.equal(results.flatMap(r=>r.received).length,1);assert.equal(results.flatMap(r=>r.received)[0].wire,wire);
    assert.ok(n.time>=15);assert.ok(results.flatMap(r=>r.events).some(e=>e.type==='recovery_timeout'));
  }
});
test('radio preset controls actual simulated delivery time, independent of replay speed',async()=>{
  const times=[];
  for(const preset of ['Long Fast','Short Turbo']){
    const n=new Network({loss:0,preset});n.enqueue(frames().slice(0,1));
    const started=await n.advance({seconds:.01});assert.equal(started.received.length,0);
    const airtime=started.hops[0].airtime;assert.ok(airtime>0);
    const before=await n.advance({seconds:airtime/2});assert.equal(before.received.length,0);
    await drain(n);times.push(n.time);
  }
  assert.ok(times[0]>times[1]*5);
});
test('corrupt frames are rejected before entering the radio queue',()=>{
  const n=new Network();const bytes=fromHex(image[0]);bytes[50]^=1;
  assert.throws(()=>n.enqueue([{wire:Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('')}]),/integrity/);
  assert.equal(radioBytes(image[0]),254);
});
test('dragging keeps crop box within edges and nonempty',()=>{
  assert.deepEqual(clampBounds([-.1,-.1,.4,.4]),[0,0,.5,.5]);
  const [l,t,r,b]=clampBounds([.9,.9,1.4,1.4]);assert.ok(l>=0&&t>=0&&r<=1&&b<=1);
  const tiny=clampBounds([.3,.3,.3,.3]);assert.ok(tiny[2]-tiny[0]>=.079);
});

test('native preview, crop request, image detail and verified receipts cross the shared engine',async()=>{
  const n=new Network({loss:.2,seed:41});
  for(const kind of ['preview','crop']){
    if(kind==='crop'){
      const wire=readFileSync(new URL('../../fixtures/wire/crop.request.bin',import.meta.url)).toString('hex');
      n.enqueue([{wire}],true);assert.equal((await drain(n)).flatMap(r=>r.received).length,1);
      assert.equal(n.lastPath[0],'D');n.setNode('C',{online:false});
    }
    const manifest=readFileSync(new URL(`../../fixtures/wire/${kind}.manifest.bin`,import.meta.url)).toString('hex');
    const packets=JSON.parse(readFileSync(new URL(`../../fixtures/wire/${kind}.packets.json`,import.meta.url)));
    const m=parseManifest(manifest),a=new Reassembler(m);
    n.enqueue([{wire:manifest,manifest:true},...packets.map(wire=>({wire}))]);
    const received=(await drain(n)).flatMap(r=>r.received);assert.equal(n.pending,0);
    assert.equal(received.filter(f=>f.manifest).length,1);for(const f of received)if(!f.manifest)a.add(f.wire);
    assert.deepEqual(Buffer.from(await a.verifiedBytes()),readFileSync(new URL(`../../fixtures/wire/${kind}.webp`,import.meta.url)));
    n.enqueue([{wire:makeAck(m)}],true);assert.equal((await drain(n)).flatMap(r=>r.received).length,1);
    if(kind==='crop')assert.deepEqual(n.lastPath,['D','E','B','A']);
  }
});

test('control packets preempt queued media at packet boundaries',async()=>{
  const n=new Network({loss:0});n.enqueue([{wire:image[0]}, {wire:makeAck(parseManifest(previewManifest))}]);
  const first=await n.advance({seconds:.01});assert.equal(first.hops[0].packetType,'receipt');
  await drain(n);assert.equal(n.pending,0);
});

test('relay failure after receiving a chunk recovers stranded relay packets on an alternate route',async()=>{
  const n=new Network({loss:0});let removed=false;
  const observe=n.simulator.onEvent;
  n.simulator.onEvent=e=>{observe(e);if(!removed&&e.type==='hop_received'&&e.to==='C'&&e.packetType==='data'){removed=true;n.setNode('C',{online:false});}};
  n.enqueue([{wire:previewManifest,manifest:true},...previewPackets.map(wire=>({wire}))]);
  const results=await drain(n),received=results.flatMap(r=>r.received);assert.ok(removed);assert.equal(n.pending,0);
  assert.ok(results.flatMap(r=>r.events).some(e=>e.type==='recovery_timeout'));
  const a=new Reassembler(parseManifest(previewManifest));for(const f of received)if(!f.manifest)a.add(f.wire);
  assert.equal((await a.verifiedBytes()).length,a.manifest.bytes);
  assert.ok(n.events.some(e=>e.type==='packet_received'&&e.path.includes('E')));
});

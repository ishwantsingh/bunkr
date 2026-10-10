import test from 'node:test';
import assert from 'node:assert/strict';
import {Network,route} from '../../imageoverbt/ui/network.mjs';
import {clampBounds} from '../../imageoverbt/ui/protocol.mjs';
const frames=()=>Array.from({length:100},(_,i)=>({wire:'00'.repeat(220),radioBytes:254,id:i}));
test('primary three-hop route and alternate survive relay removal',()=>{
  assert.deepEqual(route(new Set(['A','B','C','D','E'])),['A','B','C','D']);
  assert.deepEqual(route(new Set(['A','C','D','E'])),['A','E','D']);
  assert.deepEqual(route(new Set(['A','C','D','E']),true),['D','E','A']);
  assert.equal(route(new Set(['A','D'])),null);
});
test('20% per-hop loss recovers exact frames without duplicates',()=>{
  const network=new Network({loss:.2,seed:42});network.enqueue(frames());const received=[];
  for(let i=0;network.pending&&i<1000;i++)received.push(...network.advance().received);
  assert.equal(network.pending,0);assert.equal(received.length,100);
  assert.equal(new Set(received.map(f=>f.id)).size,100);
  assert.ok(network.lost>0);assert.equal(network.bytes,network.sent*254);
});
test('disconnect and pause preserve queue and received progress',()=>{
  const n=new Network({loss:0});n.enqueue(frames());
  n.advance();n.online=false;const pending=n.pending;
  assert.equal(n.advance().state,'waiting');assert.equal(n.pending,pending);
  n.online=true;n.paused=true;assert.equal(n.advance().state,'paused');
  n.paused=false;let received=0;while(n.pending)received+=n.advance().received.length;
  assert.equal(received,100);
});
test('route removal during a hop retains every undelivered frame',()=>{
  const n=new Network({loss:0});n.enqueue(frames());n.advance();n.enabled.delete('B');
  let received=[];while(n.pending)received.push(...n.advance().received);
  assert.equal(received.length,100);assert.equal(new Set(received.map(f=>f.id)).size,100);
});
test('retry exhaustion fails explicitly',()=>{
  const n=new Network({loss:1,retries:2});n.enqueue(frames().slice(0,1));
  assert.equal(n.advance().failed.length,0);assert.equal(n.advance().failed.length,1);assert.equal(n.pending,0);
});
test('reverse control traffic reaches sender',()=>{
  const n=new Network({loss:0});n.enqueue(frames().slice(0,1),true);
  assert.equal(n.advance().from,'D');assert.equal(n.advance().to,'B');
  const last=n.advance();assert.equal(last.to,'A');assert.equal(last.received.length,1);
});
test('dragging keeps box within edges and nonempty',()=>{
  assert.deepEqual(clampBounds([-.1,-.1,.4,.4]),[0,0,.5,.5]);
  const [l,t,r,b]=clampBounds([.9,.9,1.4,1.4]);assert.ok(l>=0&&t>=0&&r<=1&&b<=1);
  const tiny=clampBounds([.3,.3,.3,.3]);assert.ok(tiny[2]-tiny[0]>=.079);
});

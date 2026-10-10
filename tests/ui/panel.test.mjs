import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Network} from '../../bunkr/ui/network.mjs';
import {nodeChange,mediaProgress,remainingEstimate} from '../../bunkr/ui/mesh/panel.mjs';
import {parseManifest,makeAck} from '../../bunkr/ui/protocol.mjs';
const manifest=readFileSync(new URL('../../fixtures/wire/preview.manifest.bin',import.meta.url)).toString('hex');
const packets=JSON.parse(readFileSync(new URL('../../fixtures/wire/preview.packets.json',import.meta.url)));
const enqueue=n=>n.enqueue([{wire:manifest,manifest:true},...packets.map(wire=>({wire}))]);
async function drain(n){for(let i=0;n.pending&&i<1000;i++){const r=await n.advance({seconds:100});assert.equal(r.failed.length,0);}assert.equal(n.pending,0);}
test('node editor bounds positions and range and rejects invalid values',()=>{
  assert.deepEqual(nodeChange('x',999),{x:765});assert.deepEqual(nodeChange('y',-1),{y:50});assert.deepEqual(nodeChange('range',0),{range:30});assert.equal(nodeChange('x','invalid'),null);
  const n=new Network();n.setNode('B',nodeChange('range',30));assert.equal(n.getRoute(),null);
});
test('Next event steps a paused transfer without resuming autoplay or jumping time',async()=>{
  const n=new Network({loss:0});enqueue(n);n.paused=true;
  assert.equal((await n.advance()).state,'paused');assert.equal(n.time,0);
  const start=await n.advance({singleEvent:true});assert.equal(start.events.filter(e=>e.type==='tx_started').length,1);assert.equal(n.time,0);
  const finish=await n.advance({singleEvent:true});assert.equal(finish.events.filter(e=>e.type==='hop_received').length,1);assert.ok(n.time>0);assert.equal(n.clock,n.time);assert.equal(n.paused,true);
  n.paused=false;await drain(n);
});
test('inspector distinguishes received bytes, verified media and a returned receipt',async()=>{
  const n=new Network({loss:.2,seed:16}),m=parseManifest(manifest);enqueue(n);
  assert.throws(()=>n.markVerified(m.id),/incomplete/);await drain(n);
  assert.equal(mediaProgress(n).received,m.count);assert.equal(mediaProgress(n).verified,false);assert.equal(remainingEstimate(n),'Awaiting receipt');
  n.markVerified(m.id);assert.equal(mediaProgress(n).verified,true);assert.throws(()=>n.markConfirmed(m.id),/return receipt/);
  n.enqueue([{wire:makeAck(m)}],true);await drain(n);assert.equal(mediaProgress(n).confirmed,false);
  n.markConfirmed(m.id);assert.equal(mediaProgress(n).confirmed,true);assert.equal(remainingEstimate(n),'Complete');
});
test('remaining time responds to rate, loss, pause, disconnect and node movement',()=>{
  const n=new Network({loss:0});enqueue(n);const fast=remainingEstimate(n);
  n.setPreset('Long Moderate');assert.ok(remainingEstimate(n)[0]>fast[0]);n.loss=.5;assert.ok(remainingEstimate(n)[0]>fast[0]*2);
  n.paused=true;assert.equal(remainingEstimate(n),'Paused');n.paused=false;n.online=false;assert.equal(remainingEstimate(n),'Unknown');
  n.online=true;n.setNode('B',{x:765,y:385});assert.equal(remainingEstimate(n),'Unknown');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {dragBounds,progressValue} from '../../imageoverbt/ui/presentation.mjs';

test('image selection supports dragging in every direction',()=>{
  for(const [start,end] of [[[.2,.3],[.8,.9]],[[.8,.9],[.2,.3]],[[.8,.3],[.2,.9]],[[.2,.9],[.8,.3]]]){
    assert.deepEqual(dragBounds(start,end),[.2,.3,.8,.9]);
  }
});
test('drawing clamps to source coordinates and rejects accidental taps',()=>{
  assert.deepEqual(dragBounds([-.2,-.3],[1.4,1.2]),[0,0,1,1]);
  assert.equal(dragBounds([.2,.2],[.21,.8]),null);
  assert.equal(dragBounds([.2,.2],[.8,.21]),null);
  assert.equal(dragBounds([.5,.5],[.5,.5]),null);
});
test('selected-region progress is bounded and uses received frames only',()=>{
  assert.equal(progressValue(0,0),0);
  assert.equal(progressValue(0,10),0);
  assert.equal(progressValue(3,10),30);
  assert.equal(progressValue(6,6),100);
  assert.equal(progressValue(7,6),100);
  assert.equal(progressValue(-1,6),0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {mountMessages} from '../../bunkr/ui/messages.mjs';
const fixture=JSON.parse(readFileSync(new URL('../../fixtures/messages/messages.json',import.meta.url))).unicode;
fixture.radio_bytes=fixture.packets.map(wire=>wire.length/2+34);
if(!globalThis.crypto)globalThis.crypto=webcrypto;
class Node {
  constructor(){this.children=[];this.handlers={};this.value='';this.textContent='';this.classes=new Set();this.classList={add:s=>this.classes.add(s),remove:s=>this.classes.delete(s),toggle:(s,on)=>on?this.classes.add(s):this.classes.delete(s)};}
  append(...children){for(const child of children){child.parent=this;this.children.push(child);}}
  remove(){this.parent.children=this.parent.children.filter(c=>c!==this);}
  setAttribute(){}
  replaceChildren(...nodes){this.children=[];this.append(...nodes);}
  addEventListener(type,fn){this.handlers[type]=fn;}
  querySelector(selector){return this.children.find(c=>c.className===selector.slice(1))||null;}
  async trigger(type){await this.handlers[type]?.({preventDefault(){},target:this});}
}
function setup({failAck=false,failData=false}={}){
  const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,new Node());return nodes.get(id);};
  globalThis.document={getElementById:get,createElement:()=>new Node()};globalThis.window={addEventListener(){}};
  let busy=false,generation=0,acks=0,calls=0;
  const hooks={isBusy:()=>busy,setBusy:v=>busy=v,generation:()=>generation,guard:v=>{if(v!==generation){const e=Error('reset');e.name='AbortError';throw e;}},cancelAutoStart(){},event(){},urls:new Set(),
    async api(path){if(path==='/api/message')return fixture;acks++;return {confirmed:true};},
    async runFrames(frames,options){calls++;if(options.label==='Confirming text'&&failAck){failAck=false;throw Error('ACK retry limit');}if(options.label==='Text message'&&failData){failData=false;throw Error('data retry limit');}for(const f of frames)await options.onFrame?.(f);}
  };
  const ui=mountMessages(hooks);ui.ready(false);
  const settle=async()=>{for(let i=0;i<100&&busy;i++)await new Promise(resolve=>setTimeout(resolve,2));assert.equal(busy,false);};
  return {get,ui,settle,acks:()=>acks,calls:()=>calls,reset(){generation++;ui.reset();hooks.setBusy(false);}};
}
test('UI withholds incomplete text and retries same message without duplicate received bubble',async()=>{
  const h=setup({failData:true});h.get('alex-text').value='At the junction 🌲 — नमस्ते';await h.get('alex-composer').trigger('submit');await h.settle();
  const outgoing=h.get('alex-chat').children[0],incoming=h.get('sam-chat').children[0];
  assert.match(outgoing.children[1].textContent,/Not delivered/);assert.equal(incoming.children[0].textContent,'Text arriving…');assert.equal(h.acks(),0);
  await outgoing.querySelector('.retry-message').trigger('click');await h.settle();
  assert.equal(h.get('sam-chat').children.length,1);assert.equal(incoming.children[0].textContent,'At the junction 🌲 — नमस्ते');assert.match(outgoing.children[1].textContent,/Receipt confirmed/);assert.equal(h.acks(),1);
});
test('lost ACK keeps verified content visible and retries only acknowledgment',async()=>{
  const h=setup({failAck:true});h.get('alex-text').value='At the junction 🌲 — नमस्ते';await h.get('alex-composer').trigger('submit');await h.settle();
  const outgoing=h.get('alex-chat').children[0],incoming=h.get('sam-chat').children[0];
  assert.match(outgoing.children[1].textContent,/receipt not confirmed/);assert.match(incoming.children[1].textContent,/Received & verified/);assert.equal(h.acks(),0);assert.equal(h.calls(),2);
  await outgoing.querySelector('.retry-message').trigger('click');await h.settle();
  assert.equal(h.calls(),3);assert.equal(h.acks(),1);assert.equal(h.get('sam-chat').children.length,1);
  h.reset();assert.equal(h.get('alex-chat').children.length,0);assert.equal(h.get('sam-chat').children.length,0);
});
test('microphone denial is explicit and leaves composing available',async()=>{
  const h=setup();h.ui.ready(true);
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:async()=>{const e=Error('denied');e.name='NotAllowedError';throw e;}}}});
  window.MediaRecorder=class{};
  await h.get('alex-record').trigger('click');
  assert.match(h.get('alex-compose-status').textContent,/permission denied/);
  assert.equal(h.get('alex-send').disabled,false);
});
test('reset releases microphone tracks and cancels sending the recording',async()=>{
  const h=setup();h.ui.ready(true);let stopped=0;
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop(){stopped++;}}]})}}});
  class Recorder{static isTypeSupported(){return true;}constructor(){this.state='inactive';}start(){this.state='recording';}stop(){this.state='inactive';this.onstop();}}
  window.MediaRecorder=globalThis.MediaRecorder=Recorder;
  const label=new Node();h.get('alex-record').querySelector=()=>label;
  await h.get('alex-record').trigger('click');assert.equal(label.textContent,'Stop & send');
  h.reset();assert.ok(stopped>0);assert.equal(h.get('alex-chat').children.length,0);assert.equal(h.acks(),0);
});
test('cancelling a voice note releases the microphone and sends no message',async()=>{
  const h=setup();h.ui.ready(true);let stopped=0;
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop(){stopped++;}}]})}}});
  class Recorder{static isTypeSupported(){return true;}constructor(){this.state='inactive';}start(){this.state='recording';}stop(){this.state='inactive';this.onstop();}}
  window.MediaRecorder=globalThis.MediaRecorder=Recorder;
  const label=new Node();h.get('alex-record').querySelector=()=>label;
  await h.get('alex-record').trigger('click');
  assert.equal(label.textContent,'Stop & send');
  assert.equal(h.get('sam-record').disabled,true);
  h.ui.cancelRecording();
  assert.ok(stopped>0);assert.equal(label.textContent,'Record');
  assert.equal(h.get('alex-chat').children.length,0);assert.equal(h.calls(),0);
  assert.equal(h.get('alex-send').disabled,false);assert.equal(h.get('sam-record').disabled,false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mountPhotoImport,MAX_PHOTO_UPLOAD,uploadPhoto} from '../../imageoverbt/ui/photos.mjs';
import {parseManifest} from '../../imageoverbt/ui/protocol.mjs';
const manifest=readFileSync(new URL('../../fixtures/wire/preview.manifest.bin',import.meta.url)).toString('hex');
const response={image_id:parseManifest(manifest).imageId,preview:{manifest}};
class Element{
  constructor(){this.handlers={};this.disabled=false;this.value='';this.files=[];this.textContent='';this.clicked=0;this.classes=new Set();this.classList={add:s=>this.classes.add(s),remove:s=>this.classes.delete(s)};}
  addEventListener(name,fn){this.handlers[name]=fn;}
  click(){this.clicked++;return this.handlers.click?.();}
}
function setup(upload=async()=>response){
  const button=new Element(),input=new Element(),status=new Element();let busy=false,version=0;
  const applied=[],changes=[];
  const hooks={button,input,status,upload,isBusy:()=>busy,setBusy:value=>{busy=value;changes.push(value);},ready:()=>true,generation:()=>version,
    guard:v=>{if(v!==version){const e=Error('Reset');e.name='AbortError';throw e;}},cancelAutoStart:()=>changes.push('cancel'),applyPhoto:(...args)=>applied.push(args)};
  const controller=mountPhotoImport(hooks);
  return {button,input,status,applied,changes,controller,get busy(){return busy;},reset:()=>{version++;controller.reset();busy=false;controller.controls();}};
}
const file={size:1024,name:'my-photo.heic'};
test('choose opens file picker; cancel preserves the current photo',async()=>{
  const s=setup();s.input.value='previous';s.button.click();assert.equal(s.input.value,'');assert.equal(s.input.clicked,1);
  await s.input.handlers.change();assert.equal(s.applied.length,0);assert.equal(s.busy,false);
});
test('valid import locks controls, applies verified manifest and waits for explicit send',async()=>{
  let resolve;const s=setup(()=>new Promise(r=>resolve=r));s.input.files=[file];
  const pending=s.input.handlers.change();assert.equal(s.button.disabled,true);assert.equal(s.busy,true);
  resolve(response);await pending;
  assert.deepEqual(s.applied,[[response,file.name]]);assert.equal(s.button.disabled,false);assert.equal(s.busy,false);
  assert.match(s.status.textContent,/Ready/);assert.equal(s.input.value,'');
  // Import has no transport hook: it cannot silently send the selected photo.
});
test('oversized, empty and unreadable files retain the existing photo and allow retry',async()=>{
  let calls=0;const s=setup(async()=>{calls++;throw Error('This photo could not be read.');});
  for(const size of [0,MAX_PHOTO_UPLOAD+1,100]){
    s.input.files=[{...file,size}];await s.input.handlers.change();assert.equal(s.applied.length,0);
    assert.equal(s.busy,false);assert.equal(s.button.disabled,false);assert.ok(s.status.classes.has('error'));
  }
  assert.equal(calls,1);
});
test('reset aborts upload and ignores a late result without unlocking a later operation',async()=>{
  let resolve,signal;const s=setup((file,sig)=>{signal=sig;return new Promise(r=>resolve=r);});
  s.input.files=[file];const pending=s.input.handlers.change();s.reset();assert.equal(signal.aborted,true);
  resolve(response);await pending;assert.equal(s.applied.length,0);assert.equal(s.busy,false);assert.ok(!s.status.classes.has('error'));
});
test('an invalid returned manifest never replaces the selected photo',async()=>{
  const s=setup(async()=>({...response,image_id:'00'.repeat(16)}));s.input.files=[file];await s.input.handlers.change();
  assert.equal(s.applied.length,0);assert.match(s.status.textContent,/does not match/);
});
test('photo transport sends binary upload with cancellation and surfaces server errors',async()=>{
  const original=globalThis.fetch;let request;
  try{
    globalThis.fetch=async(path,options)=>{request={path,options};return {ok:true,json:async()=>response};};
    const signal=new AbortController().signal;assert.deepEqual(await uploadPhoto(file,signal),response);
    assert.equal(request.path,'/api/photo');assert.equal(request.options.body,file);assert.equal(request.options.signal,signal);
    assert.equal(request.options.headers['Content-Type'],'application/octet-stream');
    globalThis.fetch=async()=>({ok:false,json:async()=>({error:'Unsupported photo'})});
    await assert.rejects(uploadPhoto(file),/Unsupported photo/);
  }finally{globalThis.fetch=original;}
});

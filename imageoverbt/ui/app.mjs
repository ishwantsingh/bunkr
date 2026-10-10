import {parseManifest, Reassembler, makeAck, makeRequest, clampBounds, fromHex, validate} from './protocol.mjs';
import {mountMessages} from './messages.mjs';
import {mountPhotoImport} from './photos.mjs';
import {Network} from './network.mjs';
import {mountMeshPanel} from './mesh/panel.mjs';

const $ = id => document.getElementById(id);
let network=new Network(), demo=null, transfer=null, busy=false, previewReady=false, generation=0;
let bounds=[.18,.25,.84,.59], speed=1, tickBusy=false, autoStart=null;
const objectURLs=new Set();
let messages,photos,panel;
function setBusy(value){busy=value;if(messages)messages.controls();else photos?.controls();panel?.render();}
const icon=(id)=>`<svg><use href="#i-${id}"/></svg>`;
function event(text,type='normal',elapsed=network.time){panel?.log(text,type,elapsed);}
function toast(message) {$('toast').textContent=message;$('toast').hidden=false;setTimeout(()=>$('toast').hidden=true,5000);}
async function api(path,payload) {
  const response=await fetch(path,payload===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const data=await response.json();if(!response.ok)throw Error(data.error||'Could not process message');return data;
}
function cancelError(){const error=Error('Demo reset');error.name='AbortError';return error;}
function guard(version){if(version!==generation)throw cancelError();}
function step(n,done=false){for(let i=1;i<=3;i++){$(`step-${['one','two','three'][i-1]}`).className=`step${i<n||done?' done':''}${i===n&&!done?' current':''}`;}}
function senderStatus(title,detail,active=false,complete=false){$('sender-status').textContent=title;$('sender-detail').textContent=detail;$('sender-note-dot').className=`note-dot${active?' active':''}${complete?' complete':''}`;}
function recipientStatus(title,detail){$('receiver-status').textContent=title;$('receiver-detail').textContent=detail;}
function selection(){bounds=clampBounds(bounds);const [l,t,r,b]=bounds;Object.assign($('crop-box').style,{left:`${l*100}%`,top:`${t*100}%`,width:`${(r-l)*100}%`,height:`${(b-t)*100}%`});$('crop-box').setAttribute('aria-valuenow',Math.round((r-l)*100));$('crop-box').setAttribute('aria-valuetext',`${Math.round((r-l)*100)}% wide, ${Math.round((b-t)*100)}% high`);}
function metrics(){
  if(transfer){$('packet-count').textContent=`${transfer.received} / ${transfer.total} packets`;$('progress-label').textContent=transfer.label;}
  panel?.render();
}
function runFrames(frames,{label,reverse=false,onFrame=async()=>{},onState=()=>{}}){
  if(transfer)throw Error('A transfer is already active');
  return new Promise((resolve,reject)=>{transfer={resolve,reject,label,reverse,onFrame,total:frames.length,received:0,generation,onState};try{network.enqueue(frames,reverse);metrics();}catch(error){transfer=null;reject(error);}});
}
async function tick({singleEvent=false}={}){
  if(tickBusy||!transfer)return;tickBusy=true;
  const current=transfer;
  try{
    const result=await network.advance({seconds:8*speed,singleEvent});
    guard(current.generation);
    current.onState?.(result.state);
    for(const frame of result.received){await current.onFrame(frame);guard(current.generation);current.received++;}
    metrics();
    if(result.failed.length)throw Error('Mesh recovery limit reached. Retry the message or resend the photo.');
    if(current.received===current.total&&transfer===current){transfer=null;current.resolve();}
  }catch(error){if(transfer===current){transfer=null;network.cancel();current.reject(error);}}
  finally{tickBusy=false;}
}
setInterval(tick,200);
function framesFor(rep,index=0){return [{wire:rep.manifest,radioBytes:rep.manifest.length/2+34,manifest:true,index},...rep.packets.map((wire,i)=>({wire,radioBytes:rep.radio_bytes[i],index}))];}
async function decodeVerified(reassembler){
  const bytes=await reassembler.verifiedBytes(),m=reassembler.manifest;
  const blob=new Blob([bytes],{type:m.codec===1?'image/webp':'image/jpeg'});
  const bitmap=await createImageBitmap(blob);
  try{if(bitmap.width!==m.width||bitmap.height!==m.height)throw Error('Decoded image dimensions do not match manifest');}finally{bitmap.close();}
  const url=URL.createObjectURL(blob);objectURLs.add(url);network.markVerified(m.id,url);return url;
}
async function sendPhoto(){
  if(busy||!demo)return;const version=generation;setBusy(true);
  $('send-photo').disabled=true;$('request-section').disabled=true;$('another-section').hidden=true;
  $('detail-tiles').replaceChildren();$('crop-box').hidden=true;$('preview-image').hidden=true;$('image-placeholder').hidden=false;$('selection-help').hidden=false;
  previewReady=false;step(1);senderStatus('Sending tiny preview','The full photo stays on Alex’s phone.',true);recipientStatus('A preview is on its way','Packets are hopping across the mesh.');
  $('network-subtitle').textContent='Preview first. The original stays with Alex.';event('Preview queued at A · original retained locally');
  try{
    const m=parseManifest(demo.preview.manifest),assembler=new Reassembler(m);let registered=false;
    await runFrames(framesFor(demo.preview),{label:'Sending preview',onFrame:async f=>{if(f.manifest){validate(fromHex(f.wire),1);registered=true;}else assembler.add(f.wire);}});
    guard(version);if(!registered)throw Error('Preview manifest is missing');
    const url=await decodeVerified(assembler);guard(version);
    $('preview-image').src=url;$('preview-image').hidden=false;$('image-placeholder').hidden=true;previewReady=true;
    bounds=[...demo.default_bounds];selection();$('crop-box').hidden=false;$('crop-box').classList.remove('locked');$('crop-box-label').textContent='SELECTED SECTION';
    $('receiver-image-status').textContent=`PREVIEW ONLY · ${m.bytes} B`;
    recipientStatus('Preview received','Drag the box. Request only what matters.');event('Preview verified on D · crop selection enabled','verified');
    await runFrames([{wire:makeAck(m)}],{label:'Confirming preview',reverse:true});guard(version);
    const confirmed=await api('/api/confirm',{acks:[makeAck(m)]});guard(version);if(!confirmed.confirmed)throw Error('Sender confirmation failed');network.markConfirmed(m.id);
    senderStatus('Preview receipt confirmed','Full-resolution photo retained locally.',false,true);$('sender-ticks').textContent='✓✓';
    $('request-section').disabled=false;$('send-photo').innerHTML=icon('reset')+'Send again';step(2);
    $('progress-label').textContent='Preview delivered';$('packet-count').innerHTML=`${m.count+1} <small>/ ${m.count+1} packets</small>`;
    $('network-subtitle').textContent='Choose a section on Sam’s phone to bring it into focus.';
  }catch(error){if(error.name!=='AbortError'){toast(error.message);senderStatus('Transfer stopped',error.message);}}
  finally{if(version===generation){setBusy(false);$('send-photo').disabled=false;}}
}
async function requestSection(){
  if(busy||!previewReady)return;const version=generation;setBusy(true);
  $('request-section').disabled=true;$('send-photo').disabled=true;$('another-section').hidden=true;$('selection-help').hidden=true;
  $('crop-box').classList.add('locked');$('crop-box-label').textContent='REQUESTING DETAIL';step(3);
  const selected=[...bounds],requestId=crypto.randomUUID().replaceAll('-','');
  const requestWire=makeRequest(demo.image_id,requestId,selected);
  recipientStatus('Requesting your section','The request is traveling back to Alex.');senderStatus('Waiting for Sam’s request','Only the preview has been confirmed.');
  $('network-subtitle').textContent='A small request travels back. Selected detail gets priority.';
  event('Section request queued at D · reverse path');
  try{
    await runFrames([{wire:requestWire}],{label:'Request → sender',reverse:true});guard(version);
    event('Request reached A · selected detail takes priority');$('local-reply').hidden=false;
    senderStatus('Sending requested section','Extracting pixels from the original photo.',true);
    const response=await api('/api/crop',{image_id:demo.image_id,bounds:selected,request_id:requestId});guard(version);
    const reps=response.tiles.map(rep=>({wire:rep,manifest:parseManifest(rep.manifest),assembler:new Reassembler(parseManifest(rep.manifest)),registered:false,revealed:false}));
    let revealed=0;
    recipientStatus('Selected detail is arriving','0 of 6 pieces verified. The rest stays blurry.');$('crop-box-label').textContent='DETAIL ARRIVING';
    async function reveal(rep){
      if(rep.revealed||!rep.registered||rep.assembler.chunks.size!==rep.manifest.count)return;
      rep.revealed=true;const url=await decodeVerified(rep.assembler);guard(version);
      const m=rep.manifest,[left,top,right,bottom]=m.bounds;
      const x0=Math.floor(left*m.sourceWidth),y0=Math.floor(top*m.sourceHeight),x1=Math.ceil(right*m.sourceWidth),y1=Math.ceil(bottom*m.sourceHeight);
      const tile=document.createElement('img');tile.alt='Verified source detail';tile.src=url;
      Object.assign(tile.style,{left:`${x0/m.sourceWidth*100}%`,top:`${y0/m.sourceHeight*100}%`,width:`${(x1-x0)/m.sourceWidth*100}%`,height:`${(y1-y0)/m.sourceHeight*100}%`});
      $('detail-tiles').append(tile);revealed++;
      recipientStatus('Selected detail is arriving',`${revealed} of 6 pieces verified. The rest stays blurry.`);
      $('receiver-image-status').textContent=`PREVIEW + ${revealed}/6 VERIFIED DETAIL`;
      event(`Detail piece ${revealed}/6 verified at D · pixels revealed`,'verified');
    }
    await runFrames(reps.flatMap((rep,i)=>framesFor(rep.wire,i)),{label:'Requested detail',onFrame:async f=>{const rep=reps[f.index];if(f.manifest){validate(fromHex(f.wire),1);rep.registered=true;}else rep.assembler.add(f.wire);await reveal(rep);}});
    guard(version);if(revealed!==6)throw Error('Section verification did not finish');
    $('crop-box-label').textContent='HIGH-DEFINITION SECTION';
    recipientStatus('Your section is clear','Verified locally. Confirming with Alex…');senderStatus('Section sent · awaiting receipt','Waiting for Sam’s verified completion acknowledgment.',true);
    const acks=reps.map(rep=>makeAck(rep.manifest));
    await runFrames(acks.map(wire=>({wire})),{label:'Confirming receipt',reverse:true});guard(version);
    const confirmed=await api('/api/confirm',{acks});guard(version);if(!confirmed.confirmed)throw Error('Sender confirmation failed');
    for(const rep of reps)network.markConfirmed(rep.manifest.id);
    senderStatus('Section receipt confirmed','Only the detail Sam requested was sent.',false,true);
    const packetTotal=reps.reduce((sum,rep)=>sum+rep.manifest.count+1,0);
    $('progress-label').textContent='Selected detail delivered';$('packet-count').innerHTML=`${packetTotal} <small>/ ${packetTotal} packets</small>`;
    recipientStatus('Section received & verified','Original pixels. Just where you need them.');
    $('receiver-image-status').textContent='PREVIEW + VERIFIED HD SECTION';$('another-section').hidden=false;step(3,true);
    $('network-subtitle').textContent='Requested detail is clear. The rest can stay a preview.';event('Completion ACK reached A · sender receipt confirmed','verified');
  }catch(error){if(error.name!=='AbortError'){toast(error.message);recipientStatus('Detail transfer stopped',error.message);$('crop-box').classList.remove('locked');$('request-section').disabled=false;}}
  finally{if(version===generation){setBusy(false);$('send-photo').disabled=false;}}
}
function photoGeometry(){
  const m=parseManifest(demo.preview.manifest),aspect=`${m.sourceWidth} / ${m.sourceHeight}`;
  $('source-image').parentElement.style.aspectRatio=aspect;
  $('recipient-photo').style.aspectRatio=aspect;
}
function applyPhoto(response,name){
  network.representations.clear();network.activeRepresentations=[];panel?.clearTransfer();
  demo=response;previewReady=false;bounds=[...demo.default_bounds];
  photoGeometry();
  $('source-image').src=demo.source_url;$('source-image').alt=`Original photo: ${name}`;
  $('photo-file-name').textContent=name;$('photo-file-name').title=name;
  $('source-caption').textContent='Photo';$('receiver-caption').textContent='';
  $('sender-ticks').textContent='';$('detail-tiles').replaceChildren();
  $('preview-image').hidden=true;$('preview-image').removeAttribute('src');
  $('image-placeholder').hidden=false;$('crop-box').hidden=true;$('crop-box').classList.remove('locked');
  $('local-reply').hidden=true;$('another-section').hidden=true;$('selection-help').hidden=false;
  $('request-section').disabled=true;$('send-photo').innerHTML=icon('arrow')+'Send photo';
  $('receiver-image-status').textContent='Waiting for photo';$('progress-label').textContent='Photo ready to send';
  $('packet-count').innerHTML='0 <small>/ 0 packets</small>';
  senderStatus('Photo ready to send','Original stays on this phone.');
  recipientStatus('Waiting for the preview','Nothing has arrived yet.');
  $('network-subtitle').textContent='Send the preview, then choose the detail you need.';
  $('alex-chat').scrollTop=0;step(1);
  event('New photo prepared at A · not sent yet');
}
function reset(){
  generation++;photos?.reset();messages?.reset();drag=null;clearTimeout(autoStart);if(transfer){transfer.reject(cancelError());transfer=null;}
  network=new Network({loss:Number($('lossRange').value)/100,preset:$('presetSelect').value,seed:Number($('seedInput').value)||16});previewReady=false;setBusy(false);
  for(const url of objectURLs)URL.revokeObjectURL(url);objectURLs.clear();
  $('detail-tiles').replaceChildren();
  $('crop-box').hidden=true;$('preview-image').hidden=true;$('image-placeholder').hidden=false;$('local-reply').hidden=true;$('another-section').hidden=true;$('selection-help').hidden=false;
  $('request-section').disabled=true;$('send-photo').disabled=!demo;$('send-photo').innerHTML=icon('arrow')+'Send photo';$('sender-ticks').textContent='✓';
  $('receiver-image-status').textContent='Photo incoming';$('progress-label').textContent='Ready to send';$('packet-count').innerHTML='0 <small>/ 0 packets</small>';
  senderStatus('Photo ready to send','Original stays on this phone.');recipientStatus('Start with the preview','Then choose the detail you need.');$('network-subtitle').textContent='A small preview goes first. You choose what follows.';
  step(1);panel?.reset();
}
let drag=null;
$('crop-box').addEventListener('pointerdown',e=>{
  if(busy||!previewReady)return;e.preventDefault();$('request-section').disabled=false;$('another-section').hidden=true;$('crop-box').classList.remove('locked');$('crop-box-label').textContent='SELECTED SECTION';const box=$('recipient-photo').getBoundingClientRect();
  drag={start:[e.clientX/box.width,e.clientY/box.height],bounds:[...bounds],handle:e.target.dataset.handle,rect:box};$('crop-box').setPointerCapture(e.pointerId);
});
$('crop-box').addEventListener('pointermove',e=>{
  if(!drag)return;const dx=e.clientX/drag.rect.width-drag.start[0],dy=e.clientY/drag.rect.height-drag.start[1];let [l,t,r,b]=drag.bounds;
  if(!drag.handle){bounds=clampBounds([l+dx,t+dy,r+dx,b+dy]);}
  else{if(drag.handle.includes('w'))l=Math.max(0,Math.min(r-.08,l+dx));else r=Math.min(1,Math.max(l+.08,r+dx));if(drag.handle.includes('n'))t=Math.max(0,Math.min(b-.08,t+dy));else b=Math.min(1,Math.max(t+.08,b+dy));bounds=[l,t,r,b];}
  $('crop-box').classList.remove('locked');selection();
});
for(const type of ['pointerup','pointercancel'])$('crop-box').addEventListener(type,()=>drag=null);
$('crop-box').addEventListener('keydown',e=>{
  if(busy||!previewReady||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();
  const dx=e.key==='ArrowLeft'?-.02:e.key==='ArrowRight'?.02:0,dy=e.key==='ArrowUp'?-.02:e.key==='ArrowDown'?.02:0;
  let [l,t,r,b]=bounds;bounds=e.shiftKey?[l,t,r+dx,b+dy]:[l+dx,t+dy,r+dx,b+dy];selection();$('crop-box').classList.remove('locked');$('request-section').disabled=false;
});
$('another-section').addEventListener('click',()=>{bounds=[.12,.08,.65,.44];selection();$('crop-box').classList.remove('locked');$('crop-box-label').textContent='SELECTED SECTION';$('another-section').hidden=true;$('request-section').disabled=false;recipientStatus('Choose another section','Drag the box. Previously received detail stays.');step(2);});
$('send-photo').addEventListener('click',()=>{clearTimeout(autoStart);sendPhoto();});$('request-section').addEventListener('click',requestSection);$('reset').addEventListener('click',reset);
messages=mountMessages({onVerified:m=>network.markVerified(m.id),onConfirmed:m=>network.markConfirmed(m.id),api,runFrames,event,urls:objectURLs,isBusy:()=>busy,setBusy,generation:()=>generation,guard,cancelAutoStart:()=>clearTimeout(autoStart),composeBusy:disabled=>{photos?.controls(disabled);$('send-photo').disabled=disabled||!demo;$('request-section').disabled=disabled||!previewReady||$('crop-box').classList.contains('locked');}});
photos=mountPhotoImport({button:$('choose-photo'),input:$('photo-file'),status:$('photo-import-status'),
  isBusy:()=>busy,setBusy,ready:()=>!!demo,generation:()=>generation,guard,
  cancelAutoStart:()=>clearTimeout(autoStart),applyPhoto});
panel=mountMeshPanel({network:()=>network,busy:()=>busy,canSend:()=>!!demo&&!busy,
  canRequest:()=>previewReady&&!busy&&!$('crop-box').classList.contains('locked'),
  sendPhoto:()=>{clearTimeout(autoStart);sendPhoto();},requestSection,step:()=>tick({singleEvent:true}),setSpeed:value=>speed=value,reset});
reset();
try{demo=await api('/api/demo');messages.ready(demo.voice_available);$('source-image').src=demo.source_url;photoGeometry();photos.controls();$('protocol-label').textContent=demo.transport;$('send-photo').disabled=false;panel.render();autoStart=setTimeout(sendPhoto,700);}
catch(error){toast('Could not load the media demo: '+error.message);$('protocol-label').textContent='Media server unavailable';}

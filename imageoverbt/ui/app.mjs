import {parseManifest, Reassembler, makeAck, makeRequest, clampBounds, fromHex, validate} from './protocol.mjs';
import {mountMessages} from './messages.mjs';
import {Network, NODES, LINKS, route} from './network.mjs';

const $ = id => document.getElementById(id);
const svgNS='http://www.w3.org/2000/svg';
let network=new Network(), demo=null, transfer=null, busy=false, previewReady=false, generation=0;
let bounds=[.18,.25,.84,.59], speed=1, tickBusy=false, autoStart=null, clock=0;
const objectURLs=new Set();
let messages;
function setBusy(value){busy=value;messages?.controls();}
const icon=(id)=>`<svg><use href="#i-${id}"/></svg>`;
function svgElement(tag,attrs={}) {const el=document.createElementNS(svgNS,tag);for(const [k,v] of Object.entries(attrs))el.setAttribute(k,v);return el;}
function event(text,type='normal') {
  $('timeline-empty').hidden=true;
  const li=document.createElement('li');li.className=type;
  const time=document.createElement('time'), tick=clock++;time.textContent=`09:${String(41+Math.floor(tick/60)).padStart(2,'0')}:${String(tick%60).padStart(2,'0')}`;
  const dot=document.createElement('i'),span=document.createElement('span');span.textContent=text;
  li.append(time,dot,span);$('events').prepend(li);while($('events').children.length>6)$('events').lastChild.remove();
}
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
function graph(){
  const path=network.online?route(network.enabled):null;
  $('mesh-links').replaceChildren();
  for(const [a,b] of LINKS){const active=path?.some((n,i)=>n===a&&path[i+1]===b||n===b&&path[i+1]===a);const off=!network.enabled.has(a)||!network.enabled.has(b);$('mesh-links').append(svgElement('line',{x1:NODES[a][0],y1:NODES[a][1],x2:NODES[b][0],y2:NODES[b][1],class:`mesh-link${active?' active':''}${off?' disabled':''}`}));}
  $('mesh-nodes').replaceChildren();
  for(const [name,[x,y]] of Object.entries(NODES)){
    const endpoint=['A','D'].includes(name),g=svgElement('g',{class:`node${endpoint?' endpoint':''}${network.enabled.has(name)?'':' offline'}`,transform:`translate(${x} ${y})`,...(endpoint?{}:{role:'button',tabindex:'0','aria-label':`Toggle relay ${name}`,'aria-pressed':String(network.enabled.has(name))})});
    g.append(svgElement('circle',{class:'halo',r:30}),svgElement('circle',{class:'disc',r:20}));
    const label=svgElement('text',{class:'letter'});label.textContent=name;g.append(label);
    const caption=svgElement('text',{class:'node-caption',y:36});caption.textContent=name==='A'?'Alex · Sender':name==='D'?'Sam · Recipient':network.enabled.has(name)?'Relay':'Offline';g.append(caption);
    const role=svgElement('text',{class:'node-role',y:48});role.textContent=name==='A'?'SOURCE PHOTO':name==='D'?'SELECTED DETAIL':name==='E'?'ALTERNATE PATH':'';g.append(role);
    if(!endpoint){g.addEventListener('click',()=>toggleRelay(name));g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();toggleRelay(name);}});}
    $('mesh-nodes').append(g);
  }
  $('route-label').textContent=path?path.join(' → '):'No available route';
  $('hop-metric').innerHTML=path?`${path.length-1} <small>hops</small>`:'— <small>unknown</small>';
  $('connection').classList.toggle('offline',!network.online);$('connection').setAttribute('aria-pressed',String(network.online));$('connection').querySelector('span').textContent=network.online?'Network online':'Disconnected';
  const bOffline=!network.enabled.has('B');$('relay-toggle').textContent=bOffline?'Restore B':'Take B offline';$('relay-toggle').setAttribute('aria-pressed',String(bOffline));
}
function toggleRelay(name){if(network.enabled.has(name))network.enabled.delete(name);else network.enabled.add(name);event(`Relay ${name} ${network.enabled.has(name)?'restored':'offline'} · received chunks retained`,network.enabled.has(name)?'normal':'loss');graph();}
function animateHop(result){
  const a=NODES[result.from],b=NODES[result.to];if(!a||!b)return;
  $('mesh-packets').replaceChildren();
  for(let index=0;index<3;index++){
    const circle=svgElement('circle',{r:index===0?5:3,class:`moving-packet${transfer?.reverse?' request':''}`});
    $('mesh-packets').append(circle);
    const motion=svgElement('animateMotion',{dur:`${.26/speed}s`,begin:`${index*.03/speed}s`,path:`M${a[0]},${a[1]} L${b[0]},${b[1]}`,fill:'freeze'});circle.append(motion);motion.beginElement();
    setTimeout(()=>circle.remove(),400/speed);
  }
  if(result.dropped.length){const lost=svgElement('circle',{cx:(a[0]+b[0])/2,cy:(a[1]+b[1])/2+12,r:4,class:'moving-packet lost'});$('mesh-packets').append(lost);setTimeout(()=>lost.remove(),500/speed);}
}
function metrics(){
  $('retry-metric').innerHTML=`${network.lost} <small>packets</small>`;
  if(transfer){const count=transfer.received;const total=transfer.total;$('packet-count').innerHTML=`${count} <small>/ ${total} packets</small>`;$('progress-fill').style.width=`${count/total*100}%`;$('progress-label').textContent=transfer.label;}
}
function runFrames(frames,{label,reverse=false,onFrame=async()=>{},onState=()=>{}}){
  if(transfer)throw Error('A transfer is already active');
  return new Promise((resolve,reject)=>{transfer={resolve,reject,label,reverse,onFrame,total:frames.length,received:0,generation,onState};network.enqueue(frames,reverse);metrics();});
}
async function tick(){
  if(tickBusy||!transfer)return;tickBusy=true;
  const current=transfer;
  try{
    const result=network.advance();
    current.onState?.(result.state);
    $('map-state').hidden=!['waiting','paused'].includes(result.state);
    if(result.state==='waiting'||result.state==='paused'){
      $('map-state').querySelector('strong').textContent=result.state==='paused'?'Simulation paused':'Waiting for a route';
      $('map-state').querySelector('span').textContent='Received progress is retained in this session.';return;
    }
    if(result.state==='hopping'){
      animateHop(result);
      const count=result.received.length||result.dropped.length||network.active?.frames.length||1;
      if(result.dropped.length)event(`${result.dropped.length} lost on ${result.from} → ${result.to} · selective retry`,'loss');
      else event(`${count} packet${count===1?'':'s'} · ${result.from} → ${result.to}`);
      if(result.failed.length)throw Error('Retry limit reached. Reset the demo to try again.');
      for(const frame of result.received){await current.onFrame(frame);guard(current.generation);current.received++;}
      metrics();
    }
    if(current.received===current.total&&transfer===current){transfer=null;current.resolve();}
  }catch(error){if(transfer===current){transfer=null;network.queue=[];network.active=null;current.reject(error);}}
  finally{tickBusy=false;}
}
let timer=setInterval(tick,200);
function framesFor(rep,index=0){const manifest=parseManifest(rep.manifest);return [{wire:rep.manifest,radioBytes:rep.manifest.length/2+34,manifest:true,index},...rep.packets.map((wire,i)=>({wire,radioBytes:rep.radio_bytes[i],index}))];}
async function decodeVerified(reassembler){
  const bytes=await reassembler.verifiedBytes(),m=reassembler.manifest;
  const blob=new Blob([bytes],{type:m.codec===1?'image/webp':'image/jpeg'});
  const bitmap=await createImageBitmap(blob);
  try{if(bitmap.width!==m.width||bitmap.height!==m.height)throw Error('Decoded image dimensions do not match manifest');}finally{bitmap.close();}
  const url=URL.createObjectURL(blob);objectURLs.add(url);return url;
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
    await api('/api/confirm',{acks:[makeAck(m)]});guard(version);
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
    const response=await api('/api/crop',{bounds:selected,request_id:requestId});guard(version);
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
    senderStatus('Section receipt confirmed','Only the detail Sam requested was sent.',false,true);
    const packetTotal=reps.reduce((sum,rep)=>sum+rep.manifest.count+1,0);
    $('progress-label').textContent='Selected detail delivered';$('packet-count').innerHTML=`${packetTotal} <small>/ ${packetTotal} packets</small>`;
    recipientStatus('Section received & verified','Original pixels. Just where you need them.');
    $('receiver-image-status').textContent='PREVIEW + VERIFIED HD SECTION';$('another-section').hidden=false;step(3,true);
    $('network-subtitle').textContent='Requested detail is clear. The rest can stay a preview.';event('Completion ACK reached A · sender receipt confirmed','verified');
  }catch(error){if(error.name!=='AbortError'){toast(error.message);recipientStatus('Detail transfer stopped',error.message);$('crop-box').classList.remove('locked');$('request-section').disabled=false;}}
  finally{if(version===generation){setBusy(false);$('send-photo').disabled=false;}}
}
function reset(){
  generation++;messages?.reset();drag=null;clearTimeout(autoStart);if(transfer){transfer.reject(cancelError());transfer=null;}
  network=new Network({loss:Number($('loss').value)/100});previewReady=false;setBusy(false);clock=0;
  for(const url of objectURLs)URL.revokeObjectURL(url);objectURLs.clear();
  $('events').replaceChildren();$('timeline-empty').hidden=false;$('detail-tiles').replaceChildren();$('mesh-packets').replaceChildren();
  $('map-state').hidden=true;$('crop-box').hidden=true;$('preview-image').hidden=true;$('image-placeholder').hidden=false;$('local-reply').hidden=true;$('another-section').hidden=true;$('selection-help').hidden=false;
  $('request-section').disabled=true;$('send-photo').disabled=!demo;$('send-photo').innerHTML=icon('arrow')+'Send photo';$('sender-ticks').textContent='✓';
  $('receiver-image-status').textContent='Photo incoming';$('progress-label').textContent='Ready to send';$('packet-count').innerHTML='0 <small>/ 0 packets</small>';$('progress-fill').style.width='0%';$('retry-metric').innerHTML='0 <small>packets</small>';
  senderStatus('Photo ready to send','Original stays on this phone.');recipientStatus('Start with the preview','Then choose the detail you need.');$('network-subtitle').textContent='A small preview goes first. You choose what follows.';
  $('pause').innerHTML=icon('pause');$('pause').setAttribute('aria-label','Pause simulation');step(1);graph();
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
$('connection').addEventListener('click',()=>{network.online=!network.online;event(network.online?'Network reconnected · resuming received progress':'Network disconnected · arrival time unknown',network.online?'normal':'loss');graph();});
$('relay-toggle').addEventListener('click',()=>toggleRelay('B'));
$('loss').addEventListener('input',()=>{network.loss=Number($('loss').value)/100;$('loss-value').textContent=$('loss').value+'%';$('loss-metric').innerHTML=$('loss').value+'<small>%</small>';});
$('pause').addEventListener('click',()=>{network.paused=!network.paused;$('pause').innerHTML=icon(network.paused?'play':'pause');$('pause').setAttribute('aria-label',network.paused?'Resume simulation':'Pause simulation');if(!network.paused)$('map-state').hidden=true;});
$('speed').addEventListener('click',()=>{speed=speed===1?2:speed===2?4:1;$('speed').textContent=speed+'×';clearInterval(timer);timer=setInterval(tick,200/speed);});
messages=mountMessages({api,runFrames,event,urls:objectURLs,isBusy:()=>busy,setBusy,generation:()=>generation,guard,cancelAutoStart:()=>clearTimeout(autoStart),composeBusy:disabled=>{$('send-photo').disabled=disabled||!demo;$('request-section').disabled=disabled||!previewReady||$('crop-box').classList.contains('locked');}});
reset();
try{demo=await api('/api/demo');messages.ready(demo.voice_available);$('protocol-label').textContent=demo.transport;$('send-photo').disabled=false;autoStart=setTimeout(sendPhoto,700);}
catch(error){toast('Could not load the media demo: '+error.message);$('protocol-label').textContent='Media server unavailable';}

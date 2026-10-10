import {parseMessageManifest, Reassembler, makeAck, fromHex, validate, decodeMessageText, validateVoiceHeader} from './protocol.mjs';

const $=id=>document.getElementById(id);
const MAX_UPLOAD=8*1024*1024;
const owner=id=>id===1?'alex':'sam';

export function mountMessages(hooks){
  let available=false,recorder=null,stream=null,recordOwner=null,recordTimer=null,recordStarted=0,recordGeneration=0,recordCancelled=false,opening=false;
  const jobs=new Set();
  function controls(){
    const disabled=hooks.isBusy()||!!recorder||opening;
    hooks.composeBusy?.(disabled);
    for(const name of ['alex','sam']){
      $(name+'-send').disabled=disabled;
      $(name+'-upload').disabled=disabled||!available;
      $(name+'-sample').disabled=disabled||!available;
      $(name+'-record').disabled=hooks.isBusy()||opening||!available||!!recorder&&recordOwner!==name;
    }
    hooks.onControls?.();
  }
  function status(name,value){$(name+'-compose-status').textContent=value;}
  function bubble(name,outgoing,content){
    const el=document.createElement('div');el.className=`transport-message${outgoing?' outgoing':' receiving'}`;
    const body=document.createElement('div');body.textContent=content;
    const receipt=document.createElement('span');receipt.className='message-receipt';receipt.setAttribute('role','status');
    el.append(body,receipt);const chat=$(name+'-chat');chat.append(el);chat.scrollTop=chat.scrollHeight;
    return {el,body,receipt};
  }
  function scrollChat(name){const chat=$(name+'-chat');chat.scrollTop=chat.scrollHeight;}
  function receipt(job,value,verified=false){job.sent.receipt.textContent=value;job.sent.receipt.classList.toggle('verified',verified);scrollChat(owner(job.sender));}
  function audio(body,url,title){
    body.replaceChildren();const label=document.createElement('strong');label.textContent=title;
    const player=document.createElement('audio');player.controls=true;player.preload='metadata';player.src=url;player.setAttribute('aria-label',title);
    body.append(label,player);
  }
  function urlFor(bytes){const url=URL.createObjectURL(new Blob([bytes],{type:'audio/ogg; codecs=opus'}));hooks.urls.add(url);return url;}
  async function verifiedVoice(bytes,m){
    validateVoiceHeader(bytes);
    const Audio=window.AudioContext||window.webkitAudioContext;
    if(!Audio)throw Error('This browser cannot verify voice playback. Try a current browser.');
    const context=new Audio();
    try{
      const decoded=await context.decodeAudioData(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
      if(decoded.numberOfChannels!==1||Math.abs(decoded.duration*1000-m.duration)>150)throw Error('Voice duration or channels do not match the manifest');
    }finally{await context.close();}
  }
  async function deliver(job){
    if(hooks.isBusy()){status(owner(job.sender),'Wait for the current transfer to finish.');return;}
    const version=hooks.generation();hooks.setBusy(true);hooks.cancelAutoStart();controls();
    job.sent.el.querySelector('.retry-message')?.remove();
    let phase='prepare';
    try{
      if(!job.response){
        receipt(job,job.kind==='text'?'Preparing text…':'Compressing voice…');
        job.response=await hooks.api('/api/message',job.payload);hooks.guard(version);
        job.manifest=parseMessageManifest(job.response.manifest);
        if(job.manifest.sender!==job.sender||job.manifest.recipient!==3-job.sender)throw Error('Message endpoints do not match');
        if(job.kind!=='text'){
          const local=new Reassembler(job.manifest);for(const wire of job.response.packets)local.add(wire);
          audio(job.sent.body,urlFor(await local.verifiedBytes()),'Voice note');hooks.guard(version);
        }
      }
      const m=job.manifest,label=m.kind===0?'Text':'Voice',reverse=job.sender===2;
      if(!job.received){
        phase='data';const assembler=new Reassembler(m);let registered=false;
        if(!job.incoming)job.incoming=bubble(owner(m.recipient),false,`${label} arriving…`);
        receipt(job,`Queued · ${m.bytes.toLocaleString()} B · ${m.count} chunks`);
        job.incoming.receipt.textContent='Waiting for verified content';
        hooks.event(`${label} queued at ${reverse?'D':'A'} · ${m.bytes} B / ${m.count} chunks`);
        const frames=[{wire:job.response.manifest,manifest:true,radioBytes:job.response.manifest.length/2+34},
          ...job.response.packets.map((wire,i)=>({wire,radioBytes:job.response.radio_bytes[i]}))];
        await hooks.runFrames(frames,{label:`${label} message`,reverse,onState:state=>{
          if(state==='waiting')receipt(job,'Waiting for a route · arrival time unknown');
          else if(state==='paused')receipt(job,'Transfer paused');
          else if(state==='hopping')receipt(job,`In transit · ${assembler.chunks.size}/${m.count} chunks received`);
        },onFrame:async f=>{
          if(f.manifest){validate(fromHex(f.wire),7);registered=true;}else assembler.add(f.wire);
          const progress=`${assembler.chunks.size}/${m.count} chunks received`;
          receipt(job,`In transit · ${progress}`);job.incoming.receipt.textContent=progress+' · not yet verified';
        }});hooks.guard(version);
        if(!registered)throw Error('Message manifest is missing');
        const bytes=await assembler.verifiedBytes();hooks.guard(version);
        if(m.kind===0){const content=await decodeMessageText(bytes,m.codec);hooks.guard(version);job.incoming.body.textContent=content;}
        else{await verifiedVoice(bytes,m);hooks.guard(version);audio(job.incoming.body,urlFor(bytes),`Voice note · ${(m.duration/1000).toFixed(1)}s`);}
        hooks.onVerified?.(m);job.received=true;job.incoming.el.classList.remove('receiving');
        job.incoming.receipt.textContent=`Received & verified · ${m.bytes.toLocaleString()} B`;
        job.incoming.receipt.classList.add('verified');scrollChat(owner(m.recipient));hooks.event(`${label} fully verified at ${reverse?'A':'D'}`,'verified');
      }
      phase='ack';receipt(job,'Receiver verified · awaiting receipt acknowledgment');
      const ack=makeAck(m);
      await hooks.runFrames([{wire:ack}],{label:`Confirming ${label.toLowerCase()}`,reverse:!reverse,onState:state=>{
        if(state==='waiting')receipt(job,'Receiver verified · ACK waiting for a route');
        else if(state==='paused')receipt(job,'Receiver verified · ACK paused');
        else if(state==='hopping')receipt(job,'Receiver verified · ACK in transit');
      },onFrame:async f=>{validate(fromHex(f.wire),4);if(f.wire!==ack)throw Error('Unexpected message ACK');}});
      hooks.guard(version);
      const result=await hooks.api('/api/message/confirm',{ack});hooks.guard(version);
      if(!result.confirmed)throw Error('Sender could not confirm receipt');
      hooks.onConfirmed?.(m);
      receipt(job,`Receipt confirmed ✓✓ · ${m.bytes.toLocaleString()} B`,true);
      $('progress-label').textContent=`${label} receipt confirmed`;
      status(owner(job.sender),m.kind===0?(m.codec===1?'Text compressed without losing characters.':'Sent as compact UTF-8.'):`Mono Opus · 12 kb/s target · ${(m.duration/1000).toFixed(1)}s`);
      hooks.event(`${label} completion ACK reached sender · receipt confirmed`,'verified');
      job.payload=null;
    }catch(error){
      if(error.name==='AbortError')return;
      receipt(job,job.received?'Receiver verified · receipt not confirmed':`Not delivered · ${error.message}`);
      if(job.incoming&&!job.received)job.incoming.receipt.textContent='Incomplete or unverified · content withheld';
      const retry=document.createElement('button');retry.type='button';retry.className='retry-message';retry.textContent=job.received?'Retry acknowledgment':'Retry message';
      retry.addEventListener('click',()=>deliver(job));job.sent.el.append(retry);
      status(owner(job.sender),error.message);hooks.event(`${job.kind==='text'?'Text':'Voice'} ${phase} stopped · no false receipt`,'loss');
    }finally{if(version===hooks.generation()){hooks.setBusy(false);controls();}}
  }
  function send(sender,kind,payload){
    if(hooks.isBusy()||recorder||opening){status(owner(sender),'Wait for the current transfer or recording to finish.');return false;}
    const job={sender,kind,payload:{sender,kind,...payload},sent:bubble(owner(sender),true,kind==='text'?payload.text:'Preparing voice note…')};jobs.add(job);deliver(job);return true;
  }
  async function blobPayload(blob){
    if(!blob.size||blob.size>MAX_UPLOAD)throw Error('Choose an audio file up to 8 MiB and 60 seconds.');
    const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';
    for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
    return {audio:btoa(binary)};
  }
  function stopTracks(){stream?.getTracks().forEach(t=>t.stop());stream=null;}
  function stopRecording(cancel=false){
    recordCancelled=cancel;clearInterval(recordTimer);recordTimer=null;
    if(recorder?.state==='recording')recorder.stop();stopTracks();
  }
  async function record(name){
    if(recorder){stopRecording();return;}
    if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){status(name,'Microphone recording is unavailable. Import audio or try the sample.');return;}
    const version=hooks.generation();opening=true;hooks.cancelAutoStart();controls();
    try{
      const acquired=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true}});
      if(version!==hooks.generation()||hooks.isBusy()){acquired.getTracks().forEach(t=>t.stop());return;}
      stream=acquired;
      const mime=['audio/webm;codecs=opus','audio/ogg;codecs=opus','audio/mp4'].find(t=>MediaRecorder.isTypeSupported(t));
      recorder=new MediaRecorder(stream,{...(mime?{mimeType:mime}:{}),audioBitsPerSecond:12000});
      recordOwner=name;recordGeneration=version;recordCancelled=false;recordStarted=Date.now();
      const active=recorder,chunks=[];
      active.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
      active.onstop=async()=>{
        clearInterval(recordTimer);stopTracks();const cancelled=recordCancelled||recordGeneration!==hooks.generation();
        recorder=null;recordOwner=null;hooks.onRecording?.(name,false);$(name+'-record').classList.remove('recording');$(name+'-record').querySelector('span').textContent='Record';controls();
        if(cancelled){status(name,'Recording cancelled.');return;}
        try{const data=await blobPayload(new Blob(chunks,{type:active.mimeType}));hooks.guard(version);send(name==='alex'?1:2,'voice',data);}
        catch(error){if(error.name!=='AbortError')status(name,error.message);}
      };
      active.onerror=()=>{status(name,'Recording failed. Import audio or try the sample.');stopRecording(true);};
      recorder.start(250);hooks.onRecording?.(name,true,stream);$(name+'-record').classList.add('recording');$(name+'-record').querySelector('span').textContent='Stop & send';
      recordTimer=setInterval(()=>{const elapsed=(Date.now()-recordStarted)/1000;status(name,`Recording ${elapsed.toFixed(0)}s / 60s · Stop & send when ready`);if(elapsed>=59)stopRecording();},250);
    }catch(error){stopTracks();status(name,error.name==='NotAllowedError'?'Microphone permission denied. Import audio or try the sample.':'Could not start the microphone. Import audio or try the sample.');}
    finally{opening=false;controls();}
  }
  for(const name of ['alex','sam']){
    const sender=name==='alex'?1:2;
    $(name+'-composer').addEventListener('submit',e=>{e.preventDefault();const text=$(name+'-text').value;if(!text.trim())return;
      if(new TextEncoder().encode(text).length>16384){status(name,'Text must fit within 16 KiB of UTF-8.');return;}
      if(send(sender,'text',{text})){$(name+'-text').value='';hooks.onControls?.();}
    });
    $(name+'-sample').addEventListener('click',()=>send(sender,'voice_sample',{}));
    $(name+'-upload').addEventListener('click',()=>$(name+'-audio-file').click());
    $(name+'-audio-file').addEventListener('change',async e=>{const file=e.target.files[0],version=hooks.generation();e.target.value='';if(!file)return;
      try{const data=await blobPayload(file);hooks.guard(version);send(sender,'voice',data);}catch(error){if(error.name!=='AbortError')status(name,error.message);}
    });
    $(name+'-record').addEventListener('click',()=>record(name));
  }
  window.addEventListener('pagehide',()=>stopRecording(true));
  controls();
  return {
    controls,
    cancelRecording(){stopRecording(true);},
    ready(value){available=value;controls();for(const name of ['alex','sam'])status(name,value?'Type a message, record, or try a voice note.':'Text ready. Voice requires FFmpeg on the server.');},
    reset(){stopRecording(true);for(const job of jobs){job.sent.el.remove();job.incoming?.el.remove();}jobs.clear();for(const name of ['alex','sam']){status(name,'');$(name+'-text').value='';}controls();}
  };
}

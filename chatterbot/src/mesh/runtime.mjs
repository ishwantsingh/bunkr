// Connect the reference UI to the existing binary protocol and mesh engine.
import {RADIO_PRESETS,Network} from '../../../bunkr/ui/network.mjs';
import {getConnections} from '../../../bunkr/ui/mesh/simulator.mjs';
import {parseManifest,parseMessageManifest,Reassembler,makeAck,makeRequest,decodeMessageText,validateVoiceHeader} from '../../../bunkr/ui/protocol.mjs';
export const IDS={A:'!a3f2',B:'!19b4',C:'!e05d',D:'!7c1e',E:'!4a8c'};
const LETTERS={A:'A',B:'B',C:'C',D:'E',E:'D'};
export const engineId=id=>Object.keys(IDS).find(key=>IDS[key]===id);
export const framesFor=rep=>[{wire:rep.manifest,manifest:true},...rep.packets.map(wire=>({wire}))];
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export class MediaRuntime {
  constructor(hooks={},dependencies={}){
    this.hooks=hooks;this.fetch=dependencies.fetch||((...args)=>globalThis.fetch(...args));this.wait=dependencies.wait||delay;
    this.decodeImage=dependencies.decodeImage||decodeImage;this.decodeVoice=dependencies.decodeVoice||decodeVoice;
    this.urls=new Set();this.version=0;this.queue=Promise.resolve();this.reset();
  }
  reset(settings={}){
    this.version++;this.network?.cancel();this.queue=Promise.resolve();
    for(const url of this.urls)URL.revokeObjectURL(url);this.urls.clear();
    this.network=new Network({preset:settings.preset||'Short Turbo',loss:(settings.lossPct??20)/100,seed:settings.seed||16,nodes:settings.nodes?.map(n=>({id:engineId(n.id),x:n.x*5,y:n.y*4.35,range:n.range*5,online:n.online}))});
    this.publish();
  }
  guard(version){if(version!==this.version){const error=Error('Simulation reset');error.name='AbortError';throw error;}}
  async api(path,payload,raw=false){
    const response=await this.fetch(path,payload===undefined?{}:{method:'POST',headers:{'Content-Type':raw?'application/octet-stream':'application/json'},body:raw?payload:JSON.stringify(payload)});
    const data=await response.json();if(!response.ok)throw Error(data.error||'Media operation failed');return data;
  }
  publish(){this.hooks.onNetwork?.({links:getConnections(this.network.simulator.nodes).map(([a,b])=>[IDS[a],IDS[b]]),stats:{bytesOnAir:this.network.bytes,airtimeMs:this.network.airtime*1000,lostHops:this.network.lost},inFlight:this.network.simulator.activeTx?1:0,timeMs:this.network.time*1000});}
  settings(settings){
    if(settings.preset)this.network.setPreset(settings.preset);
    if(settings.lossPct!==undefined)this.network.loss=settings.lossPct/100;
    for(const node of settings.nodes||[])this.network.setNode(engineId(node.id),{x:node.x*5,y:node.y*4.35,range:node.range*5,online:node.online});
    this.publish();
  }
  enqueue(task,onError){
    const version=this.version;
    this.queue=this.queue.then(async()=>{this.guard(version);await task(version);}).catch(error=>{if(error.name!=='AbortError'&&version===this.version)onError(error);});
    return this.queue;
  }
  route(reverse=false){return (this.network.getRoute(reverse)||[]).map(id=>IDS[id]);}
  async run(frames,{version,reverse=false,phase='forward',onFrame=async()=>{},onTransit=()=>{}}){
    this.guard(version);this.network.enqueue(frames,reverse);let received=0;
    while(received<frames.length){
      await this.wait(200);this.guard(version);
      const result=await this.network.advance({seconds:8});this.guard(version);
      for(const e of result.events){
        const kind={tx_started:'air',hop_lost:'lost',hop_received:'hop',packet_received:'arrived',retry_queued:'sent',failed:'failed'}[e.type];
        if(kind)this.hooks.onEvent?.({kind,title:{air:'On air',lost:'Hop lost',hop:'Hop received',arrived:'Packet arrived',sent:'Retry queued',failed:'Transfer failed'}[kind],detail:`${e.packetType||'packet'}${e.from?' · '+LETTERS[e.from]+' → '+(LETTERS[e.to||e.at]||''):''}`,from:IDS[e.from],to:IDS[e.to],durationMs:e.airtime?Math.max(200,e.airtime*1000/40):undefined});
      }
      const tx=this.network.simulator.activeTx;
      const path=this.route(reverse),hop=tx?Math.max(0,path.indexOf(IDS[tx.from])):0;
      onTransit({phase,route:path,hop,hops:Math.max(1,path.length-1),attempt:tx?.task.losses+1||1,attemptMs:tx?Math.max(200,(tx.finish-this.network.time)*1000/40):200,lost:result.dropped.length>0,etaMs:path.length&&this.network.loss<1?(frames.length-received)*(254*8/RADIO_PRESETS[this.network.preset]+120)*Math.max(1,path.length-1)/(1-this.network.loss):null,waiting:result.state==='waiting',packet:received,packets:frames.length});
      for(const frame of result.received){await onFrame(frame);this.guard(version);received++;}
      this.publish();
      if(result.failed.length)throw Error('Mesh recovery limit reached. Adjust the route or loss and try again.');
    }
  }
  async receive(rep,options,onChunk=()=>{}){
    const manifest=rep.manifest.slice(2,4)==='07'?parseMessageManifest(rep.manifest):parseManifest(rep.manifest),assembler=new Reassembler(manifest);
    let registered=false;
    await this.run(framesFor(rep),{...options,onFrame:async frame=>{if(frame.manifest)registered=true;else assembler.add(frame.wire);onChunk(assembler.chunks.size,manifest.count);}});
    if(!registered)throw Error('Missing media manifest');
    const bytes=await assembler.verifiedBytes();this.guard(options.version);
    return {manifest,bytes};
  }
  async imageURL(bytes,m,version){
    const url=await this.decodeImage(bytes,m);
    if(version!==this.version){URL.revokeObjectURL(url);this.guard(version);}
    this.urls.add(url);return url;
  }
  async acknowledge(manifests,options,message=false){
    const acks=manifests.map(makeAck);
    await this.run(acks.map(wire=>({wire})),{...options,reverse:!options.reverse,phase:'ack'});
    const result=await this.api(message?'/api/message/confirm':'/api/confirm',message?{ack:acks[0]}:{acks});this.guard(options.version);
    if(!result.confirmed)throw Error('Receipt not confirmed');
    for(const m of manifests)this.network.markConfirmed(m.id);
    this.hooks.onEvent?.({kind:'delivered',title:'Receipt confirmed',detail:'Verified acknowledgment returned to the sender'});
  }
  async sendTextOrVoice({sender,text,voice},callbacks,version){
    const reverse=sender===2,start=this.network.time,retries=this.network.retries;
    let payload={sender,kind:'text',text};
    if(voice){
      if(!voice.audioUrl)throw Error('No recorded audio is available');
      this.urls.add(voice.audioUrl);
      const blob=await (await this.fetch(voice.audioUrl)).blob();
      if(blob.size>8*1024*1024)throw Error('Voice notes must fit within 8 MiB');
      const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
      payload={sender,kind:'voice',audio:btoa(binary)};
    }
    const rep=await this.api('/api/message',payload);this.guard(version);
    const m=parseMessageManifest(rep.manifest),options={version,reverse,onTransit:callbacks.onTransit};
    callbacks.onPrepared?.(m);
    const result=await this.receive(rep,options,callbacks.onChunk);
    let content;
    if(m.kind===0)content={text:await decodeMessageText(result.bytes,m.codec)};
    else{validateVoiceHeader(result.bytes);const audio=await this.decodeVoice(result.bytes,m);if(version!==this.version){URL.revokeObjectURL(audio.audioUrl);this.guard(version);}this.urls.add(audio.audioUrl);content={voice:{...voice,...audio,bytes:m.bytes,durationMs:m.duration}};}
    this.guard(version);this.network.markVerified(m.id);
    callbacks.onArrive(content,this.stats(m,start,retries,reverse));
    await this.acknowledge([m],options,true);callbacks.onDelivered();
  }
  stats(m,start,retries,reverse){return {route:this.network.lastPath?.map(id=>IDS[id])||this.route(reverse),packets:m.count,bytes:m.bytes,transitMs:(this.network.time-start)*1000,resends:this.network.retries-retries};}
  async sendImage(image,reverse,callbacks,version){
    const start=this.network.time,retries=this.network.retries;
    const rep=image.envelope.preview;
    const {manifest:m,bytes}=await this.receive(rep,{version,reverse,onTransit:callbacks.onTransit},callbacks.onChunk);
    const url=await this.imageURL(bytes,m,version);this.guard(version);this.network.markVerified(m.id,url);
    callbacks.onArrive({previewSrc:url},this.stats(m,start,retries,reverse));
    await this.acknowledge([m],{version,reverse,onTransit:callbacks.onTransit});callbacks.onDelivered();
  }
  async pull(image,region,reverse,callbacks,version){
    const bounds=[region.x,region.y,region.x+region.w,region.y+region.h],requestId=crypto.randomUUID().replaceAll('-','');
    await this.run([{wire:makeRequest(image.imageId,requestId,bounds)}],{version,reverse:!reverse,phase:'request',onTransit:callbacks.onTransit});
    const response=await this.api('/api/crop',{image_id:image.imageId,bounds,request_id:requestId});this.guard(version);
    // Each independently verified piece is shown immediately, before the region completes.
    const reps=response.tiles.map(rep=>({rep,manifest:parseManifest(rep.manifest),assembler:new Reassembler(parseManifest(rep.manifest)),registered:false,revealed:false}));
    let received=0;const total=reps.reduce((sum,r)=>sum+r.manifest.count+1,0);
    callbacks.onSize?.(reps.reduce((sum,r)=>sum+r.manifest.bytes,0));
    await this.run(reps.flatMap((r,index)=>framesFor(r.rep).map(f=>({...f,index}))),{version,reverse,phase:'data',onTransit:callbacks.onTransit,onFrame:async f=>{
      const r=reps[f.index];if(f.manifest)r.registered=true;else r.assembler.add(f.wire);
      callbacks.onProgress?.(++received,total);
      if(r.registered&&!r.revealed&&r.assembler.chunks.size===r.manifest.count){
        const url=await this.imageURL(await r.assembler.verifiedBytes(),r.manifest,version);this.guard(version);r.revealed=true;this.network.markVerified(r.manifest.id,url);
        const m=r.manifest,[l,t,right,bottom]=m.bounds;
        const x=Math.floor(l*m.sourceWidth)/m.sourceWidth,y=Math.floor(t*m.sourceHeight)/m.sourceHeight;
        callbacks.onTile({id:m.id,x,y,w:Math.ceil(right*m.sourceWidth)/m.sourceWidth-x,h:Math.ceil(bottom*m.sourceHeight)/m.sourceHeight-y,src:url});
      }
    }});
    callbacks.onVerified();
    await this.acknowledge(reps.map(r=>r.manifest),{version,reverse,onTransit:callbacks.onTransit});callbacks.onDelivered?.();
  }
}
async function decodeImage(bytes,m){
  const blob=new Blob([bytes],{type:m.codec===1?'image/webp':'image/jpeg'}),bitmap=await createImageBitmap(blob);
  try{if(bitmap.width!==m.width||bitmap.height!==m.height)throw Error('Image dimensions do not match manifest');}finally{bitmap.close();}
  return URL.createObjectURL(blob);
}
async function decodeVoice(bytes,m){
  const context=new AudioContext();
  try{const audio=await context.decodeAudioData(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));if(audio.numberOfChannels!==1||Math.abs(audio.duration*1000-m.duration)>150)throw Error('Voice metadata does not match received audio');}
  finally{await context.close();}
  return {audioUrl:URL.createObjectURL(new Blob([bytes],{type:'audio/ogg; codecs=opus'}))};
}

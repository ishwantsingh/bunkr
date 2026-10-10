// Adapter to the mesh-simulation branch's shared engine. Actual v2 application
// bytes travel hop by hop; UI animation never decides packet delivery.
import {MeshSimulator,DEFAULT_NODES,findRoute,getConnections,RADIO_PRESETS} from './mesh/simulator.mjs';
import {fromHex,toHex,validate,parseManifest,parseMessageManifest,makeMissing} from './protocol.mjs';
export {RADIO_PRESETS};
export const mapPosition=node=>[node.x*.75+10,node.y*.8+35];
export const NODES=Object.fromEntries(DEFAULT_NODES.map(n=>[n.id,mapPosition(n)]));
export const LINKS=getConnections(DEFAULT_NODES);
export function route(enabled,reverse=false){return findRoute(DEFAULT_NODES.map(n=>({...n,online:enabled.has(n.id)})),reverse?'D':'A',reverse?'A':'D');}
export const radioBytes=wire=>wire.length/2+(wire.length/2>127?34:33);
const typeFor=tag=>({1:'manifest',2:'crop_request',3:'data',4:'receipt',5:'receipt',6:'missing_request',7:'manifest'}[tag]);

export class Network {
  constructor({loss=.2,seed=2407,retries=5,missingRounds=3,preset='Long Fast',nodes=DEFAULT_NODES}={}){
    this.enabled=new Set(nodes.filter(n=>n.online).map(n=>n.id));this.online=true;this.paused=false;
    this.maxRounds=missingRounds;this.sequence=0;this.clock=0;this.frames=new Map();this.round=0;this.deadline=null;
    this.result=null;this.events=[];this.lastPath=null;this.representations=new Map();this.activeRepresentations=[];
    this.simulator=new MeshSimulator({nodes,preset,loss,seed,maxAttempts:retries,onEvent:e=>this.observe(e)});
  }
  get loss(){return this.simulator.loss;}set loss(value){this.simulator.setLoss(value);}
  get sent(){return this.simulator.metrics.hopTransmissions;}get lost(){return this.simulator.metrics.lostHops;}
  get bytes(){return this.simulator.metrics.transmittedBytes;}get retries(){return this.simulator.metrics.retries;}
  get time(){return this.simulator.time;}get airtime(){return this.simulator.metrics.airtimeSeconds;}
  get pending(){return [...this.frames.values()].filter(f=>!f.delivered).length;}
  get positions(){return Object.fromEntries(this.simulator.nodes.map(n=>[n.id,mapPosition(n)]));}
  get links(){this.syncNodes();return getConnections(this.simulator.nodes);}
  get preset(){return this.simulator.preset;}
  setPreset(value){this.simulator.setPreset(value);}
  setNode(id,changes){this.simulator.setNode(id,changes);if(changes.online===true)this.enabled.add(id);if(changes.online===false)this.enabled.delete(id);}
  syncNodes(){for(const n of this.simulator.nodes)if(n.online!==this.enabled.has(n.id))this.simulator.setNode(n.id,{online:this.enabled.has(n.id)});}
  getRoute(reverse=false){this.syncNodes();return this.online?findRoute(this.simulator.nodes,reverse?'D':'A',reverse?'A':'D'):null;}
  enqueue(frames,reverse=false){
    if(this.pending)throw Error('A mesh transfer is already active');
    this.frames.clear();this.round=0;this.deadline=null;this.clock=this.time;this.packets=new Map();
    const priorities=new Map(),representations=[];
    for(const f of frames){const b=fromHex(f.wire);validate(b,b[1]);if(!typeFor(b[1]))throw Error('Unknown application frame type');
      if([1,7].includes(b[1])){
        const m=b[1]===1?parseManifest(f.wire):parseMessageManifest(f.wire);
        const kind=b[1]===1?(['preview','crop','background'][m.kind]||'image'):(m.kind===0?'text':'voice');
        priorities.set(m.id,kind==='preview'?'preview':kind==='background'?'background':'crop');
        this.representations.set(m.id,{id:m.id,kind,total:m.count,received:new Set(),manifestReceived:false,verified:false,senderConfirmed:false,receiptArrived:false,failed:false,source:reverse?'D':'A',destination:reverse?'A':'D',manifest:m});
        representations.push(m.id);
      }
      if(b[1]===7){const m=parseMessageManifest(f.wire);priorities.set(m.id,'crop');}
    }
    if(representations.length)this.activeRepresentations=representations;
    for(const f of frames){
      const bytes=fromHex(f.wire),tag=bytes[1],view=new DataView(bytes.buffer);
      const representationId=toHex(bytes.slice(tag===1||tag===3?18:2,tag===1||tag===3?34:18));
      const id=`wire-${++this.sequence}`;
      const entry={id,frame:f,bytes,tag,representationId,index:tag===3?view.getUint32(34):null,delivered:false,
        priority:tag===3?(priorities.get(representationId)||'crop'):'control',source:reverse?'D':'A',destination:reverse?'A':'D'};
      this.frames.set(id,entry);this.enqueueEntry(entry);
    }
  }
  enqueueEntry(entry){
    this.simulator.enqueue({id:`${entry.id}-r${this.round}`,external:true,type:typeFor(entry.tag),source:entry.source,destination:entry.destination,
      representationId:entry.representationId,priority:entry.priority,chunkIndex:entry.index??0,
      bytes:entry.bytes,payload:entry.bytes,wireBytes:radioBytes(entry.frame.wire),entryId:entry.id});
  }
  observe(e){
    this.events.push(e);if(this.events.length>1500)this.events.shift();
    if(!this.result)return;
    this.result.events.push(e);
    if(e.type==='tx_started')this.result.hops.push(e);
    if(e.type==='hop_lost')this.result.dropped.push({wire:e.packetId,from:e.from,to:e.to});
    if(e.type==='packet_received'){
      // Packet IDs map back to the unmodified submitted application frame.
      const packet=this.packetById(e.packetId);
      if(!packet)return;
      if(packet.missingEntries){for(const id of packet.missingEntries){const entry=this.frames.get(id);if(entry&&!entry.delivered)this.enqueueEntry(entry);}return;}
      const entry=this.frames.get(packet.entryId);
      if(entry&&!entry.delivered){
        entry.delivered=true;this.lastPath=e.path;
        const rep=this.representations.get(entry.representationId);
        if(rep){
          if([1,7].includes(entry.tag))rep.manifestReceived=true;
          if(entry.tag===3)rep.received.add(entry.index);
          if(entry.tag===4&&toHex(entry.bytes.slice(22,54))===rep.manifest.hash&&new DataView(entry.bytes.buffer).getUint32(18)===rep.manifest.recipient)rep.receiptArrived=true;
        }
        this.result.received.push(entry.frame);
      }
    }
  }
  packetById(id){return this.packets?.get(id);}
  // Keep source packets for the lifetime of a transfer, including control retries.
  rememberPackets(){
    this.packets??=new Map();
    for(const task of this.simulator.queue)this.packets.set(task.packet.id,task.packet);
    for(const item of this.simulator.scheduled)if(item.detail.task)this.packets.set(item.detail.task.packet.id,item.detail.task.packet);
  }
  recover(){
    const missing=[...this.frames.values()].filter(f=>!f.delivered);
    if(this.round>=this.maxRounds){for(const f of missing){const rep=this.representations.get(f.representationId);if(rep)rep.failed=true;}this.result.failed.push(...missing.map(f=>f.frame));this.result.state='failed';return;}
    this.round++;this.deadline=null;
    this.result.events.push({type:'recovery_timeout',time:this.time,round:this.round});
    const groups=new Map();
    for(const f of missing){
      const manifest=[...this.frames.values()].find(m=>m.tag!==3&&[1,7].includes(m.tag)&&m.representationId===f.representationId);
      if(f.tag===3&&manifest?.delivered){const key=f.representationId;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(f);}
      else this.enqueueEntry(f); // sender/control timeout; no fabricated hop ACK
    }
    for(const [id,entries] of groups)for(let offset=0;offset<entries.length;offset+=49){
      const part=entries.slice(offset,offset+49),wire=makeMissing(id,part.map(f=>f.index)),bytes=fromHex(wire);
      this.simulator.enqueue({id:`missing-${++this.sequence}-r${this.round}`,external:true,type:'missing_request',
        source:part[0].destination,destination:part[0].source,representationId:id,priority:'control',
        bytes,payload:bytes,wireBytes:radioBytes(wire),missingEntries:part.map(f=>f.id)});
    }
  }
  markVerified(id,url=null){
    const rep=this.representations.get(id);
    if(!rep||!rep.manifestReceived||rep.received.size!==rep.total)throw Error('Cannot verify incomplete mesh delivery');
    rep.verified=true;rep.url=url;rep.failed=false;
    this.simulator.emit('representation_verified',{representationId:id,kind:rep.kind,at:rep.destination});
  }
  markConfirmed(id){
    const rep=this.representations.get(id);
    if(!rep?.verified||!rep.receiptArrived)throw Error('Cannot confirm before verified return receipt');
    rep.senderConfirmed=true;rep.failed=false;
    this.simulator.emit('receipt_confirmed',{representationId:id,at:rep.source});
  }
  cancel(){this.frames.clear();this.simulator.queue=[];this.simulator.scheduled=[];this.simulator.activeTx=null;this.deadline=null;this.packets?.clear();}
  async advance({seconds=8,singleEvent=false}={}){
    const result={state:'idle',received:[],dropped:[],failed:[],hops:[],events:[]};this.result=result;
    if(!this.pending)return result;
    if(this.paused&&!singleEvent){result.state='paused';return result;}
    if(!this.online){result.state='waiting';return result;}
    this.syncNodes();this.clock=singleEvent?this.time:this.clock+seconds;
    const horizon=singleEvent?Infinity:this.clock;result.state='transmitting';
    for(let steps=0;steps<(singleEvent?1:1000)&&this.pending;steps++){
      this.rememberPackets();
      const sim=this.simulator;
      if(sim.activeTx){if(sim.activeTx.finish>horizon)break;}
      else{
        const routable=sim.queue.some(t=>findRoute(sim.nodes,t.current,t.packet.destination));
        if(!routable){
          if(sim.scheduled.length){if(sim.scheduled[0].at>horizon)break;}
          else{
            if(!this.getRoute()){result.state='waiting';break;}
            this.deadline??=sim.time+15;
            if(horizon<this.deadline){result.state='recovering';break;}
            // A relay can disappear after receiving a packet. If the endpoints
            // still have an alternate route, recover on timeout instead of
            // waiting forever on that relay's stranded queue.
            sim.time=this.deadline;sim.queue=[];this.recover();if(result.failed.length)break;continue;
          }
        }
      }
      const event=await sim.step();
      if(!event&&!sim.activeTx&&!sim.queue.length&&!sim.scheduled.length)continue;
    }
    if(singleEvent)this.clock=this.time;
    if(result.hops.length){const last=result.hops.at(-1);result.from=last.from;result.to=last.to;result.path=last.route;}
    if(result.hops.length&&result.state==='transmitting')result.state='hopping';
    return result;
  }
}

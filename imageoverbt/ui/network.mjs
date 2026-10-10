// Deliberately accelerated visual model, not Meshtastic firmware emulation.
export const NODES = {A:[62,208], B:[198,104], C:[388,126], D:[535,222], E:[298,307]};
export const LINKS = [['A','B'],['B','C'],['C','D'],['A','E'],['B','E'],['E','D'],['C','E']];
export function route(enabled, reverse=false) {
  const preferred=reverse?['D','C','B','A']:['A','B','C','D'];
  if(preferred.every(n=>enabled.has(n))) return preferred;
  const start=reverse?'D':'A',goal=reverse?'A':'D',queue=[[start]],seen=new Set([start]);
  while(queue.length) {
    const path=queue.shift(), node=path.at(-1);
    if(node===goal) return path;
    for(const edge of LINKS) {
      const next=edge[0]===node?edge[1]:edge[1]===node?edge[0]:null;
      if(next && enabled.has(next) && !seen.has(next)) {seen.add(next); queue.push([...path,next]);}
    }
  }
  return null;
}
export function random(seed=41) {
  return ()=> {seed=(Math.imul(seed,1664525)+1013904223)>>>0; return seed/4294967296;};
}
export class Network {
  constructor({loss=.2, seed=41, batch=20, retries=32}={}) {
    this.enabled=new Set(Object.keys(NODES)); this.online=true; this.paused=false;
    this.loss=loss; this.rng=random(seed); this.batch=batch; this.maxRetries=retries;
    this.queue=[]; this.active=null; this.sent=0; this.lost=0; this.bytes=0; this.delivered=0;
  }
  enqueue(frames, reverse=false) { this.queue.push(...frames.map(f=>({...f,reverse,attempts:0}))); }
  get pending() { return this.queue.length+(this.active?.frames.length||0); }
  advance() {
    if(!this.pending) return {state:'idle',received:[]};
    if(this.paused) return {state:'paused',received:[]};
    const direction=this.active?.reverse??this.queue[0]?.reverse??false;
    const path=this.online?route(this.enabled,direction):null;
    if(!path) return {state:'waiting',received:[]};
    if(this.active && this.active.path.some(n=>!this.enabled.has(n))) {
      this.queue.unshift(...this.active.frames); this.active=null;
    }
    if(!this.active) {
      const reverse=this.queue[0].reverse,frames=[];
      while(frames.length<this.batch && this.queue.length && this.queue[0].reverse===reverse) frames.push(this.queue.shift());
      this.active={frames,reverse,path:route(this.enabled,reverse),hop:0};
    }
    const active=this.active, from=active.path[active.hop],to=active.path[active.hop+1];
    const survivors=[],failed=[],dropped=[],retry=[];
    for(const f of active.frames) {
      this.sent++; this.bytes+=f.radioBytes??f.wire.length/2;
      if(this.rng()<this.loss) {
        this.lost++; f.attempts++; dropped.push(f);
        if(f.attempts>=this.maxRetries) failed.push(f); else retry.push(f);
      } else survivors.push(f);
    }
    this.queue.unshift(...retry);
    active.frames=survivors; active.hop++;
    const received=active.hop===active.path.length-1?survivors:[];
    this.delivered+=received.length;
    if(received.length || !survivors.length) this.active=null;
    return {state:'hopping',from,to,received,dropped,failed,path:active.path};
  }
}

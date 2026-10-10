// Map, controls and inspector adapted from mesh-ui/app.mjs on mesh-simulation.
// This panel observes native phone transfers; it never creates fixture traffic.
import {RADIO_PRESETS,findRoute} from './simulator.mjs';
export function nodeChange(key,raw){
  const value=Number(raw),limits={x:[35,765],y:[50,385],range:[30,500]}[key];
  return limits&&Number.isFinite(value)?{[key]:Math.round(Math.max(limits[0],Math.min(limits[1],value)))}:null;
}
export function mediaProgress(network){
  const reps=network.activeRepresentations.map(id=>network.representations.get(id)).filter(Boolean);
  return {reps,kind:reps[0]?.kind||'media',total:reps.reduce((s,r)=>s+r.total,0),received:reps.reduce((s,r)=>s+r.received.size,0),verified:reps.length>0&&reps.every(r=>r.verified),confirmed:reps.length>0&&reps.every(r=>r.senderConfirmed),failed:reps.some(r=>r.failed)};
}
export function remainingEstimate(network){
  const group=mediaProgress(network);
  if(network.paused)return 'Paused';
  if(!network.online||!network.getRoute()||network.loss>=1)return 'Unknown';
  if(!network.pending)return group.confirmed?'Complete':group.total?'Awaiting receipt':'—';
  const sim=network.simulator,tasks=[...sim.queue,...sim.scheduled.filter(i=>i.detail.task).map(i=>i.detail.task),...(sim.activeTx?[sim.activeTx.task]:[])];
  let seconds=0;const tracked=new Set();
  for(const task of tasks){const path=findRoute(sim.nodes,task.current,task.packet.destination);if(!path)return 'Unknown';
    seconds+=(path.length-1)*(task.packet.wireBytes*8/(RADIO_PRESETS[network.preset]*1000)+.12);if(task.packet.entryId)tracked.add(task.packet.entryId);
  }
  for(const f of network.frames.values())if(!f.delivered&&!tracked.has(f.id)){
    const path=findRoute(sim.nodes,f.source,f.destination);if(!path)return 'Unknown';
    seconds+=(path.length-1)*((f.bytes.length+34)*8/(RADIO_PRESETS[network.preset]*1000)+.12)+15;
  }
  const expected=seconds/Math.max(.01,1-network.loss);
  return [expected*.75,expected*1.5];
}
export function mountMeshPanel(hooks){
const $ = (id) => document.getElementById(id);
const svg = $("networkMap");
const svgNS = "http://www.w3.org/2000/svg";
let sim;
let selectedNode = "A";
let draggingNode = null;
let lastPacket = null;
let lastLoss = null;
let eventIndex=0,appEvents=[];
const root=document.querySelector(".mesh-panel");

function formatTime(seconds) {
  const rounded = Math.max(0, Math.round(seconds));
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}

function formatBytes(bytes) {
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;
}

function eventDescription(event) {
  const shortId = event.packetType === "data" ? `Chunk ${event.chunkIndex+1}` : event.packetType?.replaceAll("_", " ") ?? "Packet";
  switch (event.type) {
    case "queued": return ["Queued", `${event.packetType?.replaceAll("_", " ")} at ${event.from}`];
    case "tx_started": return ["On air", `${shortId}: ${event.from} → ${event.to}`];
    case "hop_received": return ["Hop received", `${shortId} reached ${event.to}`];
    case "hop_lost": return ["Hop lost", `${shortId}: ${event.from} → ${event.to}`];
    case "packet_received": return ["Packet arrived", `${shortId} reached ${event.at}`];
    case "retry_queued": return ["Retry queued", `${event.packetId}, attempt ${event.attempt}`];
    case "missing_requested": return ["Missing requested", `${event.missing.length} chunks requested by D`];
    case "request_received": return ["Crop request arrived", "A can now send the detailed crop"];
    case "representation_verified": return ["Image verified", `${event.kind} completed at D`];
    case "receipt_confirmed": return ["Receipt confirmed", "A received D’s confirmation"];
    case "route_changed": return ["Route changed", event.route?.join(" → ") ?? "No route available"];
    case "waiting_for_route": return ["Waiting for route", "Packets keep their progress until a route returns"];
    case "status_requested": return ["Status query", "A asks D for a receipt"];
    case "crop_selected": return ["Detail selected", "D requests a clearer trail sign"];
    case "failed": return ["Failed", event.reason];
    case "application": return [event.level === "verified" ? "Verified" : "Application",event.text];
    case "recovery_timeout": return ["Recovery timeout", `Missing/control retry round ${event.round}`];
    default: return [event.type.replaceAll("_", " "), ""];
  }
}

function timelineEvents() {
  const visible = new Set(["tx_started", "hop_received", "hop_lost", "packet_received", "retry_queued", "missing_requested", "request_received", "representation_verified", "receipt_confirmed", "route_changed", "waiting_for_route", "status_requested", "crop_selected", "failed", "application", "recovery_timeout"]);
  return [...sim.events,...appEvents].filter((event) => visible.has(event.type)).sort((a,b)=>a.time-b.time).slice(-10);
}

function renderTimeline() {
  const list = $("timeline");
  list.replaceChildren();
  for (const event of timelineEvents()) {
    const [title, detail] = eventDescription(event);
    const item = document.createElement("li");
    if (["hop_lost", "failed", "waiting_for_route"].includes(event.type)) item.classList.add("is-alert");
    if (["representation_verified", "receipt_confirmed"].includes(event.type) || event.level === "verified") item.classList.add("is-success");
    const time = document.createElement("time");
    time.textContent = `T+${formatTime(event.time)}`;
    const heading = document.createElement("strong");
    heading.textContent = title;
    const copy = document.createElement("p");
    copy.textContent = detail;
    item.append(time, heading, copy);
    list.append(item);
  }
}

function renderNodes(state) {
  const links = $("reachLinks");
  links.replaceChildren();
  for (const [from, to] of state.connections) {
    const a = state.nodes.find((node) => node.id === from);
    const b = state.nodes.find((node) => node.id === to);
    const path = document.createElementNS(svgNS, "path");
    path.setAttribute("d", `M${a.x} ${a.y} ${b.x} ${b.y}`);
    links.append(path);
  }
  for (const node of state.nodes) {
    const group = svg.querySelector(`[data-node-id="${node.id}"]`);
    group.setAttribute("transform", `translate(${node.x} ${node.y})`);
    group.classList.toggle("is-offline", !node.online);
    group.classList.toggle("is-selected", node.id === selectedNode);
    group.setAttribute("role","button");group.setAttribute("tabindex","0");
    group.setAttribute("aria-label",`Move node ${node.id}, ${node.online?'online':'offline'}. Arrow keys move; select to edit range.`);
    group.setAttribute("aria-pressed",String(node.id===selectedNode));
    const label = svg.querySelector(`[data-label-id="${node.id}"]`);
    if (label) label.setAttribute("transform", `translate(${node.x} ${node.y + (node.id === "E" ? 44 : 50)})`);
  }
  const chosen = state.nodes.find((node) => node.id === selectedNode);
  const ring = $("rangeRing");
  ring.setAttribute("cx", chosen.x);
  ring.setAttribute("cy", chosen.y);
  ring.setAttribute("r", chosen.range);
  ring.style.display = chosen.online ? "" : "none";
}

function markerAt(marker, x, y) {
  marker.classList.remove("hidden-marker");
  marker.setAttribute("transform", `translate(${x} ${y})`);
}

function renderRoute(state) {
  const active = state.activeTx;
  const lastRouteValid = lastPacket?.route?.every((id, index, route) => index === 0 || state.connections.some(([a, b]) =>
    (a === route[index - 1] && b === id) || (b === route[index - 1] && a === id)));
  const direction = active ? findRoute(state.nodes, active.from, active.packet.destination) : lastRouteValid ? lastPacket.route : state.route;
  const path = direction?.map((id) => state.nodes.find((node) => node.id === id));
  $("activeRoute").setAttribute("d", path?.length > 1 ? `M${path.map((node) => `${node.x} ${node.y}`).join(" ")}` : "");
  $("routeLabel").textContent = path ? `${active ? "Active" : lastRouteValid ? "Last packet" : "Active"} route · ${direction.join(" → ")}` : "No route · arrival time unknown";
  $("networkState").textContent = state.route ? (state.route.includes("E") ? "Rerouted via E" : "Route available") : "Waiting for route";
  root.querySelector(".network-state").classList.toggle("is-rerouted", !state.route || state.route.includes("E"));

  if (lastPacket) {
    const node = state.nodes.find((item) => item.id === lastPacket.location);
    if (node) markerAt($("packetMarker"), node.x, node.y);
  } else $("packetMarker").classList.add("hidden-marker");
  if (lastLoss) {
    const a = state.nodes.find((node) => node.id === lastLoss.from);
    const b = state.nodes.find((node) => node.id === lastLoss.to);
    if (a && b) markerAt($("lostMarker"), (a.x + b.x) / 2, (a.y + b.y) / 2);
  } else $("lostMarker").classList.add("hidden-marker");
}

function renderStages(){
  const group=mediaProgress(hooks.network());
  const pending=hooks.network().pending;
  const stage=group.confirmed?3:group.verified?3:group.kind==='crop'?2:pending&&[...hooks.network().frames.values()].some(f=>f.tag===2)?1:group.total?0:-1;
  root.querySelectorAll('.flow-step').forEach((el,i)=>{
    el.classList.toggle('is-active',i===stage&&!group.confirmed);
    el.classList.toggle('is-complete',i<stage||group.confirmed);
    if(i===stage)el.setAttribute('aria-current','step');else el.removeAttribute('aria-current');
  });
}

function renderTrace() {
  const trace = $("hopTrace");
  trace.replaceChildren();
  if (!lastPacket?.route) return;
  for (const nodeId of lastPacket.route) {
    const row = document.createElement("div");
    row.className = `trace-row ${lastPacket.path?.includes(nodeId) ? "done" : nodeId === lastPacket.location ? "current" : ""}`;
    const node = document.createElement("span");
    node.textContent = nodeId;
    const spacer = document.createElement("i");
    const label = document.createElement("p");
    label.textContent = lastPacket.path?.includes(nodeId) ? "Reached" : nodeId === lastPacket.location ? "Current" : "Waiting";
    row.append(node, spacer, label);
    trace.append(row);
  }
}

function renderPacket() {
  if (!lastPacket) return;
  const type = lastPacket.packetType?.replaceAll("_", " ") ?? "packet";
  $("packetTitle").textContent = lastPacket.packetType === "data" ? `Chunk ${lastPacket.chunkIndex+1}` : type[0].toUpperCase() + type.slice(1);
  $("packetSubtitle").textContent = lastPacket.packetId;
  $("packetStatus").textContent = lastPacket.status;
  $("packetStatusDot").className = `status-dot ${lastPacket.lost ? "amber" : lastPacket.received ? "green" : "blue"}`;
  $("directionValue").textContent = `${lastPacket.source} → ${lastPacket.destination}`;
  $("attemptValue").textContent = lastPacket.attempt ? `${lastPacket.attempt} of ${sim.maxAttempts}` : "—";
  $("sizeValue").textContent = lastPacket.wireBytes ? `${lastPacket.wireBytes} bytes` : "—";
  renderTrace();
}

function renderProgress(){
  const n=hooks.network(),group=mediaProgress(n);
  $('representationLabel').textContent=group.total?group.kind.toUpperCase():'NO TRANSFER';
  $('progressTitle').textContent=group.total?`${group.kind==='crop'?'Selected detail':group.kind[0].toUpperCase()+group.kind.slice(1)} · ${group.confirmed?'receipt confirmed':group.verified?'verified locally':'receiving'}`:'Waiting for media';
  $('progressValue').innerHTML=`${group.received} <span>/ ${group.total} chunks</span>`;
  const percent=group.total?Math.round(group.received/group.total*100):0;
  $('progressPercent').textContent=`${percent}%`;$('progressFill').style.width=`${percent}%`;
  const grid=$('chunkGrid');grid.replaceChildren();
  for(const rep of group.reps)for(let i=0;i<rep.total;i++){
    const span=document.createElement('span');
    const inTransit=sim.activeTx?.task.packet.representationId===rep.id&&sim.activeTx.task.packet.type==='data'&&sim.activeTx.task.packet.chunkIndex===i;
    const state=rep.received.has(i)?'received':inTransit?'transit':'missing';
    span.className=`chunk ${state}`;span.title=`${rep.kind} ${rep.id.slice(0,6)}, chunk ${i+1}: ${state}`;grid.append(span);
  }
  grid.setAttribute('aria-label',`${group.received} of ${group.total} chunks received`);
  const image=group.reps.filter(rep=>rep.verified&&rep.url).at(-1);
  $('receivedImageWrap').hidden=!image;
  if(image){$('receivedImage').src=image.url;$('receivedImageCaption').textContent=image.kind==='crop'?'Latest verified source tile':'Verified preview';}
}

function renderKnowledge(state){
  const n=hooks.network(),group=mediaProgress(n),first=group.reps[0];
  $('truthValue').textContent=!state.route?'No route between phones':lastPacket?.lost?`Lost hop ${lastLoss?.from} → ${lastLoss?.to}`:state.activeTx?`Packet on ${state.activeTx.from} → ${state.activeTx.to}`:group.verified?'Media verified at recipient':'Watching all hops';
  $('senderEndpoint').textContent=first?`Sender phone (${first.source})`:'Sender phone';
  $('receiverEndpoint').textContent=first?`Receiver phone (${first.destination})`:'Receiver phone';
  $('senderValue').textContent=group.confirmed?'Verified receipt received':group.failed?'Receipt unconfirmed; retry available':group.total?'Sent; awaiting verified receipt':'Nothing sent yet';
  $('receiverValue').textContent=group.verified?'Media verified locally':group.total?`${group.received} of ${group.total} chunks; unverified`:'Nothing received yet';
}

function renderControls(state){
  const n=hooks.network(),group=mediaProgress(n);
  $('rateValue').textContent=`${RADIO_PRESETS[state.preset].toFixed(2)} kbps`;
  $('lossValue').textContent=`${Math.round(n.loss*100)}%`;
  $('simTime').textContent=formatTime(n.time);$('txBytes').textContent=formatBytes(n.bytes);
  $('airtime').textContent=`${n.airtime.toFixed(1)} s`;$('lostCount').textContent=n.lost;
  const estimate=remainingEstimate(n);
  $('etaValue').textContent=typeof estimate==='string'?estimate:`~${formatTime(estimate[0])}–${formatTime(estimate[1])}`;
  $('etaValue').title='Approximate simulated time for this transfer, including expected retries. Future crop requests and local codec work are excluded.';
  $('requestButton').disabled=!hooks.canRequest();$('startButton').disabled=!hooks.canSend();
  $('playButton').disabled=!n.pending&&!hooks.busy();$('stepButton').disabled=!n.pending&&!hooks.busy();
  $('playButton').textContent=n.paused?'Play':'Pause';
  $('toggleRelay').textContent=n.enabled.has('C')?'Disable relay C':'Restore relay C';
  $('networkConnection').textContent=n.online?'Network online':'Reconnect network';$('networkConnection').setAttribute('aria-pressed',String(n.online));
  $('networkState').textContent=!n.online?'Disconnected':n.paused?'Paused':!state.route?'Waiting for route':state.route.includes('E')?'Rerouted via E':'Route available';
  $('nodeSelect').value=selectedNode;
  const node=state.nodes.find(item=>item.id===selectedNode);
  $('nodeRole').textContent=node.role[0].toUpperCase()+node.role.slice(1);
  for(const [id,key] of [['nodeX','x'],['nodeY','y'],['nodeRange','range']])if(document.activeElement!==$(id))$(id).value=Math.round(node[key]);
  $('nodeOnline').checked=node.online;
  let movement='Ready to send',status='Idle';
  if(!n.online||!state.route){movement='No route to recipient';status='Waiting';}
  else if(n.paused){movement='Progress retained · use Next event to step';status='Paused';}
  else if(state.activeTx){const p=state.activeTx.packet;movement=`${p.type==='data'?`Chunk ${p.chunkIndex+1}`:p.type.replaceAll('_',' ')} · ${state.activeTx.from} to ${state.activeTx.to}`;status='On air';}
  else if(group.failed){movement='Recovery limit reached · retry from phone';status='Failed';}
  else if(n.pending){movement='Waiting for next packet or recovery timeout';status='Queued';}
  else if(group.confirmed){movement='Verified receipt returned to sender';status='Delivered';}
  else if(group.total){movement=group.verified?'Receiver verified · awaiting receipt':'Waiting for local verification';status='Unconfirmed';}
  $('currentMovement').textContent=movement;$('movementStatus').textContent=status;
}

function render(){
  const n=hooks.network();n.syncNodes();
  if(sim!==n.simulator){sim=n.simulator;eventIndex=0;lastPacket=null;lastLoss=null;appEvents=[];}
  const fresh=sim.events.slice(eventIndex);eventIndex=sim.events.length;
  for(const e of fresh)consumeEvent(e);
  const state=sim.getState();state.route=n.getRoute();state.connections=n.online?n.links:[];
  renderNodes(state);renderRoute(state);renderStages();renderPacket();renderProgress();renderKnowledge(state);renderControls(state);renderTimeline();
}
function consumeEvent(event){
  if(event.type==='hop_lost')lastLoss=event;
  if(event.type==='tx_started')lastPacket={...event,route:[...event.path.slice(0,-1),...event.route],location:event.from,status:`On air · ${event.from} → ${event.to}`,lost:false,received:false};
  if(lastPacket&&event.packetId===lastPacket.packetId){
    if(event.type==='hop_received'){lastPacket.location=event.to;lastPacket.path=event.path;lastPacket.status=`Reached ${event.to}`;lastPacket.lost=false;}
    if(event.type==='hop_lost'){lastPacket.status=`Lost on ${event.from} → ${event.to}`;lastPacket.lost=true;}
    if(event.type==='packet_received'){lastPacket.status=`Received at ${event.at}`;lastPacket.received=true;}
  }
}
function resetView(){lastPacket=null;lastLoss=null;appEvents=[];eventIndex=0;
  $('packetTitle').textContent='No packet yet';$('packetSubtitle').textContent='Send from either phone to inspect each hop.';
  $('packetStatus').textContent='Idle';$('packetStatusDot').className='status-dot blue';
  for(const id of ['directionValue','attemptValue','sizeValue'])$(id).textContent='—';$('hopTrace').replaceChildren();
}
$('startButton').addEventListener('click',()=>hooks.sendPhoto());
$('requestButton').addEventListener('click',()=>hooks.requestSection());
$('playButton').addEventListener('click',()=>{hooks.network().paused=!hooks.network().paused;render();});
$('stepButton').addEventListener('click',async()=>{hooks.network().paused=true;await hooks.step();render();});
$('toggleRelay').addEventListener('click',()=>{const n=hooks.network();n.setNode('C',{online:!n.enabled.has('C')});render();});
$('networkConnection').addEventListener('click',()=>{hooks.network().online=!hooks.network().online;render();});
$('presetSelect').addEventListener('change',e=>{hooks.network().setPreset(e.target.value);render();});
$('lossRange').addEventListener('input',e=>{hooks.network().loss=Number(e.target.value)/100;render();});
$('replaySelect').addEventListener('change',e=>hooks.setSpeed(Number(e.target.value)));
$('resetButton').addEventListener('click',()=>hooks.reset());
$('nodeSelect').addEventListener('change',e=>{selectedNode=e.target.value;render();});
for(const [id,key] of [['nodeX','x'],['nodeY','y'],['nodeRange','range']])$(id).addEventListener('change',e=>{
  const change=nodeChange(key,e.target.value);if(change){e.target.value=change[key];hooks.network().setNode(selectedNode,change);render();}
});
$('nodeOnline').addEventListener('change',e=>{hooks.network().setNode(selectedNode,{online:e.target.checked});render();});
svg.addEventListener('pointerdown',e=>{const group=e.target.closest('[data-node-id]');if(!group)return;e.preventDefault();selectedNode=group.dataset.nodeId;draggingNode=selectedNode;svg.setPointerCapture(e.pointerId);render();});
svg.addEventListener('pointermove',e=>{if(!draggingNode)return;const point=new DOMPoint(e.clientX,e.clientY).matrixTransform(svg.getScreenCTM().inverse());hooks.network().setNode(draggingNode,{...nodeChange('x',point.x),...nodeChange('y',point.y)});render();});
for(const name of ['pointerup','pointercancel','lostpointercapture'])svg.addEventListener(name,()=>draggingNode=null);
svg.addEventListener('keydown',e=>{const group=e.target.closest('[data-node-id]');if(!group)return;selectedNode=group.dataset.nodeId;
  const moves={ArrowLeft:['x',-10],ArrowRight:['x',10],ArrowUp:['y',-10],ArrowDown:['y',10]};
  if(moves[e.key]){e.preventDefault();const [key,delta]=moves[e.key],node=hooks.network().simulator.nodes.find(n=>n.id===selectedNode);hooks.network().setNode(selectedNode,nodeChange(key,node[key]+delta));}
  render();
});
return {render,reset(){draggingNode=null;resetView();render();},clearTransfer(){resetView();eventIndex=hooks.network().simulator.events.length;render();},log(text,level,time){render();appEvents.push({type:'application',text,level,time});if(appEvents.length>100)appEvents.shift();renderTimeline();}};
}

import { MeshSimulator, RADIO_PRESETS, findRoute } from "./simulator.mjs";
import { createDemoFixtures } from "./fixtures.mjs";

const $ = (id) => document.getElementById(id);
const svg = $("networkMap");
const svgNS = "http://www.w3.org/2000/svg";
const fixtures = await createDemoFixtures();
let sim;
let started = false;
let playing = false;
let stepping = false;
let playTimer = null;
let selectedNode = "A";
let draggingNode = null;
let requestSent = false;
let requestArrived = false;
let lastPacket = null;
let lastLoss = null;
let imageUrl = null;
let displayedImageId = null;

function formatTime(seconds) {
  const rounded = Math.max(0, Math.round(seconds));
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}

function formatBytes(bytes) {
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;
}

function eventDescription(event) {
  const shortId = event.chunkIndex ? `Chunk ${event.chunkIndex}` : event.packetType?.replaceAll("_", " ") ?? "Packet";
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
    default: return [event.type.replaceAll("_", " "), ""];
  }
}

function timelineEvents() {
  const visible = new Set(["tx_started", "hop_received", "hop_lost", "packet_received", "retry_queued", "missing_requested", "request_received", "representation_verified", "receipt_confirmed", "route_changed", "waiting_for_route", "status_requested", "crop_selected", "failed"]);
  return sim.events.filter((event) => visible.has(event.type)).slice(-10);
}

function renderTimeline() {
  const list = $("timeline");
  list.replaceChildren();
  for (const event of timelineEvents()) {
    const [title, detail] = eventDescription(event);
    const item = document.createElement("li");
    if (["hop_lost", "failed", "waiting_for_route"].includes(event.type)) item.classList.add("is-alert");
    if (["representation_verified", "receipt_confirmed"].includes(event.type)) item.classList.add("is-success");
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
  const direction = active ? findRoute(state.nodes, active.from, active.packet.destination) : state.route;
  const path = direction?.map((id) => state.nodes.find((node) => node.id === id));
  $("activeRoute").setAttribute("d", path?.length > 1 ? `M${path.map((node) => `${node.x} ${node.y}`).join(" ")}` : "");
  $("routeLabel").textContent = path ? `${active ? "Packet's next hops" : "Current A → D route"} · ${direction.join(" → ")}` : "No route · arrival time unknown";
  $("networkState").textContent = state.route ? (state.route.includes("E") ? "Rerouted via E" : "Route available") : "Waiting for route";
  document.querySelector(".network-state").classList.toggle("is-rerouted", !state.route || state.route.includes("E"));

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

function renderStages(state) {
  const preview = state.representations.find((rep) => rep.kind === "preview");
  const crop = state.representations.find((rep) => rep.kind === "crop");
  const stage = crop?.senderConfirmed ? 3 : crop ? 2 : requestSent ? 1 : started ? 0 : -1;
  document.querySelectorAll(".flow-step").forEach((element, index) => {
    element.classList.toggle("is-active", index === stage);
    element.classList.toggle("is-complete", Boolean(index < stage || (index === 0 && preview?.verified)));
    if (index === stage) element.setAttribute("aria-current", "step");
    else element.removeAttribute("aria-current");
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
  $("packetTitle").textContent = lastPacket.chunkIndex ? `Chunk ${lastPacket.chunkIndex}` : type[0].toUpperCase() + type.slice(1);
  $("packetSubtitle").textContent = lastPacket.packetId;
  $("packetStatus").textContent = lastPacket.status;
  $("packetStatusDot").className = `status-dot ${lastPacket.lost ? "amber" : lastPacket.received ? "green" : "blue"}`;
  $("directionValue").textContent = `${lastPacket.source} → ${lastPacket.destination}`;
  $("attemptValue").textContent = lastPacket.attempt ? `${lastPacket.attempt} of ${sim.maxAttempts}` : "—";
  $("sizeValue").textContent = lastPacket.wireBytes ? `${lastPacket.wireBytes} bytes` : "—";
  renderTrace();
}

function renderProgress(state) {
  const rep = state.representations.find((item) => item.kind === "crop") ?? state.representations.find((item) => item.kind === "preview");
  if (!rep) return;
  $("representationLabel").textContent = rep.kind === "crop" ? "REQUESTED CROP" : "TINY PREVIEW";
  const baseTitle = rep.kind === "crop" ? "Trail sign detail" : "Tiny preview";
  $("progressTitle").textContent = rep.received === rep.total && !rep.verified && !rep.manifestReceived ? `${baseTitle} · waiting for manifest` : baseTitle;
  $("progressValue").innerHTML = `${rep.received} <span>/ ${rep.total} chunks</span>`;
  const percent = Math.round(rep.received / rep.total * 100);
  $("progressPercent").textContent = `${percent}%`;
  $("progressFill").style.width = `${percent}%`;
  const grid = $("chunkGrid");
  grid.replaceChildren();
  for (let index = 1; index <= rep.total; index += 1) {
    const chunk = document.createElement("span");
    const inTransit = state.activeTx?.packet.representationId === rep.id && state.activeTx.packet.chunkIndex === index;
    chunk.className = `chunk ${sim.representations.get(rep.id).received.has(index) ? "received" : inTransit ? "transit" : "missing"}`;
    chunk.title = `Chunk ${index}: ${chunk.className.split(" ")[1]}`;
    grid.append(chunk);
  }
  grid.setAttribute("aria-label", `${rep.received} of ${rep.total} chunks received`);
  const wrap = $("receivedImageWrap");
  if (rep.verified) {
    if (displayedImageId !== rep.id) {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      imageUrl = URL.createObjectURL(new Blob([sim.representations.get(rep.id).verifiedBytes], { type: "image/svg+xml" }));
      $("receivedImage").src = imageUrl;
      displayedImageId = rep.id;
    }
    $("receivedImageCaption").textContent = rep.kind === "crop" ? "Verified detail received at D" : "Verified preview received at D";
    wrap.hidden = false;
  } else wrap.hidden = true;
}

function remainingEstimate(state) {
  if (!state.route || state.loss >= 1) return "Unknown";
  const rep = state.representations.find((item) => item.kind === "crop") ?? state.representations.find((item) => item.kind === "preview");
  if (!rep) return "—";
  if (rep.failed) return "Failed";
  if (rep.senderConfirmed) return "Complete";
  const remaining = rep.verified ? 1 : Math.max(1, rep.total - rep.received);
  const hopSeconds = 180 * 8 / (RADIO_PRESETS[state.preset] * 1000) + 0.12;
  const lower = remaining * (state.route.length - 1) * hopSeconds;
  const upper = lower * Math.min(4, 1.35 / Math.max(.1, 1 - state.loss));
  return `${formatTime(lower)}–${formatTime(upper)}`;
}

function renderKnowledge(state) {
  const preview = state.representations.find((rep) => rep.kind === "preview");
  const crop = state.representations.find((rep) => rep.kind === "crop");
  if (!state.route) $("truthValue").textContent = "No A → D route";
  else if (lastPacket?.lost) $("truthValue").textContent = `Lost hop ${lastLoss?.from} → ${lastLoss?.to}`;
  else if (state.activeTx) $("truthValue").textContent = `Packet on ${state.activeTx.from} → ${state.activeTx.to}`;
  else if (crop?.verified) $("truthValue").textContent = "Crop verified at D";
  else $("truthValue").textContent = started ? "Watching all hops" : "Ready";

  if (crop?.senderConfirmed) $("senderValue").textContent = "Crop receipt received";
  else if (crop?.failed && sim.representations.get(crop.id).statusQueries > 0) $("senderValue").textContent = "No receipt after status query";
  else if (crop || requestArrived) $("senderValue").textContent = "Crop sent; awaiting receipt";
  else if (preview?.senderConfirmed) $("senderValue").textContent = "Preview receipt received";
  else if (started) $("senderValue").textContent = "Preview sent; awaiting receipt";
  else $("senderValue").textContent = "Nothing sent yet";

  if (crop?.verified) $("receiverValue").textContent = "Crop verified locally";
  else if (crop?.failed) $("receiverValue").textContent = "Crop incomplete; retry limit reached";
  else if (crop) $("receiverValue").textContent = `Crop: ${crop.received} of ${crop.total} chunks`;
  else if (preview?.verified) $("receiverValue").textContent = requestSent ? "Preview verified; crop requested" : "Preview verified";
  else if (preview) $("receiverValue").textContent = `Preview: ${preview.received} of ${preview.total} chunks`;
  else $("receiverValue").textContent = "Nothing received yet";
}

function renderControls(state) {
  $("rateValue").textContent = `${RADIO_PRESETS[state.preset].toFixed(2)} kbps`;
  $("lossValue").textContent = `${Math.round(state.loss * 100)}%`;
  $("simTime").textContent = formatTime(state.time);
  $("txBytes").textContent = formatBytes(state.metrics.transmittedBytes);
  $("airtime").textContent = `${state.metrics.airtimeSeconds.toFixed(1)} s`;
  $("lostCount").textContent = state.metrics.lostHops;
  $("etaValue").textContent = remainingEstimate(state);
  const preview = state.representations.find((rep) => rep.kind === "preview");
  $("requestButton").disabled = !preview?.verified || requestSent;
  $("startButton").disabled = started;
  $("playButton").disabled = !started;
  $("stepButton").disabled = !started;
  $("playButton").textContent = playing ? "Pause" : "Play";
  const c = state.nodes.find((node) => node.id === "C");
  $("toggleRelay").textContent = c.online ? "Disable relay C" : "Restore relay C";
  const node = state.nodes.find((item) => item.id === selectedNode);
  $("nodeSelect").value = selectedNode;
  $("nodeRole").textContent = node.role[0].toUpperCase() + node.role.slice(1);
  if (document.activeElement !== $("nodeX")) $("nodeX").value = Math.round(node.x);
  if (document.activeElement !== $("nodeY")) $("nodeY").value = Math.round(node.y);
  if (document.activeElement !== $("nodeRange")) $("nodeRange").value = Math.round(node.range);
  $("nodeOnline").checked = node.online;
  const crop = state.representations.find((rep) => rep.kind === "crop");
  if (!started) { $("currentMovement").textContent = "Ready to start"; $("movementStatus").textContent = "Idle"; }
  else if (!state.route) { $("currentMovement").textContent = "No route to receiver"; $("movementStatus").textContent = "Waiting"; }
  else if (crop?.failed) { $("currentMovement").textContent = "Crop stopped at retry limit"; $("movementStatus").textContent = "Failed"; }
  else if (state.activeTx) {
    const packet = state.activeTx.packet;
    $("currentMovement").textContent = `${packet.chunkIndex ? `Chunk ${packet.chunkIndex}` : packet.type.replaceAll("_", " ")} · ${state.activeTx.from} to ${state.activeTx.to}`;
    $("movementStatus").textContent = "On air";
  } else if (preview?.verified && !requestSent) { $("currentMovement").textContent = "Preview verified · request the sign"; $("movementStatus").textContent = "Your turn"; }
  else if (crop?.senderConfirmed) { $("currentMovement").textContent = "Crop confirmed at sender"; $("movementStatus").textContent = "Delivered"; }
  else { $("currentMovement").textContent = "Waiting for next packet"; $("movementStatus").textContent = "Queued"; }
}

function render() {
  const state = sim.getState();
  renderNodes(state);
  renderRoute(state);
  renderStages(state);
  renderPacket();
  renderProgress(state);
  renderKnowledge(state);
  renderControls(state);
  renderTimeline();
}

function onEvent(event) {
  if (event.type === "request_received") requestArrived = true;
  if (event.type === "hop_lost") lastLoss = event;
  if (event.type === "tx_started") lastPacket = {
    packetId: event.packetId, packetType: event.packetType, chunkIndex: event.chunkIndex,
    source: event.source, destination: event.destination, route: [...event.path.slice(0, -1), ...event.route],
    path: event.path, location: event.from, attempt: event.attempt, wireBytes: event.wireBytes,
    status: `On air · ${event.from} → ${event.to}`, lost: false, received: false
  };
  if (lastPacket && ["hop_received", "hop_lost", "packet_received"].includes(event.type) && event.packetId === lastPacket.packetId) {
    if (event.type === "hop_received") {
      lastPacket.location = event.to;
      lastPacket.path = event.path;
      lastPacket.status = `Reached ${event.to}`;
      lastPacket.lost = false;
    } else if (event.type === "hop_lost") {
      lastPacket.status = `Lost on ${event.from} → ${event.to}`;
      lastPacket.lost = true;
    } else {
      lastPacket.status = `Received at ${event.at}`;
      lastPacket.received = true;
    }
  }
  if (event.type === "representation_verified" && event.kind === "preview" && !requestSent) {
    // Pause at the meaningful interaction: D can now request the unreadable sign.
    playing = false;
    clearTimeout(playTimer);
  }
  render();
}

function reset() {
  playing = false;
  clearTimeout(playTimer);
  started = false;
  requestSent = false;
  requestArrived = false;
  lastPacket = null;
  lastLoss = null;
  if (imageUrl) URL.revokeObjectURL(imageUrl);
  imageUrl = null;
  displayedImageId = null;
  $("receivedImageWrap").hidden = true;
  $("packetTitle").textContent = "No packet yet";
  $("packetSubtitle").textContent = "Start the image demo to see each hop.";
  $("packetStatus").textContent = "Idle";
  $("directionValue").textContent = "—";
  $("attemptValue").textContent = "—";
  $("sizeValue").textContent = "—";
  $("hopTrace").replaceChildren();
  $("representationLabel").textContent = "NO TRANSFER";
  $("progressTitle").textContent = "Waiting for image";
  $("progressValue").innerHTML = '0 <span>/ 0 chunks</span>';
  $("progressPercent").textContent = "0%";
  $("progressFill").style.width = "0%";
  $("chunkGrid").replaceChildren();
  const seed = Math.max(1, Number($("seedInput").value) || 16);
  $("seedInput").value = seed;
  sim = new MeshSimulator({
    preset: $("presetSelect").value,
    loss: Number($("lossRange").value) / 100,
    seed,
    onEvent,
    onCropRequest: async (_requestId, _payload, engine) => {
      if (!engine.representations.has(fixtures.crop.manifest.id)) engine.enqueueRepresentation(fixtures.crop.manifest, fixtures.crop.chunks);
    }
  });
  render();
}

async function stepOnce() {
  if (stepping) return;
  stepping = true;
  try {
    const event = await sim.step();
    if (!event) { playing = false; render(); }
  } finally { stepping = false; }
}

async function playLoop() {
  if (!playing) return;
  await stepOnce();
  if (playing) playTimer = setTimeout(playLoop, 120);
}

function play() {
  if (playing) return;
  playing = true;
  render();
  playLoop();
}

$("startButton").addEventListener("click", () => {
  if (started) return;
  started = true;
  sim.enqueueRepresentation(fixtures.preview.manifest, fixtures.preview.chunks);
  sim.enqueueRepresentation(fixtures.background.manifest, fixtures.background.chunks);
  render();
  play();
});
$("requestButton").addEventListener("click", () => {
  if (requestSent) return;
  sim.requestCrop();
  requestSent = true;
  render();
  play();
});
$("playButton").addEventListener("click", () => {
  if (playing) { playing = false; clearTimeout(playTimer); render(); }
  else play();
});
$("stepButton").addEventListener("click", async () => {
  playing = false;
  clearTimeout(playTimer);
  await stepOnce();
  render();
});
$("toggleRelay").addEventListener("click", () => {
  const c = sim.nodes.find((node) => node.id === "C");
  sim.setNode("C", { online: !c.online });
  render();
});
$("presetSelect").addEventListener("change", (event) => { sim.setPreset(event.target.value); render(); });
$("lossRange").addEventListener("input", (event) => { sim.setLoss(Number(event.target.value) / 100); render(); });
$("resetButton").addEventListener("click", reset);
$("nodeSelect").addEventListener("change", (event) => { selectedNode = event.target.value; render(); });
for (const [id, key] of [["nodeX", "x"], ["nodeY", "y"], ["nodeRange", "range"]]) {
  $(id).addEventListener("change", (event) => {
    const raw = Number(event.target.value);
    if (!Number.isFinite(raw)) return;
    const [minimum, maximum] = key === "x" ? [35, 765] : key === "y" ? [50, 385] : [30, 500];
    const value = Math.max(minimum, Math.min(maximum, raw));
    event.target.value = value;
    sim.setNode(selectedNode, { [key]: value });
    render();
  });
}
$("nodeOnline").addEventListener("change", (event) => { sim.setNode(selectedNode, { online: event.target.checked }); render(); });

svg.addEventListener("pointerdown", (event) => {
  const group = event.target.closest("[data-node-id]");
  if (!group) return;
  selectedNode = group.dataset.nodeId;
  draggingNode = selectedNode;
  svg.setPointerCapture(event.pointerId);
  render();
});
svg.addEventListener("pointermove", (event) => {
  if (!draggingNode) return;
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM().inverse());
  sim.setNode(draggingNode, { x: Math.max(35, Math.min(765, Math.round(point.x))), y: Math.max(50, Math.min(385, Math.round(point.y))) });
  render();
});
svg.addEventListener("pointerup", () => { draggingNode = null; });
svg.addEventListener("pointercancel", () => { draggingNode = null; });

reset();

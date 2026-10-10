// A deterministic, Meshtastic-inspired transport simulator, not Meshtastic firmware.
// The 16-byte outer header follows the documented field sizes. The 24-byte
// application header is this demo's explicit byte-counting envelope.
export const MAX_PACKET_BYTES = 230;
export const HEADER_BYTES = 40;
export const MAX_PAYLOAD_BYTES = MAX_PACKET_BYTES - HEADER_BYTES;
export const RADIO_PRESETS = Object.freeze({
  "Long Fast": 1.07,
  "Medium Fast": 3.52,
  "Short Turbo": 21.88,
  "Long Moderate": 0.34
});
export const DEFAULT_NODES = Object.freeze([
  { id: "A", x: 119, y: 220, range: 240, online: true, role: "sender" },
  { id: "B", x: 303, y: 105, range: 270, online: true, role: "relay" },
  { id: "C", x: 509, y: 153, range: 240, online: true, role: "relay" },
  { id: "D", x: 686, y: 224, range: 310, online: true, role: "receiver" },
  { id: "E", x: 413, y: 335, range: 310, online: true, role: "relay" }
]);

const TYPE_CODE = Object.freeze({ manifest: 1, data: 2, crop_request: 3, missing_request: 4, receipt: 5, status_query: 6 });
const PRIORITY = Object.freeze({ control: 0, crop: 1, preview: 2, background: 3 });
const encoder = new TextEncoder();

function hash32(value) {
  let hash = 2166136261;
  for (const byte of encoder.encode(String(value))) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (-(crc & 1) & 0xedb88320);
  }
  return (crc ^ -1) >>> 0;
}

export async function sha256Hex(bytes) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function splitBytes(bytes, chunkSize = 180) {
  if (!(bytes instanceof Uint8Array) || !Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > MAX_PAYLOAD_BYTES) {
    throw new Error(`Chunks must be Uint8Array pieces of at most ${MAX_PAYLOAD_BYTES} bytes`);
  }
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += chunkSize) chunks.push(bytes.slice(offset, offset + chunkSize));
  return chunks;
}

function payloadBytes(payload) {
  return payload instanceof Uint8Array ? payload : encoder.encode(JSON.stringify(payload ?? {}));
}

export function createPacket({ id, type, source, destination, representationId = "", requestId = "", chunkIndex = 0, chunkCount = 0, priority = "control", payload = new Uint8Array() }) {
  if (!TYPE_CODE[type]) throw new Error(`Unknown packet type: ${type}`);
  if (!(priority in PRIORITY)) throw new Error(`Unknown priority: ${priority}`);
  const body = payloadBytes(payload);
  if (body.length > MAX_PAYLOAD_BYTES) throw new Error(`Packet ${id} exceeds the ${MAX_PACKET_BYTES}-byte cap`);
  const bytes = new Uint8Array(HEADER_BYTES + body.length);
  const view = new DataView(bytes.buffer);
  // Documented Meshtastic-style 16-byte outer header.
  view.setUint32(0, hash32(destination), true);
  view.setUint32(4, hash32(source), true);
  view.setUint32(8, hash32(id), true);
  view.setUint8(12, 4); // modeled hop limit
  view.setUint8(13, 0x42); // demo channel hash
  view.setUint8(14, 0); // next hop is selected by the simulator
  view.setUint8(15, 0); // current relay is selected by the simulator
  // Explicit, fixed-size demo application envelope.
  view.setUint8(16, 1);
  view.setUint8(17, TYPE_CODE[type]);
  view.setUint8(18, PRIORITY[priority]);
  view.setUint32(20, hash32(representationId), true);
  view.setUint16(24, chunkIndex, true);
  view.setUint16(26, chunkCount, true);
  view.setUint32(28, hash32(requestId), true);
  view.setUint32(32, crc32(body), true);
  view.setUint16(36, body.length, true);
  bytes.set(body, HEADER_BYTES);
  return { id, type, source, destination, representationId, requestId, chunkIndex, chunkCount, priority, payload: body, bytes, wireBytes: bytes.length };
}

export function getConnections(nodes) {
  const links = [];
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i];
      const b = nodes[j];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (a.online && b.online && distance <= a.range && distance <= b.range) links.push([a.id, b.id]);
    }
  }
  return links;
}

export function findRoute(nodes, source, destination) {
  if (!nodes.find((node) => node.id === source && node.online) || !nodes.find((node) => node.id === destination && node.online)) return null;
  if (source === destination) return [source];
  const links = getConnections(nodes);
  const queue = [[source]];
  const seen = new Set([source]);
  while (queue.length) {
    const path = queue.shift();
    const current = path.at(-1);
    const neighbors = links.flatMap(([a, b]) => a === current ? [b] : b === current ? [a] : []).sort();
    for (const next of neighbors) {
      if (seen.has(next)) continue;
      const nextPath = [...path, next];
      if (next === destination) return nextPath;
      seen.add(next);
      queue.push(nextPath);
    }
  }
  return null;
}

export class MeshSimulator {
  constructor({ nodes = DEFAULT_NODES, preset = "Long Fast", loss = 0.2, seed = 2407, maxAttempts = 5, maxMissingRounds = 3, verifyRepresentation, onCropRequest, onEvent } = {}) {
    this.nodes = nodes.map((node) => ({ ...node }));
    this.setPreset(preset, false);
    this.setLoss(loss, false);
    this.seed = seed >>> 0 || 1;
    this.randomState = this.seed;
    this.maxAttempts = maxAttempts;
    this.maxMissingRounds = maxMissingRounds;
    this.verifyRepresentation = verifyRepresentation ?? (async (manifest, bytes) => (await sha256Hex(bytes)) === manifest.expectedHash);
    this.onCropRequest = onCropRequest;
    this.onEvent = onEvent;
    this.time = 0;
    this.queue = [];
    this.scheduled = [];
    this.activeTx = null;
    this.events = [];
    this.representations = new Map();
    this.deliveredPacketIds = new Set();
    this.handledCropRequests = new Set();
    this.metrics = { transmittedBytes: 0, airtimeSeconds: 0, hopTransmissions: 0, lostHops: 0, retries: 0 };
    this.sequence = 0;
    this.waitingReported = false;
  }

  random() {
    let x = this.randomState;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.randomState = x >>> 0;
    return this.randomState / 0x100000000;
  }

  emit(type, detail = {}) {
    const event = { type, time: this.time, ...detail };
    this.events.push(event);
    this.onEvent?.(event, this);
    return event;
  }

  setPreset(preset, announce = true) {
    if (!(preset in RADIO_PRESETS)) throw new Error(`Unknown preset: ${preset}`);
    this.preset = preset;
    if (announce) this.emit("settings_changed", { preset, loss: this.loss });
  }

  setLoss(loss, announce = true) {
    if (!Number.isFinite(loss) || loss < 0 || loss > 1) throw new Error("Loss must be between 0 and 1");
    this.loss = loss;
    if (announce) this.emit("settings_changed", { preset: this.preset, loss });
  }

  setNode(id, changes) {
    const node = this.nodes.find((item) => item.id === id);
    if (!node) throw new Error(`Unknown node: ${id}`);
    const before = findRoute(this.nodes, "A", "D");
    const updated = { ...node };
    for (const key of ["x", "y", "range", "online"]) {
      if (Object.hasOwn(changes, key)) updated[key] = changes[key];
    }
    if (!Number.isFinite(updated.x) || !Number.isFinite(updated.y) || !Number.isFinite(updated.range) || updated.range <= 0 || typeof updated.online !== "boolean") throw new Error("Invalid node position, range, or availability");
    Object.assign(node, updated);
    if (!node.online) {
      // A relay that disappears cannot forward packets it was holding. The
      // source still has its original bytes, so those packets can be resent.
      for (const task of this.queue) {
        if (task.current === id && task.packet.source !== id) {
          task.current = task.packet.source;
          task.path = [task.current];
          this.emit("retry_queued", { packetId: task.packet.id, representationId: task.packet.representationId, reason: `relay ${id} offline; resend from source` });
        }
      }
    }
    const after = findRoute(this.nodes, "A", "D");
    this.emit("node_changed", { nodeId: id, node: { ...node } });
    if (JSON.stringify(before) !== JSON.stringify(after)) this.emit(after ? "route_changed" : "waiting_for_route", { route: after, previousRoute: before });
    this.waitingReported = false;
  }

  schedule(delay, type, detail = {}) {
    this.scheduled.push({ at: this.time + delay, type, detail, sequence: this.sequence++ });
    this.scheduled.sort((a, b) => a.at - b.at || a.sequence - b.sequence);
  }

  enqueue(packet, current = packet.source) {
    if (packet.external) {
      // Already serialized imageoverbt v2 frames: don't add this standalone
      // demo's incompatible 40-byte envelope. Count the actual SDK radio budget.
      if (!(packet.bytes instanceof Uint8Array) || packet.bytes.length > 220 || packet.bytes.length < 6 ||
          packet.wireBytes !== packet.bytes.length + (packet.bytes.length > 127 ? 34 : 33)) throw new Error("Invalid external application frame or radio budget");
    } else if (!(packet.bytes instanceof Uint8Array) || packet.bytes.length !== packet.wireBytes || packet.wireBytes > MAX_PACKET_BYTES) throw new Error("Packet exceeds byte cap or lacks serialized bytes");
    if (!this.nodes.some((node) => node.id === current)) throw new Error(`Unknown origin: ${current}`);
    const task = { packet, current, path: [current], losses: 0, sequence: this.sequence++, startedOnce: false };
    this.queue.push(task);
    const rep = this.representations.get(packet.representationId);
    if (rep && ["data", "manifest"].includes(packet.type)) rep.inflight.add(packet.id);
    this.emit("queued", { packetId: packet.id, packetType: packet.type, representationId: packet.representationId, from: current, to: packet.destination, wireBytes: packet.wireBytes });
    return task;
  }

  enqueueControl(type, payload, source, destination, representationId = "", requestId = "") {
    const packet = createPacket({ id: `${type}-${++this.sequence}`, type, source, destination, representationId, requestId, priority: "control", payload });
    this.enqueue(packet);
    return packet;
  }

  enqueueRepresentation(manifest, chunks) {
    if (!manifest?.id || !manifest.expectedHash || !["preview", "crop", "background"].includes(manifest.kind)) throw new Error("Incomplete representation manifest");
    if (!Array.isArray(chunks) || !chunks.length || chunks.some((chunk) => !(chunk instanceof Uint8Array) || chunk.length > MAX_PAYLOAD_BYTES)) throw new Error("Invalid chunks");
    if (this.representations.has(manifest.id)) throw new Error(`Duplicate representation: ${manifest.id}`);
    const normalized = { ...manifest, source: manifest.source ?? "A", destination: manifest.destination ?? "D", chunkCount: chunks.length, encodedBytes: chunks.reduce((total, chunk) => total + chunk.length, 0) };
    const rep = { manifest: normalized, chunks: chunks.map((chunk) => chunk.slice()), received: new Map(), manifestReceived: false, verified: false, senderConfirmed: false, failed: false, inflight: new Set(), missingRounds: 0, missingRequestPending: false, startedRemaining: chunks.length + 1, statusQueries: 0 };
    this.representations.set(normalized.id, rep);
    const manifestPayload = { id: normalized.id, kind: normalized.kind, hash: normalized.expectedHash, n: normalized.chunkCount, bytes: normalized.encodedBytes };
    this.enqueue(createPacket({ id: `${normalized.id}-manifest`, type: "manifest", source: normalized.source, destination: normalized.destination, representationId: normalized.id, priority: normalized.kind === "background" ? "background" : "control", payload: manifestPayload }));
    chunks.forEach((chunk, index) => this.enqueue(createPacket({ id: `${normalized.id}-chunk-${index + 1}`, type: "data", source: normalized.source, destination: normalized.destination, representationId: normalized.id, chunkIndex: index + 1, chunkCount: chunks.length, priority: normalized.kind, payload: chunk })));
    return rep;
  }

  requestCrop({ imageId = "trail-sign", bounds = [0.42, 0.22, 0.38, 0.36], requestId = `crop-${++this.sequence}` } = {}) {
    const preview = [...this.representations.values()].find((rep) => rep.manifest.kind === "preview" && rep.verified);
    if (!preview) throw new Error("The preview must be verified before requesting a crop");
    this.emit("crop_selected", { requestId, imageId, bounds, from: "D" });
    return this.enqueueControl("crop_request", { imageId, bounds, requestId }, "D", "A", "", requestId);
  }

  _nextRoutableTask() {
    let bestIndex = -1;
    for (let i = 0; i < this.queue.length; i += 1) {
      const task = this.queue[i];
      if (!findRoute(this.nodes, task.current, task.packet.destination)) continue;
      if (bestIndex < 0 || PRIORITY[task.packet.priority] < PRIORITY[this.queue[bestIndex].packet.priority] ||
        (PRIORITY[task.packet.priority] === PRIORITY[this.queue[bestIndex].packet.priority] && task.sequence < this.queue[bestIndex].sequence)) bestIndex = i;
    }
    return bestIndex < 0 ? null : this.queue.splice(bestIndex, 1)[0];
  }

  _startTx(task) {
    const route = findRoute(this.nodes, task.current, task.packet.destination);
    const next = route[1];
    const airtime = task.packet.wireBytes * 8 / (RADIO_PRESETS[this.preset] * 1000) + 0.12;
    if (!task.startedOnce) {
      task.startedOnce = true;
      const rep = this.representations.get(task.packet.representationId);
      if (rep && ["data", "manifest"].includes(task.packet.type)) {
        rep.startedRemaining -= 1;
        if (rep.startedRemaining === 0) this.schedule(Math.max(15, airtime * rep.manifest.chunkCount * 4), "receipt_timeout", { representationId: rep.manifest.id });
      }
    }
    this.metrics.transmittedBytes += task.packet.wireBytes;
    this.metrics.airtimeSeconds += airtime;
    this.metrics.hopTransmissions += 1;
    this.activeTx = { task, from: task.current, to: next, finish: this.time + airtime, airtime };
    this.waitingReported = false;
    return this.emit("tx_started", { packetId: task.packet.id, packetType: task.packet.type, representationId: task.packet.representationId, chunkIndex: task.packet.chunkIndex, source: task.packet.source, destination: task.packet.destination, from: task.current, to: next, route, path: [...task.path], attempt: task.losses + 1, wireBytes: task.packet.wireBytes, airtime });
  }

  async _finishTx() {
    const tx = this.activeTx;
    this.activeTx = null;
    this.time = tx.finish;
    const { task } = tx;
    const stillLinked = getConnections(this.nodes).some(([a, b]) => (a === tx.from && b === tx.to) || (a === tx.to && b === tx.from));
    if (!stillLinked || this.random() < this.loss) {
      task.losses += 1;
      this.metrics.lostHops += 1;
      const event = this.emit("hop_lost", { packetId: task.packet.id, packetType: task.packet.type, representationId: task.packet.representationId, chunkIndex: task.packet.chunkIndex, from: tx.from, to: tx.to, attempt: task.losses, reason: stillLinked ? "radio loss" : "link unavailable" });
      if (task.losses < this.maxAttempts) {
        if (!this.nodes.find((node) => node.id === task.current)?.online && task.current !== task.packet.source) {
          task.current = task.packet.source;
          task.path = [task.current];
        }
        this.metrics.retries += 1;
        this.schedule(Math.max(0.5, tx.airtime * 1.5), "retry_ready", { task });
      } else await this._exhausted(task);
      return event;
    }
    task.current = tx.to;
    task.path.push(tx.to);
    const event = this.emit("hop_received", { packetId: task.packet.id, packetType: task.packet.type, representationId: task.packet.representationId, chunkIndex: task.packet.chunkIndex, from: tx.from, to: tx.to, path: [...task.path] });
    if (tx.to === task.packet.destination) await this._delivered(task);
    else { task.sequence = this.sequence++; this.queue.push(task); }
    return event;
  }

  async _exhausted(task) {
    const packet = task.packet;
    this.emit("failed", { packetId: packet.id, packetType: packet.type, representationId: packet.representationId, reason: `hop retries exhausted (${this.maxAttempts})` });
    const rep = this.representations.get(packet.representationId);
    if (rep && ["data", "manifest"].includes(packet.type)) {
      rep.inflight.delete(packet.id);
      await this._maybeRequestMissing(rep);
    } else if (packet.type === "missing_request" && rep) {
      rep.missingRequestPending = false;
      await this._maybeRequestMissing(rep);
    }
  }

  async _delivered(task) {
    const packet = task.packet;
    const rep = this.representations.get(packet.representationId);
    if (this.deliveredPacketIds.has(packet.id)) {
      this.emit("duplicate_ignored", { packetId: packet.id, representationId: packet.representationId });
      return;
    }
    this.deliveredPacketIds.add(packet.id);
    this.emit("packet_received", { packetId: packet.id, packetType: packet.type, representationId: packet.representationId, chunkIndex: packet.chunkIndex, at: packet.destination, path: [...task.path] });
    // The integrated app owns binary parsing, codec verification and completion
    // ACKs. Legacy fixture representations below retain their original flow.
    if (packet.external) return;
    if (packet.type === "manifest" || packet.type === "data") {
      if (!rep) return;
      if (packet.type === "manifest") rep.manifestReceived = true;
      else if (!rep.received.has(packet.chunkIndex)) rep.received.set(packet.chunkIndex, packet.payload.slice());
      rep.inflight.delete(packet.id);
      this.emit("progress", { representationId: packet.representationId, received: rep.received.size, total: rep.manifest.chunkCount, manifestReceived: rep.manifestReceived });
      await this._tryVerify(rep);
      await this._maybeRequestMissing(rep);
    } else if (packet.type === "crop_request") {
      if (this.handledCropRequests.has(packet.requestId)) {
        this.emit("duplicate_ignored", { requestId: packet.requestId, packetType: packet.type });
        return;
      }
      this.handledCropRequests.add(packet.requestId);
      this.emit("request_received", { requestId: packet.requestId, at: packet.destination });
      await this.onCropRequest?.(packet.requestId, JSON.parse(new TextDecoder().decode(packet.payload)), this);
    } else if (packet.type === "missing_request") {
      if (!rep) return;
      rep.missingRequestPending = false;
      const request = JSON.parse(new TextDecoder().decode(packet.payload));
      this.emit("missing_request_received", { representationId: packet.representationId, missing: request.missing, manifest: request.manifest });
      if (request.manifest) this.enqueue(createPacket({ id: `${rep.manifest.id}-manifest-r${rep.missingRounds}`, type: "manifest", source: rep.manifest.source, destination: rep.manifest.destination, representationId: rep.manifest.id, priority: "control", payload: { id: rep.manifest.id, kind: rep.manifest.kind, hash: rep.manifest.expectedHash, n: rep.manifest.chunkCount, bytes: rep.manifest.encodedBytes } }));
      for (const index of request.missing) this.enqueue(createPacket({ id: `${rep.manifest.id}-chunk-${index}-r${rep.missingRounds}`, type: "data", source: rep.manifest.source, destination: rep.manifest.destination, representationId: rep.manifest.id, chunkIndex: index, chunkCount: rep.manifest.chunkCount, priority: rep.manifest.kind, payload: rep.chunks[index - 1] }));
    } else if (packet.type === "receipt") {
      if (rep && rep.verified && !rep.senderConfirmed) {
        rep.senderConfirmed = true;
        this.emit("receipt_confirmed", { representationId: rep.manifest.id, at: packet.destination });
      }
    } else if (packet.type === "status_query" && rep?.verified) {
      this.enqueueControl("receipt", { representationId: rep.manifest.id, hash: rep.manifest.expectedHash }, rep.manifest.destination, rep.manifest.source, rep.manifest.id);
    }
  }

  async _tryVerify(rep) {
    if (!rep.manifestReceived || rep.received.size !== rep.manifest.chunkCount || rep.verified || rep.failed) return;
    const bytes = new Uint8Array(rep.manifest.encodedBytes);
    let offset = 0;
    for (let index = 1; index <= rep.manifest.chunkCount; index += 1) {
      const chunk = rep.received.get(index);
      if (!chunk) return;
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    if (offset !== rep.manifest.encodedBytes || !(await this.verifyRepresentation(rep.manifest, bytes))) {
      rep.failed = true;
      this.emit("failed", { representationId: rep.manifest.id, reason: "image verification failed" });
      return;
    }
    rep.verified = true;
    rep.verifiedBytes = bytes;
    this.emit("representation_verified", { representationId: rep.manifest.id, kind: rep.manifest.kind, at: rep.manifest.destination, bytes: bytes.length });
    this.enqueueControl("receipt", { representationId: rep.manifest.id, hash: rep.manifest.expectedHash }, rep.manifest.destination, rep.manifest.source, rep.manifest.id);
  }

  async _maybeRequestMissing(rep) {
    if (rep.verified || rep.failed || rep.inflight.size || rep.missingRequestPending) return;
    const missing = [];
    for (let index = 1; index <= rep.manifest.chunkCount; index += 1) if (!rep.received.has(index)) missing.push(index);
    if (!missing.length && rep.manifestReceived) return;
    if (rep.missingRounds >= this.maxMissingRounds) {
      rep.failed = true;
      this.emit("failed", { representationId: rep.manifest.id, reason: "missing-chunk rounds exhausted" });
      return;
    }
    rep.missingRounds += 1;
    rep.missingRequestPending = true;
    this.emit("missing_requested", { representationId: rep.manifest.id, missing, manifest: !rep.manifestReceived, round: rep.missingRounds, from: rep.manifest.destination });
    this.enqueueControl("missing_request", { missing, manifest: !rep.manifestReceived }, rep.manifest.destination, rep.manifest.source, rep.manifest.id);
  }

  async _runScheduled(item) {
    this.time = Math.max(this.time, item.at);
    if (item.type === "retry_ready") {
      if (!this.nodes.find((node) => node.id === item.detail.task.current)?.online && item.detail.task.current !== item.detail.task.packet.source) {
        item.detail.task.current = item.detail.task.packet.source;
        item.detail.task.path = [item.detail.task.current];
      }
      item.detail.task.sequence = this.sequence++;
      this.queue.push(item.detail.task);
      return this.emit("retry_queued", { packetId: item.detail.task.packet.id, representationId: item.detail.task.packet.representationId, attempt: item.detail.task.losses + 1 });
    }
    if (item.type === "receipt_timeout") {
      const rep = this.representations.get(item.detail.representationId);
      if (!rep || rep.senderConfirmed || rep.failed || rep.statusQueries >= 3) return this.emit("timeout_checked", { representationId: item.detail.representationId });
      rep.statusQueries += 1;
      this.enqueueControl("status_query", { representationId: rep.manifest.id }, rep.manifest.source, rep.manifest.destination, rep.manifest.id);
      this.schedule(Math.max(15, rep.manifest.chunkCount * 1.5), "receipt_timeout", { representationId: rep.manifest.id });
      return this.emit("status_requested", { representationId: rep.manifest.id, attempt: rep.statusQueries, from: rep.manifest.source });
    }
    return null;
  }

  async step() {
    if (this.activeTx) return this._finishTx();
    const task = this._nextRoutableTask();
    if (task) return this._startTx(task);
    if (this.queue.length && !this.waitingReported) {
      this.waitingReported = true;
      return this.emit("waiting_for_route", { route: null, pending: this.queue.length });
    }
    if (this.scheduled.length) return this._runScheduled(this.scheduled.shift());
    return null;
  }

  getState() {
    const representations = [...this.representations.values()].map((rep) => ({ id: rep.manifest.id, kind: rep.manifest.kind, total: rep.manifest.chunkCount, received: rep.received.size, manifestReceived: rep.manifestReceived, verified: rep.verified, senderConfirmed: rep.senderConfirmed, failed: rep.failed, missingRounds: rep.missingRounds }));
    return { time: this.time, nodes: this.nodes.map((node) => ({ ...node })), connections: getConnections(this.nodes), route: findRoute(this.nodes, "A", "D"), preset: this.preset, loss: this.loss, seed: this.seed, activeTx: this.activeTx && { from: this.activeTx.from, to: this.activeTx.to, packet: this.activeTx.task.packet, finish: this.activeTx.finish }, queueLength: this.queue.length, scheduledLength: this.scheduled.length, metrics: { ...this.metrics }, representations };
  }
}

import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_NODES, MAX_PACKET_BYTES, MeshSimulator, createPacket, findRoute, getConnections, splitBytes } from "./simulator.mjs";
import { createDemoFixtures } from "./fixtures.mjs";

async function drain(sim, limit = 3000) {
  let count = 0;
  while (count < limit && await sim.step()) count += 1;
  assert.ok(count < limit, "simulation did not settle");
  return count;
}

test("node positions and radio ranges determine links and alternate routes", () => {
  const sim = new MeshSimulator({ loss: 0 });
  assert.deepEqual(findRoute(sim.nodes, "A", "D"), ["A", "B", "C", "D"]);
  assert.ok(getConnections(sim.nodes).some(([a, b]) => a === "B" && b === "E"));
  sim.setNode("C", { online: false });
  assert.deepEqual(findRoute(sim.nodes, "A", "D"), ["A", "B", "E", "D"]);
  sim.setNode("E", { online: false });
  assert.equal(findRoute(sim.nodes, "A", "D"), null);
  sim.setNode("E", { online: true, x: 700, y: 350 });
  assert.equal(findRoute(sim.nodes, "A", "D"), null);
  assert.deepEqual(DEFAULT_NODES[2].online, true, "default topology must stay unchanged");
});

test("binary packet accounting enforces the 230-byte limit", () => {
  const full = createPacket({ id: "full", type: "data", source: "A", destination: "D", representationId: "r", priority: "preview", payload: new Uint8Array(190) });
  assert.equal(full.wireBytes, MAX_PACKET_BYTES);
  assert.equal(full.bytes.length, MAX_PACKET_BYTES);
  assert.throws(() => createPacket({ id: "large", type: "data", source: "A", destination: "D", payload: new Uint8Array(191) }), /230-byte cap/);
  assert.throws(() => splitBytes(new Uint8Array(2), 191), /at most 190/);
});

test("radio preset changes future hop airtime", async () => {
  const packet = createPacket({ id: "speed", type: "data", source: "A", destination: "D", representationId: "speed-check", priority: "preview", payload: new Uint8Array(180) });
  const long = new MeshSimulator({ preset: "Long Fast", loss: 0 });
  const fast = new MeshSimulator({ preset: "Short Turbo", loss: 0 });
  long.enqueue(packet);
  fast.enqueue(packet);
  const slowHop = await long.step();
  const fastHop = await fast.step();
  assert.equal(slowHop.type, "tx_started");
  assert.ok(slowHop.airtime > fastHop.airtime);
  assert.equal(slowHop.wireBytes, fastHop.wireBytes);
});

test("repeated crop request IDs trigger the crop producer only once", async () => {
  let produced = 0;
  const sim = new MeshSimulator({ loss: 0, onCropRequest: () => { produced += 1; } });
  sim.enqueueControl("crop_request", { requestId: "same", bounds: [0, 0, 1, 1] }, "D", "A", "", "same");
  sim.enqueueControl("crop_request", { requestId: "same", bounds: [0, 0, 1, 1] }, "D", "A", "", "same");
  await drain(sim);
  assert.equal(produced, 1);
  assert.ok(sim.events.some((event) => event.type === "duplicate_ignored"));
});

test("preview, reverse crop request, missing chunks, and receipt survive seeded 20% loss", async () => {
  const fixtures = await createDemoFixtures();
  const sim = new MeshSimulator({ loss: 0.2, seed: 16, onCropRequest: (_id, _payload, engine) => engine.enqueueRepresentation(fixtures.crop.manifest, fixtures.crop.chunks) });
  sim.enqueueRepresentation(fixtures.preview.manifest, fixtures.preview.chunks);
  sim.enqueueRepresentation(fixtures.background.manifest, fixtures.background.chunks);
  for (let i = 0; i < 2000 && !sim.representations.get(fixtures.preview.manifest.id).verified; i += 1) await sim.step();
  assert.equal(sim.representations.get("trail-preview").verified, true);
  sim.requestCrop();
  await drain(sim);
  const crop = sim.representations.get("trail-sign-crop");
  assert.equal(crop.received.size, fixtures.crop.chunks.length);
  assert.equal(crop.verified, true);
  assert.equal(crop.senderConfirmed, true);
  assert.ok(crop.missingRounds > 0, "receiver should request a missing chunk in this seeded run");
  assert.ok(sim.events.some((event) => event.type === "hop_lost"));
  assert.ok(sim.events.some((event) => event.type === "request_received"));
  assert.ok(sim.events.some((event) => event.type === "missing_request_received"));
  assert.ok(sim.events.some((event) => event.type === "receipt_confirmed" && event.representationId === crop.manifest.id));
  const requestArrival = sim.events.findIndex((event) => event.type === "request_received");
  const laterData = sim.events.slice(requestArrival + 1).filter((event) => event.type === "tx_started" && event.packetType === "data");
  assert.equal(laterData[0].representationId, crop.manifest.id, "requested crop should outrank queued background data");
  assert.ok(sim.events.filter((event) => event.type === "tx_started").every((event) => event.wireBytes <= MAX_PACKET_BYTES));
  assert.ok(sim.metrics.transmittedBytes > fixtures.crop.sourceBytes.length);
  assert.ok(sim.metrics.airtimeSeconds > 0);
});

test("a relay outage uses E and keeps already received chunks", async () => {
  const { preview } = await createDemoFixtures();
  const sim = new MeshSimulator({ loss: 0 });
  sim.enqueueRepresentation(preview.manifest, preview.chunks);
  for (let i = 0; i < 100 && sim.representations.get(preview.manifest.id).received.size === 0; i += 1) await sim.step();
  const receivedBefore = sim.representations.get(preview.manifest.id).received.size;
  assert.ok(receivedBefore > 0);
  sim.setNode("C", { online: false });
  assert.deepEqual(findRoute(sim.nodes, "A", "D"), ["A", "B", "E", "D"]);
  await drain(sim);
  assert.equal(sim.representations.get(preview.manifest.id).verified, true);
  assert.ok(sim.events.some((event) => event.type === "tx_started" && event.route?.includes("E")));
  assert.ok(sim.representations.get(preview.manifest.id).received.size >= receivedBefore);
});

test("complete disconnection waits without delivery, then resumes", async () => {
  const { preview } = await createDemoFixtures();
  const sim = new MeshSimulator({ loss: 0 });
  sim.enqueueRepresentation(preview.manifest, preview.chunks);
  sim.setNode("C", { online: false });
  sim.setNode("E", { online: false });
  assert.equal(findRoute(sim.nodes, "A", "D"), null);
  for (let i = 0; i < 10; i += 1) if (!(await sim.step())) break;
  assert.equal(sim.representations.get(preview.manifest.id).senderConfirmed, false);
  assert.ok(sim.events.some((event) => event.type === "waiting_for_route"));
  sim.setNode("E", { online: true });
  await drain(sim);
  assert.equal(sim.representations.get(preview.manifest.id).verified, true);
  assert.equal(sim.representations.get(preview.manifest.id).senderConfirmed, true);
});

test("a lost final receipt cannot confirm the sender; a status query recovers it", async () => {
  const { preview } = await createDemoFixtures();
  const sim = new MeshSimulator({ loss: 0.2, seed: 7 });
  let firstReceiptId;
  sim.random = () => {
    const started = sim.events.at(-1);
    if (started?.type === "tx_started" && started.packetType === "receipt") {
      firstReceiptId ??= started.packetId;
      if (started.packetId === firstReceiptId) return 0;
    }
    return 0.99;
  };
  sim.enqueueRepresentation(preview.manifest, preview.chunks);
  let sawVerified = false;
  for (let i = 0; i < 500; i += 1) {
    const event = await sim.step();
    if (!event) break;
    if (sim.representations.get(preview.manifest.id).verified) sawVerified = true;
    if (sim.events.some((item) => item.type === "hop_lost" && item.packetId === firstReceiptId)) {
      assert.equal(sim.representations.get(preview.manifest.id).senderConfirmed, false);
      break;
    }
  }
  assert.equal(sawVerified, true);
  await drain(sim);
  assert.ok(sim.events.some((event) => event.type === "status_requested"));
  assert.equal(sim.representations.get(preview.manifest.id).senderConfirmed, true);
});

test("100% loss stops after bounded attempts without a false receipt", async () => {
  const { preview } = await createDemoFixtures();
  const sim = new MeshSimulator({ loss: 1, maxAttempts: 2, maxMissingRounds: 1 });
  sim.enqueueRepresentation(preview.manifest, preview.chunks);
  await drain(sim, 1000);
  const rep = sim.representations.get(preview.manifest.id);
  assert.equal(rep.senderConfirmed, false);
  assert.equal(rep.verified, false);
  assert.equal(rep.failed, true);
  assert.ok(sim.events.some((event) => event.type === "failed"));
});

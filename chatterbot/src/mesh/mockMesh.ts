import type { DeliveryStats, Transit } from './types'

// Stand-in for the real mesh simulation: walks each packet of a message hop by
// hop, losing packets at random and resending them, then walks the ACK back.

export const PACKET_BYTES = 230
const HEADER_BYTES = 16
const ACK_BYTES = 16
const LOSS_RATE = 0.2 // per hop, per try
const MAX_TRIES = 5 // Meshtastic's limit for direct messages
const RESEND_TIMEOUT_MS = 700
const CONTENTION_MS = [600, 1500] // rebroadcast wait range per packet

export const CODEC2_BPS = 700
// Codec2 700C payload size for a clip of `durationMs`.
export const voiceBytes = (durationMs: number) => Math.ceil(((durationMs / 1000) * CODEC2_BPS) / 8)

export const packetCount = (bytes: number) => Math.max(1, Math.ceil(bytes / PACKET_BYTES))

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Airtime for `packets` packets of `bytes` each, plus contention / rebroadcast delay.
// kbps is bits per millisecond, so bits / kbps = ms.
const airtimeMs = (bytes: number, kbps: number) => ((bytes + HEADER_BYTES) * 8) / kbps
const hopMs = (bytes: number, packets: number, kbps: number) =>
  Math.round(
    packets * (airtimeMs(bytes, kbps) + CONTENTION_MS[0] + Math.random() * (CONTENTION_MS[1] - CONTENTION_MS[0])),
  )
const meanHopMs = (bytes: number, packets: number, kbps: number) =>
  packets * (airtimeMs(bytes, kbps) + (CONTENTION_MS[0] + CONTENTION_MS[1]) / 2)

const randomSnr = () => Math.round((Math.random() * 14 - 4) * 10) / 10

// Walks one phase hop by hop with loss and resends.
// Returns the hop index it got stuck on, or null if every hop got through.
async function runHops(
  phase: Transit['phase'],
  hops: number,
  tryMs: () => number,
  etaFor: (hop: number) => number,
  onTransit: (t: Transit) => void,
  onLoss: () => void = () => {},
) {
  for (let hop = 0; hop < hops; hop++) {
    for (let attempt = 1; ; attempt++) {
      const attemptMs = tryMs()
      const transit = { phase, hop, hops, attempt, attemptMs, lost: false, etaMs: etaFor(hop) }
      onTransit(transit)
      await sleep(attemptMs)

      if (Math.random() >= LOSS_RATE) break
      onLoss()
      onTransit({ ...transit, lost: true })
      if (attempt >= MAX_TRIES) return hop
      await sleep(RESEND_TIMEOUT_MS)
    }
  }
  return null
}

type SendCallbacks = {
  onTransit: (t: Transit) => void
  onChunk?: (received: number) => void // another packet reached the recipient
  onArrive: (stats: DeliveryStats) => void
  onDelivered: () => void
  onFailed: (reason: string) => void
}

export async function simulateSend(route: string[], bytes: number, kbps: number, cb: SendCallbacks) {
  const hops = route.length - 1
  const packets = packetCount(bytes)
  const perPacketBytes = Math.min(bytes, PACKET_BYTES)
  const avgPacketHop = meanHopMs(perPacketBytes, 1, kbps)
  const avgAck = meanHopMs(ACK_BYTES, 1, kbps)
  const start = performance.now()
  let resends = 0

  // Packets go one at a time across every hop, so the recipient gets them
  // progressively (e.g. a voice note becomes playable chunk by chunk).
  for (let packet = 0; packet < packets; packet++) {
    const stuck = await runHops(
      'forward',
      hops,
      () => hopMs(perPacketBytes, 1, kbps),
      (hop) => ((packets - packet) * hops - hop) * avgPacketHop + hops * avgAck,
      (t) => cb.onTransit({ ...t, packet, packets }),
      () => resends++,
    )
    if (stuck !== null) {
      const which = packets > 1 ? `packet ${packet + 1} of ${packets} ` : ''
      cb.onFailed(`Not delivered · ${which}lost at hop ${stuck + 1} after ${MAX_TRIES} tries`)
      return
    }
    cb.onChunk?.(packet + 1)
  }

  cb.onArrive({
    route,
    packets,
    bytes,
    transitMs: Math.round(performance.now() - start),
    snr: randomSnr(),
    resends,
  })

  const stuckAck = await runHops(
    'ack',
    hops,
    () => hopMs(ACK_BYTES, 1, kbps),
    (hop) => (hops - hop) * avgAck,
    cb.onTransit,
  )
  if (stuckAck !== null) {
    // The recipient may well have it, but we can't confirm that.
    cb.onFailed(`Not confirmed · no ACK after ${MAX_TRIES} tries`)
    return
  }
  cb.onDelivered()
}

type PullCallbacks = {
  onTransit: (t: Transit) => void
  onArrive: () => void
  onFailed: (reason: string) => void
}

// Receiver asks the sender for `bytes` more data: a small request travels back
// along the route, then the data comes forward. `route` is sender → receiver.
export async function simulatePull(route: string[], bytes: number, kbps: number, cb: PullCallbacks) {
  const hops = route.length - 1
  const packets = packetCount(bytes)
  const perPacketBytes = Math.min(bytes, PACKET_BYTES)
  const avgRequest = meanHopMs(ACK_BYTES, 1, kbps)
  const avgData = meanHopMs(perPacketBytes, packets, kbps)

  const stuckRequest = await runHops(
    'request',
    hops,
    () => hopMs(ACK_BYTES, 1, kbps),
    (hop) => (hops - hop) * avgRequest + hops * avgData,
    cb.onTransit,
  )
  if (stuckRequest !== null) {
    cb.onFailed(`Request lost at hop ${stuckRequest + 1} after ${MAX_TRIES} tries`)
    return
  }

  const stuckData = await runHops(
    'data',
    hops,
    () => hopMs(perPacketBytes, packets, kbps),
    (hop) => (hops - hop) * avgData,
    cb.onTransit,
  )
  if (stuckData !== null) {
    cb.onFailed(`Not received · lost at hop ${stuckData + 1} after ${MAX_TRIES} tries`)
    return
  }
  cb.onArrive()
}

// Expected time for a pull, including the average cost of 20% loss.
export function estimatePullMs(bytes: number, hops: number, kbps: number) {
  const packets = packetCount(bytes)
  const clean = hops * (meanHopMs(ACK_BYTES, 1, kbps) + meanHopMs(Math.min(bytes, PACKET_BYTES), packets, kbps))
  const expectedTries = 1 / (1 - LOSS_RATE)
  return clean * expectedTries + 2 * hops * (expectedTries - 1) * RESEND_TIMEOUT_MS
}

// Stats for messages that were already delivered before the demo starts.
export function pastStats(route: string[], bytes: number, kbps: number): DeliveryStats {
  const hops = route.length - 1
  const packets = packetCount(bytes)
  const resends = Math.random() < 0.3 ? 1 : 0
  return {
    route,
    packets,
    bytes,
    transitMs: hops * hopMs(Math.min(bytes, PACKET_BYTES), packets, kbps) + resends * RESEND_TIMEOUT_MS,
    snr: randomSnr(),
    resends,
  }
}

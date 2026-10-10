// Approximate pre-request cost; measured byte counts replace it after encoding.
// Native image packets carry up to 174 B; application headers and modeled radio framing add up to 80 B.
export const packetCount = (bytes: number) => Math.max(1, Math.ceil(bytes / 174))
export const estimatePullMs = (bytes: number, hops: number, kbps: number) => {
  const packets = packetCount(bytes)
  return ((bytes + packets * 80 + 13 * 130) * 8 / kbps + (packets + 13) * 120) * Math.max(1, hops) / 0.8
}

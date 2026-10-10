// Mesh delivery stats for a message, known once it reaches the recipient.
export type DeliveryStats = {
  route: string[] // node IDs from sender to recipient, inclusive
  packets: number // LoRa packets (~230 B each) the message was split into
  bytes: number // bytes on air, before per-packet headers
  transitMs: number // first packet sent → last packet received
  snr?: number // SNR of the final hop, dB
  resends: number // packets resent after loss on the way
}

// Live progress of a message still in flight.
export type Transit = {
  route?: string[] // current phase route, including topology changes
  // send: message heading out, then ACK coming back
  // pull: request heading to the sender, then data coming back
  phase: 'forward' | 'ack' | 'request' | 'data'
  hop: number // 0-based hop index within the phase
  hops: number
  attempt: number // 1-based try for this hop
  attemptMs: number // how long this try takes on air
  lost: boolean // this try's packet was lost
  waiting?: boolean
  etaMs: number | null // rough estimate until the ACK is back
  packet?: number // 0-based packet being forwarded, for multi-packet sends
  packets?: number
}

export type Delivery =
  | { status: 'sending'; transit: Transit | null }
  | { status: 'delivered' } // explicit ACK received from the recipient
  | { status: 'failed'; reason: string }

// Recorded voice note. The server encodes Opus; the recipient plays only the
// decoded, verified bytes that crossed the mesh.
export type VoiceNote = {
  durationMs: number
  levels: number[] // 0–1 waveform bars for display
  bytes?: number
  audioUrl?: string
}

// An area of an image the receiver asked to sharpen. Coordinates are 0–1 fractions.
export type Region = {
  id: string
  x: number
  y: number
  w: number
  h: number
  bytes?: number // encoded size of the sharp crop; undefined while estimating
  status: 'selected' | 'pulling' | 'done' | 'failed'
  transit?: Transit | null
  reason?: string
  received?: number
  total?: number
}

// Image sent as a tiny preview first; the receiver pulls sharp regions on demand.
export type ImageNote = {
  src: string // sender-only source thumbnail
  aspect: number // width / height
  previewSrc: string // what actually crossed the mesh
  previewBytes: number
  previewSize: [number, number] // px
  fullBytes: number // conservative whole-image detail budget before crop encoding
  imageId: string
  envelope: {preview: {manifest: string; packets: string[]}}
  tiles: {id: string; x: number; y: number; w: number; h: number; src: string}[]
  regions: Region[]
}

export type Message = {
  example?: boolean
  id: number
  from: string
  text: string
  voice?: VoiceNote
  image?: ImageNote
  sentAt: Date
  route: string[]
  delivery: Delivery
  packets?: number // LoRa packets the message was split into
  received?: number // packets that have reached the recipient so far
  stats?: DeliveryStats // set when the whole message reaches the recipient
}

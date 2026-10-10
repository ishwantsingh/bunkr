# ColHack Mesh: project context

Background for the UI. The mesh simulation and codecs are built separately; this file covers what the UI has to show and why.

## The brief (CHRP Track: Off-Grid Everything)

CHRP is building a pouch that turns an iPhone into a LoRa mesh radio. The task is to build software that sends **text, voice and video** across a **simulated mesh** of 5 or more nodes:

- **Simulate the mesh:** nodes on a map, each relaying packets, with realistic data rates, packet loss and range.
- **Squeeze the media:** speech codecs, tiny thumbnails, keyframes, or an AI-generated description that is rebuilt into an image on the other end. Split everything into packets of about 230 bytes.
- **Survive the network:** ACKs, resending missing chunks, error correction and reassembly. A message must arrive whole even with 20% packet loss across 3 hops.
- **Be honest with the user:** show what has arrived, what is still in transit, the route it took and the time remaining. Never say "delivered" when it wasn't.

**Demo that wins:** a voice note and an image sent across a 5-node mesh with packet loss. Judges score media delivered per byte, recovery from loss, and **how honest the delivery status is**.

## Meshtastic facts that matter

| Thing | Value |
|---|---|
| Max payload per LoRa packet | 239 B (the brief says ~230 B) |
| Header | dest + sender (4 B each), 32-bit packet ID, hop limit (3 bits), want-ack, channel hash, next-hop byte |
| Hop limit | default 3, max 7 (3 hops reaches 5 nodes counting the sender) |
| Retries | broadcast: 3 sends in total; direct message: 5 sends in total, then failure |
| Routing | managed flooding. Every node rebroadcasts unless it already heard someone else do it. Farther nodes (low SNR) rebroadcast first. DMs learn a fixed next-hop after the first success. |
| Max text in the iOS app | 200 B |

### Modem presets (data rate)

| Preset | Rate | Notes |
|---|---|---|
| Short Turbo | 21.88 kbps | fastest; the "~22 kbps" in the brief |
| Short Fast | 10.94 kbps | |
| Short Slow | 6.25 kbps | |
| Medium Fast | 3.52 kbps | |
| Medium Slow | 1.95 kbps | |
| Long Fast | 1.07 kbps | Meshtastic default |
| Long Moderate | 0.34 kbps | longest range |

### Two kinds of ACK (the core of "honest status")

- **Implicit ACK:** the sender hears a neighbour rebroadcast the packet. This only means it is **on the mesh**, not that the recipient got it.
- **Explicit ACK:** the recipient sends an ACK back. This is the only thing that means **delivered**.

The official iOS app separates these states:

| State | Icon | Colour |
|---|---|---|
| Sending | clock | orange |
| Delivered to mesh (implicit) | checkmark | gray |
| Delivered to recipient (explicit) | checkmark | gray |
| Relayed, not confirmed by recipient | exclamation, can retry | orange |
| Failed after retries | exclamation | orange |
| Too large / key mismatch | x | red |

## Back-of-envelope numbers

- **20% loss over 3 hops:** one packet survives with probability 0.8³ ≈ **51%** without retries. Chunk-level resends and FEC are mandatory.
- **Voice:** Codec2 runs at 3200 down to 450 bps. At **700 bps**, 1 s of speech is about 88 B, so a 10 s voice note is about 875 B, or **4–5 packets** before overhead. Raw audio would be hundreds of packets.
- **Image:** a 64×64 WebP/AVIF thumbnail is about 1–2 KB, or **5–9 packets**. An AI caption ("person standing by red car at dusk") is about 40 B, or **1 packet**, and can arrive first.
- **Airtime:** a 239 B packet takes about 0.1 s at Short Turbo and about 1.8 s at Long Fast, per hop.

## What the UI should show (design notes)

1. **Per-message status:** queued → sending → on mesh (implicit) → partially received (n/N chunks) → delivered (explicit ACK) / failed. Use different visuals for "on mesh" and "delivered".
2. **Chunk progress:** a segmented bar or dot grid with one cell per 230 B chunk. Show arrived, in flight and missing/resending for each chunk.
3. **Route:** the hop path (A → C → D → B) with per-hop SNR, taken from traceroute-style data.
4. **ETA:** remaining chunks × airtime per hop × hops, plus a retry allowance. Show it as a range, not a promise.
5. **Progressive media:** show the AI caption first, then a blurry thumbnail, then a sharper one. A voice note can be played back partially, showing which seconds have arrived.
6. **Byte budget:** show bytes sent against the original size (for example "1.2 KB of 2.4 MB, 99.95% smaller"), since judges score media per byte.

## Sources

- https://meshtastic.org/docs/overview/radio-settings/
- https://meshtastic.org/docs/overview/mesh-algo/
- https://meshtastic.org/docs/software/apple/user/messages/
- https://meshtastic.org/docs/software/android/user/messages-and-channels/
- https://en.wikipedia.org/wiki/Codec_2
- https://github.com/voicetastic/voicetastic-core/wiki/Voice-Protocol

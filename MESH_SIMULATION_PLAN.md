# Mesh simulation plan

**Integration status:** This branch's engine is now shared by the messaging app and
the standalone network demo. It relays actual text, Opus voice, preview and crop
frames, including reverse requests and verified receipt ACKs. The canonical engine
is `bunkr/ui/mesh/simulator.mjs`; `mesh-ui/simulator.mjs` re-exports it.

The standalone fixture demo retains its original 230-byte envelope format. The
integrated messaging app preserves the established 220-byte application contract
and accounts for 33–34 bytes of protobuf/encryption/radio reserve per hop. These
are separate formats; the app does not nest one inside the other.

This is a deterministic software model, not Meshtastic firmware emulation.
See [demo controls and limitations](docs/UI_MOCK.md).

## Build in small, visible steps

| Step | What we build | What you will see |
| --- | --- | --- |
| **1. Define the five nodes** | Each node has an **ID** (A–E), **position** (x, y), **radio range**, and **online/offline** state. A is the sender; D is the receiver. | The map draws nodes from data. Changing a position moves its circle. |
| **2. Calculate connections** | Two online nodes connect when each is within the other's radio range. | Reachable links appear or disappear as nodes move. |
| **3. Find a route** | Find a connected path from A to D, then recalculate when a node goes offline. | The active route lights up, changes to an alternate path, or says “waiting for route.” |
| **4. Move one sample packet** | Send one packet along the route, one hop at a time. | You watch the packet travel between circles and see each hop in the timeline. |
| **5. Add speed and loss** | Use the selected radio speed to set time per hop. Apply the selected loss rate separately at each hop. | The packet moves at the chosen speed; a failed hop appears on the map. |
| **6. Send image chunks** | Accept image packets from the media owner and move them through the same mesh. | Received, in-transit, and missing chunk counts update. |
| **7. Recover missing chunks** | D requests missing chunks; A retries those chunks, with an attempt limit. | The request travels back through the mesh, and retries appear on the map. |
| **8. Confirm delivery** | D verifies the complete image and sends a receipt back to A. | The sender shows “delivered” only after that receipt reaches A. |

Speed and loss are **scenario settings**, not fields required on every node.
Use Meshtastic radio presets for speed options and a configurable loss rate;
start the demo at 20% loss with a fixed random seed so it can be replayed.

## Rules to keep throughout

- Follow the packet contract agreed with the media and app owners in
  `IMPLEMENTATION_PHASES.md`, using [Meshtastic's mesh packet documentation](https://meshtastic.org/docs/overview/mesh-algo/)
  as the reference. Every serialized data, request, and receipt packet must fit
  within the hackathon's **230-byte limit**.
- Count time and bytes for **every hop**, including retries and control
  packets. A simple shared radio queue is enough for the first version.
- Keep the map's **simulator truth** separate from what the phones know. The
  map can show a lost packet immediately; A learns of failure only through a
  timeout or a message returned through the mesh.
- If no route exists, keep received chunks and show “waiting for route” with
  unknown arrival time. Resume when a route returns.
- Person 3 decides when the received image passes verification. Only then may
  D send the completion receipt. A cannot claim delivery before receiving it.

## References

- [Meshtastic mesh algorithm](https://meshtastic.org/docs/overview/mesh-algo/) — packet relaying and acknowledgments.
- [Meshtastic radio settings](https://meshtastic.org/docs/overview/radio-settings/) — speed presets and their range tradeoff.

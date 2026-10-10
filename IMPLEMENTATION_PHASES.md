# Implementation phases

**A photo arrives as a tiny preview. Tap the unreadable trail sign, and the
network prioritizes that crop.**

This plan implements the [README](README.md): recipient-directed image delivery
for the CHRP Off-Grid Everything track. Start with the media contract, develop
media handling and mesh simulation simultaneously on separate branches, then
integrate the app. These are delivery phases, not three serial work periods.

The current implementation is software only and now covers images, text and voice
notes. The text/voice extension includes formats, compression, display/playback and
packet/ACK integration with the existing browser mock transport. See
[TEXT_VOICE.md](docs/TEXT_VOICE.md). Video, cloud services, generative image
reconstruction and physical radio integration remain outside this scope. Realistic
mesh simulation and independent persistent endpoints remain unfinished.

| Phase | Owner | Proposed branch | Demo result |
|---|---|---|---|
| **1. Media handling** | Person 3 | `codex/media-handling` | A tiny preview arrives; a requested crop from the source photo arrives intact and makes the sign readable. |
| **2. Mesh simulation** | Person 2 | `codex/mesh-simulation` | The crop request travels back across five virtual nodes, changes transmission priority, and survives loss and interruption. |
| **3. App interface** | Person 1 | `codex/app-interface` | Judges select the sign and see its detail arrive, alongside the route, packet progress, wait estimate, and honest receipt status. |

## Shared contract: agree at the start of Phase 1

Commit the contract and fixtures to the common base before splitting branches.
Define these together so the two implementations can be tested independently:

- **Representation manifest:** source image ID, representation ID, sender,
  recipient, kind (preview, crop, or full image), codec, dimensions, encoded byte
  count, chunk count, and expected content hash. A crop also carries its request
  ID and bounds in the source image.
- **Crop request:** request ID, image ID, recipient, selected bounds, and desired
  detail. Use normalized bounds against the orientation-corrected source image;
  define validation and conversion so a displayed tap selects the right pixels.
  Support additional regions and requests for full-image detail.
- **Packet:** image ID, representation ID, chunk index/count, payload, and
  integrity information. Set a serialized application packet cap of approximately
  230 bytes or less, reserving space for headers and integrity fields. Keep
  requests and acknowledgments compact and within the agreed limit too.
- **Scheduling metadata:** control traffic and requested crops take precedence
  over background refinement, with fair service among active transfers. Priority
  changes take effect after the current packet finishes. Define preview ordering
  and dependencies so the preview is usable before crop interaction begins.
- **Recovery and completion:** identify missing chunks and acknowledgments by
  representation. Distinguish hop acknowledgments from verified receiver
  completion. Deduplicate repeated requests, chunks, and completion acknowledgments.
- **Events and metrics:** request queued/received, transmitted/received/missing
  chunks, retries, observed hops, route availability, local verification, sender
  confirmation, stalled/failed states, bytes, and simulated airtime. Separate
  simulator-wide observations from each phone's packet-derived knowledge.

Media owns source retention, encoding, cropping, chunking, reconstruction, and
verification. Mesh owns transport, routing, scheduling, airtime, retries, and
acknowledgment delivery. The app maps user selection to a request and displays
the evidence each endpoint actually has.

## Phase 1: Media handling

**Owner:** Person 3

**Branch:** `codex/media-handling`

**Implementation status:** Media pipeline, version 2 wire contract, real NPS trail-sign fixture, offline acceptance demo, and automated media tests are implemented on this branch. See [MEDIA_CONTRACT.md](docs/MEDIA_CONTRACT.md) for API boundaries, protocol layout, scheduling handoff, measured codec results and reproduction. The official Meshtastic SDK/protobuf adapter uses private application port 256; [MESHTASTIC.md](docs/MESHTASTIC.md) records upstream reuse and the Meshtasticator handoff. Shared artifacts are on this branch; they have not been committed to or merged into the common base.

1. Retain the source photo locally and generate a tiny, independently decodable
   preview. Evaluate JPEG and WebP against measured byte budgets.
2. When a crop request reaches the sender, automatically extract and encode
   higher-detail pixels from that source. No second photo or manual resend is
   needed. All displayed detail comes from the original photo.
3. Encode each preview, crop, or requested full-image rendition separately. Split
   it into numbered packets and reconstruct it despite reordered or duplicate
   chunks. Keep overlapping requests unambiguous through representation IDs.
4. Verify the reconstructed encoded bytes against the expected hash before
   publishing completion. Cache completed representations and received chunks;
   retain partial progress through interruptions and reuse identical requests.
5. Provide the decoded crop and source bounds so the app can overlay it precisely
   on the preview. Hash verification proves transfer integrity, not scene truth.

**Checks:** packet-size limits, exact reconstruction of encoded bytes, missing
and corrupt chunks, duplicates and reordering, overlapping/repeated requests,
coordinate mapping including rotated images and image edges, and cache reuse.
Use a real trail-sign fixture: the preview must hide the lettering while the
requested source crop makes it readable. Record encoded sizes and codec settings.

**Demo gate:** preview first, then an independently verified readable crop at the
correct location. Unrequested regions may remain blurry; full-image completion
is not a prerequisite.

## Phase 2: Mesh simulation, developed alongside Phase 1

**Owner:** Person 2

**Branch:** `mesh-simulation`

Begin immediately after the shared contract exists, using fixture packets and a
stub crop producer while media handling develops.

1. Model at least five nodes, radio presets, range, shared-channel airtime,
   contention, queues, packet loss, and multi-hop relaying. The intended model is
   phones connected to CHRP accessories using LoRa between accessories.
2. Transport crop requests back to the sender through the same constrained mesh.
   Only a received request triggers crop generation and scheduling. Count request,
   acknowledgment, relay, retry, and redundancy traffic in time and byte totals.
3. Prioritize control traffic and requested crops ahead of queued background
   refinement after the current packet completes. Preserve fair scheduling among
   active transfers so repeated requests cannot starve them indefinitely.
4. Selectively retransmit missing chunks with bounded retries. Evaluate a small
   amount of erasure-correction redundancy against retransmission alone, recording
   its byte cost and recovery benefit.
5. Preserve received chunks when a route disappears and resume over an available
   route without restarting the representation. Expose waiting, stalled, and
   failed states, plus explicit retry/expiry rules.
6. Return a representation-specific completion acknowledgment only after media
   verification. If it is lost, retry confirmation without requiring an already
   verified crop to be retransmitted in full.

**Checks:** repeatable loss scenarios, three-hop transfer with 20% loss per hop,
reverse-path requests, packet-boundary priority changes, fairness, selective
retransmission, relay removal and alternate routing, retained chunks, retry
exhaustion, and lost final acknowledgments. Assert that sender confirmation
cannot precede receipt of the completion acknowledgment.

**Demo gate:** a crop request changes what the network transmits next; the crop
arrives despite loss and an interrupted route. Disconnection never produces a
fabricated countdown or success event.

## Phase 3: App interface and integration

**Owner:** Person 1

**Branch:** `app-interface`

**Mock status:** The requested three-panel interactive mock is available locally; see [UI_MOCK.md](docs/UI_MOCK.md). It uses real media bytes and verified progressive tiles, with a deliberately simplified visual transport model. The complete Phase 2 transport and Phase 3 integrated acceptance gates remain outstanding.

Build an iPhone-style sender and recipient interface alongside the five-node map.
Person 1 can prepare it against event fixtures during the parallel work.

1. Let the sender choose and send a photo. Display the recipient's verified tiny
   preview immediately, without implying that the full image has arrived.
2. Let the recipient tap a region, adjust its bounds, and request desired detail.
   Show the request traveling back, then the crop gaining transmission priority.
   Allow another region or more detail across the whole image to be requested.
3. Overlay only a completed, verified crop at its matching preview location.
   Keep received and missing chunks, packet paths, retries, and per-representation
   progress visible while it arrives.
4. Show a time range based on observed conditions. Show arrival time as unknown
   while no route exists. Clearly distinguish the simulator's complete map view
   from information learned by each phone through packets.

Track preview, each crop, and any full-image rendition separately:

| State | Evidence and display rule |
|---|---|
| Preview received | The recipient has verified the preview; other detail may still be absent. |
| Crop requested | The request is queued or in transit; the sender may not know about it. |
| Detail arriving | Some crop chunks have arrived, but the crop is incomplete. |
| Crop verified locally | The recipient has reconstructed and checked the crop; confirmation may still be in transit. |
| Receipt confirmed | The sender has received completion acknowledgment for that specific representation. |
| Waiting for a route | Transmission cannot progress and arrival time is unknown. |
| Stalled or failed | Progress has stopped or the configured retry/expiry limit was reached; show the reason. |

A preview acknowledgment never confirms the full photo. Dropping the final crop
acknowledgment must leave the recipient's verified detail visible while the
sender remains unconfirmed.

**Demo gate:** select the unreadable sign, watch its request and prioritized
packets cross the mesh, and read the verified crop. Demonstrate relay removal,
alternate-route recovery, lost confirmation, and complete disconnection.

## Integrated acceptance and comparison

Use the same source photos, codec settings, radio model, and reproducible loss
scenarios to compare recipient-directed delivery with sequential full-image
delivery. Include a three-hop path with 20% packet loss per hop and an alternate
path for the interruption test. Keep lower-priority detail queued when the sign
is selected so the priority change is observable.

Report time to preview, selection-to-readable-detail time including the request
round trip, total transmitted bytes and airtime including all control traffic,
relays and retries, and completion rate for requested representations. Apply the
same readable-detail criterion to both approaches and record crop bounds, codec
settings, and scenario seeds. Report measured tradeoffs; small crops are not
assumed to be faster in every scenario.

Run automated checks for media reconstruction, transport recovery and priority,
and acknowledgment-driven UI states, plus an end-to-end trail-sign scenario.
Document how to reproduce the demo, interruption cases, and benchmark results.

## Branch and merge sequence

1. Agree and commit the shared contract, packet limits, event fixtures, and sample
   image/representation fixtures to the common base. Assign Person 3 ownership of
   the shared media schema, with Person 2 reviewing transport constraints.
2. Branch media and mesh independently from that base. Keep implementations and
   tests in separate module areas; exchange contract changes through the common
   base rather than depending on either unfinished branch. Person 1 owns the UI.
3. Merge media first, then mesh, and run integrated preview-request-crop tests
   before app integration. Both branches must already pass their fixture checks.
4. Integrate the app, run the complete acceptance scenarios and comparison, and
   document the measured results and remaining simulator limitations.

Phase 1 media handling is implemented on `codex/media-handling`. An interactive UI mock is available. The full mesh
simulator, production app integration, integrated radio scenarios and comparison
benchmarks remain planned work; the media demo does not claim those gates are complete.

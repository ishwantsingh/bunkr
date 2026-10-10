# Media contract, version 2

Implementation: `imageoverbt/contract.py`, `media.py`, `events.py`. Python 3.11+
and Pillow are the only runtime requirements. Mesh scheduling and the app are
consumers of this module, and are not implemented here.

## Wire layout

All integers use network byte order. Frames contain a uint8 version (`2`), a
uint8 type, a binary body, then uint32 CRC32 over version/type/body. Maximum
**serialized application frame** size is 220 bytes, including integrity fields.
The official Meshtastic adapter wraps frames in `Data` protobufs on `PRIVATE_APP`
(port 256). A maximum frame encodes to 226 bytes; reserving 12 bytes for encryption
and 16 for the radio header yields 254 bytes before LoRa PHY overhead. Phase 2
must count all of these bytes and their airtime. See [MESHTASTIC.md](MESHTASTIC.md).
CRC detects accidental damage, not hostile modification or sender identity.
SHA-256 checks complete encoded-image integrity, not scene truth.

IDs are 128-bit values represented in Python as 32 lowercase hex characters.
Source IDs are the first 128 bits of SHA-256 of the retained, orientation-corrected
RGB PNG. Representation IDs hash source/encoding settings, endpoints, request ID,
kind, wire version and packet cap. Version 2 replaces the local 230-byte version 1
draft; regenerate old wire fixtures. The new version rejects old wire frames and
uses distinct representation IDs while retaining reusable source/encoding caches. A full SHA-256 is retained separately for content verification. IDs are
opaque to transport. Zero request ID is reserved for previews. Endpoints are
uint32 node IDs. No strings, base64, or JSON wrappers are added on the wire.

| Type | Body, in order | Frame bytes |
| --- | --- | --- |
| 1: manifest | image ID:16, representation ID:16, sender:u32, recipient:u32, kind:u8, codec:u8, width:u32, height:u32, byte count:u64, chunk count:u32, SHA-256:32, request ID:16, bounds:4×u16, source width:u32, source height:u32 | 132 |
| 2: request | request ID:16, image ID:16, recipient:u32, bounds:4×u16, desired max dimension:u32, kind:u8 | 55 |
| 3: data | image ID:16, representation ID:16, index:u32, count:u32, payload:1–174 | 47–220 |
| 4: completion ACK | representation ID:16, recipient:u32, SHA-256:32 | 58 |
| 5: hop ACK | same as completion ACK; cannot confirm delivery | 58 |
| 6: missing chunks | representation ID:16, 1–49 missing indices:u32 | 26–218 |

Kinds: preview=0, crop=1, full=2. Codecs: JPEG=0, WebP=1. Chunk indices start at
zero. All chunks except the last have exactly 174 payload bytes. The final chunk
length follows the manifest byte count. Maximum representation size: 12 MiB;
maximum desired detail: 8192 pixels on the longest side. Manifests and requests
are validated before allocation or processing. Manifests must precede chunks;
transport retries or buffers early chunks with its own bounded policy.

## Coordinates and source retention

Bounds are `(left, top, right, bottom)` in unsigned 16-bit normalized coordinates
on the **EXIF orientation-corrected source**, with 65535 representing 1.0.
Selections must be finite, inside the image, and nonempty after quantization.
`Bounds.normalized` rounds to nearest ticks; no silent clamping occurs.
`Bounds.pixels` floors left/top and ceils right/bottom into half-open source pixel
bounds. This includes edge pixels and guarantees a nonempty crop. Both full and
preview manifests carry full-image bounds. Full-image requests must do likewise.

The app must subtract letterbox offsets and divide by rendered image dimensions
before constructing bounds. `Bounds.overlay` provides normalized display geometry;
for pixel-exact placement, compute `bounds.pixels(source_width, source_height)`
from the manifest and scale that rectangle to the displayed image. Use the same
rectangle when fitting the decoded crop. `demo-output/overlay.png` illustrates it.

Sources are retained locally as lossless oriented RGB PNGs. Metadata is stripped;
representation pixels always originate from the source, never the preview. No
upscaling is used to claim additional detail. JPEG previews are baseline;
WebP/JPEG representations are independent decodable files.

## Encoding, caching and recovery

The encoder tries quality 85, 70, 55, 40, 25, 10 at the requested dimension, then
reduces dimensions by 25% until the budget is met. It fails if even a 1×1 image
cannot fit. Both codec settings and actual encoded sizes are recorded by the demo.
The normal preview budget is 1500 bytes at at most 96 pixels. The sign acceptance
fixture uses 300 bytes to demonstrate unreadable lettering. Detail defaults to a
48000-byte ceiling. Requests communicate desired max dimension; budget and codec
are sender policy. A detail request is not a guarantee of readable text.

SQLite stores sources, encoded bytes, received chunks, verified representations,
request bindings and sender confirmations across endpoint restarts. The caller
owns endpoint database lifecycle. Identical repeated requests reuse representation
IDs and bytes; a new request ID for identical bounds reuses cached encoded bytes
but has a distinct representation. Overlapping requests remain independent.
Reusing an existing request ID with changed selection is rejected.

The receiver rejects bad CRCs, unexpected lengths/counts/image IDs and conflicting
duplicates. It preserves valid chunks after interruption. `missing()` identifies
selective retransmission needs; `missing_frames()` batches them within the cap.
After complete reconstruction it verifies SHA-256, image decoding, codec and
reported dimensions before publishing bytes or issuing completion ACKs. If the
whole-image hash fails despite valid chunk CRCs, the receiver clears chunks for
that representation and requests it again: it cannot know which chunk is bad.
Other representations survive. Transport applies bounded retry/expiry policy.

A receiver can regenerate a completion ACK from its verified cache after a lost
ACK without retransmitting the representation. Repeated data after verification
returns the same ACK. Only a matching received type-4 ACK lets the sender call
`confirm`; hop ACKs do not. This is integrity-based receipt evidence on a trusted
simulator network, not an authenticated communication protocol. Cache eviction,
quotas, encryption and physical radio integration are outside Phase 1. Until
explicit eviction, source images, partial progress and completion persist.

## Scheduling handoff to Phase 2

Transport owns queues and scheduling. Control (requests/manifests/ACKs/missing
reports) ranks before requested crops/full detail, which rank before unsolicited
background refinement. Preview is the first image transfer. Crop interaction is
enabled only after the recipient verifies its preview; unsolicited background
refinement waits for that prerequisite. Received requests alone trigger sender
crop production. A queued recipient request is not evidence the sender knows it.

Apply priority changes at packet boundaries, never within a packet. Within a
class, use round-robin service across active representations. To prevent starvation,
after eight higher-priority data packets give one waiting lower-priority data
packet a turn. Bound control bursts similarly (eight consecutive control frames
then one eligible data frame); retry storms must not starve data. The transport
implementation may revise this policy with measured evidence and contract review.
Full-image refinement and requested full-image detail are distinct queue intents,
even though both use kind=full. Manifests do not imply successful delivery.

## Events, metrics and endpoint evidence

`events.Event` is the common in-process/UI vocabulary. `time_ms` is monotonic
simulation time; `observer` is `endpoint` with the observing `node_id`, or
`simulator`. Attach image/representation/request IDs wherever applicable.
Chunk events carry chunk index, missing events carry missing indices, hop events
carry hop_from/hop_to. Waiting/stalled/failed events carry reason. An absent
route has no arrival estimate. `airtime_ms=None` means unknown, never zero.

Count serialized frame bytes for each actual transmission, including every relay,
request, manifest, ACK, retry and missing report. Count physical framing separately
when the radio model exists. Simulator-only route visibility or hop observations
must not be presented as a phone's knowledge. The media module returns verified
ACKs; transport emits `verified_locally` from that result at the recipient and
`sender_confirmed` only after `confirm()` at the sender. Media has no clock or
radio model, so the Phase 1 report contains no invented airtime or wait estimates.
`fixtures/events.json` demonstrates endpoint evidence with an initially lost ACK.

## Reproduction

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -e .
.venv/bin/python -m unittest discover -s tests -v
.venv/bin/python -m imageoverbt.demo
```

The demo runs entirely offline with the committed NPS photo. It sends the preview
and crop independently, injects duplicates/reordering/gaps, closes and reopens the
receiver, requests only missing chunks, verifies exact bytes, withholds a completion
ACK and regenerates it. Inspect `demo-output/comparison.png`, `overlay.png` and
`report.json`. Reports contain encoded sizes, codec settings, packet totals and
missing-request overhead, not a full mesh benchmark.

Measured on Pillow 12.3.0 in this workspace:

| Representation | Codec | Dimensions | Quality | Encoded bytes | Budget |
| --- | --- | --- | --- | --- | --- |
| Preview | JPEG | 12×8 | 10 | 299 | 300 |
| Preview | WebP | 54×36 | 10 | 298 | 300 |
| Sign crop | JPEG | 1024×352 | 55 | 46176 | 48000 |
| Sign crop | WebP | 1024×352 | 70 | 41854 | 48000 |

WebP preserves a larger preview and reaches higher tested crop quality under these
budgets. This is one fixture, not a general codec or transmission-speed conclusion.
Human review confirms **OAK FLAT LOOP** is readable only in the crop comparison.

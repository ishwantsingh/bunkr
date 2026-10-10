# Integrated software mesh demo

## Run

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -e ".[meshtastic]"
.venv/bin/python -m bunkr.ui_server --port 8765
```

Open http://127.0.0.1:8765. Install FFmpeg for voice. The server binds to loopback,
uses a temporary SQLite database and removes its demo state when stopped. No cloud
service or physical radio is contacted. `--source /absolute/path/photo.jpg` chooses
a local photo. See [TEXT_VOICE.md](TEXT_VOICE.md) for recording, import and playback.

## Experience

The UI is built directly from `chatterbot/src/`: its two phones, gradient/grain,
local serif fonts, bokeh background, image expansion/collapse, waveform morph,
floating mesh, hover expansion, animated gear switcher and sliding settings panel.
The earlier vanilla styling port is removed. No controls are added to the phones
beyond those in the reference. Reduced-motion preferences shorten animations.

- Either phone can type a message and press Enter or the send arrow.
- The photo icon opens a file picker; choosing a photo prepares and immediately
  queues its real preview. The recipient sees it only after reassembly,
  CRC/SHA-256 verification, decoding and dimensions checks.
- Open the received image to expand it from its thumbnail. Drag to draw one or
  more selections; each has the reference remove and render-arrow controls.
  Six independent source tiles sharpen a requested area as each verifies,
  before the full selection finishes. The rendered percentage includes pieces
  already received. Close collapses back to the thumbnail. **Render full**
  requests the entire source through the same pipeline.
- An empty composer shows the microphone. Recording morphs it into the reference
  cancel/waveform/send pill. Permission failure reports an error without making
  sample audio. The recipient's waveform shows packet progress; playback stays
  disabled until the whole Opus stream verifies and decodes.
- Hover over the floating mesh card to reveal links, live packet animations,
  loss pulses and measured statistics. Drag nodes while the map is expanded.
  The gear slides open radio preset/loss and per-node position/range/online
  settings. Its clock tab shows the real transmission timeline.
- A missing route retains progress and shows “Waiting for route” with no ETA.
  Restoring online state/range resumes the transfer. Presets and loss affect the
  actual shared engine. Seed applies on **Reset**, which clears new messages,
  selections, received URLs and packet activity and restores default node layout.
  It also cancels recordings, pending imports and queued/active transfers.

The reference's opening conversation is example content; it adds no fabricated
packet metrics. Live messages show real received bytes, packets, route and retries.
There is no simulated SNR measurement. Transfers run serially at 40× modeled time;
short on-air hops retain visible animation durations. Cost labels are approximate
pre-request estimates based on the existing six-tile, 8 KB-per-tile encoding
budget, replaced by actual encoded crop bytes after the request reaches the sender.
They include approximate framing, hops, control traffic and 20% expected loss;
actual cost depends on content and current loss. Receipt confirmation still requires the real
return ACK and server validation, independently of recipient-local verification.

## Photo import

The local upload endpoint accepts **12 MiB / 50 megapixels**. It checks actual
image content, rejects corrupt/animated files, applies EXIF orientation and
retains an orientation-corrected lossless source. Each selected photo creates
its own message and immutable image ID. Older photos and their verified detail
remain in the conversation. Invalid uploads leave existing messages intact.
Reset/unmount aborts pending uploads and ignores late results. Source images are
never used for recipient rendering: only verified preview/detail blobs appear.

`POST /api/photo` accepts binary bytes and returns the normal envelope plus an
immutable `image_id` and `source_url`. Every `POST /api/crop` explicitly supplies
that image ID, bounds and request ID. `GET /api/source.jpg?image_id=…` supplies
only the sender's thumbnail. Filename text is never used as a filesystem path.
HEIC decoding uses the installed Pillow HEIF plugin. Imports stay in the demo's
temporary local database, removed when the server stops.

## Frontend development

The existing Python endpoints, media codecs, binary contract and mesh engine
are unchanged. `chatterbot/src/mesh/runtime.mjs` connects the actual reference
components to `bunkr/ui/network.mjs` and `protocol.mjs`; mock route/timing
functions are removed. Verified tiles render immediately and independently.

With Node.js **22.12+**:

```sh
cd chatterbot
npm ci
npm run build
npm run lint
```

The build type-checks the UI and writes bundled assets to `bunkr/ui/client/`
plus the server's root `index.html`. Commit these generated assets alongside
source changes. Python wheels include them and the locally licensed fonts;
users running the Python server need neither Node.js nor internet access.
For live editing, start the Python server on 8765, then `npm run dev` in
`chatterbot/`; Vite proxies API and font requests to it.

## Engine and packet integration

The canonical engine is `bunkr/ui/mesh/simulator.mjs`, imported from branch
`mesh-simulation`. `network.mjs` adapts the existing native version-2 binary media
contract to it without replacing the content with fixture IDs or JSON wrappers.
`mesh-ui/simulator.mjs` re-exports the same engine for the standalone demo.

Application frames remain at most 220 bytes. Modeled radio accounting adds 33–34
bytes per frame for the existing protobuf/encryption/radio reserve; a full frame
therefore costs 254 radio bytes per hop. These envelopes are accounting, not
physical radio transmission. With the optional SDK installed, Python also checks
official `PRIVATE_APP` 256 protobuf serialization.

One shared radio queue gives control packets priority over detail, preview and
background traffic at packet boundaries. Transmission time is estimated as
`radio bytes × 8 / preset bitrate + 0.12 seconds`. Each frame has at most five
failed-hop attempts per round. After a stalled transfer's 15-second timeout,
missing data is requested using real binary tag-6 packets from receiver to sender;
only requested missing chunks are resent after that request arrives. Lost manifests
and controls use sender timeouts. Application recovery is bounded to three rounds.
Exhaustion reports failure and allows retry; it never becomes a delivered receipt.

## Limits and reuse

This is the branch's deterministic software model, **not Meshtastic firmware
emulation**. It uses distance-based range, BFS routing, seeded loss, approximate
preset rates and a serialized shared channel. It does not model LoRa PHY airtime,
RF propagation, collisions, duty cycles, fair scheduling, backpressure or FEC.
The UI still hosts both phones in one browser, with browser receive state in RAM.
Independent durable endpoints and the SDK bridge/firmware path remain unfinished.

The standalone fixture demo retains its separate original 230-byte envelope
contract. It is available by serving the repository root and opening
`/mesh-ui/index.html`; the integrated messaging app does not use its generated
SVG image fixtures or receipt implementation.

[Meshtastic Python](https://github.com/meshtastic/python) and generated
[protobufs](https://github.com/meshtastic/protobufs) are reused directly.
[Meshtasticator](https://github.com/meshtastic/Meshtasticator) remains a future
firmware simulation target. See [MESHTASTIC.md](MESHTASTIC.md) for attribution.

## Checks

```sh
.venv/bin/python -m unittest discover -s tests -v
node --test tests/ui/*.test.mjs mesh-ui/simulator.test.mjs
```

Checks cover native image/text/voice reconstruction over 20% per-hop loss,
reverse requests/receipts, missing-chunk recovery, bounded failure, interrupted
routes, range changes, preset timing and byte accounting, legacy inspector/stepping logic, plus the original standalone engine scenarios.
The reference adapter adds integration tests for progressive tile verification,
corruption rejection, actual text/voice transport, reverse receipts, no-route
recovery, browser fetch binding and reset cancellation. CI runs both suites.

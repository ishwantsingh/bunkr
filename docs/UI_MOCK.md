# Integrated software mesh demo

## Run

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -e ".[meshtastic]"
.venv/bin/python -m imageoverbt.ui_server --port 8765
```

Open http://127.0.0.1:8765. Install FFmpeg for voice. The server binds to loopback,
uses a temporary SQLite database and removes its demo state when stopped. No cloud
service or physical radio is contacted. `--source /absolute/path/photo.jpg` chooses
a local photo. See [TEXT_VOICE.md](TEXT_VOICE.md) for recording, import and playback.

## Experience

Sender phone → five-node mesh → recipient phone. The preview sends automatically
on first load. **Send again** repeats it; **Reset demo** resets the session.
Drag or resize the crop box and click **Request section** above the image. The
binary request crosses the reverse mesh before encoding starts. Six independent
source crops sharpen the selected region as each passes CRC, SHA-256, decoding
and dimensions checks. Previously verified sections remain visible. Arrow keys
move the box; Shift+arrows resize it.

### Import a photo

Click **Upload photo** on the sender, select a JPG, PNG, WebP or HEIC/HEIF file,
then click **Send photo**. Import prepares the source and preview locally; it does
not deliver anything to the recipient. The preview, section requests, detail tiles
and completion ACKs still cross the same mesh. Photo selection preserves existing
text/voice chat and clears the previous image's received detail and receipts.

The local upload endpoint accepts at most **12 MiB / 50 megapixels**. It checks the
actual image content, rejects corrupt or animated files, applies EXIF orientation
and retains an orientation-corrected lossless source. Portrait and landscape photos
keep their aspect ratio. The local sender display uses a JPEG thumbnail; crops
always come from the retained source, not that thumbnail or the transmitted preview.

Invalid imports leave the current photo intact. Reset cancels an in-flight import;
late upload results cannot replace the current photo. Every crop request identifies
its source explicitly. Reset keeps a successfully imported photo selected; a page
reload returns to the configured sample. Imported files live only in the demo's
temporary local database, which is removed when the server stops.

`POST /api/photo` accepts raw image bytes and returns the normal media demo envelope
plus an immutable `image_id` and `source_url`. `POST /api/crop` accepts `image_id`
with its bounds and request ID. `GET /api/source.jpg?image_id=…` serves that source's
browser thumbnail. Filename text stays in the browser and is never used as a path.
HEIC decoding uses the [Pillow HEIF plugin](https://pillow-heif.readthedocs.io/en/stable/pillow-plugin.html),
installed with the application's dependencies. Reinstall with `pip install -e .`
when updating an existing environment.

Both phones can send text and compressed Opus voice. The recipient displays or
plays only verified content. The sender confirms receipt only after the matching
application ACK crosses the mesh back to the sender and is validated by the API.

The map observes the shared `mesh-simulation` engine's actual packet events:

- Default route: A → B → C → D. **Take C offline** reroutes through B → E → D.
- Click relay nodes to toggle them. Removing B isolates A; restoring it resumes.
- Choose a relay and change its range: links require mutual range and both nodes online.
- Radio presets change modeled transmission time. Loss applies independently per hop (0–100%).
- Disconnect/pause preserves received chunks and freezes progress. No arrival promise is made without a route.
- Replay speed cycles 40× / 80× / 160×. It changes playback of simulated time, not the radio rate or measured byte counts.
- Timeline times are simulated elapsed time. Counters include every hop, retry and control packet.

## Engine and packet integration

The canonical engine is `imageoverbt/ui/mesh/simulator.mjs`, imported from branch
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
routes, range changes, preset timing and byte accounting, plus the original
standalone engine scenarios. CI runs both suites.

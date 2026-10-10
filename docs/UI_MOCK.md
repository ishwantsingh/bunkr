# Interactive UI mock

## Run

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -e ".[meshtastic]"
.venv/bin/python -m imageoverbt.ui_server --port 8765
```

Open http://127.0.0.1:8765. The server binds to loopback, uses a temporary local
SQLite database, and deletes its demo state when stopped. No cloud service or
radio is contacted. Use `--source /absolute/path/photo.jpg` for a different local
photo; Pillow must support its format. The initial selection is tuned for the
committed Oak Flat fixture. After installation, `imageoverbt-ui` is equivalent.

## Experience

The sender phone is on the left, the five-node mesh in the middle, and the
recipient phone on the right. The tiny preview automatically sends once on first
load. **Send again** repeats it; **Reset demo** returns to the manual send step.

On the recipient phone, drag the crop box or resize its corners. **Request
section** sits directly above the image. The request travels back through the
mesh before the sender extracts detail. Six independently encoded source crops
arrive and sharpen the selected region progressively. Each piece must pass packet
CRC, whole-representation SHA-256, decoding and dimensions checks before display.
Previously verified sections stay visible when another section is requested.
Keyboard: focus the box and use arrows to move; Shift+arrows resize.

The map shows packet bursts hopping between nodes, losses and selective retries.
Take B offline to switch to A → E → D. Click relay nodes to enable/disable them.
Disconnect the network to stop progress; reconnect to resume retained chunks.
Pause and speed controls change the animation; packet loss can be set from 0–40%.
No arrival countdown is shown while disconnected. Sender receipt confirmation
appears only after the application completion ACK returns.

## Reuse and scope

This is a working **visual mock**, not a completed Phase 2 firmware simulation.
It uses the actual Python media encoder, binary version 2 contract and persistent
sender cache. With the Meshtastic extra installed, every outgoing application
frame is serialized through upstream `meshtastic.protobuf.mesh_pb2.Data` on
`PRIVATE_APP` 256; sizes include the documented radio/encryption envelope reserve.
The browser independently reconstructs and verifies the actual encoded bytes.

The topology, SVG map and accelerated packet animation are local demo code.
Routing prefers A → B → C → D, then chooses an available alternate path. Loss is
seeded per hop; a missing frame retries end to end, capped at 32 attempts. At most
20 packets are animated as one burst. This model does not implement shared-channel
contention, RF range, duty-cycle limits, LoRa airtime, erasure correction or the
production scheduler. Timeline timestamps are a monotonic illustrative demo clock,
not measured RF timing. Do not interpret the animation speed as radio performance.

[Meshtastic Python](https://github.com/meshtastic/python) and its generated
[protobufs](https://github.com/meshtastic/protobufs) are reused directly.
[Meshtasticator](https://github.com/meshtastic/Meshtasticator) remains the Phase 2
firmware simulator target. The upstream [web client](https://github.com/meshtastic/web)
was reviewed; this focused two-phone mock does not need its full device-management
application. No upstream UI or simulator source is copied. See
[MESHTASTIC.md](MESHTASTIC.md) for upstream attribution and license notes.

## Checks

```sh
.venv/bin/python -m unittest discover -s tests -v
node --test tests/ui/*.test.mjs
```

Python checks cover the real crop producer, tile coverage, independently verified
reconstruction and completion acknowledgments. Node checks cover browser parsing
against Python golden fixtures, exact image reconstruction, corrupt/incomplete
bytes, coordinate clamping, reverse-path requests, deterministic loss, interrupted
routes, retained progress and retry exhaustion. CI runs both suites.

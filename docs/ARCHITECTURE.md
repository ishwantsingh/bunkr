# Project architecture and implementation status

Status reflects the code currently in this repository. **Built** means implemented
and locally tested; it does not imply deployment or physical-radio validation.

## Architecture

### Left-to-right delivery flow

**Start at the sender on the left; finish at the recipient on the right.**
Text and voice now use the same packet/verification pipeline; see [TEXT_VOICE.md](TEXT_VOICE.md).
Green boxes are built. Amber boxes mark mock boundaries. Blue boxes show
what will replace those boundaries; these integrations remain unfinished.

![Left-to-right architecture with mock transport and its replacement](assets/architecture.png)

[Editable Mermaid source](assets/architecture.mmd) · Regenerate the image with
`python scripts/render_architecture.py` (requires Pillow).


The numbered solid arrows are the forward delivery sequence. Return
arrows summarize control messages: they cross the same mesh, rather than taking
a direct phone-to-phone shortcut. The first pass delivers a tiny preview; after
a crop request reaches the sender, the same pipeline delivers six independent
detail tiles. Receipt confirmation waits for the verified completion ACK to return.

### Other demo boundaries to replace

| Current demo boundary | Actual replacement | Existing code retained |
| --- | --- | --- |
| Both phone UIs share one browser and local API | Separate sender and receiver endpoints; transport delivers requests and ACKs | Chat/crop interaction, media engine, wire contract and verification |
| Browser receive state is in memory; server database is temporary | Durable storage per endpoint, with restart recovery connected to the transport | Existing SQLite media storage and recovery logic |
| Map is driven by synthetic browser events | Map observes events from the integrated firmware simulator | Map presentation and controls where applicable |

The demo wraps frames using official protobufs when the optional Meshtastic
SDK dependency is installed. It does **not** currently send them through the
SDK Bridge or firmware. The bridge and SQLite recovery code already exist;
end-to-end integration is the missing work.

Meshtasticator is the next software transport target. Physical LoRa accessories
connected over BLE/serial are a later option, outside the initial scope.

## What is finished, partial, and outstanding

| Area | Status | What we have / what remains |
| --- | --- | --- |
| Phase 1: media handling | **Built** | Original retention, EXIF orientation, JPEG/WebP encoding, preview/crop/full-image representations, binary packets, integrity checks, cache reuse and restart-safe Python reconstruction. |
| Text and voice | **Built over mock transport** | Bidirectional UTF-8/zlib text and mono Opus voice, record/import/sample controls, playback after verification, and matching receipt ACKs. Video remains unimplemented. |
| Two-phone interaction | **Built as a local UI** | Send a preview, drag/resize a crop, request that section, progressively reveal six independently verified source tiles, and confirm receipt after the ACK returns. |
| Network visualization | **Working mock** | Five nodes, per-hop seeded loss, bounded end-to-end retries, relay removal, alternate routes, pause and disconnection. Animation time is illustrative. |
| Meshtastic reuse | **Adapter built; integration pending** | Official SDK/protobufs and a send/receive bridge are tested offline. Connected endpoints, firmware nodes and transport dispatch are not wired together. |
| Phase 2: transport and radio model | **Not built** | Production queueing, packet-boundary priority, fairness, backpressure, retry/expiry policy, radio range/presets, airtime, contention, duty-cycle behavior and erasure-correction evaluation. |
| Phase 3: production application | **Partial** | The interaction is implemented in the browser mock. Separate device sessions, durable browser receive state, photo-import UI and the full-image request UI remain unfinished. The media engine already supports full-image representations. |
| Performance and acceptance evidence | **Partial** | Codec/packet measurements and automated local checks exist. Firmware-backed five-node acceptance, airtime accounting, request round-trip measurements and crop-versus-full-image benchmarks remain outstanding. |
| Physical radios / native mobile apps | **Outside initial scope** | No physical LoRa/BLE field validation or native iOS/Android app has been built. |

## How a section becomes sharp today

1. The sender retains the original; the server encodes a tiny preview.
2. Actual preview packets cross the browser's mock mesh. The browser reconstructs
   and verifies them before displaying the preview.
3. The recipient selects a box and clicks **Request section**. The request crosses
   the reverse mock route before the server creates detail.
4. The server crops the original into six independently encoded tiles. Their
   actual packets cross the mock mesh, and each verified tile appears in place.
5. Completion ACKs travel back. The sender shows confirmed receipt only after
   the server receives and validates those ACKs.

The server's demo database is temporary and removed on shutdown. Python media
storage supports restart recovery with a retained database, but browser receive
progress currently lives in memory and does not survive a page reload.

## Code map

| Component | Implementation |
| --- | --- |
| Phone UI and interaction | [app.mjs](../imageoverbt/ui/app.mjs), [index.html](../imageoverbt/ui/index.html), [style.css](../imageoverbt/ui/style.css) |
| Mock network | [network.mjs](../imageoverbt/ui/network.mjs) |
| Browser packet receiver | [protocol.mjs](../imageoverbt/ui/protocol.mjs) |
| Local API | [ui_server.py](../imageoverbt/ui_server.py) |
| Image processing and SQLite state | [media.py](../imageoverbt/media.py) |
| Text/voice media and persistence | [messages.py](../imageoverbt/messages.py), [messages.mjs](../imageoverbt/ui/messages.mjs) |
| Binary frame contract | [contract.py](../imageoverbt/contract.py) |
| Official SDK adapter | [meshtastic_transport.py](../imageoverbt/meshtastic_transport.py) |
| Local event vocabulary | [events.py](../imageoverbt/events.py) — full transport metrics integration remains pending |
| Automated checks | [Python tests](../tests), [browser module tests](../tests/ui), [CI configuration](../.github/workflows/media.yml) |

See [implementation phases](../IMPLEMENTATION_PHASES.md),
[UI behavior and limits](UI_MOCK.md), and
[Meshtastic integration boundary](MESHTASTIC.md) for the detailed contracts.

# imageoverbt

**A photo arrives as a tiny preview. Tap the unreadable trail sign, and the network prioritizes that crop.**

imageoverbt is an off-grid messaging prototype for text, voice notes and recipient-directed images for the **CHRP Track — Off-Grid Everything**. It makes a photo useful before the whole image has crossed a slow, unreliable mesh network. The recipient chooses which detail should arrive next.

**Status:** The phone UI mock supports text, voice notes, and recipient-directed images over its mock transport. The media pipeline supports JPEG/WebP previews, source-photo crops, bounded packets, reconstruction, and verified acknowledgments. A separate five-node software mesh simulator and middle network UI are available in `mesh-ui/`. The phone UI and media pipeline have not yet been connected to that simulator; physical radio integration remains planned. See [text/voice setup](docs/TEXT_VOICE.md) and [media contract](docs/MEDIA_CONTRACT.md).

See the [architecture diagram and built-versus-planned breakdown](docs/ARCHITECTURE.md).

Run `python3 -m unittest discover -s tests -v` and `python3 -m imageoverbt.demo` after installing with `python3 -m pip install -e .`. The offline demo writes a real trail-sign comparison and measured codec results to `demo-output/`. See [the media contract and setup instructions](docs/MEDIA_CONTRACT.md).

Meshtastic interoperability uses the official [Python SDK](https://github.com/meshtastic/python) and generated [protobuf definitions](https://github.com/meshtastic/protobufs). Install `python3 -m pip install -e ".[meshtastic]"` and run `python3 -m imageoverbt.meshtastic_transport` for an offline protocol check. Frames are capped at 220 bytes to leave room for the Meshtastic wrapper and encryption overhead. See [upstream integration and simulator handoff](docs/MESHTASTIC.md).

## Try the interactive mock

Run `python3 -m imageoverbt.ui_server` after installation and open
[localhost:8765](http://127.0.0.1:8765). Two phone chats surround an animated
five-node mesh. Drag the recipient’s crop box and click **Request section** to
watch verified source detail arrive progressively. Type messages on either phone,
record/import a voice note, or click **Try voice** for a speech sample. Voice
requires FFmpeg with libopus on the server. Loss, relay removal,
disconnection, pause, reset and another-section requests are interactive.
See [UI_MOCK.md](docs/UI_MOCK.md) for setup, controls and simulation limits.

## The use case

A hiker photographs a trail junction and sends it to a friend several radio hops away. The photo contains two paths, trees, and a small trail sign. There is no cellular service or Wi-Fi.

1. **Send the photo.** The sender keeps the source image locally and generates a very small, compressed preview.
2. **Receive the preview.** The recipient can see the junction, but the sign is too small to read. The app shows that only the preview has arrived.
3. **Tap the sign.** The recipient taps to select a crop, adjusting its bounds if needed. A compact request containing the image identifier, crop coordinates, and desired detail travels back through the mesh.
4. **Prioritize that crop.** When the request reaches the sender, it creates a higher-detail crop from the source photo. After the current packet finishes, the scheduler sends the requested detail ahead of lower-priority image data.
5. **Bring the sign into focus.** The recipient reassembles and verifies the crop, then places it over the matching area of the preview. The rest of the photo can remain small and blurry.
6. **Confirm receipt.** The recipient acknowledges the verified crop. Only then does the sender show that the crop is confirmed received.

The recipient can select another region or request more detail across the whole image. A crop request changes the order of transmission; it does not require the sender to manually take or send another photo.

## Why this is useful

A person looking at a photo often needs one small detail: a trail sign, an equipment label, a building number, or a landmark. Sending a readable version of that region can require fewer bytes than sharpening the entire image.

The core feature is **recipient-directed delivery**. A small request changes what the network spends its next packets transmitting. The benefit depends on the selected crop, image content, and round-trip delay, and must be measured against ordinary sequential transfer.

All displayed image detail comes from the sender's source photo. The proposed flow uses local image compression and cropping, with no cloud service or generative reconstruction.

## Planned system

```text
Sender's photo -> Small preview -> Simulated radio mesh -> Recipient
      ^                                                     |
      |                 Request selected crop               |
      +-----------------------------------------------------+
      |
      +-> Compressed crop -> Prioritized packets -> Verified detail
```

The current implementations are software only. The phone UI mock and standalone five-node simulator are separate components awaiting integration. The intended hardware model is a phone connected to a CHRP radio accessory, with LoRa between accessories.

### Run the mesh simulator

From the repository root, run `python3 -m http.server 8765` and open
`http://127.0.0.1:8765/mesh-ui/`. No package installation is needed. Run
`node --test mesh-ui/simulator.test.mjs` for transport checks.

Click **Start image demo**. The simulation pauses when D has verified the tiny
preview; click **Request sign detail** to send the request back to A. Use
**Pause**, **Play**, or **Next event** to inspect hops. Drag nodes, edit their
range or availability, or disable relay C to test rerouting. Changing the radio
preset affects future hops; the loss slider affects subsequent delivery checks.
Reset to replay the same random seed.

The simulator is in `mesh-ui/simulator.mjs`. Its `enqueueRepresentation` input
accepts a manifest and byte chunks, so the media encoder can replace the SVG
fixtures in `mesh-ui/fixtures.mjs`. Each demo packet has actual binary bytes and
is checked against the 230-byte cap. The 16-byte outer header uses the field
sizes described by Meshtastic; the 24-byte application envelope, shared-channel
queue, route choice, and airtime overhead are simplified simulation choices.
This is not a Meshtastic firmware-compatible packet implementation.

### Image transport

- Encode the preview and requested crops as separate, independently decodable images. Evaluate JPEG and WebP at measured byte budgets.
- Split each encoded image into packets of approximately 230 bytes or less, reserving space for application headers and integrity information.
- Identify every transfer by its source image, representation, and chunk numbers so overlapping requests, duplicates, and reordered packets remain unambiguous.
- Keep requests and acknowledgments small. Prioritize control traffic and requested crops ahead of background image refinement, with fair scheduling between active transfers.
- Cache completed representations and received chunks to avoid repeating work unnecessarily.

### Mesh and recovery

- Model radio presets, range, shared-channel airtime, queues, packet loss, and multi-hop relaying. A crop request and its acknowledgment consume airtime too.
- Use selective retransmission for missing chunks and evaluate a small amount of erasure-correction redundancy across chunks.
- Preserve received chunks through interruptions. Resume when a route becomes available, with bounded retries and explicit stalled or failed states.
- Verify each reconstructed preview or crop against its expected content hash before acknowledging completion. This checks transfer integrity; it does not establish the truth of the photographed scene.

### Honest delivery status

Delivery is tracked separately for the preview, each crop, and any requested full-image rendition.

| State | What the app can honestly say |
| --- | --- |
| Preview received | The recipient has a complete, verified preview. More detail may still be absent. |
| Crop requested | A request is queued or in transit; the sender may not have received it yet. |
| Detail arriving | Some crop chunks have arrived. The crop is still incomplete. |
| Crop verified locally | The recipient has reconstructed and checked the crop. Its acknowledgment may still be in transit. |
| Receipt confirmed | The sender has received the recipient's acknowledgment for that specific representation. |
| Waiting for a route | Transmission cannot currently progress. The arrival time is unknown. |

The interface should show received and missing chunks, observed packet paths, and an estimated time range based on current conditions. A preview acknowledgment never implies that the full photo arrived. The simulator's complete network view must remain distinct from what either phone has actually learned through received packets.

## First demo and acceptance criteria

Show the sender, recipient, and five-node mesh together. Configure a three-hop path with 20% packet loss per hop, plus an alternate path for an interruption test.

- Send a photo containing a sign that is unreadable in its tiny preview.
- Let the recipient select the sign while lower-priority image detail is still queued.
- Show the crop request traveling back and the requested detail taking priority when it reaches the sender.
- Reassemble a readable crop despite dropped, duplicated, and reordered packets.
- Remove a relay and demonstrate retained progress and recovery over an available alternate path.
- Drop the final acknowledgment: the recipient should show its verified crop while the sender waits for confirmation. Recover without displaying a false delivery claim.
- Demonstrate a disconnected network honestly, without a fabricated countdown or success state.

Compare recipient-directed delivery with sequential full-image delivery using the same source photos, codec settings, radio model, and reproducible loss scenarios. Report time to preview, time from selection to readable detail, total transmitted bytes and airtime including control traffic and retries, and completion rate for requested representations. Include request round-trip time in the comparison.

Media tests cover packet-size limits, reconstruction, corruption, duplicate/reordered chunks, persistent recovery, repeated requests, EXIF orientation, cache reuse, and acknowledgments. Standalone mesh tests cover packet size, byte verification, missing-chunk recovery, duplicate requests, requested-crop priority, relay interruption, disconnection, and sender receipt status. Tests for the combined phone UI, media pipeline, and mesh engine remain to be built.

## Scope

The current prototype covers **text, voice notes, photos, previews, and requested crops**. Video, cloud services, and physical radio integration remain outside this implementation. Background full-image refinement is secondary to delivering the detail the recipient selects.

## References

- [CHRP track foundation: Meshtastic](https://meshtastic.org/)
- [Meshtastic radio presets and data rates](https://meshtastic.org/docs/overview/radio-settings/)
- [SSDV: resilient image transmission over unreliable links](https://github.com/fsphil/ssdv)
- [VISTA-LoRa: research on selective visual transmission over LoRa](https://ieeexplore.ieee.org/abstract/document/11513963)

These projects establish related work. imageoverbt's proposed focus is the interaction between recipient-selected image detail, transmission priority, and explicit delivery evidence.

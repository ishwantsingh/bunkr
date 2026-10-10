# Text and voice messaging

Text and voice notes are implemented in the two-phone local demo. They use the
existing **mock mesh**, not real radio simulation. Video remains unimplemented.

## Try it

Install the Python project as described in the README. Voice encoding additionally
requires **FFmpeg with libopus** on the server's PATH. On macOS, `brew install
ffmpeg`; on Ubuntu, `sudo apt-get install ffmpeg`. Text and images still work
without it; the UI disables voice controls and explains the missing dependency.

Start `python -m imageoverbt.ui_server` and open http://127.0.0.1:8765.
Either Alex or Sam can:

- Type a message and press Enter or the send arrow.
- Click **Record**, allow microphone access, then **Stop & send**. Recording stops
  automatically just before 60 seconds. Microphone denial has an explicit message.
- **Import audio** from a local file, or click **Try voice** for the bundled speech
  sample without microphone permission.
- Play a voice note after all chunks arrive, the hash matches and audio decoding
  succeeds. Incomplete content is withheld.

The local server accepts at most 8 MiB of input audio and 60 seconds of decoded
speech. Longer notes are rejected, not silently cut short. Browser recording
format is selected with `MediaRecorder.isTypeSupported`; server transcoding
normalizes recorded/imported audio to mono Ogg Opus, 16 kHz input, 12 kb/s target,
VBR, speech mode. Container overhead and VBR mean total bytes are not exactly
12 kb/s. FFmpeg runs with bounded duration/time and pipe-only protocol access.
There is no cloud transcription, voice cloning or generated reconstruction.

The sample is clearly synthetic fixture speech, not a user recording. See
[fixture attribution](../fixtures/README.md).

## Shared transport contract

Implementation: [messages.py](../imageoverbt/messages.py),
[browser protocol](../imageoverbt/ui/protocol.mjs), and
[messaging UI controller](../imageoverbt/ui/messages.mjs).

This adds **manifest tag 7** to wire version 2. Image tags 1–6 are unchanged.
Older image-only receivers must reject unknown tag 7; this extension requires
both endpoints to support text/voice. All integers are big endian.

| Field | Bytes / values |
| --- | --- |
| Envelope | Version:u8 = 2, tag:u8 = 7 |
| Message ID | 16 bytes, nonzero random UUID; repeated content can be distinct messages |
| Sender / recipient | Two uint32 node IDs, concrete distinct endpoints |
| Kind / codec | Two uint8: kind 0 text / 1 voice; codec 0 UTF-8 / 1 zlib UTF-8 / 2 Ogg Opus |
| Encoded length / chunks | Two uint32; chunks = ceil(length / 174) |
| Duration / sample rate | Two uint32: milliseconds and Hz; both zero for text |
| Content SHA-256 | 32 bytes over encoded payload |
| CRC32 | 4 bytes over preceding frame bytes |
| Total manifest | **80 bytes** |

Text is bounded to 16 KiB of UTF-8; Unicode and whitespace inside nonblank messages
are preserved. Zlib is chosen only when it saves more than 8 bytes. Both receivers
bound decompression and reject malformed UTF-8. Voice payloads are capped at
200 KiB; duration and codec metadata are validated.

Tag-3 data frames reuse the existing layout: message ID in **both** ID fields,
chunk index/count and up to 174 payload bytes. Maximum application frame remains
**220 bytes**, reserving space for the Meshtastic wrapper/encryption. Completion
uses tag 4 with message ID, recipient and encoded-content SHA-256. Tag 5 hop ACKs
cannot confirm message delivery. Tag 6 missing-index frames can refer to a message
ID; production retry scheduling is still a future integration.

`meshtastic_transport.validate_frame` accepts tag 7, so manifests, data and ACKs
can use the existing SDK Bridge. The UI sends actual packet bytes through the
browser mock network, including reverse-direction messages and returning ACKs.
It does not open firmware/radio connections or implement the production scheduler.

## Persistence and honest status

`MessageStore` persists manifests, outgoing encoded bytes, received chunks,
verified content and sender confirmations in SQLite. It tolerates reordered and
identical duplicate packets, rejects conflicting chunks/manifests, and clears
corrupt unverified chunks to allow retransmission. A retained database resumes
partial transfers and regenerates completion ACKs after restart.

The browser shows queued/in-transit chunk progress, waiting for a route, locally
verified reception and sender-confirmed receipt separately. During disconnection
it gives no fabricated ETA. On failure, **Retry message** resends the same message
ID; after verified reception, **Retry acknowledgment** retries only the ACK and
keeps the received content visible. It never displays a second received bubble
for those retries. One transfer runs at a time; this is not a production queue.

The demo server database is temporary. Browser receive state is in memory;
recovery survives a paused/disconnected route, but not page reload. Independent
persistent device endpoints remain future work.

## Validation

Run `python -m unittest discover -s tests -v` and
`node --test tests/ui/*.test.mjs`. CI installs FFmpeg as well as the Meshtastic
extra. Tests cover Unicode/compression limits, actual voice compression and decode,
packet budgets, CRC/hash rejection, duplicate/reordered and partial reconstruction,
restart recovery, matching completion ACKs, official protobuf wrapping and seeded
20% packet loss across the mock three-hop path. Browser checks cover bidirectional
text, playable verified voice, disconnection and the existing image interaction.

Codec references: [FFmpeg libopus options](https://ffmpeg.org/ffmpeg-codecs.html#libopus),
[MediaRecorder format selection](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/isTypeSupported_static).

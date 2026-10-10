# Trail sign and protocol fixtures

`trail-sign.jpg` is an unmodified real National Park Service photograph, **Oak
Flat Trail**, taken June 29, 2021 in Black Canyon of the Gunnison National Park.
NPS accession: `44aec3d2-e7cc-40c4-80b5-19a83deb18db`.

Source and public-domain status:
https://commons.wikimedia.org/wiki/File:Wooden_trail_sign_at_junction_(44aec3d2-e7cc-40c4-80b5-19a83deb18db).JPG

Download:
https://upload.wikimedia.org/wikipedia/commons/f/f8/Wooden_trail_sign_at_junction_%2844aec3d2-e7cc-40c4-80b5-19a83deb18db%29.JPG

Credit: NPS Photo. US federal employee work, public domain in the United States.
No generated detail or replacement lettering is used.

The sign selection is normalized `(0.18, 0.25, 0.84, 0.59)`, quantized to uint16
by `Bounds.normalized`. The expected readable text is **OAK FLAT LOOP**. Visual
review of `demo-output/comparison.png` confirms that the tiny preview does not
reveal the text and the source crop does. Automated checks verify geometry,
encoded bytes, integrity and decoding, not human reading comprehension.

`wire/` contains version 2 manifests, a crop request, hex-encoded data packet
arrays, independently decodable representation bytes, and measured codec settings.
Phase 2 can consume these without importing Pillow or implementing media encoding.
Regenerate with `python3 -m bunkr.demo`, then copy desired wire artifacts
from `demo-output/`. Use committed encoded bytes for cross-language golden tests;
codec output may differ across Pillow/libjpeg/libwebp versions. Neither Python's
random sequence nor codec bytes are intended as a cross-language simulation seed
contract.

## Voice and text fixtures

`trail-voice.ogg` is local synthesized demo speech generated using the macOS
Samantha system voice, then encoded as mono Opus. It says: “At the junction. Take
the left trail toward Pine Lake. I will wait by the sign.” It contains no user
recording and is used only as a reproducible playback/transport sample. It does
not describe the photographed sign; the image fixture remains unchanged.

`messages/messages.json` contains tag-7 manifests, tag-3 data frames and expected
tag-4 ACKs for Unicode text, compressed text and a normalized voice note. These
are cross-language golden fixtures. Voice encoder output can vary by FFmpeg/Opus
version, so tests consume the committed bytes.

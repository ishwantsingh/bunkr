# 60-second project demo

The finished video is `demo-output/bunkr-demo/bunkr-60-second-demo.mp4` (1920×1080,
30 fps, H.264/AAC, exactly 60 seconds). `bunkr-demo.srt` contains companion captions.
`verification.json` records duration, resolution, browser errors and tile arrival
observations. Generated media stays in the ignored `demo-output/` directory.

The recording uses Playwright against the actual integrated application, importing
`fixtures/trail-sign.jpg`, receiving the 298-byte preview over the default
five-node mesh with 20% loss, selecting the trail sign, requesting source detail,
and observing all six verified tiles. It also sends a text response and opens
simulation controls and the event timeline. Voice support is explained in narration.
The recording is edited for pacing; tile arrival is slowed to make progressive
reception visible. The application itself runs at 40× modeled time. This is a
software mesh demonstration, not a physical radio test.

## Reproduce

Requires the project's Python environment (Pillow), FFmpeg/FFprobe on PATH and
Playwright with Chromium installed. Start the application:

```sh
.venv/bin/python -m bunkr.ui_server --port 8765
```

In another terminal:

```sh
# Generates narration using ELEVENLABS_API_KEY from the root .env.
# Optional: ELEVENLABS_VOICE_ID and ELEVENLABS_MODEL. This consumes API credits.
.venv/bin/python scripts/narrate-demo.py

# Set PLAYWRIGHT_MODULE to an installed Playwright module if not locally resolvable.
node scripts/record-demo.cjs
.venv/bin/python scripts/render-demo.py
```

Narration and chapter timings live in `scripts/demo-narration.json`.
The renderer uses bundled Instrument Serif and macOS Avenir Next fonts. It asserts
60-second duration, a 1080p video stream and an audio stream before completion.
Recording fails unless all six source tiles arrive and there are no page errors.
Credentials are read only by the narration generator and never written to output.

Validation for this capture: 52 Python tests and 59 JavaScript tests passed.

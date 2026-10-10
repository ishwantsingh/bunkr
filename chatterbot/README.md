# Chatterbot UI

This is the live frontend for bunkr, including both phones, bokeh backdrop,
image/recording transitions and the floating mesh simulator. The original React
components are connected to the existing Python API and binary packet engine
through `src/mesh/runtime.mjs`. There is no mock delivery or recipient access to
the sender's source pixels.

Node.js 22.12+ is required for frontend development:

```sh
npm ci
npm run build
npm run lint
```

The build type-checks and updates `../bunkr/ui/client/` and the Python
server's root `index.html`. Commit the generated assets with frontend changes.
Run `python -m bunkr.ui_server` from the repository root to serve the result;
Python users need no Node.js or internet. Fonts and licenses are bundled locally.

For hot reload, start that server on 8765 and run `npm run dev` here. Vite proxies
`/api` and `/fonts` to the Python server. See [demo controls](../docs/UI_MOCK.md)
and [voice setup](../docs/TEXT_VOICE.md). Backend APIs/codecs remain unchanged.

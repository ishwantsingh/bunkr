import { sha256Hex, splitBytes } from "./simulator.mjs";

// Small, locally generated SVG images are transport fixtures. The media owner's
// eventual encoder can pass JPEG/WebP bytes through the same API.
const previewSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200"><defs><linearGradient id="s" x2="0" y2="1"><stop stop-color="#8dc7dd"/><stop offset="1" stop-color="#eaf4e7"/></linearGradient></defs><rect width="320" height="200" fill="url(#s)"/><path d="M0 148 52 68 100 143 163 55 231 154 279 85 320 144v56H0" fill="#7aa69b"/><path d="M0 165q92-18 143 9t177-15v41H0" fill="#507d6b"/><path d="M134 200q19-48 29-50t21 50" fill="#d9bc91"/><path d="M224 95v68" stroke="#644e39" stroke-width="7"/><rect x="189" y="91" width="69" height="33" rx="3" fill="#e2b75e" stroke="#704b30" stroke-width="3"/><path d="M196 101h55m-52 8h48" stroke="#775b3a" stroke-width="3"/></svg>`;

const cropSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="340" viewBox="0 0 560 340"><defs><linearGradient id="wood" x2="1" y2="1"><stop stop-color="#f1d88e"/><stop offset="1" stop-color="#c89049"/></linearGradient><filter id="shadow"><feDropShadow dx="0" dy="6" stdDeviation="8" flood-opacity=".22"/></filter></defs><rect width="560" height="340" fill="#dcecd9"/><path d="M0 230q110-82 206-22t354-28v160H0" fill="#83ae91"/><path d="M0 280q155-64 300-8t260-20v88H0" fill="#5d967c"/><path d="M256 310V62" stroke="#76523b" stroke-width="19"/><g filter="url(#shadow)"><rect x="50" y="62" width="460" height="186" rx="12" fill="url(#wood)" stroke="#805336" stroke-width="10"/><rect x="70" y="82" width="420" height="146" rx="6" fill="none" stroke="#f9e8b8" stroke-width="3"/></g><circle cx="91" cy="101" r="5" fill="#745139"/><circle cx="469" cy="101" r="5" fill="#745139"/><circle cx="91" cy="211" r="5" fill="#745139"/><circle cx="469" cy="211" r="5" fill="#745139"/><text x="280" y="145" text-anchor="middle" font-family="Arial,sans-serif" font-size="36" font-weight="800" letter-spacing="2" fill="#473f36">NORTH TRAIL</text><text x="280" y="198" text-anchor="middle" font-family="Arial,sans-serif" font-size="31" font-weight="700" letter-spacing="5" fill="#473f36">2 MI  →</text><path d="M95 117h22m-17 70h16m330-71h18m-21 68h18M117 95h40m249 0h36M116 212h30m268 0h30" stroke="#b6854f" stroke-width="2" opacity=".55"/></svg>`;

export async function makeFixture(id, kind, svg, chunkSize = 180) {
  const bytes = new TextEncoder().encode(svg);
  const chunks = splitBytes(bytes, chunkSize);
  return {
    manifest: { id, imageId: "trail-sign", kind, source: "A", destination: "D", mime: "image/svg+xml", expectedHash: await sha256Hex(bytes) },
    chunks,
    sourceBytes: bytes
  };
}

export async function createDemoFixtures() {
  return {
    preview: await makeFixture("trail-preview", "preview", previewSvg),
    crop: await makeFixture("trail-sign-crop", "crop", cropSvg),
    background: await makeFixture("trail-background", "background", previewSvg, 120)
  };
}

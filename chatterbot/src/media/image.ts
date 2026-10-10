import type { ImageNote, Region } from '../mesh/types'

const PREVIEW_LONG_SIDE = 24 // px: the first, tiny version that crosses the mesh
const FULL_LONG_SIDE = 320 // px: resolution regions are sharpened to
const PREVIEW_QUALITY = 0.4
const REGION_QUALITY = 0.5

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })

const encode = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), type, quality),
  )

// WebP where the browser can encode it; browsers that can't silently return PNG, so use JPEG there.
const toBlob = async (canvas: HTMLCanvasElement, quality: number) => {
  const webp = await encode(canvas, 'image/webp', quality)
  return webp.type === 'image/webp' ? webp : encode(canvas, 'image/jpeg', quality)
}

// Bytes actually sent for an encoded image. Browsers wrap WebP in a RIFF container
// with a ~450 B colour profile; only the bitstream (plus 4 B for width/height) needs
// to cross the mesh, and the receiver rebuilds the container.
async function payloadBytes(blob: Blob) {
  if (blob.type !== 'image/webp') return blob.size
  const u = new Uint8Array(await blob.arrayBuffer())
  let bytes = 4
  for (let o = 12; o + 8 <= u.length; ) {
    const id = String.fromCharCode(...u.slice(o, o + 4))
    const len = u[o + 4] | (u[o + 5] << 8) | (u[o + 6] << 16) | (u[o + 7] << 24)
    if (id === 'VP8 ' || id === 'VP8L' || id === 'ALPH') bytes += len
    o += 8 + len + (len & 1)
  }
  return bytes
}

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.readAsDataURL(blob)
  })

const draw = (img: CanvasImageSource, sw: number, sh: number, w: number, h: number, sx = 0, sy = 0) => {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w))
  canvas.height = Math.max(1, Math.round(h))
  canvas.getContext('2d')!.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
  return canvas
}

const fit = (w: number, h: number, longSide: number) => {
  const scale = longSide / Math.max(w, h)
  return [Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale))] as const
}

// Downscale a picked photo into the full-res copy and the tiny preview that gets sent.
export async function prepareImage(file: File): Promise<ImageNote> {
  const url = URL.createObjectURL(file)
  try {
    const img = await loadImage(url)
    const [fw, fh] = fit(img.naturalWidth, img.naturalHeight, FULL_LONG_SIDE)
    const full = draw(img, img.naturalWidth, img.naturalHeight, fw, fh)
    const [pw, ph] = fit(fw, fh, PREVIEW_LONG_SIDE)
    const preview = await toBlob(draw(full, fw, fh, pw, ph), PREVIEW_QUALITY)
    const fullBytes = await payloadBytes(await toBlob(full, REGION_QUALITY))
    return {
      src: full.toDataURL('image/jpeg', 0.9),
      aspect: fw / fh,
      previewSrc: await blobToDataUrl(preview),
      previewBytes: await payloadBytes(preview),
      previewSize: [pw, ph],
      fullBytes,
      regions: [],
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}

// Bytes it takes to send `region` of the full image at full resolution.
export async function regionBytes(src: string, region: Pick<Region, 'x' | 'y' | 'w' | 'h'>) {
  const img = await loadImage(src)
  const W = img.naturalWidth
  const H = img.naturalHeight
  const crop = draw(img, region.w * W, region.h * H, region.w * W, region.h * H, region.x * W, region.y * H)
  return payloadBytes(await toBlob(crop, REGION_QUALITY))
}

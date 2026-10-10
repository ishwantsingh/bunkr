import type { ImageNote } from '../mesh/types'
import { parseManifest } from '../../../bunkr/ui/protocol.mjs'

const DETAIL_BUDGET = 6 * 8000 // existing /api/crop: six independent tiles, up to 8 KB each

// The existing server retains the original, normalizes EXIF/HEIC, and encodes the
// exact preview bytes. Picking a photo sends that preview without another button.
export async function prepareImage(file: File, signal?: AbortSignal): Promise<ImageNote> {
  if (!file.size || file.size > 12 * 1024 * 1024) throw Error('Choose a photo up to 12 MiB.')
  const response = await fetch('/api/photo', { method: 'POST', headers: {'Content-Type': 'application/octet-stream'}, body: file, signal })
  const envelope = await response.json()
  if (!response.ok) throw Error(envelope.error || 'Could not prepare this photo.')
  const m = parseManifest(envelope.preview.manifest)
  return {src: envelope.source_url, aspect: m.sourceWidth/m.sourceHeight, previewSrc: '',
    previewBytes: m.bytes, previewSize: [m.width,m.height], fullBytes: DETAIL_BUDGET,
    imageId: envelope.image_id, envelope, regions: [], tiles: []}
}

// Before a request reaches the sender, only its six-tile byte budget is known.
// The actual encoded size replaces this conservative estimate after encoding.
export async function regionBytes() { return DETAIL_BUDGET }

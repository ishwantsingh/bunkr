import { useRef, useState, type PointerEvent } from 'react'
import { regionBytes } from '../media/image'
import { formatBytes, formatSeconds } from '../media/regions'
import { estimatePullMs, packetCount } from '../mesh/mockMesh'
import type { ImageNote, Region } from '../mesh/types'
import TransitBar from './TransitBar'

type Box = Pick<Region, 'x' | 'y' | 'w' | 'h'>

const MIN_BOX = 0.08 // smallest selection, as a fraction of the image

type Props = {
  image: ImageNote
  mine: boolean
  route: string[] // sender → receiver
  kbps: number
  width: string // CSS width; height follows the image's aspect ratio
  interactive?: boolean // draw / remove / pull boxes (full-screen viewer only)
  onRegionsChange?: (update: (regions: Region[]) => Region[]) => void
  onPull?: (region: Region) => void // pull one selected area
}

// The image as this phone has it: the sender's full copy, or the receiver's tiny
// preview with sharp crops laid over it as they arrive. When interactive, the
// receiver drags boxes, sees what each will cost, and pulls them.
export default function ImageCanvas({
  image,
  mine,
  route,
  kbps,
  width,
  interactive = false,
  onRegionsChange = () => {},
  onPull,
}: Props) {
  const frame = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState<Box | null>(null)
  const hops = route.length - 1

  const pointerFraction = (e: PointerEvent) => {
    const rect = frame.current!.getBoundingClientRect()
    const clamp = (v: number) => Math.min(1, Math.max(0, v))
    return [clamp((e.clientX - rect.left) / rect.width), clamp((e.clientY - rect.top) / rect.height)] as const
  }

  // Drag origin lives in a ref so pointerup sees it even if no render happened since pointerdown.
  const origin = useRef<readonly [number, number] | null>(null)

  const boxTo = (e: PointerEvent): Box => {
    const [ox, oy] = origin.current!
    const [x, y] = pointerFraction(e)
    return { x: Math.min(x, ox), y: Math.min(y, oy), w: Math.abs(x - ox), h: Math.abs(y - oy) }
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!interactive || mine || (e.target as HTMLElement).closest('[data-no-draw]')) return
    origin.current = pointerFraction(e)
    e.currentTarget.setPointerCapture(e.pointerId)
    setDraft({ ...boxTo(e) })
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (origin.current) setDraft(boxTo(e))
  }

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!origin.current) return
    const box = boxTo(e)
    origin.current = null
    setDraft(null)
    if (box.w < MIN_BOX || box.h < MIN_BOX) return
    const id = crypto.randomUUID()
    onRegionsChange((rs) => [...rs, { id, ...box, status: 'selected' }])
    regionBytes(image.src, box).then((bytes) =>
      onRegionsChange((rs) => rs.map((r) => (r.id === id ? { ...r, bytes } : r))),
    )
  }

  const remove = (id: string) => onRegionsChange((rs) => rs.filter((r) => r.id !== id))

  const place = (b: Box) => ({
    left: `${b.x * 100}%`,
    top: `${b.y * 100}%`,
    width: `${b.w * 100}%`,
    height: `${b.h * 100}%`,
  })

  return (
    <div
      ref={frame}
      className={`relative touch-none select-none ${interactive && !mine ? 'cursor-crosshair' : ''}`}
      style={{ width, aspectRatio: image.aspect }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        origin.current = null
        setDraft(null)
      }}
    >
      {/* Base layer: the sender holds the full image; the receiver only has the preview */}
      <div className="absolute inset-0 overflow-hidden rounded-[3cqw] shadow-lg">
        <img
          src={mine ? image.src : image.previewSrc}
          alt=""
          draggable={false}
          className={`h-full w-full object-cover ${mine ? '' : 'scale-105 blur-[3px]'}`}
        />
      </div>

      {/* Sharpened areas that have arrived */}
      {!mine &&
        image.regions
          .filter((r) => r.status === 'done')
          .map((r) => (
            <div key={r.id} className="absolute animate-[fadein_600ms_ease-out] overflow-hidden" style={place(r)}>
              <img
                src={image.src}
                alt=""
                draggable={false}
                className="absolute max-w-none"
                style={{
                  width: `${100 / r.w}%`,
                  height: `${100 / r.h}%`,
                  left: `${(-r.x / r.w) * 100}%`,
                  top: `${(-r.y / r.h) * 100}%`,
                }}
              />
            </div>
          ))}

      {/* Selected / in-flight / failed boxes */}
      {!mine &&
        image.regions
          .filter((r) => r.status !== 'done' && (interactive || r.status === 'pulling'))
          .map((r) => (
            <div
              key={r.id}
              className={`absolute rounded-[1.5cqw] border-2 ${
                r.status === 'pulling'
                  ? 'border-white/70 bg-white/5'
                  : r.status === 'failed'
                    ? 'border-dashed border-amber-300 bg-amber-300/10'
                    : 'border-dashed border-white/90 bg-white/10'
              }`}
              style={place(r)}
            >
              {interactive && (
                <div className={`absolute bottom-full mb-[1cqw] ${r.x + r.w / 2 > 0.5 ? 'right-0' : 'left-0'}`}>
                  {r.status === 'pulling' ? (
                    <TransitBar
                      transit={r.transit ?? null}
                      route={route}
                      kind="pull"
                      alignRight={r.x + r.w / 2 > 0.5}
                      className="w-[30cqw]"
                    />
                  ) : r.status === 'failed' ? (
                    <p className="font-sans text-[2.6cqw] whitespace-nowrap text-amber-300">{r.reason}</p>
                  ) : (
                    <p className="rounded-full bg-black/40 px-[2cqw] py-[0.5cqw] font-sans text-[2.6cqw] whitespace-nowrap text-white/90 backdrop-blur-sm">
                      {r.bytes === undefined
                        ? 'Estimating…'
                        : `${formatSeconds(estimatePullMs(r.bytes, hops, kbps))} · ${formatBytes(r.bytes)} · ${packetCount(r.bytes)} pkts`}
                    </p>
                  )}
                </div>
              )}
              {interactive && r.status !== 'pulling' && (
                <button
                  type="button"
                  data-no-draw
                  aria-label="Remove selection"
                  onClick={() => remove(r.id)}
                  className="absolute -top-[2cqw] -right-[2cqw] flex h-[4.5cqw] w-[4.5cqw] items-center justify-center rounded-full bg-white text-[#26394a] shadow"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-[2.6cqw] w-[2.6cqw]"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                  >
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              )}
              {interactive && onPull && (r.status === 'selected' || r.status === 'failed') && (
                <button
                  type="button"
                  data-no-draw
                  aria-label="Render this area"
                  onClick={() => onPull(r)}
                  disabled={r.bytes === undefined}
                  className="absolute -right-[3cqw] -bottom-[3cqw] flex h-[6.5cqw] w-[6.5cqw] items-center justify-center rounded-full bg-[#2f7dff] text-white shadow-lg transition active:scale-95 disabled:opacity-50"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-[3.5cqw] w-[3.5cqw]"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </button>
              )}
            </div>
          ))}

      {/* Box being drawn */}
      {draft && (
        <div
          className="absolute rounded-[1.5cqw] border-2 border-dashed border-white bg-white/15"
          style={place(draft)}
        />
      )}
    </div>
  )
}

import { useRef } from 'react'
import { estimatePullMs } from '../mesh/mockMesh'
import type { Message } from '../mesh/types'
import { formatBytes, formatSeconds, renderedShare, isFull } from '../media/regions'
import ImageCanvas from './ImageCanvas'
import TransitBar from './TransitBar'

type Props = {
  message: Message & { image: NonNullable<Message['image']> }
  mine: boolean
  kbps: number
  hidden: boolean // the viewer is showing this image full screen
  onOpen: (rect: DOMRect) => void
  onRenderFull: () => void
}

// Chat thumbnail of an image: how much has been rendered, and a button to pull the rest.
// Tapping it opens the full-screen viewer, where specific areas can be selected.
export default function ImageMessage({ message: m, mine, kbps, hidden, onOpen, onRenderFull }: Props) {
  const thumb = useRef<HTMLButtonElement>(null)
  const { image, route } = m
  const hops = route.length - 1

  const share = renderedShare(image.regions)
  const received =
    image.previewBytes + image.regions.filter((r) => r.status === 'done').reduce((a, r) => a + (r.bytes ?? 0), 0)
  const pulling = image.regions.find((r) => r.status === 'pulling')
  const fullUnderway = image.regions.some((r) => isFull(r) && (r.status === 'pulling' || r.status === 'done'))

  // Always show what the preview was; add how much is sharp once anything has arrived
  const preview = `${image.previewSize[0]}×${image.previewSize[1]} preview · ${formatBytes(image.previewBytes)}`
  const summary =
    share === 0
      ? preview
      : share >= 0.999
        ? `${preview} · fully rendered · ${formatBytes(received)}`
        : `${preview} · ${Math.round(share * 100)}%`

  return (
    <div className={`flex flex-col gap-[1.5cqw] ${mine ? 'items-end' : 'items-start'}`}>
      <button
        ref={thumb}
        type="button"
        aria-label="Open image"
        onClick={() => thumb.current && onOpen(thumb.current.getBoundingClientRect())}
        className={`block cursor-zoom-in ${hidden ? 'opacity-0' : ''}`}
      >
        <ImageCanvas
          image={image}
          mine={mine}
          route={route}
          kbps={kbps}
          width={`min(62cqw, ${Math.round(80 * image.aspect)}cqw)`}
        />
      </button>

      {mine ? (
        <p className="px-[1cqw] font-sans text-[2.6cqw] text-white/50">
          Sent as {image.previewSize[0]}×{image.previewSize[1]} preview · {formatBytes(image.previewBytes)}
        </p>
      ) : (
        <div className="flex flex-col items-start gap-[1.5cqw] px-[1cqw]">
          {pulling && <TransitBar transit={pulling.transit ?? null} route={route} kind="pull" className="w-[30cqw]" />}
          {/* Preview size, progress and the render-full button on one line */}
          <div className="flex items-center gap-[2cqw] font-sans text-[2.4cqw] whitespace-nowrap text-white/50">
            <span>{summary}</span>
            {!pulling && !fullUnderway && (
              <button
                type="button"
                onClick={onRenderFull}
                className="rounded-full bg-[#2f7dff]/20 px-[2cqw] py-[0.4cqw] text-[2.3cqw] text-[#a9c9ff] ring-1 ring-[#2f7dff]/40 transition hover:bg-[#2f7dff]/35 active:scale-95"
              >
                Render full {formatSeconds(estimatePullMs(image.fullBytes, hops, kbps))}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

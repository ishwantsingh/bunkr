import { useLayoutEffect, useRef, useState } from 'react'
import { estimatePullMs } from '../mesh/mockMesh'
import type { Message, Region } from '../mesh/types'
import { formatBytes, formatSeconds, renderedShare } from '../media/regions'
import ImageCanvas from './ImageCanvas'

const DURATION_MS = 450
const ease = 'cubic-bezier(0.32,0.72,0,1)'

type Props = {
  message: Message & { image: NonNullable<Message['image']> }
  mine: boolean
  kbps: number
  originRect: DOMRect // thumbnail position to expand from and collapse back to
  onClose: () => void
  onRegionsChange: (update: (regions: Region[]) => Region[]) => void
  onPull: (region: Region) => void
}

// Full-screen image panel inside the phone. The image grows out of its chat
// thumbnail; here the receiver drags boxes over areas to sharpen and pulls them.
export default function ImageViewer({ message: m, mine, kbps, originRect, onClose, onRegionsChange, onPull }: Props) {
  const target = useRef<HTMLDivElement>(null)
  const fromTransform = useRef('none')
  const [closing, setClosing] = useState(false)
  const { image, route } = m
  const hops = route.length - 1

  // Jump the image onto the thumbnail with no transition, force a reflow so the
  // browser commits that position, then transition to its real place. Styles are
  // set directly on the element so this doesn't depend on animation frames.
  useLayoutEffect(() => {
    const el = target.current!
    const t = el.getBoundingClientRect()
    const scale = originRect.width / t.width
    fromTransform.current = `translate(${originRect.left - t.left}px, ${originRect.top - t.top}px) scale(${scale})`
    el.style.transition = 'none'
    el.style.transform = fromTransform.current
    void el.offsetWidth
    el.style.transition = `transform ${DURATION_MS}ms ${ease}`
    el.style.transform = 'none'
  }, [originRect])

  const close = () => {
    target.current!.style.transform = fromTransform.current
    setClosing(true)
    setTimeout(onClose, DURATION_MS)
  }

  const pending = image.regions.filter((r) => r.status === 'selected' || r.status === 'failed')
  const pendingBytes = pending.reduce((a, r) => a + (r.bytes ?? 0), 0)
  const share = renderedShare(image.regions)

  let hint = 'Drag on the image to select areas to sharpen'
  if (mine)
    hint = `You sent a ${image.previewSize[0]}×${image.previewSize[1]} preview · ${formatBytes(image.previewBytes)}`
  else if (pending.length > 0)
    hint = `${pending.length} ${pending.length === 1 ? 'area' : 'areas'} · ${formatBytes(pendingBytes)} · ${formatSeconds(
      estimatePullMs(pendingBytes, hops, kbps),
    )} · tap → on a box to render it`

  // Fade in on mount, fade out while collapsing back to the thumbnail
  const fade = closing ? 'opacity-0 transition-opacity duration-300' : 'animate-[fadein_300ms_ease-out]'

  return (
    <div className="absolute inset-0 z-40 flex flex-col font-sans text-white">
      <div className={`absolute inset-0 bg-[#0b1218]/85 backdrop-blur-xl ${fade}`} onClick={close} />

      <div className={`relative flex items-center justify-between px-[5cqw] pt-[16cqw] ${fade}`}>
        <button
          type="button"
          aria-label="Close"
          onClick={close}
          className="flex h-[9cqw] w-[9cqw] items-center justify-center rounded-full bg-white/20 active:scale-95"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-[4cqw] w-[4cqw]"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
        {!mine && <p className="text-[3cqw] text-white/70">{Math.round(share * 100)}% rendered</p>}
      </div>

      <div className="relative flex flex-1 items-center justify-center">
        <div
          ref={target}
          // transform / transition are driven from the layout effect and close()
          style={{ transformOrigin: 'top left' }}
        >
          <ImageCanvas
            image={image}
            mine={mine}
            route={route}
            kbps={kbps}
            width={`min(90cqw, ${Math.round(130 * image.aspect)}cqw)`}
            interactive={!closing && !mine}
            onRegionsChange={onRegionsChange}
            onPull={onPull}
          />
        </div>
      </div>

      <p className={`relative px-[8cqw] pb-[12cqw] text-center text-[3cqw] text-white/60 ${fade}`}>{hint}</p>
    </div>
  )
}

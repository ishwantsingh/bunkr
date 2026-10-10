import { useEffect, useRef, useState } from 'react'
import { grain } from '../grain'
import type { DeliveryStats, ImageNote, Message, Region, VoiceNote } from '../mesh/types'
import Composer from './Composer'
import ImageMessage from './ImageMessage'
import ImageViewer from './ImageViewer'
import NodeOrb, { type NodeInfo } from './NodeOrb'
import TransitBar from './TransitBar'
import VoiceBubble from './VoiceBubble'

const formatSentAt = (d: Date) =>
  `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`

function StatsLine({ stats, alignRight }: { stats: DeliveryStats; alignRight: boolean }) {
  const { route, packets, bytes, transitMs, snr, resends } = stats
  const hops = route.length - 1
  const rest = [
    `${packets} ${packets === 1 ? 'pkt' : 'pkts'}`,
    `${bytes} B`,
    `${(transitMs / 1000).toFixed(1)} s`,
    ...(snr === undefined ? [] : [`SNR ${snr.toFixed(1)} dB`]),
    ...(resends ? [`${resends} ${resends === 1 ? 'resend' : 'resends'}`] : []),
  ].join(' · ')

  return (
    <p className={`px-[1cqw] font-sans text-[2.6cqw] leading-tight text-white/60 ${alignRight ? 'text-right' : ''}`}>
      <span
        tabIndex={0}
        className="group relative cursor-default underline decoration-dotted underline-offset-2 outline-none"
      >
        {hops} {hops === 1 ? 'hop' : 'hops'}
        {/* Route popover */}
        <span
          className={`pointer-events-none absolute top-full z-20 ${alignRight ? 'right-0' : 'left-0'} mt-[1.5cqw] rounded-[2cqw] bg-white/95 px-[2.5cqw] py-[1.5cqw] whitespace-nowrap text-[2.6cqw] text-slate-700 opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus:opacity-100`}
        >
          {route.join(' → ')}
        </span>
      </span>
      {' · '}
      {rest}
    </p>
  )
}

// Above each bubble: live hop progress while sending, stats once it's confirmed.
function DeliveryStatus({ message: m, mine }: { message: Message; mine: boolean }) {
  if (!mine) {
    if (m.stats) return <StatsLine stats={m.stats} alignRight={false} />
    // Part of a voice note has arrived; the rest is still on its way
    if (m.received)
      return (
        <p className="px-[1cqw] font-sans text-[2.6cqw] leading-tight text-white/60">
          Receiving · {m.received} of {m.packets} packets
        </p>
      )
    return null
  }
  if (m.delivery.status === 'sending') return <TransitBar transit={m.delivery.transit} route={m.route} alignRight />
  if (m.delivery.status === 'failed')
    return (
      <p className="px-[1cqw] text-right font-sans text-[2.6cqw] leading-tight text-amber-300">{m.delivery.reason}</p>
    )
  return m.stats ? <StatsLine stats={m.stats} alignRight /> : null
}

type Props = {
  me: string
  peer: string // who this phone is talking to; shown as the title
  node: NodeInfo
  messages: Message[]
  onSendText: (text: string) => void
  onSendVoice: (voice: VoiceNote) => void
  onSendImage: (image: ImageNote) => void
  onRegionsChange: (messageId: number, update: (regions: Region[]) => Region[]) => void
  onPull: (message: Message, regions?: Region[], isNew?: boolean) => void
  kbps: number
  onError: (message: string) => void
}

// Phone screen content. Sizes use cqw so the UI scales with the PhoneFrame.
export default function ChatScreen({
  me,
  peer,
  node,
  messages,
  onSendText,
  onSendVoice,
  onSendImage,
  onRegionsChange,
  onPull,
  kbps,
  onError,
}: Props) {
  const listRef = useRef<HTMLDivElement>(null)

  const [viewer, setViewer] = useState<{ id: number; rect: DOMRect } | null>(null)
  const viewed = messages.find((m) => m.id === viewer?.id)

  // The recipient only sees a message once it has actually arrived.
  const visible = messages.filter((m) => m.example || m.from === me || m.stats || (m.voice && m.received))

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [visible.length])

  return (
    <div className="flex h-full flex-col bg-[linear-gradient(to_bottom,#7a9fc2_0%,#5f86ab_18%,#3f6181_45%,#26394a_75%,#16222c_100%)] font-serif text-white">
      <div className="absolute inset-0 opacity-[0.15] mix-blend-overlay" style={{ backgroundImage: grain }} />

      {/* Header */}
      {/* Floats over the list: frosted glass, solid at the top fading to clear */}
      <header className="absolute inset-x-0 top-0 z-30 px-[7cqw] pt-[16cqw] pb-[4cqw]">
        <div className="pointer-events-none absolute inset-x-0 top-0 -bottom-[8cqw] bg-linear-to-b from-[#7a9fc2] via-[#729abd]/80 to-transparent backdrop-blur-2xl [mask-image:linear-gradient(to_bottom,black_70%,transparent)]" />
        <h1 className="relative font-display text-[8cqw] leading-[10cqw]">{peer}</h1>
        <div className="absolute top-[16cqw] right-[6cqw]">
          <NodeOrb node={node} />
        </div>
      </header>

      {/* Messages */}
      <div
        ref={listRef}
        className="relative flex flex-1 flex-col gap-[3cqw] overflow-y-auto px-[5cqw] pt-[33cqw] pb-[3cqw] [scrollbar-width:none]"
      >
        {visible.map((m) => {
          const mine = m.from === me
          return (
            <div key={m.id} className={`flex max-w-[80%] flex-col gap-[1cqw] ${mine ? 'self-end' : 'self-start'}`}>
              <DeliveryStatus message={m} mine={mine} />
              {m.image ? (
                <div className={`flex flex-col gap-[1cqw] ${mine ? 'items-end' : 'items-start'}`}>
                  <ImageMessage
                    message={{ ...m, image: m.image }}
                    mine={mine}
                    kbps={kbps}
                    hidden={viewer?.id === m.id}
                    onOpen={(rect) => setViewer({ id: m.id, rect })}
                    onRenderFull={() =>
                      onPull(
                        m,
                        [
                          {
                            id: crypto.randomUUID(),
                            x: 0,
                            y: 0,
                            w: 1,
                            h: 1,
                            bytes: m.image!.fullBytes,
                            status: 'selected',
                          },
                        ],
                        true,
                      )
                    }
                  />
                  <p className="px-[1cqw] font-sans text-[2.8cqw] text-white/50">{formatSentAt(m.sentAt)}</p>
                </div>
              ) : m.voice ? (
                // Voice notes sit directly on the background, no card
                <div className={`flex flex-col gap-[1cqw] ${mine ? 'items-end' : 'items-start'}`}>
                  <VoiceBubble voice={mine || m.stats ? m.voice : {...m.voice, audioUrl: undefined}} available={mine || m.stats ? 1 : (m.received ?? 0) / (m.packets ?? 1)} />
                  <p className="px-[1cqw] font-sans text-[2.8cqw] text-white/50">{formatSentAt(m.sentAt)}</p>
                </div>
              ) : (
                <div
                  className={`relative overflow-hidden rounded-[3cqw] px-[4cqw] py-[3cqw] shadow-lg ${
                    mine ? 'bg-[#34495b]/95' : 'bg-[#26394a]/95'
                  }`}
                >
                  <div
                    className="absolute inset-0 opacity-[0.2] mix-blend-overlay"
                    style={{ backgroundImage: grain }}
                  />
                  <p className="relative text-[4.4cqw] leading-snug text-white/90">{m.text}</p>
                  <p className="relative mt-[1cqw] text-right font-sans text-[2.8cqw] text-white/50">
                    {formatSentAt(m.sentAt)}
                  </p>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {viewer && viewed?.image && (
        <ImageViewer
          message={{ ...viewed, image: viewed.image }}
          mine={viewed.from === me}
          kbps={kbps}
          originRect={viewer.rect}
          onClose={() => setViewer(null)}
          onRegionsChange={(update) => onRegionsChange(viewed.id, update)}
          onPull={(region) => onPull(viewed, [region])}
        />
      )}

      <Composer onError={onError} onSendText={onSendText} onSendVoice={onSendVoice} onSendImage={onSendImage} />
    </div>
  )
}

import type { Transit } from '../mesh/types'

const green = 'bg-[linear-gradient(to_bottom,#b6f59a_0%,#5fd84a_45%,#2fae2a_55%,#3cc236_100%)]'
const amber = 'bg-[linear-gradient(to_bottom,#ffe19a_0%,#f7b23b_50%,#e08f16_100%)]'

type Props = {
  transit: Transit | null
  route: string[] // sender → receiver
  alignRight?: boolean
  kind?: 'send' | 'pull'
  className?: string // bar width
}

// Small macOS-style progress bar with one segment per hop, in two groups:
// send = message out, then ACK back. pull = request to the sender, then data back.
export default function TransitBar({
  transit,
  route,
  alignRight = false,
  kind = 'send',
  className = 'w-[36cqw]',
}: Props) {
  const hops = route.length - 1
  const firstGroup = transit?.phase === 'forward' || transit?.phase === 'request'
  const active = transit ? (firstGroup ? transit.hop : hops + transit.hop) : -1

  let label = kind === 'pull' ? 'Requesting…' : 'Queued'
  if (transit) {
    const eta = `~${Math.max(1, Math.round(transit.etaMs / 1000))} s left`
    if (transit.lost) {
      label = `Packet lost at hop ${transit.hop + 1} · resending`
    } else if (transit.phase === 'request') {
      label = `Requesting · hop ${transit.hop + 1} of ${hops} · ${eta}`
    } else if (transit.phase === 'forward' || transit.phase === 'data') {
      const from = route[transit.hop]
      const to = route[transit.hop + 1]
      const retry = transit.attempt > 1 ? ` · try ${transit.attempt}` : ''
      label =
        transit.packets && transit.packets > 1
          ? `Packet ${(transit.packet ?? 0) + 1}/${transit.packets} · hop ${transit.hop + 1}/${hops}${retry} · ${eta}`
          : `Hop ${transit.hop + 1} of ${hops} · ${from} → ${to}${retry} · ${eta}`
    } else {
      label = `Waiting for ACK · ${eta}`
    }
  }

  const segment = (i: number) => {
    const done = i < active
    const current = i === active
    return (
      <div
        key={i}
        className="relative h-full flex-1 overflow-hidden rounded-full bg-white/15 shadow-[inset_0_1px_1px_rgba(0,0,0,0.35)]"
      >
        {done && <div className={`absolute inset-0 ${green}`} />}
        {current && transit && (
          <div
            // Remount on every try so the fill restarts
            key={`${transit.phase}-${transit.hop}-${transit.attempt}-${transit.lost}`}
            className={`absolute inset-y-0 left-0 ${transit.lost ? `w-full ${amber}` : `${green} animate-[hopfill_linear_forwards]`}`}
            style={transit.lost ? undefined : { animationDuration: `${transit.attemptMs}ms` }}
          />
        )}
      </div>
    )
  }

  return (
    <div className={`flex flex-col gap-[1cqw] px-[1cqw] ${alignRight ? 'items-end' : 'items-start'}`}>
      <p
        className={`font-sans text-[2.6cqw] leading-tight whitespace-nowrap ${transit?.lost ? 'text-amber-300' : 'text-white/60'}`}
      >
        {label}
      </p>
      <div className={`flex h-[1.6cqw] items-center gap-[2cqw] ${className}`}>
        {/* The heavy phase gets the wider group */}
        <div className={`flex h-full gap-[0.6cqw] ${kind === 'pull' ? 'flex-[1] opacity-80' : 'flex-[3]'}`}>
          {Array.from({ length: hops }, (_, i) => segment(i))}
        </div>
        <div className={`flex h-full gap-[0.6cqw] ${kind === 'pull' ? 'flex-[3]' : 'flex-[2] opacity-80'}`}>
          {Array.from({ length: hops }, (_, i) => segment(hops + i))}
        </div>
      </div>
    </div>
  )
}

import { useEffect, useRef } from 'react'
import { formatSimTime, useMesh, type MeshEventKind } from '../mesh/network'

const dot: Record<MeshEventKind, string> = {
  sent: 'bg-slate-400',
  air: 'bg-sky-400',
  hop: 'bg-[#5fd84a]',
  lost: 'bg-amber-400',
  arrived: 'bg-[#3cc236]',
  delivered: 'bg-[#2fae2a] ring-2 ring-[#5fd84a]/40',
  failed: 'bg-red-400',
}

// Actual events from the shared packet engine, oldest first, following the latest event.
export default function MeshTimeline() {
  const events = useMesh((s) => s.events)
  const end = useRef<HTMLDivElement>(null)

  // Scroll only the panel, not the page
  useEffect(() => {
    const panel = end.current?.closest('.overflow-y-auto')
    if (panel) panel.scrollTop = panel.scrollHeight
  }, [events.length])

  if (events.length === 0)
    return (
      <div className="flex h-full items-center justify-center p-6 text-xs text-slate-500">
        No traffic yet. Send something from a phone.
      </div>
    )

  return (
    <ol className="flex flex-col p-4">
      {events.map((e) => (
        <li key={e.id} className="relative flex gap-3 pb-2.5 pl-4 last:pb-0">
          {/* Rail */}
          <span className="absolute top-2 bottom-0 left-[3px] w-px bg-slate-900/10" />
          <span className={`absolute top-1 left-0 h-2 w-2 rounded-full ${dot[e.kind]}`} />
          <span className="w-9 shrink-0 font-mono text-[10px] leading-4 text-slate-400">T+{formatSimTime(e.t)}</span>
          <span className="text-[11px] leading-4">
            <span className="font-semibold text-slate-800">{e.title}</span>{' '}
            <span className="text-slate-500">{e.detail}</span>
          </span>
        </li>
      ))}
      <div ref={end} />
    </ol>
  )
}

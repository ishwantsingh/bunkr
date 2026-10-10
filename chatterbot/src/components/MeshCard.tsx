import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import { MAP_H, MAP_W, MOCK_LINKS, formatSimTime, mesh, useMesh, type MeshEvent, type MeshNode } from '../mesh/network'
import MeshControls from './MeshControls'
import MeshTimeline from './MeshTimeline'

const ease = 'ease-[cubic-bezier(0.32,0.72,0,1)]'
const green = 'bg-[#3cc236]'

// Space between the two phones (each is 90% of the viewport height minus padding, at 426:898).
const between = 'calc(100vw - 7rem - 0.8538 * (100dvh - 4rem))'

const pct = (n: MeshNode) => ({ left: `${(n.x / MAP_W) * 100}%`, top: `${(n.y / MAP_H) * 100}%` })

// Current time, refreshed every `ms` (drives the clock and clears finished packets).
function useNow(ms = 500) {
  const [now, setNow] = useState(() => performance.now())
  useEffect(() => {
    const id = setInterval(() => setNow(performance.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}

// A packet travelling along one link, from `from` to `to` over `durationMs`.
function PacketDot({ event, nodes }: { event: MeshEvent; nodes: MeshNode[] }) {
  const el = useRef<HTMLSpanElement>(null)
  const from = nodes.find((n) => n.id === event.from)
  const to = nodes.find((n) => n.id === event.to)

  useLayoutEffect(() => {
    if (!el.current || !from || !to) return
    const elapsed = performance.now() - mesh.get().startedAt - event.t
    const duration = event.durationMs ?? 1000
    if (elapsed >= duration) return
    const anim = el.current.animate([pct(from), pct(to)], { duration, easing: 'linear', fill: 'forwards' })
    anim.currentTime = elapsed
    anim.onfinish = () => el.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' })
    return () => anim.cancel()
    // Positions are read once at launch; a moved node doesn't redirect packets already in the air
  }, [event.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!from || !to) return null
  return (
    <span
      ref={el}
      className={`pointer-events-none absolute z-10 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ${green} shadow-[0_0_10px_3px_rgba(95,216,74,0.7)]`}
      style={pct(from)}
    />
  )
}

// Where a packet was lost: a brief amber pulse halfway along the link.
function LossMark({ event, nodes }: { event: MeshEvent; nodes: MeshNode[] }) {
  const from = nodes.find((n) => n.id === event.from)
  const to = nodes.find((n) => n.id === event.to)
  if (!from || !to) return null
  return (
    <span
      className="pointer-events-none absolute z-10 h-3 w-3 -translate-x-1/2 -translate-y-1/2 animate-[lossfade_1.6s_ease-out_forwards] rounded-full bg-amber-400 ring-4 ring-amber-300/40"
      style={{
        left: `${((from.x + to.x) / 2 / MAP_W) * 100}%`,
        top: `${((from.y + to.y) / 2 / MAP_H) * 100}%`,
      }}
    />
  )
}

type Tab = 'controls' | 'timeline'

// Glass gear that grows into a two-tab switcher (controls · timeline) with a sliding highlight.
function SettingsPill({ tab, onChange }: { tab: Tab | null; onChange: (t: Tab | null) => void }) {
  const open = tab !== null
  const btn = 'relative z-10 flex h-8 w-8 items-center justify-center rounded-full text-slate-600 transition-colors'
  return (
    <div
      className={`relative flex h-9 items-center justify-end overflow-hidden rounded-full bg-white/50 p-0.5 ring-1 ring-white/70 backdrop-blur-xl transition-[width] duration-500 ${ease} ${
        open ? 'w-[6.75rem]' : 'w-9'
      }`}
    >
      {/* Sliding highlight behind the active tab */}
      <span
        className={`absolute top-0.5 left-0.5 h-8 w-8 rounded-full bg-white shadow-sm transition-all duration-500 ${ease} ${
          open ? 'opacity-100' : 'opacity-0'
        } ${tab === 'timeline' ? 'translate-x-8' : 'translate-x-0'}`}
      />
      <div className={`flex transition-opacity duration-300 ${open ? 'opacity-100 delay-150' : 'opacity-0'}`}>
        <button
          type="button"
          aria-label="Simulation controls"
          onClick={() => onChange('controls')}
          className={`${btn} ${tab === 'controls' ? 'text-slate-900' : 'hover:text-slate-900'}`}
        >
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M6 4v16M12 4v16M18 4v16" />
            <circle cx="6" cy="14" r="2.2" fill="white" />
            <circle cx="12" cy="8" r="2.2" fill="white" />
            <circle cx="18" cy="16" r="2.2" fill="white" />
          </svg>
        </button>
        <button
          type="button"
          aria-label="Event timeline"
          onClick={() => onChange('timeline')}
          className={`${btn} ${tab === 'timeline' ? 'text-slate-900' : 'hover:text-slate-900'}`}
        >
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <circle cx="12" cy="12" r="8.5" />
            <path d="M12 7.5V12l3 2" />
          </svg>
        </button>
      </div>
      <button
        type="button"
        aria-label={open ? 'Close settings' : 'Settings'}
        onClick={() => onChange(open ? null : 'controls')}
        className={`${btn} shrink-0 hover:text-slate-900`}
      >
        <svg
          viewBox="0 0 24 24"
          className={`h-4 w-4 transition-transform duration-500 ${open ? 'rotate-90' : ''}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {open ? (
            <path d="M7 7l10 10M17 7L7 17" />
          ) : (
            <>
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </>
          )}
        </svg>
      </button>
    </div>
  )
}

// Rows that fold away to nothing when the card is at rest.
function Reveal({ show, children }: { show: boolean; children: React.ReactNode }) {
  return (
    <div
      className={`grid transition-[grid-template-rows,opacity] duration-500 ${ease} ${
        show ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
      }`}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  )
}

// Floating glass card between the phones: a mock map of the 5-node mesh. At rest it
// is just green dots; hovering expands it to show links, live packets, a legend and
// stats. The gear opens simulation controls and an event timeline.
export default function MeshCard() {
  const nodes = useMesh((s) => s.nodes)
  const events = useMesh((s) => s.events)
  const stats = useMesh((s) => s.stats)
  const startedAt = useMesh((s) => s.startedAt)

  const [hover, setHover] = useState(false)
  const [tab, setTab] = useState<Tab | null>(null)
  const [selected, setSelected] = useState(nodes[0].id)
  const [dragging, setDragging] = useState<string | null>(null)
  const map = useRef<HTMLDivElement>(null)

  const expanded = hover || tab !== null || dragging !== null
  const now = useNow() - startedAt

  // Packets on air right now, and losses in the last moment
  const flying = events.filter((e) => e.kind === 'air' && now < e.t + (e.durationMs ?? 0))
  const losses = events.filter((e) => e.kind === 'lost' && now < e.t + 1600)
  const activeLinks = new Set(flying.map((e) => [e.from, e.to].sort().join('|')))
  const transmitting = new Set(flying.map((e) => e.from))
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const sel = byId.get(selected)!

  const drag = (e: PointerEvent, id: string) => {
    if (!expanded || tab !== null) return
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setDragging(id)
    setSelected(id)
  }
  const move = (e: PointerEvent) => {
    if (!dragging || !map.current) return
    const r = map.current.getBoundingClientRect()
    const clamp = (v: number, max: number) => Math.round(Math.min(max, Math.max(0, v)))
    mesh.updateNode(dragging, {
      x: clamp(((e.clientX - r.left) / r.width) * MAP_W, MAP_W),
      y: clamp(((e.clientY - r.top) / r.height) * MAP_H, MAP_H),
    })
  }

  const statItems: [string, string][] = [
    ['Sim time', formatSimTime(now)],
    ['On-air bytes', stats.bytesOnAir < 1000 ? `${stats.bytesOnAir} B` : `${(stats.bytesOnAir / 1000).toFixed(1)} KB`],
    ['Airtime', `${(stats.airtimeMs / 1000).toFixed(1)} s`],
    ['Lost hops', `${stats.lostHops}`],
    ['In flight', `${flying.length}`],
  ]

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={`absolute top-1/2 left-1/2 z-20 -translate-x-1/2 -translate-y-1/2 rounded-[28px] bg-linear-to-b from-white/95 via-white/85 to-white/70 p-3 font-sans text-slate-700 shadow-[0_50px_60px_-40px_rgba(8,20,40,0.35),inset_0_1px_0_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(255,255,255,0.5)] ring-1 ring-white backdrop-blur-2xl backdrop-saturate-[1.8] transition-[width,padding] duration-500 ${ease} ${
        // Gentle bob at rest so it reads as floating; held still while in use
        expanded ? 'p-4' : 'animate-[float_6s_ease-in-out_infinite]'
      }`}
      style={{ width: `min(${expanded ? 640 : 300}px, ${between})` }}
    >
      <Reveal show={expanded}>
        <div className="flex items-center justify-between pb-3 pl-1">
          <p className="flex items-center gap-2 text-xs font-medium text-slate-600">
            <span className={`h-2 w-2 rounded-full ${green}`} />
            {nodes.filter((n) => n.online).length} of {nodes.length} nodes online
          </p>
          <SettingsPill tab={tab} onChange={setTab} />
        </div>
      </Reveal>

      {/* Map */}
      <div
        ref={map}
        onPointerMove={move}
        onPointerUp={() => setDragging(null)}
        className={`relative aspect-[16/10] w-full overflow-hidden rounded-[20px] transition-colors duration-500 ${
          expanded ? 'bg-white/35 ring-1 ring-white/60' : 'bg-transparent'
        }`}
      >
        <svg
          viewBox={`0 0 ${MAP_W} ${MAP_H}`}
          preserveAspectRatio="none"
          className={`absolute inset-0 h-full w-full transition-opacity duration-500 ${expanded ? 'opacity-100' : 'opacity-0'}`}
        >
          {/* Range of the selected node */}
          <ellipse
            cx={sel.x}
            cy={sel.y}
            rx={sel.range}
            ry={sel.range}
            className="fill-[#5fd84a]/5 stroke-[#2fae2a]/40"
            strokeDasharray="2 2"
            vectorEffect="non-scaling-stroke"
          />
          {MOCK_LINKS.map(([a, b]) => {
            const na = byId.get(a)
            const nb = byId.get(b)
            if (!na || !nb || !na.online || !nb.online) return null
            const active = activeLinks.has([a, b].sort().join('|'))
            return (
              <line
                key={`${a}-${b}`}
                x1={na.x}
                y1={na.y}
                x2={nb.x}
                y2={nb.y}
                vectorEffect="non-scaling-stroke"
                strokeDasharray={active ? undefined : '3 4'}
                className={active ? 'stroke-[#3cc236]' : 'stroke-slate-500/35'}
                strokeWidth={active ? 2.5 : 1}
              />
            )
          })}
        </svg>

        {flying.map((e) => (
          <PacketDot key={e.id} event={e} nodes={nodes} />
        ))}
        {expanded && losses.map((e) => <LossMark key={e.id} event={e} nodes={nodes} />)}

        {nodes.map((n) => (
          <div
            key={n.id}
            className="absolute z-20 -translate-x-1/2 -translate-y-1/2 transition-[left,top] duration-75"
            style={pct(n)}
          >
            <button
              type="button"
              aria-label={`Node ${n.letter}`}
              onPointerDown={(e) => drag(e, n.id)}
              onClick={() => setSelected(n.id)}
              className={`relative block rounded-full transition-all duration-500 ${ease} ${
                n.online ? green : 'bg-slate-400/70'
              } ${expanded ? (n.name ? 'h-5 w-5' : 'h-4 w-4') : n.name ? 'h-3 w-3' : 'h-2.5 w-2.5'} ${
                expanded && tab === null ? 'cursor-grab active:cursor-grabbing' : ''
              } ${selected === n.id && expanded ? 'ring-4 ring-white/80' : ''}`}
            >
              {transmitting.has(n.id) && (
                <span className="absolute inset-0 animate-ping rounded-full bg-[#5fd84a]/60" />
              )}
            </button>
            {/* Label under the dot: just the people at rest, every node when expanded */}
            <span
              className={`absolute top-full left-1/2 mt-1.5 -translate-x-1/2 text-[10px] font-semibold tracking-wider whitespace-nowrap text-slate-600 uppercase transition-opacity duration-300 ${
                expanded || n.name ? 'opacity-100' : 'opacity-0'
              }`}
            >
              {expanded ? `${n.letter}${n.name ? ` · ${n.name}` : ''}` : n.name}
            </span>
          </div>
        ))}

        {/* Settings panel slides over the map */}
        <div
          className={`absolute inset-0 z-30 overflow-y-auto rounded-[20px] bg-white/70 backdrop-blur-xl transition-all duration-500 ${ease} ${
            tab ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-4 opacity-0'
          }`}
        >
          {tab === 'controls' && <MeshControls selected={selected} onSelect={setSelected} />}
          {tab === 'timeline' && <MeshTimeline />}
        </div>
      </div>

      <Reveal show={expanded}>
        {/* Legend */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 pt-3 text-[11px] text-slate-600">
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded bg-[#3cc236]" /> Active hop
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0 w-4 border-t border-dashed border-slate-500/60" /> Reachable link
          </span>
          <span className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${green}`} /> In transit
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-amber-400" /> Lost attempt
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-slate-400/70" /> Offline
          </span>
        </div>
        {/* Stats */}
        <div className="mt-3 grid grid-cols-5 gap-2 border-t border-white/60 px-1 pt-3">
          {statItems.map(([label, value]) => (
            <div key={label}>
              <p className="text-[9px] font-semibold tracking-[0.12em] text-slate-500 uppercase">{label}</p>
              <p className="text-sm font-medium text-slate-800 tabular-nums">{value}</p>
            </div>
          ))}
        </div>
      </Reveal>
    </div>
  )
}

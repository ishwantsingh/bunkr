import { useState } from 'react'

export type NodeInfo = {
  shortName: string // 4-char Meshtastic-style short name
  id: string // node ID, e.g. !a3f2
  preset: string // modem preset, e.g. Short Turbo
  kbps: number
  meshSize: number // nodes heard on the mesh, including this one
  hopLimit: number
}

export const orbGradient =
  'bg-[radial-gradient(circle_at_50%_30%,#ffffff_0%,#dbe7f3_35%,#4f8fd6_65%,#1d5bb5_100%)]'

// Connected-node badge: a blue orb that morphs into a details card on hover or tap.
export default function NodeOrb({ node }: { node: NodeInfo }) {
  const [open, setOpen] = useState(false)
  const ease = 'ease-[cubic-bezier(0.32,0.72,0,1)]'

  const rows: [string, string][] = [
    ['Preset', `${node.preset} · ${node.kbps} kbps`],
    ['Mesh', `${node.meshSize} nodes`],
    ['Hop limit', `${node.hopLimit}`],
  ]

  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={open}
      aria-label={`Node ${node.shortName}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onClick={() => setOpen((o) => !o)}
      onBlur={() => setOpen(false)}
      className={`absolute top-0 right-0 z-30 cursor-pointer overflow-hidden rounded-[5cqw] outline-none transition-all duration-500 ${ease} ${
        open
          ? 'h-[36cqw] w-[62cqw] bg-white/90 shadow-2xl backdrop-blur-xl'
          : 'h-[10cqw] w-[10cqw] bg-white/0 shadow-lg'
      }`}
    >
      {/* The orb stays pinned top-right and shrinks into the card's icon */}
      <div
        className={`absolute top-0 right-0 rounded-full ${orbGradient} transition-all duration-500 ${ease} ${
          open ? 'm-[3cqw] h-[7cqw] w-[7cqw]' : 'm-0 h-[10cqw] w-[10cqw]'
        }`}
      />

      {/* Details fade in once the card has mostly grown */}
      <div
        className={`absolute inset-0 px-[4cqw] py-[3cqw] font-sans text-slate-700 transition-opacity ${
          open ? 'opacity-100 delay-200 duration-300' : 'opacity-0 duration-150'
        }`}
      >
        <p className="font-display text-[6cqw] leading-[7cqw] text-slate-900">ColHack Mesh</p>
        <p className="flex items-center gap-[1.5cqw] text-[2.8cqw] text-slate-500">
          <span className="h-[1.6cqw] w-[1.6cqw] rounded-full bg-emerald-500" />
          Connected · {node.shortName} · {node.id}
        </p>
        <dl className="mt-[2.5cqw] space-y-[1cqw] text-[3cqw]">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-[3cqw]">
              <dt className="text-slate-500">{label}</dt>
              <dd className="font-medium whitespace-nowrap">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}

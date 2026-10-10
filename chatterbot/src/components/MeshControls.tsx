import { MAP_H, MAP_W, PRESETS, mesh, useMesh } from '../mesh/network'

const label = 'text-[11px] font-medium text-slate-500'
const value = 'text-[11px] font-semibold text-[#2fae2a] tabular-nums'
const slider = 'h-1 w-full cursor-pointer accent-[#3cc236]'

// Mock simulation controls. They only change what the mesh card shows.
export default function MeshControls({ selected, onSelect }: { selected: string; onSelect: (id: string) => void }) {
  const preset = useMesh((s) => s.preset)
  const lossPct = useMesh((s) => s.lossPct)
  const seed = useMesh((s) => s.seed)
  const nodes = useMesh((s) => s.nodes)
  const node = nodes.find((n) => n.id === selected)!
  const kbps = PRESETS.find((p) => p.name === preset)?.kbps

  const field = (name: string, val: number, max: number, key: 'x' | 'y' | 'range', min = 0) => (
    <label className="flex flex-col gap-1">
      <span className="flex justify-between">
        <span className={label}>{name}</span>
        <span className={value}>{val}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={val}
        onChange={(e) => mesh.updateNode(node.id, { [key]: Number(e.target.value) })}
        className={slider}
      />
    </label>
  )

  return (
    <div className="flex flex-col gap-3 p-4 text-slate-700">
      <label className="flex flex-col gap-1">
        <span className="flex justify-between">
          <span className={label}>Radio preset</span>
          <span className={value}>{kbps} kbps</span>
        </span>
        <select
          value={preset}
          onChange={(e) => mesh.setPreset(e.target.value)}
          className="h-8 rounded-xl bg-white/80 px-2.5 text-xs font-medium ring-1 ring-slate-900/5 outline-none"
        >
          {PRESETS.map((p) => (
            <option key={p.name}>{p.name}</option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="flex justify-between">
          <span className={label}>Packet loss per hop</span>
          <span className={value}>{lossPct}%</span>
        </span>
        <input
          type="range"
          min={0}
          max={100}
          value={lossPct}
          onChange={(e) => mesh.setLossPct(Number(e.target.value))}
          className={slider}
        />
      </label>

      <div className="h-px bg-slate-900/5" />

      <div className="flex items-center justify-between">
        <span className={label}>Node</span>
        <div className="flex gap-1">
          {nodes.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => onSelect(n.id)}
              className={`h-6 min-w-6 rounded-full px-2 text-[11px] font-semibold transition ${
                n.id === selected ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {n.letter}
            </button>
          ))}
        </div>
      </div>
      <p className="-mt-2 text-[11px] text-slate-500">
        {node.name ? `${node.name}'s phone` : 'Relay'} · {node.id}
      </p>

      <div className="grid grid-cols-3 gap-3">
        {field('X', node.x, MAP_W, 'x')}
        {field('Y', node.y, MAP_H, 'y')}
        {field('Range', node.range, 120, 'range', 10)}
      </div>

      <label className="flex cursor-pointer items-center justify-between">
        <span className={label}>Node online</span>
        <span className="relative inline-flex">
          <input
            type="checkbox"
            checked={node.online}
            onChange={(e) => mesh.updateNode(node.id, { online: e.target.checked })}
            className="peer sr-only"
          />
          <span className="h-5 w-9 rounded-full bg-slate-300 transition peer-checked:bg-[#3cc236]" />
          <span className="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition peer-checked:translate-x-4" />
        </span>
      </label>

      <div className="h-px bg-slate-900/5" />

      <div className="flex items-end gap-2">
        <label className="flex flex-1 flex-col gap-1">
          <span className={label}>Scenario seed</span>
          <input
            type="number"
            value={seed}
            onChange={(e) => mesh.setSeed(Number(e.target.value))}
            className="h-8 rounded-xl bg-white/80 px-2.5 text-xs font-medium tabular-nums ring-1 ring-slate-900/5 outline-none"
          />
        </label>
        <button
          type="button"
          onClick={mesh.reset}
          className="h-8 rounded-xl bg-white/80 px-3 text-xs font-semibold text-slate-700 ring-1 ring-slate-900/5 transition hover:bg-white active:scale-95"
        >
          Reset
        </button>
      </div>
    </div>
  )
}

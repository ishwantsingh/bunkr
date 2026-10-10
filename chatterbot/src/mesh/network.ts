import { useSyncExternalStore } from 'react'

// Reference mesh-card state. Controls feed the shared packet engine through
// MediaRuntime, and counters/links/events come back from its actual transmissions.

export type MeshNode = {
  id: string // Meshtastic-style node ID, matching the routes in messages
  letter: string
  name?: string // person holding this phone, for endpoint nodes
  x: number // map units, 0–MAP_W
  y: number // map units, 0–MAP_H
  range: number // map units
  online: boolean
}

export type MeshEventKind = 'sent' | 'air' | 'lost' | 'hop' | 'arrived' | 'delivered' | 'failed'

export type MeshEvent = {
  id: number
  t: number // ms since the demo started
  kind: MeshEventKind
  title: string
  detail: string
  from?: string
  to?: string
  durationMs?: number // for 'air': how long this transmission takes
}

export const PRESETS = [
  { name: 'Short Turbo', kbps: 21.88 },
  { name: 'Medium Fast', kbps: 3.52 },
  { name: 'Long Fast', kbps: 1.07 },
  { name: 'Long Moderate', kbps: 0.34 },
]

export const MAP_W = 160
export const MAP_H = 100
const MAX_EVENTS = 400

const defaultNodes = (): MeshNode[] => [
  { id: '!a3f2', letter: 'A', name: 'Richard', x: 22, y: 58, range: 60, online: true },
  { id: '!19b4', letter: 'B', x: 58, y: 24, range: 60, online: true },
  { id: '!e05d', letter: 'C', x: 100, y: 36, range: 60, online: true },
  { id: '!4a8c', letter: 'D', x: 74, y: 80, range: 60, online: true },
  { id: '!7c1e', letter: 'E', name: 'Maya', x: 138, y: 58, range: 60, online: true },
]

export type State = {
  preset: string
  lossPct: number
  seed: number
  nodes: MeshNode[]
  events: MeshEvent[]
  stats: { bytesOnAir: number; airtimeMs: number; lostHops: number }
  inFlight: number
  timeMs: number
  links: [string, string][]
  startedAt: number
}

const initial = (keep?: Partial<State>): State => ({
  preset: keep?.preset ?? PRESETS[0].name,
  lossPct: keep?.lossPct ?? 20,
  seed: keep?.seed ?? 16,
  nodes: defaultNodes(),
  events: [],
  stats: { bytesOnAir: 0, airtimeMs: 0, lostHops: 0 },
  inFlight: 0,
  timeMs: 0,
  links: [],
  startedAt: performance.now(),
})

let state = initial()
let nextEventId = 1
const listeners = new Set<() => void>()

const set = (patch: Partial<State>) => {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

let controls: {change: (settings: State) => void; reset: (settings: State) => void} | null = null
export const mesh = {
  connect: (handlers: typeof controls) => { controls = handlers },
  observe: (patch: Partial<State>) => set(patch),
  get: () => state,
  subscribe: (l: () => void) => {
    listeners.add(l)
    return () => listeners.delete(l)
  },

  setPreset: (preset: string) => { set({ preset }); controls?.change(state) },
  setLossPct: (lossPct: number) => { set({ lossPct }); controls?.change(state) },
  setSeed: (seed: number) => set({ seed }),
  updateNode: (id: string, patch: Partial<MeshNode>) =>
    { set({ nodes: state.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }); controls?.change(state) },
  reset: () => {
    state = initial(state)
    controls?.reset(state)
    listeners.forEach((l) => l())
  },

  emit: (e: Omit<MeshEvent, 'id' | 't'>) => {
    const event = { ...e, id: nextEventId++, t: performance.now() - state.startedAt }
    set({ events: [...state.events, event].slice(-MAX_EVENTS) })
  },

}

// Subscribe to a slice of the state. Return primitives or stable references.
export function useMesh<T>(select: (s: State) => T): T {
  return useSyncExternalStore(mesh.subscribe, () => select(state))
}

export const letterOf = (id: string) => state.nodes.find((n) => n.id === id)?.letter ?? id

export const formatSimTime = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

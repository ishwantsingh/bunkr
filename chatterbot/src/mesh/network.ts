import { useSyncExternalStore } from 'react'

// UI-only state for the mesh card: a fixed mock node layout, control values and
// a log of events the mock mesh reports. Nothing here drives packet behaviour;
// the real simulation lives in the backend and can feed the same events later.

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
  { name: 'Short Fast', kbps: 10.94 },
  { name: 'Short Slow', kbps: 6.25 },
  { name: 'Medium Fast', kbps: 3.52 },
  { name: 'Medium Slow', kbps: 1.95 },
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

// Mock "reachable" links drawn on the map: every pair the mock routes can use.
export const MOCK_LINKS: [string, string][] = [
  ['!a3f2', '!19b4'],
  ['!a3f2', '!e05d'],
  ['!a3f2', '!4a8c'],
  ['!19b4', '!e05d'],
  ['!19b4', '!4a8c'],
  ['!e05d', '!4a8c'],
  ['!19b4', '!7c1e'],
  ['!e05d', '!7c1e'],
  ['!4a8c', '!7c1e'],
]

type State = {
  preset: string
  lossPct: number
  seed: number
  nodes: MeshNode[]
  events: MeshEvent[]
  stats: { bytesOnAir: number; airtimeMs: number; lostHops: number }
  startedAt: number
}

const initial = (keep?: Partial<State>): State => ({
  preset: keep?.preset ?? PRESETS[0].name,
  lossPct: keep?.lossPct ?? 20,
  seed: keep?.seed ?? 16,
  nodes: defaultNodes(),
  events: [],
  stats: { bytesOnAir: 0, airtimeMs: 0, lostHops: 0 },
  startedAt: performance.now(),
})

let state = initial()
let nextEventId = 1
const listeners = new Set<() => void>()

const set = (patch: Partial<State>) => {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

export const mesh = {
  get: () => state,
  subscribe: (l: () => void) => {
    listeners.add(l)
    return () => listeners.delete(l)
  },

  setPreset: (preset: string) => set({ preset }),
  setLossPct: (lossPct: number) => set({ lossPct }),
  setSeed: (seed: number) => set({ seed }),
  updateNode: (id: string, patch: Partial<MeshNode>) =>
    set({ nodes: state.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }),
  reset: () => {
    state = initial(state)
    listeners.forEach((l) => l())
  },

  emit: (e: Omit<MeshEvent, 'id' | 't'>) => {
    const event = { ...e, id: nextEventId++, t: performance.now() - state.startedAt }
    set({ events: [...state.events, event].slice(-MAX_EVENTS) })
  },
  addTraffic: (bytes: number, airtimeMs: number) =>
    set({
      stats: {
        ...state.stats,
        bytesOnAir: state.stats.bytesOnAir + bytes,
        airtimeMs: state.stats.airtimeMs + airtimeMs,
      },
    }),
  addLostHop: () => set({ stats: { ...state.stats, lostHops: state.stats.lostHops + 1 } }),
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

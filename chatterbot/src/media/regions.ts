import type { Region } from '../mesh/types'

export const formatBytes = (b: number) => (b < 1000 ? `${b} B` : `${(b / 1000).toFixed(1)} KB`)
export const formatSeconds = (ms: number) =>
  ms < 60_000 ? `~${Math.round(ms / 1000)} s` : `~${(ms / 60_000).toFixed(1)} min`

export const isFull = (r: Pick<Region, 'w' | 'h'>) => r.w >= 0.999 && r.h >= 0.999

// Share of the image covered by sharp regions (0–1), sampled on a grid so overlaps count once.
export function renderedShare(regions: Pick<Region, 'x' | 'y' | 'w' | 'h'>[]) {
  const done = regions
  if (done.some(isFull)) return 1
  const N = 40
  let hit = 0
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) {
      const x = (i + 0.5) / N
      const y = (j + 0.5) / N
      if (done.some((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h)) hit++
    }
  return hit / (N * N)
}

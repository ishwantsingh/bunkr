import { useCallback, useEffect, useRef, useState } from 'react'
import type { VoiceNote } from '../mesh/types'

const NOTE_BARS = 28 // waveform bars kept for the sent voice note

const idleLevels = (bars: number) => Array<number>(bars).fill(0.15)

// Average `values` into `count` buckets, normalised so the loudest is 1.
const downsample = (values: number[], count: number) => {
  if (values.length === 0) return idleLevels(count)
  const out = Array.from({ length: count }, (_, i) => {
    const from = Math.floor((i * values.length) / count)
    const to = Math.max(from + 1, Math.floor(((i + 1) * values.length) / count))
    const slice = values.slice(from, to)
    return slice.reduce((a, b) => a + b, 0) / slice.length
  })
  const max = Math.max(...out, 0.01)
  return out.map((v) => Math.max(0.12, v / max))
}

// Records from the mic and exposes live, symmetric waveform levels (0–1).
// Falls back to a simulated waveform if the mic is unavailable.
export function useVoiceRecorder(bars = 18) {
  const [recording, setRecording] = useState(false)
  const [levels, setLevels] = useState(() => idleLevels(bars))

  const session = useRef(0)
  const stream = useRef<MediaStream | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const audioCtx = useRef<AudioContext | null>(null)
  const raf = useRef(0)
  const startedAt = useRef(0)
  const history = useRef<number[]>([])

  const teardown = useCallback(() => {
    cancelAnimationFrame(raf.current)
    stream.current?.getTracks().forEach((t) => t.stop())
    audioCtx.current?.close()
    stream.current = null
    audioCtx.current = null
  }, [])

  useEffect(() => teardown, [teardown])

  const start = useCallback(async () => {
    const id = ++session.current
    setRecording(true)
    history.current = []
    chunks.current = []
    recorder.current = null
    startedAt.current = performance.now()
    const half = bars / 2

    // Center bars are loudest, edges taper off like the reference design.
    const mirror = (halfLevels: number[]) => {
      const shaped = halfLevels.map((v, i) => Math.max(0.12, Math.min(1, v * (1 - (i / half) * 0.5))))
      return [...[...shaped].reverse(), ...shaped]
    }

    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (id !== session.current) {
        s.getTracks().forEach((t) => t.stop())
        return
      }
      stream.current = s
      const rec = new MediaRecorder(s)
      rec.ondataavailable = (e) => chunks.current.push(e.data)
      rec.start()
      recorder.current = rec

      const ctx = new AudioContext()
      audioCtx.current = ctx
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 64
      analyser.smoothingTimeConstant = 0.7
      ctx.createMediaStreamSource(s).connect(analyser)
      const data = new Uint8Array(analyser.frequencyBinCount)

      const tick = () => {
        analyser.getByteFrequencyData(data)
        const halfLevels = Array.from({ length: half }, (_, i) => data[i + 1] / 200)
        history.current.push(data.slice(1, 12).reduce((a, b) => a + b, 0) / (11 * 255))
        setLevels(mirror(halfLevels))
        raf.current = requestAnimationFrame(tick)
      }
      tick()
    } catch {
      // No mic (denied or unsupported): animate a plausible waveform instead.
      const tick = (t: number) => {
        const halfLevels = Array.from(
          { length: half },
          (_, i) => 0.45 + 0.4 * Math.sin(t / 140 + i * 0.9) * Math.sin(t / 370 + i * 0.4),
        )
        history.current.push(0.3 + 0.3 * Math.abs(Math.sin(t / 300)))
        setLevels(mirror(halfLevels))
        raf.current = requestAnimationFrame(tick)
      }
      raf.current = requestAnimationFrame(tick)
    }
  }, [bars])

  // Ends the recording. Returns the note when `keep` is true, otherwise discards it.
  const stop = useCallback(
    async (keep: boolean): Promise<VoiceNote | null> => {
      session.current++
      const durationMs = Math.round(performance.now() - startedAt.current)
      const rec = recorder.current
      recorder.current = null

      let audioUrl: string | undefined
      if (rec && rec.state !== 'inactive') {
        await new Promise<void>((resolve) => {
          rec.onstop = () => resolve()
          rec.stop()
        })
        if (keep) audioUrl = URL.createObjectURL(new Blob(chunks.current, { type: rec.mimeType }))
      }
      teardown()
      setRecording(false)
      setLevels(idleLevels(bars))

      if (!keep) return null
      return { durationMs, levels: downsample(history.current, NOTE_BARS), audioUrl }
    },
    [bars, teardown],
  )

  return { recording, levels, start, stop }
}

import { useEffect, useRef, useState } from 'react'
import { CODEC2_BPS, voiceBytes } from '../mesh/mockMesh'
import type { VoiceNote } from '../mesh/types'

const formatDuration = (ms: number) => {
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

type Props = {
  voice: VoiceNote
  available?: number // 0–1 share of the clip that has arrived; Codec2 is constant-bitrate, so bytes map to time
}

// Voice note: play/pause, waveform and on-air size. While packets are still
// arriving, unreceived bars are greyed out and playback stops at the edge of
// what has arrived, resuming by itself when the next packet lands.
export default function VoiceBubble({ voice, available = 1 }: Props) {
  const audio = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [waiting, setWaiting] = useState(false) // playing, but caught up with what has arrived
  const [progress, setProgress] = useState(0)

  const durationSec = voice.durationMs / 1000
  const availableSec = available * durationSec
  const complete = available >= 1

  useEffect(() => () => audio.current?.pause(), [])

  // While playing a partial clip, stop right at the edge of what has arrived.
  useEffect(() => {
    if (!playing || waiting || complete) return
    let raf = 0
    const watch = () => {
      const a = audio.current
      if (a && a.currentTime >= availableSec - 0.03) {
        a.pause()
        setWaiting(true)
        return
      }
      raf = requestAnimationFrame(watch)
    }
    raf = requestAnimationFrame(watch)
    return () => cancelAnimationFrame(raf)
  }, [playing, waiting, complete, availableSec])

  // More audio arrived while waiting at the edge: carry on.
  useEffect(() => {
    const a = audio.current
    if (waiting && a && a.currentTime < availableSec - 0.05) {
      a.play()
      setWaiting(false)
    }
  }, [waiting, availableSec])

  const toggle = () => {
    if (!voice.audioUrl) return
    if (!audio.current) {
      const a = new Audio(voice.audioUrl)
      a.ontimeupdate = () => setProgress(a.currentTime / durationSec)
      a.onended = () => {
        setPlaying(false)
        setWaiting(false)
        setProgress(0)
      }
      audio.current = a
    }
    const a = audio.current
    if (playing) {
      a.pause()
      setPlaying(false)
      setWaiting(false)
    } else if (!complete && a.currentTime >= availableSec - 0.05) {
      setPlaying(true)
      setWaiting(true) // nothing new to play yet; starts when the next packet lands
    } else {
      a.play()
      setPlaying(true)
    }
  }

  const bars = voice.levels.length
  const played = Math.floor(progress * bars)
  const received = complete ? bars : Math.floor(available * bars)
  const totalBytes = voiceBytes(voice.durationMs)

  return (
    <div className="relative grid grid-cols-[auto_auto] items-center gap-x-[3cqw] gap-y-[1cqw]">
      <button
        type="button"
        aria-label={playing ? 'Pause' : 'Play'}
        onClick={toggle}
        disabled={!voice.audioUrl || available === 0}
        className="flex h-[9cqw] w-[9cqw] shrink-0 items-center justify-center rounded-full bg-white text-[#26394a] disabled:opacity-40"
      >
        <svg viewBox="0 0 24 24" className="h-[4cqw] w-[4cqw]" fill="currentColor">
          {playing ? <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /> : <path d="M8 5.5v13l11-6.5z" />}
        </svg>
      </button>
      <div className="flex h-[7cqw] items-center gap-[0.6cqw]">
        {voice.levels.map((level, i) => (
          <span
            key={i}
            className={`w-[0.7cqw] rounded-full transition-colors duration-500 ${
              i < played ? 'bg-white' : i < received ? 'bg-white/45' : 'bg-white/15'
            }`}
            style={{ height: `${Math.round(level * 100)}%` }}
          />
        ))}
      </div>
      {/* Caption sits under the waveform, so the play button centres on the bars alone */}
      <p className="col-start-2 font-sans text-[2.6cqw] text-white/50">
        {complete
          ? `${formatDuration(voice.durationMs)} · Codec2 ${CODEC2_BPS} · ${totalBytes} B`
          : `${formatDuration(availableSec * 1000)} of ${formatDuration(voice.durationMs)} · ${Math.round(
              available * totalBytes,
            )} / ${totalBytes} B${waiting ? ' · waiting for next packet' : ''}`}
      </p>
    </div>
  )
}

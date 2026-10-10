import { useEffect, useRef, useState } from 'react'
import { useVoiceRecorder } from '../hooks/useVoiceRecorder'
import { prepareImage } from '../media/image'
import type { ImageNote, VoiceNote } from '../mesh/types'

const ease = 'ease-[cubic-bezier(0.32,0.72,0,1)]'

type Props = {
  onSendText: (text: string) => void
  onSendVoice: (voice: VoiceNote) => void
  onSendImage: (image: ImageNote) => void
  onError: (message: string) => void
}

// Text field plus a round button: mic when empty, send arrow when there's text.
// The photo button inside the field sends a picked image as a tiny preview.
// Tapping the mic morphs the button into a recording pill (cancel · waveform · send).
export default function Composer({ onSendText, onSendVoice, onSendImage, onError }: Props) {
  const [draft, setDraft] = useState('')
  const { recording, levels, start, stop } = useVoiceRecorder(18, onError)
  const fileInput = useRef<HTMLInputElement>(null)
  const upload = useRef<AbortController | null>(null)
  useEffect(() => () => upload.current?.abort(), [])
  const hasText = draft.trim().length > 0

  const sendText = () => {
    if (!hasText) return
    onSendText(draft.trim())
    setDraft('')
  }

  const finish = async (keep: boolean) => {
    const note = await stop(keep)
    if (note) onSendVoice(note)
  }

  const pickImage = async (file: File | undefined) => {
    if (!file) return
    upload.current?.abort()
    const controller = new AbortController()
    upload.current = controller
    try {
      const image = await prepareImage(file, controller.signal)
      if (!controller.signal.aborted) onSendImage(image)
    } catch (e) { if (!controller.signal.aborted) onError((e as Error).message) }
    finally { if (fileInput.current) fileInput.current.value = '' }
  }

  return (
    <form
      className="relative flex items-center justify-end px-[5cqw] pt-[3cqw] pb-[7cqw]"
      onSubmit={(e) => {
        e.preventDefault()
        sendText()
      }}
    >
      <div
        className={`relative h-[12cqw] min-w-0 overflow-hidden transition-all duration-500 ${ease} ${
          recording ? 'mr-0 w-0 opacity-0' : 'mr-[3cqw] w-[calc(100%-15cqw)] opacity-100'
        }`}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Message"
          disabled={recording}
          className="h-full w-full rounded-[3cqw] bg-[#26394a]/95 pr-[4cqw] pl-[11cqw] text-[4.4cqw] text-white shadow-lg outline-none placeholder:text-white/40"
        />
        <button
          type="button"
          aria-label="Send photo"
          disabled={recording}
          onClick={() => fileInput.current?.click()}
          className="absolute top-0 left-0 flex h-full w-[10cqw] items-center justify-center text-white/60 transition hover:text-white/90"
        >
          <svg viewBox="0 0 24 24" className="h-[5cqw] w-[5cqw]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="5" width="18" height="14" rx="3" />
            <circle cx="9" cy="10" r="1.6" />
            <path d="M21 16l-5-5-8 8" />
          </svg>
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/*,.heic,.heif"
          hidden
          onChange={(e) => pickImage(e.target.files?.[0])}
        />
      </div>

      <div
        className={`relative h-[12cqw] shrink-0 overflow-hidden rounded-full bg-[#141c23] shadow-lg transition-all duration-500 ${ease} ${
          recording ? 'w-full' : 'w-[12cqw]'
        }`}
      >
        {/* Idle: mic, or send arrow once there's text */}
        <button
          type={hasText ? 'submit' : 'button'}
          aria-label={hasText ? 'Send' : 'Record voice note'}
          onClick={hasText ? undefined : start}
          className={`absolute top-0 right-0 flex h-[12cqw] w-[12cqw] items-center justify-center text-white/90 transition-opacity duration-200 active:scale-95 ${
            recording ? 'pointer-events-none opacity-0' : 'opacity-100'
          }`}
        >
          <svg viewBox="0 0 24 24" className="h-[5cqw] w-[5cqw]" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            {hasText ? (
              <path d="M12 19V5M5 12l7-7 7 7" />
            ) : (
              <>
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
              </>
            )}
          </svg>
        </button>

        {/* Recording: cancel · live waveform · send */}
        <div
          className={`absolute inset-0 flex items-center justify-between px-[1.5cqw] transition-opacity ${
            recording ? 'opacity-100 delay-200 duration-300' : 'pointer-events-none opacity-0 duration-100'
          }`}
        >
          <button
            type="button"
            aria-label="Cancel recording"
            onClick={() => finish(false)}
            className="flex h-[9cqw] w-[9cqw] items-center justify-center rounded-full bg-white/25 text-white active:scale-95"
          >
            <svg viewBox="0 0 24 24" className="h-[4cqw] w-[4cqw]" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>

          <div className="flex h-[7cqw] items-center gap-[0.9cqw]">
            {levels.map((level, i) => (
              <span
                key={i}
                className="w-[0.9cqw] rounded-full bg-white transition-[height] duration-75"
                style={{ height: `${Math.round(level * 100)}%` }}
              />
            ))}
          </div>

          <button
            type="button"
            aria-label="Send voice note"
            onClick={() => finish(true)}
            className="flex h-[9cqw] w-[9cqw] items-center justify-center rounded-full bg-white text-[#141c23] active:scale-95"
          >
            <svg viewBox="0 0 24 24" className="h-[4.5cqw] w-[4.5cqw]" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </button>
        </div>
      </div>
    </form>
  )
}

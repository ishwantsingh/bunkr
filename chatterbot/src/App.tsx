import { useRef, useState } from 'react'
import BokehBackground from './components/BokehBackground'
import ChatScreen from './components/ChatScreen'
import { type NodeInfo } from './components/NodeOrb'
import PhoneFrame from './components/PhoneFrame'
import { packetCount, pastStats, simulatePull, simulateSend, voiceBytes } from './mesh/mockMesh'
import type { Delivery, DeliveryStats, ImageNote, Message, Region, VoiceNote } from './mesh/types'

const people = ['Richard', 'Maya']

const todayAt = (hours: number, minutes: number) => {
  const d = new Date()
  d.setHours(hours, minutes, 0, 0)
  return d
}

// Mesh node IDs for each person's phone, plus relay nodes in between.
const nodeIds: Record<string, string> = { Richard: '!a3f2', Maya: '!7c1e' }
const relays = ['!19b4', '!e05d', '!4a8c']
const KBPS = 21.9 // Short Turbo

const nodes: Record<string, NodeInfo> = Object.fromEntries(
  people.map((p) => [
    p,
    {
      shortName: p.slice(0, 4).toUpperCase(),
      id: nodeIds[p],
      preset: 'Short Turbo',
      kbps: KBPS,
      meshSize: people.length + relays.length,
      hopLimit: 3,
    },
  ]),
)

const otherPerson = (from: string) => people.find((p) => p !== from)!

// Path through 1–2 relays, so a message takes 2–3 hops.
const pickRoute = (from: string) => {
  const relayCount = 1 + Math.floor(Math.random() * 2)
  const path = [...relays].sort(() => Math.random() - 0.5).slice(0, relayCount)
  return [nodeIds[from], ...path, nodeIds[otherPerson(from)]]
}

const byteLength = (text: string) => new TextEncoder().encode(text).length

const seed = (id: number, from: string, text: string, sentAt: Date): Message => {
  const route = pickRoute(from)
  return {
    id,
    from,
    text,
    sentAt,
    route,
    delivery: { status: 'delivered' },
    stats: pastStats(route, byteLength(text), KBPS),
  }
}

// Scenario: flood has knocked out cell and internet. Richard is stranded and
// tries to tell Maya where he is, over the LoRa mesh only. Messages stay short
// so each fits in a single ~230 B packet.
const initialMessages: Message[] = [
  seed(1, 'Maya', 'Richard, are you okay? No signal anywhere, towers are down.', todayAt(7, 2)),
  seed(2, 'Richard', 'I’m okay. Water is up to the first floor, I’m on the roof.', todayAt(7, 5)),
  seed(3, 'Maya', 'Where exactly? I can get to you.', todayAt(7, 6)),
  seed(4, 'Richard', 'Old pharmacy on Elm St, 2 blocks east of the church. Red roof.', todayAt(7, 9)),
  seed(5, 'Richard', 'GPS 39.9526, -75.1652. Phone at 31%, saving battery.', todayAt(7, 10)),
  seed(6, 'Maya', 'Got it. Rescue boat is at the school, heading your way. Stay put.', todayAt(7, 14)),
  seed(7, 'Richard', 'I’ll wave a white sheet when I hear the motor.', todayAt(7, 15)),
]

export default function App() {
  const [messages, setMessages] = useState(initialMessages)
  const nextId = useRef(initialMessages.length + 1)

  const send = (from: string, content: { text: string; voice?: VoiceNote; image?: ImageNote }) => {
    const id = nextId.current++
    const bytes = content.image
      ? content.image.previewBytes
      : content.voice
        ? voiceBytes(content.voice.durationMs)
        : byteLength(content.text)
    const route = pickRoute(from)
    const patch = (p: { delivery?: Delivery; stats?: DeliveryStats; received?: number }) =>
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...p } : m)))

    setMessages((prev) => [
      ...prev,
      {
        id,
        from,
        ...content,
        sentAt: new Date(),
        route,
        packets: packetCount(bytes),
        received: 0,
        delivery: { status: 'sending', transit: null },
      },
    ])

    simulateSend(route, bytes, KBPS, {
      onTransit: (transit) => patch({ delivery: { status: 'sending', transit } }),
      onChunk: (received) => patch({ received }),
      onArrive: (stats) => patch({ stats }),
      onDelivered: () => patch({ delivery: { status: 'delivered' } }),
      onFailed: (reason) => patch({ delivery: { status: 'failed', reason } }),
    })
  }

  const updateRegions = (messageId: number, update: (regions: Region[]) => Region[]) =>
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId && m.image ? { ...m, image: { ...m.image, regions: update(m.image.regions) } } : m,
      ),
    )

  const patchRegion = (messageId: number, regionId: string, p: Partial<Region>) =>
    updateRegions(messageId, (rs) => rs.map((r) => (r.id === regionId ? { ...r, ...p } : r)))

  // Receiver pulls areas of an image: the given `regions` (added first when `isNew`,
  // e.g. the whole image for "Render full"), or every selected / failed area.
  const pull = (m: Message, only?: Region[], isNew = false) => {
    if (only && isNew) updateRegions(m.id, (rs) => [...rs, ...only])
    const regions =
      only ??
      m.image?.regions.filter((r) => (r.status === 'selected' || r.status === 'failed') && r.bytes !== undefined) ??
      []
    regions.forEach((r) => {
      patchRegion(m.id, r.id, { status: 'pulling', transit: null, reason: undefined })
      simulatePull(m.route, r.bytes!, KBPS, {
        onTransit: (transit) => patchRegion(m.id, r.id, { transit }),
        onArrive: () => patchRegion(m.id, r.id, { status: 'done', transit: null }),
        onFailed: (reason) => patchRegion(m.id, r.id, { status: 'failed', reason }),
      })
    })
  }

  return (
    <main className="relative flex h-dvh items-center justify-between overflow-hidden bg-[#1c1c1e] p-8">
      <BokehBackground />

      <div className="relative z-10 flex h-full w-full items-center justify-between">
        {people.map((person) => (
          <PhoneFrame key={person}>
            <ChatScreen
              me={person}
              peer={otherPerson(person)}
              node={nodes[person]}
              messages={messages}
              onSendText={(text) => send(person, { text })}
              onSendVoice={(voice) => send(person, { text: '', voice })}
              onSendImage={(image) => send(person, { text: '', image })}
              onRegionsChange={updateRegions}
              onPull={pull}
              kbps={KBPS}
            />
          </PhoneFrame>
        ))}
      </div>
    </main>
  )
}

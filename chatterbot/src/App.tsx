import { useEffect, useRef, useState } from 'react'
import BokehBackground from './components/BokehBackground'
import ChatScreen from './components/ChatScreen'
import MeshCard from './components/MeshCard'
import { type NodeInfo } from './components/NodeOrb'
import PhoneFrame from './components/PhoneFrame'
import { MediaRuntime } from './mesh/runtime.mjs'
import {mesh, PRESETS, useMesh} from './mesh/network'
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

const seed = (id: number, from: string, text: string, sentAt: Date): Message => {
  const route = [nodeIds[from],nodeIds[otherPerson(from)]]
  return {
    example: true,
    id,
    from,
    text,
    sentAt,
    route,
    delivery: { status: 'delivered' },

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
  const runtime = useRef<MediaRuntime | null>(null)
  const preset = useMesh(s => s.preset)
  const meshNodes = useMesh(s => s.nodes)
  const kbps = PRESETS.find(p => p.name === preset)!.kbps
  const [generation, setGeneration] = useState(0)
  const [error, setError] = useState('')
  useEffect(() => {
    const transport = new MediaRuntime({onNetwork: mesh.observe, onEvent: mesh.emit})
    runtime.current = transport
    transport.reset(mesh.get())
    mesh.connect({change: settings => transport.settings(settings), reset: settings => {
      transport.reset(settings); setGeneration(n => n + 1); setMessages(initialMessages); setError('')
    }})
    return () => {mesh.connect(null); transport.reset(); runtime.current = null}
  }, [])

  const updateRegions = (messageId: number, update: (regions: Region[]) => Region[]) =>
    setMessages(prev => prev.map(m => m.id === messageId && m.image
      ? {...m, image: {...m.image, regions: update(m.image.regions)}} : m))
  const patchRegion = (messageId: number, regionId: string, patch: Partial<Region>) =>
    updateRegions(messageId, regions => regions.map(r => r.id === regionId ? {...r,...patch} : r))

  const send = (from: string, content: {text: string; voice?: VoiceNote; image?: ImageNote}) => {
    const transport = runtime.current!
    const id = nextId.current++, reverse = from === people[1]
    const patch = (p: Partial<Message>) => setMessages(prev => prev.map(m => m.id === id ? {...m,...p} : m))
    const route = transport.route(reverse)
    setMessages(prev => [...prev,{id,from,...content,sentAt:new Date(),route:route.length ? route : [nodeIds[from],nodeIds[otherPerson(from)]],received:0,delivery:{status:'sending',transit:null}}])
    const callbacks = {
      onTransit: (transit: NonNullable<Extract<Delivery,{status:'sending'}>['transit']>) => patch({delivery:{status:'sending',transit}}),
      onPrepared: (m: {count:number;bytes:number;duration:number}) => patch({packets:m.count,...(content.voice ? {voice:{...content.voice,bytes:m.bytes,durationMs:m.duration}} : {})}),
      onChunk: (received:number, packets:number) => patch({received,packets}),
      onArrive: (received: Partial<ImageNote> | {text?:string;voice?:VoiceNote}, stats:DeliveryStats) => {
        if(content.image) patch({image:{...content.image,...received},stats,route:stats.route})
        else patch({...received as Partial<Message>,stats,route:stats.route})
      },
      onDelivered: () => patch({delivery:{status:'delivered'}}),
    }
    transport.enqueue((version:number) => content.image
      ? transport.sendImage(content.image,reverse,callbacks,version)
      : transport.sendTextOrVoice({sender:reverse?2:1,...content},callbacks,version),
      (e:Error) => patch({delivery:{status:'failed',reason:e.message}}))
  }

  const pull = (m: Message, only?: Region[], isNew = false) => {
    if(!m.image) return
    if(only && isNew) updateRegions(m.id,regions => [...regions,...only])
    const regions = only ?? m.image.regions.filter(r => r.status === 'selected' || r.status === 'failed')
    for(const r of regions){
      patchRegion(m.id,r.id,{status:'pulling',transit:null,reason:undefined})
      runtime.current!.enqueue((version:number) => runtime.current!.pull(m.image,r,m.from===people[1],{
        onTransit: (transit:Region['transit']) => patchRegion(m.id,r.id,{transit}),
        onSize: (bytes:number) => patchRegion(m.id,r.id,{bytes}),
        onProgress: (received:number,total:number) => patchRegion(m.id,r.id,{received,total}),
        onTile: (tile:ImageNote['tiles'][number]) => setMessages(prev => prev.map(item => item.id===m.id && item.image ? {...item,image:{...item.image,tiles:[...item.image.tiles.filter(t => t.id !== tile.id),tile]}} : item)),
        onVerified: () => patchRegion(m.id,r.id,{status:'done',transit:null}),
      },version),(e:Error) => updateRegions(m.id, regions => regions.map(region => region.id === r.id ? {...region,status:region.status === 'done' ? 'done' : 'failed',reason:e.message,transit:null} : region)))
    }
  }

  return (
    <main className="relative flex h-dvh items-center justify-between overflow-hidden bg-[#1c1c1e] p-8">
      <BokehBackground />
      {error && <p role="alert" className="absolute bottom-2 left-1/2 z-50 -translate-x-1/2 rounded-full bg-black/70 px-4 py-2 text-sm text-white" onClick={()=>setError('')}>{error}</p>}
      <MeshCard />

      <div className="relative z-10 flex h-full w-full items-center justify-between">
        {people.map((person) => (
          <PhoneFrame key={`${person}-${generation}`}>
            <ChatScreen
              me={person}
              peer={otherPerson(person)}
              node={{...nodes[person],preset,kbps,meshSize:meshNodes.filter(n=>n.online).length}}
              messages={messages}
              onSendText={(text) => send(person, { text })}
              onSendVoice={(voice) => send(person, { text: '', voice })}
              onSendImage={(image) => send(person, { text: '', image })}
              onError={setError}
              onRegionsChange={updateRegions}
              onPull={pull}
              kbps={kbps}
            />
          </PhoneFrame>
        ))}
      </div>
    </main>
  )
}

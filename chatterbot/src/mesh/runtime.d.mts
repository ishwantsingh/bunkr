import type {DeliveryStats,ImageNote,Region,Transit,VoiceNote} from './types'
import type {State,MeshEvent} from './network'
type Manifest = {id:string; count:number; bytes:number; kind:number; duration:number}
type Callbacks = {
  onTransit:(transit:Transit)=>void
  onPrepared?:(manifest:Manifest)=>void
  onChunk:(received:number,total:number)=>void
  onArrive:(content:Partial<ImageNote>|{text?:string;voice?:VoiceNote},stats:DeliveryStats)=>void
  onDelivered:()=>void
}
export class MediaRuntime {
  constructor(hooks:{onNetwork:(patch:Partial<State>)=>void;onEvent:(event:Omit<MeshEvent,'id'|'t'>)=>void})
  reset(settings?:Partial<State>):void
  settings(settings:Partial<State>):void
  route(reverse?:boolean):string[]
  enqueue(task:(version:number)=>Promise<void>,onError:(error:Error)=>void):Promise<void>
  sendImage(image:ImageNote,reverse:boolean,callbacks:Callbacks,version:number):Promise<void>
  sendTextOrVoice(content:{sender:number;text:string;voice?:VoiceNote},callbacks:Callbacks,version:number):Promise<void>
  pull(image:ImageNote|undefined,region:Region,reverse:boolean,callbacks:{
    onTransit:(transit:Transit)=>void
    onSize:(bytes:number)=>void
    onProgress:(received:number,total:number)=>void
    onTile:(tile:ImageNote['tiles'][number])=>void
    onVerified:()=>void
  },version:number):Promise<void>
}

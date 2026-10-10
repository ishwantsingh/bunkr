export const VERSION = 2;
export const fromHex = hex => {
  if (typeof hex !== 'string' || hex.length % 2 || !/^[a-f0-9]*$/i.test(hex)) throw Error('Invalid hexadecimal frame');
  return Uint8Array.from(hex.match(/../g) || [], h => parseInt(h, 16));
};
export const toHex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function validate(bytes, tag) {
  if (bytes.length < 6 || bytes.length > 220 || bytes[0] !== VERSION || bytes[1] !== tag) throw Error('Invalid application frame');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(bytes.length - 4) !== crc32(bytes.subarray(0, -4))) throw Error('Packet integrity check failed');
  return view;
}
export function parseManifest(hex) {
  const b = fromHex(hex), v = validate(b, 1);
  if (b.length !== 132) throw Error('Invalid manifest length');
  const m = {imageId: toHex(b.slice(2,18)), id: toHex(b.slice(18,34)), sender: v.getUint32(34), recipient: v.getUint32(38),
    kind:b[42], codec:b[43], width:v.getUint32(44), height:v.getUint32(48), bytes:Number(v.getBigUint64(52)),
    count:v.getUint32(60), hash:toHex(b.slice(64,96)), requestId:toHex(b.slice(96,112)),
    bounds:[112,114,116,118].map(i=>v.getUint16(i)/65535), sourceWidth:v.getUint32(120), sourceHeight:v.getUint32(124)};
  if (!m.bytes || m.bytes > 12*1024*1024 || m.count !== Math.ceil(m.bytes/174) || !m.width || !m.height || ![0,1].includes(m.codec)) throw Error('Invalid representation metadata');
  return m;
}
export function parsePacket(hex, m) {
  const b = fromHex(hex), v = validate(b, 3), index = v.getUint32(34), count = v.getUint32(38);
  if (toHex(b.slice(2,18)) !== m.imageId || toHex(b.slice(18,34)) !== m.id || count !== m.count || index >= count) throw Error('Chunk does not match manifest');
  const data = b.slice(42,-4);
  if (data.length !== Math.min(174, m.bytes-index*174)) throw Error('Invalid chunk length');
  return {index, data};
}
export class Reassembler {
  constructor(manifest) { this.manifest = manifest; this.chunks = new Map(); }
  add(hex) {
    const {index,data} = parsePacket(hex, this.manifest), old = this.chunks.get(index);
    if (old && toHex(old) !== toHex(data)) throw Error('Conflicting duplicate chunk');
    this.chunks.set(index,data);
    return this.chunks.size === this.manifest.count;
  }
  async verifiedBytes() {
    const m = this.manifest;
    if (this.chunks.size !== m.count) throw Error('Representation is incomplete');
    const bytes = new Uint8Array(m.bytes);
    for (const [index,chunk] of this.chunks) bytes.set(chunk,index*174);
    const hash = toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
    if (hash !== m.hash) throw Error('Representation hash mismatch');
    return bytes;
  }
}
export function makeAck(m) {
  const b = new Uint8Array(58), v = new DataView(b.buffer);
  b.set([VERSION,4]); b.set(fromHex(m.id),2); v.setUint32(18,m.recipient); b.set(fromHex(m.hash),22);
  v.setUint32(54,crc32(b.subarray(0,54)));
  return toHex(b);
}
export function makeRequest(imageId, requestId, bounds) {
  const b = new Uint8Array(55), v = new DataView(b.buffer);
  b.set([VERSION,2]); b.set(fromHex(requestId),2); b.set(fromHex(imageId),18); v.setUint32(34,2);
  bounds.forEach((n,i)=>v.setUint16(38+i*2,Math.round(n*65535)));
  v.setUint32(46,1024); b[50]=1; v.setUint32(51,crc32(b.subarray(0,51)));
  return toHex(b);
}
export function clampBounds(bounds) {
  let [x0,y0,x1,y1]=bounds;
  const width=Math.max(.08,Math.min(1,x1-x0)),height=Math.max(.08,Math.min(1,y1-y0));
  x0=Math.max(0,Math.min(1-width,x0)); y0=Math.max(0,Math.min(1-height,y0));
  return [x0,y0,x0+width,y0+height];
}

// Tag 7 extends v2 for text/voice; packet and completion ACK layouts are shared.
export function parseMessageManifest(hex) {
  const b=fromHex(hex),v=validate(b,7);
  if(b.length!==80)throw Error('Invalid message manifest length');
  const id=toHex(b.slice(2,18));
  const m={id,imageId:id,sender:v.getUint32(18),recipient:v.getUint32(22),kind:b[26],codec:b[27],
    bytes:v.getUint32(28),count:v.getUint32(32),duration:v.getUint32(36),sampleRate:v.getUint32(40),hash:toHex(b.slice(44,76))};
  if(id==='00'.repeat(16)||!m.sender||m.sender>=0xffffffff||!m.recipient||m.recipient>=0xffffffff||m.sender===m.recipient||
     ![0,1].includes(m.kind)||!m.bytes||m.bytes>(m.kind===0?16384:204800)||m.count!==Math.ceil(m.bytes/174))throw Error('Invalid message metadata');
  if(m.kind===0?(![0,1].includes(m.codec)||m.duration!==0||m.sampleRate!==0):(m.codec!==2||m.duration<1||m.duration>60000||m.sampleRate!==16000))throw Error('Invalid message codec or duration');
  return m;
}
export async function decodeMessageText(bytes,codec) {
  if(codec===1){
    const reader=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
    const chunks=[];let size=0;
    try{
      while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>16384)throw Error('Decompressed text exceeds limit');chunks.push(value);}
    }finally{await reader.cancel().catch(()=>{});}
    bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  }else if(codec!==0)throw Error('Invalid text codec');
  if(!bytes.length||bytes.length>16384)throw Error('Invalid text size');
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  if(!text.trim())throw Error('Text cannot be blank');
  return text;
}
export function validateVoiceHeader(bytes) {
  const prefix=new TextDecoder('latin1').decode(bytes.subarray(0,128)),head=prefix.indexOf('OpusHead');
  if(prefix.slice(0,4)!=='OggS'||head<0||bytes.length<head+19||bytes[head+9]!==1)throw Error('Expected mono Ogg Opus voice note');
}

export function makeMissing(id,indices) {
  if(!indices.length||indices.length>49||indices.some(i=>!Number.isInteger(i)||i<0||i>=Math.ceil(12*1024*1024/174)))throw Error('Invalid missing chunk indices');
  const identifier=fromHex(id);if(identifier.length!==16)throw Error('Invalid representation ID');
  const b=new Uint8Array(22+indices.length*4),v=new DataView(b.buffer);
  b.set([VERSION,6]);b.set(identifier,2);indices.forEach((n,i)=>v.setUint32(18+i*4,n));
  v.setUint32(b.length-4,crc32(b.subarray(0,-4)));return toHex(b);
}

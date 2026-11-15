import { ByteWriter } from './bytes';

interface Chunk { id: string; data: Uint8Array }

function readChunks(b: Uint8Array): Chunk[] {
  const str = (o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  if (str(0) !== 'RIFF' || str(8) !== 'WEBP') throw new Error('No es un WebP válido');
  const out: Chunk[] = [];
  let p = 12;
  while (p + 8 <= b.length) {
    const id = str(p), size = b[p + 4] | (b[p + 5] << 8) | (b[p + 6] << 16) | (b[p + 7] << 24);
    out.push({ id, data: b.slice(p + 8, p + 8 + size) });
    p += 8 + size + (size & 1);
  }
  return out;
}

/** Tamaño del lienzo a partir del flujo VP8/VP8L. */
function bitstreamSize(c: Chunk): [number, number, boolean] {
  const d = c.data;
  if (c.id === 'VP8L') {
    const bits = d[1] | (d[2] << 8) | (d[3] << 16) | (d[4] << 24);
    return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1, ((bits >>> 28) & 1) === 1];
  }
  // VP8: tras 3 bytes de cabecera de fotograma y el código 9d 01 2a.
  return [(d[6] | (d[7] << 8)) & 0x3fff, (d[8] | (d[9] << 8)) & 0x3fff, false];
}

/** Incrusta un perfil ICC en un WebP (formato extendido VP8X + ICCP). */
export function webpWithIcc(webp: Uint8Array, icc: Uint8Array): Uint8Array {
  const chunks = readChunks(webp).filter(c => c.id !== 'ICCP');
  let vp8x = chunks.find(c => c.id === 'VP8X');
  if (!vp8x) {
    const img = chunks.find(c => c.id === 'VP8 ' || c.id === 'VP8L');
    if (!img) throw new Error('WebP sin imagen');
    const [w, h, alpha] = bitstreamSize(img);
    const d = new Uint8Array(10);
    d[0] = alpha || chunks.some(c => c.id === 'ALPH') ? 0x10 : 0;
    d[4] = (w - 1) & 255; d[5] = ((w - 1) >> 8) & 255; d[6] = ((w - 1) >> 16) & 255;
    d[7] = (h - 1) & 255; d[8] = ((h - 1) >> 8) & 255; d[9] = ((h - 1) >> 16) & 255;
    vp8x = { id: 'VP8X', data: d };
    chunks.unshift(vp8x);
  }
  vp8x.data[0] |= 0x20; // bandera ICC
  const ordered = [vp8x, { id: 'ICCP', data: icc }, ...chunks.filter(c => c !== vp8x)];
  const w = new ByteWriter(webp.length + icc.length + 64, true);
  w.ascii('RIFF').u32(0).ascii('WEBP');
  for (const c of ordered) { w.ascii(c.id).u32(c.data.length).bytes(c.data); if (c.data.length & 1) w.u8(0); }
  w.setU32(4, w.length - 8);
  return w.result();
}

/** true si el WebP es sin pérdida (VP8L). */
export const isLosslessWebp = (b: Uint8Array) => readChunks(b).some(c => c.id === 'VP8L');

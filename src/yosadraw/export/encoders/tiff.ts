import { zlibSync } from 'fflate';
import { ByteWriter } from './bytes';

/**
 * LZW de TIFF (compatible con libtiff): códigos MSB primero, Clear 256,
 * EOI 257. El ancho sube cuando la tabla supera 511/1023/2047 (el decodificador,
 * que va una entrada por detrás, lo hace con el "cambio anticipado" del estándar).
 */
export function lzwEncode(input: Uint8Array): Uint8Array {
  const out: number[] = [];
  let acc = 0, accBits = 0;
  const put = (code: number, width: number) => {
    acc = (acc << width) | code; accBits += width;
    while (accBits >= 8) { out.push((acc >>> (accBits - 8)) & 255); accBits -= 8; acc &= (1 << accBits) - 1; }
  };
  let dict = new Map<number, number>();
  let next = 258, width = 9;
  put(256, width);
  if (!input.length) { put(257, width); if (accBits) out.push((acc << (8 - accBits)) & 255); return new Uint8Array(out); }
  let w = input[0];
  for (let i = 1; i < input.length; i++) {
    const k = input[i], key = w * 256 + k;
    const hit = dict.get(key);
    if (hit !== undefined) { w = hit; continue; }
    put(w, width);
    dict.set(key, next++);
    if (next === 4094) { put(256, width); dict = new Map(); next = 258; width = 9; }
    else if (next > (1 << width) - 1) width++;
    w = k;
  }
  put(w, width);
  next++;
  if (next === 4094) { put(256, width); width = 9; }
  else if (next > (1 << width) - 1) width++;
  put(257, width);
  if (accBits) out.push((acc << (8 - accBits)) & 255);
  return new Uint8Array(out);
}

export interface TiffOptions {
  /** Canales en `data`: 1 gris, 2 gris+alfa, 3 RGB, 4 RGBA. */
  channels: 1 | 2 | 3 | 4;
  compression: 'none' | 'lzw' | 'deflate';
  dpi?: number;
  icc?: Uint8Array;
  onProgress?: (f: number) => void;
}

/**
 * TIFF baseline (little-endian), 8 bits por muestra, alfa no asociado,
 * tiras de ~64 KB, predictor horizontal al comprimir, PPP y perfil ICC.
 */
export function encodeTIFF(data: Uint8Array, width: number, height: number, o: TiffOptions): Uint8Array {
  const spp = o.channels, stride = width * spp;
  const rowsPerStrip = Math.max(1, Math.floor(65536 / stride));
  const strips: Uint8Array[] = [];
  const compressed = o.compression !== 'none';
  for (let y = 0; y < height; y += rowsPerStrip) {
    const rows = Math.min(rowsPerStrip, height - y);
    let s: Uint8Array = data.slice(y * stride, (y + rows) * stride);
    if (compressed) {
      // Predictor 2: diferencia con el píxel anterior de la fila.
      for (let r = 0; r < rows; r++) for (let i = stride - 1; i >= spp; i--) s[r * stride + i] = (s[r * stride + i] - s[r * stride + i - spp]) & 255;
      s = o.compression === 'lzw' ? lzwEncode(s) : zlibSync(s, { level: 6 });
    }
    strips.push(s);
    o.onProgress?.((y + rows) / height);
  }
  const photometric = spp <= 2 ? 1 : 2;
  const alpha = spp === 2 || spp === 4;
  type Tag = [number, number, number[] | Uint8Array, number?]; // id, tipo, valores
  const SHORT = 3, LONG = 4, RATIONAL = 5, ASCII = 2, UNDEFINED = 7;
  const software = 'YOSADRAW\0';
  const dpi = Math.round((o.dpi ?? 72) * 100);
  const tags: Tag[] = [
    [256, LONG, [width]], [257, LONG, [height]], [258, SHORT, Array(spp).fill(8)], [259, SHORT, [o.compression === 'lzw' ? 5 : o.compression === 'deflate' ? 8 : 1]],
    [262, SHORT, [photometric]], [273, LONG, strips.map(() => 0)], [277, SHORT, [spp]], [278, LONG, [rowsPerStrip]],
    [279, LONG, strips.map(s => s.length)], [282, RATIONAL, [dpi, 100]], [283, RATIONAL, [dpi, 100]], [284, SHORT, [1]], [296, SHORT, [2]],
    [305, ASCII, [...software].map(c => c.charCodeAt(0))],
  ];
  if (compressed) tags.push([317, SHORT, [2]]);
  if (alpha) tags.push([338, SHORT, [2]]);
  if (o.icc) tags.push([34675, UNDEFINED, o.icc]);
  tags.sort((a, b) => a[0] - b[0]);

  const size = (t: number) => (t === SHORT ? 2 : t === LONG ? 4 : t === RATIONAL ? 8 : 1);
  const count = (t: Tag) => (t[1] === RATIONAL ? t[2].length / 2 : t[2].length);
  // Disposición: cabecera (8) → IFD → datos de etiquetas largas → tiras.
  const ifdSize = 2 + tags.length * 12 + 4;
  let extra = 8 + ifdSize;
  const extraOff = new Map<number, number>();
  for (const t of tags) {
    const bytes = count(t) * size(t[1]);
    if (bytes > 4) { extraOff.set(t[0], extra); extra += bytes + (bytes & 1); }
  }
  let stripPos = extra;
  const offsets = strips.map(s => { const p = stripPos; stripPos += s.length + (s.length & 1); return p; });
  tags.find(t => t[0] === 273)![2] = offsets;

  const w = new ByteWriter(stripPos + 16, true);
  w.ascii('II').u16(42).u32(8);
  w.u16(tags.length);
  const writeValues = (t: Tag) => {
    const v = t[2];
    if (t[1] === SHORT) for (const x of v) w.u16(x);
    else if (t[1] === LONG || t[1] === RATIONAL) for (const x of v) w.u32(x);
    else w.bytes(v as Uint8Array);
  };
  for (const t of tags) {
    w.u16(t[0]).u16(t[1]).u32(count(t));
    const bytes = count(t) * size(t[1]);
    if (bytes > 4) w.u32(extraOff.get(t[0])!);
    else { const start = w.length; writeValues(t); while (w.length < start + 4) w.u8(0); }
  }
  w.u32(0);
  for (const t of tags) {
    const bytes = count(t) * size(t[1]);
    if (bytes <= 4) continue;
    writeValues(t);
    if (bytes & 1) w.u8(0);
  }
  for (const s of strips) { w.bytes(s); if (s.length & 1) w.u8(0); }
  return w.result();
}

import { zlibSync } from 'fflate';
import { ByteWriter, crc32, latin1 } from './bytes';

export interface PngOptions {
  /** Canales por píxel en `data`: 1 gris, 2 gris+alfa, 3 RGB, 4 RGBA. */
  channels: 1 | 2 | 3 | 4;
  /** Nivel de compresión zlib 0..9. */
  level: number;
  dpi?: number;
  icc?: { name: string; data: Uint8Array };
  /** Declarar sRGB sin perfil incrustado. */
  srgb?: boolean;
  onProgress?: (f: number) => void;
}

const COLOR_TYPE = { 1: 0, 2: 4, 3: 2, 4: 6 } as const;

function chunk(w: ByteWriter, type: string, data: Uint8Array) {
  w.u32(data.length);
  const start = w.length;
  w.ascii(type).bytes(data);
  const all = w.result();
  w.u32(crc32(all, start, start + 4 + data.length));
}

/**
 * Codificador PNG propio: filtro adaptativo por fila (el de menor suma de
 * diferencias), zlib con nivel configurable, pHYs (PPP) e iCCP (perfil).
 */
export function encodePNG(data: Uint8Array, width: number, height: number, o: PngOptions): Uint8Array {
  const bpp = o.channels, stride = width * bpp;
  const raw = new Uint8Array((stride + 1) * height);
  const cand = [new Uint8Array(stride), new Uint8Array(stride), new Uint8Array(stride), new Uint8Array(stride), new Uint8Array(stride)];
  for (let y = 0; y < height; y++) {
    const row = data.subarray(y * stride, (y + 1) * stride);
    const prev = y ? data.subarray((y - 1) * stride, y * stride) : null;
    let best = 0;
    if (o.level > 0) {
      let bestSum = Infinity;
      for (let f = 0; f < 5; f++) {
        const c = cand[f];
        let sum = 0;
        for (let i = 0; i < stride; i++) {
          const a = i >= bpp ? row[i - bpp] : 0, b = prev ? prev[i] : 0, cc = prev && i >= bpp ? prev[i - bpp] : 0;
          let v: number;
          if (f === 0) v = row[i];
          else if (f === 1) v = row[i] - a;
          else if (f === 2) v = row[i] - b;
          else if (f === 3) v = row[i] - ((a + b) >> 1);
          else {
            const p = a + b - cc, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - cc);
            v = row[i] - (pa <= pb && pa <= pc ? a : pb <= pc ? b : cc);
          }
          c[i] = v & 255;
          sum += c[i] < 128 ? c[i] : 256 - c[i];
          if (sum >= bestSum) break;
        }
        if (sum < bestSum) { bestSum = sum; best = f; }
      }
      // Recalcula el ganador entero (el bucle pudo cortarse antes).
      const c = cand[best];
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? row[i - bpp] : 0, b = prev ? prev[i] : 0, cc = prev && i >= bpp ? prev[i - bpp] : 0;
        let v: number;
        if (best === 0) v = row[i];
        else if (best === 1) v = row[i] - a;
        else if (best === 2) v = row[i] - b;
        else if (best === 3) v = row[i] - ((a + b) >> 1);
        else { const p = a + b - cc, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - cc); v = row[i] - (pa <= pb && pa <= pc ? a : pb <= pc ? b : cc); }
        c[i] = v & 255;
      }
      raw[y * (stride + 1)] = best;
      raw.set(c, y * (stride + 1) + 1);
    } else {
      raw[y * (stride + 1)] = 0;
      raw.set(row, y * (stride + 1) + 1);
    }
    if (o.onProgress && y % 64 === 0) o.onProgress((y / height) * 0.6);
  }
  const z = zlibSync(raw, { level: Math.max(0, Math.min(9, o.level)) as 0 });
  o.onProgress?.(0.95);

  const w = new ByteWriter(z.length + 4096);
  w.bytes([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new ByteWriter(13); ihdr.u32(width).u32(height).u8(8).u8(COLOR_TYPE[bpp]).u8(0).u8(0).u8(0);
  chunk(w, 'IHDR', ihdr.result());
  if (o.icc) {
    const p = new ByteWriter(); p.bytes(latin1(o.icc.name.slice(0, 79))).u8(0).u8(0).bytes(zlibSync(o.icc.data, { level: 9 }));
    chunk(w, 'iCCP', p.result());
  } else if (o.srgb) chunk(w, 'sRGB', new Uint8Array([0]));
  if (o.dpi) {
    const ppm = Math.round(o.dpi / 0.0254);
    const p = new ByteWriter(9); p.u32(ppm).u32(ppm).u8(1);
    chunk(w, 'pHYs', p.result());
  }
  for (let i = 0; i < z.length; i += 1 << 20) chunk(w, 'IDAT', z.subarray(i, Math.min(z.length, i + (1 << 20))));
  chunk(w, 'IEND', new Uint8Array(0));
  return w.result();
}

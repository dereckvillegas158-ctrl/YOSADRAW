import { apply, DISPLAY_P3, inv, mul, rgbToXyz, srgbDecode, srgbEncode } from './icc';

/** Conversión de color sobre píxeles RGBA sin premultiplicar (in situ). */
const DECODE = new Float32Array(256).map((_, i) => srgbDecode(i / 255));
const ENC_N = 4096;
const ENCODE = new Uint8Array(ENC_N + 1).map((_, i) => Math.round(srgbEncode(i / ENC_N) * 255));
const enc = (l: number) => ENCODE[Math.round(Math.min(1, Math.max(0, l)) * ENC_N)];

/** sRGB → Display P3: mismos colores, expresados en el espacio P3 (para incrustar su perfil). */
export const SRGB_TO_P3 = mul(inv(rgbToXyz(DISPLAY_P3)), rgbToXyz({ r: [0.64, 0.33], g: [0.3, 0.6], b: [0.15, 0.06], white: [0.3127, 0.329] }));

export function toDisplayP3(px: Uint8ClampedArray | Uint8Array) {
  const m = SRGB_TO_P3;
  for (let i = 0; i < px.length; i += 4) {
    const v = apply(m, [DECODE[px[i]], DECODE[px[i + 1]], DECODE[px[i + 2]]]);
    px[i] = enc(v[0]); px[i + 1] = enc(v[1]); px[i + 2] = enc(v[2]);
  }
}

/** Escala de grises por luminancia (Rec. 709, en luz lineal). */
export function toGray(px: Uint8ClampedArray | Uint8Array) {
  for (let i = 0; i < px.length; i += 4) {
    const y = enc(0.2126 * DECODE[px[i]] + 0.7152 * DECODE[px[i + 1]] + 0.0722 * DECODE[px[i + 2]]);
    px[i] = px[i + 1] = px[i + 2] = y;
  }
}

/** Bordes duros: alfa al 50 %. */
export function hardEdges(px: Uint8ClampedArray | Uint8Array) {
  for (let i = 3; i < px.length; i += 4) px[i] = px[i] >= 128 ? 255 : 0;
}

/** Compone sobre un color de fondo y deja el alfa opaco. */
export function flatten(px: Uint8ClampedArray | Uint8Array, bg: [number, number, number]) {
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3] / 255;
    if (a === 1) continue;
    px[i] = Math.round(px[i] * a + bg[0] * (1 - a));
    px[i + 1] = Math.round(px[i + 1] * a + bg[1] * (1 - a));
    px[i + 2] = Math.round(px[i + 2] * a + bg[2] * (1 - a));
    px[i + 3] = 255;
  }
}

/** Separa canales: RGBA → (gris|RGB)[+alfa] intercalados. */
export function packChannels(px: Uint8ClampedArray | Uint8Array, gray: boolean, alpha: boolean): Uint8Array {
  const n = px.length / 4, c = (gray ? 1 : 3) + (alpha ? 1 : 0);
  const out = new Uint8Array(n * c);
  for (let i = 0, o = 0; i < px.length; i += 4) {
    if (gray) out[o++] = px[i]; else { out[o++] = px[i]; out[o++] = px[i + 1]; out[o++] = px[i + 2]; }
    if (alpha) out[o++] = px[i + 3];
  }
  return out;
}

export function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

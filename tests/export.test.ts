import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { flatten, packChannels, SRGB_TO_P3, toDisplayP3, toGray } from '../src/yosadraw/export/color';
import { encodeBMP } from '../src/yosadraw/export/encoders/bmp';
import { jpegWithMeta } from '../src/yosadraw/export/encoders/jpegMeta';
import { encodePDF } from '../src/yosadraw/export/encoders/pdf';
import { encodePNG } from '../src/yosadraw/export/encoders/png';
import { encodePSD } from '../src/yosadraw/export/encoders/psd';
import { encodeTIFF, lzwEncode } from '../src/yosadraw/export/encoders/tiff';
import { webpWithIcc } from '../src/yosadraw/export/encoders/webpMeta';
import { apply, d50Colorants, DISPLAY_P3, makeIccProfile, SRGB } from '../src/yosadraw/export/icc';
import { encodeExport, keepsAlpha, profileFor } from '../src/yosadraw/export/pipeline';
import { DEFAULT_OPTIONS, normalizeOptions, type ExportOptions } from '../src/yosadraw/export/types';

/** Imagen de prueba: degradado de color, un disco semitransparente y una esquina transparente. */
function sample(w = 97, h = 61) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    px[i] = (x * 255) / (w - 1); px[i + 1] = (y * 255) / (h - 1); px[i + 2] = ((x + y) * 7) % 256;
    const d = Math.hypot(x - w / 2, y - h / 2);
    px[i + 3] = x < 10 && y < 10 ? 0 : d < 15 ? 128 : 255;
  }
  return { px, w, h };
}

const OUT = process.env.EXPORT_SAMPLES_DIR;
const save = (name: string, data: Uint8Array) => { if (OUT) { mkdirSync(OUT, { recursive: true }); writeFileSync(join(OUT, name), data); } };
const be32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

describe('Perfiles ICC', () => {
  it('colorantes sRGB en D50 coinciden con los publicados', () => {
    const c = d50Colorants(SRGB);
    expect(c[0]).toBeCloseTo(0.4361, 3); expect(c[3]).toBeCloseTo(0.2225, 3); expect(c[6]).toBeCloseTo(0.0139, 3);
    expect(c[1]).toBeCloseTo(0.3851, 3); expect(c[4]).toBeCloseTo(0.7169, 3);
    expect(c[2]).toBeCloseTo(0.1431, 3); expect(c[8]).toBeCloseTo(0.7141, 3);
    const p3 = d50Colorants(DISPLAY_P3);
    expect(p3[0]).toBeCloseTo(0.5151, 3); expect(p3[4]).toBeCloseTo(0.6922, 3);
    // Blanco: suma de colorantes = D50.
    expect(c[0] + c[1] + c[2]).toBeCloseTo(0.9642, 3); expect(c[3] + c[4] + c[5]).toBeCloseTo(1, 4);
  });
  it('estructura válida: tamaño, firma acsp y tabla de etiquetas', () => {
    for (const k of ['srgb', 'p3', 'gray'] as const) {
      const p = makeIccProfile(k);
      expect(be32(p, 0)).toBe(p.length);
      expect(String.fromCharCode(...p.subarray(36, 40))).toBe('acsp');
      const n = be32(p, 128);
      expect(n).toBe(k === 'gray' ? 4 : 9);
      for (let i = 0; i < n; i++) { const off = be32(p, 132 + i * 12 + 4), len = be32(p, 132 + i * 12 + 8); expect(off + len).toBeLessThanOrEqual(p.length); expect(off % 4).toBe(0); }
      save(`profile-${k}.icc`, p);
    }
  });
});

describe('Conversión de color', () => {
  it('sRGB → P3: el blanco sigue siendo blanco y el rojo puro entra en P3', () => {
    expect(apply(SRGB_TO_P3, [1, 1, 1]).map(v => +v.toFixed(5))).toEqual([1, 1, 1]);
    const px = new Uint8ClampedArray([255, 0, 0, 255, 128, 128, 128, 255]);
    toDisplayP3(px);
    expect(px[0]).toBe(234); expect(px[1]).toBe(51); expect(px[2]).toBe(35);
    expect([px[4], px[5], px[6]]).toEqual([128, 128, 128]);
  });
  it('gris por luminancia y aplanado sobre el fondo', () => {
    const px = new Uint8ClampedArray([0, 255, 0, 255, 255, 0, 0, 0]);
    toGray(px);
    expect(px[0]).toBe(px[1]); expect(px[0]).toBeGreaterThan(200);
    flatten(px, [10, 20, 30]);
    expect([px[4], px[5], px[6], px[7]]).toEqual([10, 20, 30, 255]);
    expect(packChannels(new Uint8ClampedArray([1, 2, 3, 4]), false, false)).toEqual(new Uint8Array([1, 2, 3]));
  });
});

describe('Codificadores', () => {
  const { px, w, h } = sample();
  it('PNG: cabecera, pHYs a 300 PPP e iCCP', () => {
    for (const [name, ch, gray, alpha] of [['rgba', 4, false, true], ['rgb', 3, false, false], ['ga', 2, true, true], ['g', 1, true, false]] as const) {
      const data = packChannels(px, gray, alpha);
      const png = encodePNG(data, w, h, { channels: ch, level: 6, dpi: 300, icc: { name: 'sRGB', data: makeIccProfile(gray ? 'gray' : 'srgb') } });
      expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      expect(be32(png, 16)).toBe(w); expect(be32(png, 20)).toBe(h);
      const s = String.fromCharCode(...png);
      expect(s.includes('pHYs')).toBe(true); expect(s.includes('iCCP')).toBe(true);
      expect(be32(png, s.indexOf('pHYs') + 4)).toBe(11811); // 300 PPP en píxeles por metro
      save(`png-${name}.png`, png);
    }
    save('png-level0.png', encodePNG(packChannels(px, false, true), w, h, { channels: 4, level: 0 }));
  });
  it('BMP 32 y 24 bits', () => {
    const b32 = encodeBMP(px, w, h, { depth: 32, dpi: 300, icc: makeIccProfile('srgb') });
    const b24 = encodeBMP(px, w, h, { depth: 24, dpi: 150 });
    expect(String.fromCharCode(b32[0], b32[1])).toBe('BM');
    expect(b32.length).toBe(14 + 124 + w * h * 4 + makeIccProfile('srgb').length);
    expect(b24.length).toBe(14 + 124 + Math.ceil((w * 3) / 4) * 4 * h);
    save('bmp-32.bmp', b32); save('bmp-24.bmp', b24);
  });
  it('TIFF: sin compresión, LZW y Deflate', () => {
    for (const c of ['none', 'lzw', 'deflate'] as const) {
      save(`tiff-rgba-${c}.tif`, encodeTIFF(packChannels(px, false, true), w, h, { channels: 4, compression: c, dpi: 300, icc: makeIccProfile('srgb') }));
      save(`tiff-g-${c}.tif`, encodeTIFF(packChannels(px, true, false), w, h, { channels: 1, compression: c, dpi: 72, icc: makeIccProfile('gray') }));
    }
    // LZW con más de 4094 códigos (fuerza el reinicio de la tabla) y anchos 9→12 bits.
    const big = new Uint8Array(300 * 200 * 3).map((_, i) => (i * 7919) % 251);
    save('tiff-lzw-big.tif', encodeTIFF(big, 300, 200, { channels: 3, compression: 'lzw' }));
    expect(lzwEncode(new Uint8Array([1, 1, 1, 1])).length).toBeGreaterThan(0);
  });
  it('PDF de varias páginas con transparencia y perfil', () => {
    const rgb = packChannels(px, false, false), alpha = new Uint8Array(w * h).map((_, i) => px[i * 4 + 3]);
    const pdf = encodePDF([{ width: w, height: h, channels: 3, pixels: rgb, alpha }, { width: w, height: h, channels: 3, pixels: rgb }], { dpi: 300, title: 'Prueba (1)', icc: makeIccProfile('srgb') });
    const s = String.fromCharCode(...pdf);
    expect(s.startsWith('%PDF-1.4')).toBe(true); expect(s.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(s.includes('/SMask')).toBe(true); expect(s.includes('/ICCBased')).toBe(true);
    save('pdf-rgb-2pages.pdf', pdf);
    save('pdf-gray.pdf', encodePDF([{ width: w, height: h, channels: 1, pixels: packChannels(px, true, false) }], { dpi: 72, title: 'Gris', icc: makeIccProfile('gray') }));
  });
  it('PSD con capas, nombres, opacidad, fusión y visibilidad', () => {
    const layer = (name: string, blend: string, opacity: number, hidden: boolean) => ({ name, blend, opacity, hidden, data: px, left: 3, top: 2, width: w, height: h });
    const psd = encodePSD(w + 6, h + 4, new Uint8ClampedArray((w + 6) * (h + 4) * 4).fill(200), [layer('Fondo', 'normal', 1, false), layer('Sombras', 'multiply', 0.5, false), layer('Oculta', 'screen', 1, true)], { dpi: 300, icc: makeIccProfile('srgb'), compress: false });
    expect(String.fromCharCode(...psd.subarray(0, 4))).toBe('8BPS');
    save('psd-layers.psd', psd);
  });
  it('JPEG: JFIF con PPP y perfil en APP2 (sobre un JPEG mínimo)', () => {
    // SOI + APP0 JFIF (72 PPP) + EOI: basta para comprobar la reescritura de segmentos.
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
    const out = jpegWithMeta(jpeg, { dpi: 300, icc: makeIccProfile('srgb') });
    expect(out[13]).toBe(1); expect((out[14] << 8) | out[15]).toBe(300);
    expect(String.fromCharCode(...out.subarray(24, 35))).toBe('ICC_PROFILE');
  });
  it('WebP: añade VP8X con la bandera ICC y el fragmento ICCP', () => {
    // WebP sin pérdida mínimo de 1×1 (VP8L).
    const vp8l = new Uint8Array([0x2f, 0, 0, 0, 0x10, 0x07, 0x10, 0x11, 0x11, 0x88, 0x88, 0xfe, 0x07, 0]);
    const riff = new Uint8Array(20 + vp8l.length);
    riff.set([0x52, 0x49, 0x46, 0x46]); new DataView(riff.buffer).setUint32(4, 12 + vp8l.length, true);
    riff.set([0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c], 8); new DataView(riff.buffer).setUint32(16, vp8l.length, true); riff.set(vp8l, 20);
    const out = webpWithIcc(riff, makeIccProfile('srgb'));
    expect(String.fromCharCode(...out.subarray(12, 16))).toBe('VP8X');
    expect(out[20] & 0x20).toBe(0x20);
    expect(String.fromCharCode(...out.subarray(30, 34))).toBe('ICCP');
    expect(new DataView(out.buffer).getUint32(4, true)).toBe(out.length - 8);
  });
});

describe('Pipeline', () => {
  const opts = (o: Partial<ExportOptions>) => normalizeOptions({ ...DEFAULT_OPTIONS, ...o });
  const noCanvas = { canvas: async () => { throw new Error('sin canvas'); }, webp: async () => { throw new Error('sin webp'); } };
  it('opciones: perfil efectivo y transparencia según formato', () => {
    expect(profileFor(opts({ format: 'jpeg', profile: 'gray' }))).toBe('srgb');
    expect(profileFor(opts({ format: 'tiff', profile: 'gray' }))).toBe('gray');
    expect(profileFor(opts({ embedProfile: false }))).toBeNull();
    expect(keepsAlpha(opts({ format: 'jpeg' }))).toBe(false);
    expect(keepsAlpha(opts({ format: 'bmp', bmpDepth: 24 }))).toBe(false);
    expect(normalizeOptions({ format: 'exe', scale: 999, name: '' }).format).toBe('png');
  });
  it('capas individuales generan un archivo por capa sin tocar los datos de origen', async () => {
    const { px, w, h } = sample();
    const before = new Uint8ClampedArray(px);
    const files = await encodeExport({ width: w, height: h, composite: px, layers: [], individual: [{ name: 'Tinta', data: px }, { name: 'Color', data: px }] },
      opts({ format: 'png', layers: 'individual', name: 'Mi dibujo', profile: 'gray', transparent: false }), noCanvas, () => {});
    expect(files.map(f => f.name)).toEqual(['Mi dibujo - Tinta.png', 'Mi dibujo - Color.png']);
    expect(px).toEqual(before);
    save('pipeline-gray-flat.png', files[0].data);
  });
});

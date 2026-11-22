import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';

/**
 * Texturas del editor 3D: procedimentales (madera, piedra, ladrillo, mármol, tejas,
 * hierba, tela, corteza: se dibujan al vuelo, no pesan en el proyecto) e imágenes
 * del proyecto (lienzo editable: se puede pintar encima y verse en vivo).
 */
const rnd = (seed: number) => { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };

function proc(kind: string): HTMLCanvasElement {
  const N = 512, c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  const r = rnd(kind.length * 977 + 13);
  const shade = (v: number) => `rgb(${v},${v},${v})`;
  g.fillStyle = '#fff'; g.fillRect(0, 0, N, N);
  switch (kind) {
    case 'wood': case 'bark': {
      // Vetas: bandas verticales onduladas (más oscuras en la corteza).
      const img = g.getImageData(0, 0, N, N), d = img.data;
      const ph = Array.from({ length: 6 }, () => r() * 6.28);
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const w = Math.sin((x / N) * 40 + Math.sin(y / 37 + ph[0]) * 2.2 + Math.sin(y / 11 + ph[1]) * 0.4);
        let v = 200 + w * (kind === 'bark' ? 40 : 28) + (r() - 0.5) * 18;
        if (kind === 'bark' && Math.sin(x / 9 + Math.sin(y / 23) * 3) > 0.85) v -= 70;
        const i = (y * N + x) * 4; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      break;
    }
    case 'stone': case 'marble': {
      const img = g.getImageData(0, 0, N, N), d = img.data;
      // Ruido de valor por octavas (rápido, sin bibliotecas).
      const grid = (s: number) => { const n = s + 1, a = new Float32Array(n * n); for (let i = 0; i < a.length; i++) a[i] = r(); return (x: number, y: number) => { const gx = (x / N) * s, gy = (y / N) * s, xi = Math.floor(gx), yi = Math.floor(gy), fx = gx - xi, fy = gy - yi; const at = (i: number, j: number) => a[(j % n) * n + (i % n)]; const top = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * fx, bot = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * fx; return top + (bot - top) * fy; }; };
      const oct = [grid(4), grid(8), grid(16), grid(32), grid(64)];
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        let n = 0, amp = 0.5;
        for (const o of oct) { n += o(x, y) * amp; amp *= 0.5; }
        const v = kind === 'marble' ? 240 - n * 25 - Math.pow(1 - Math.abs(Math.sin((x * 0.6 + y) / 50 + n * 10)), 12) * 120 : 150 + n * 120;
        const i = (y * N + x) * 4; d[i] = d[i + 1] = d[i + 2] = Math.max(0, Math.min(255, v)); d[i + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      break;
    }
    case 'brick': case 'tiles': {
      g.fillStyle = shade(kind === 'brick' ? 205 : 190); g.fillRect(0, 0, N, N);
      const rows = kind === 'brick' ? 8 : 6, cols = kind === 'brick' ? 4 : 6, bh = N / rows, bw = N / cols;
      for (let j = 0; j < rows; j++) for (let i = -1; i <= cols; i++) {
        const off = j % 2 ? bw / 2 : 0, v = 225 + (r() - 0.5) * 50;
        g.fillStyle = shade(v);
        if (kind === 'brick') g.fillRect(i * bw + off + 4, j * bh + 4, bw - 8, bh - 8);
        else { g.beginPath(); g.ellipse(i * bw + off + bw / 2, j * bh + bh * 0.15, bw / 2 - 3, bh * 0.9, 0, 0, Math.PI); g.fill(); }
      }
      break;
    }
    case 'grass': {
      g.fillStyle = shade(190); g.fillRect(0, 0, N, N);
      for (let k = 0; k < 9000; k++) { g.strokeStyle = shade(150 + r() * 105); g.lineWidth = 1; const x = r() * N, y = r() * N; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 6, y - 4 - r() * 8); g.stroke(); }
      break;
    }
    case 'fabric': {
      for (let y = 0; y < N; y += 4) for (let x = 0; x < N; x += 4) { g.fillStyle = shade(((x + y) / 4) % 2 ? 215 : 245 - r() * 20); g.fillRect(x, y, 4, 4); }
      break;
    }
  }
  return c;
}

/** Caché de texturas por clave (procedimentales y del proyecto). */
export class TexCache {
  private procs = new Map<string, Texture>();
  private imgs = new Map<string, { canvas: HTMLCanvasElement | null; tex: CanvasTexture | null; loading: Promise<void> | null }>();
  onLoad: () => void = () => {};

  procedural(kind: string): Texture {
    let t = this.procs.get(kind);
    if (!t) { t = new CanvasTexture(proc(kind)); t.wrapS = t.wrapT = RepeatWrapping; t.colorSpace = SRGBColorSpace; t.anisotropy = 4; this.procs.set(kind, t); }
    return t;
  }
  /** Textura de una imagen del proyecto (null mientras carga). */
  image(id: string, src: string): CanvasTexture | null {
    let e = this.imgs.get(id);
    if (!e) {
      e = { canvas: null, tex: null, loading: null };
      this.imgs.set(id, e);
      const entry = e;
      e.loading = loadCanvas(src).then(c => {
        entry.canvas = c;
        entry.tex = new CanvasTexture(c); entry.tex.wrapS = entry.tex.wrapT = RepeatWrapping; entry.tex.colorSpace = SRGBColorSpace; entry.tex.anisotropy = 4;
        this.onLoad();
      }).catch(() => undefined);
    }
    return e.tex;
  }
  /** Lienzo editable de una textura (para pintar). */
  canvas(id: string) { return this.imgs.get(id)?.canvas ?? null; }
  /** Asocia un lienzo ya cargado a otra id (la nueva versión tras pintar no parpadea). */
  alias(from: string, to: string) { const e = this.imgs.get(from); if (e) this.imgs.set(to, { ...e }); }
  /** Pone un lienzo propio como textura (pintar en un material sin textura). */
  put(id: string, c: HTMLCanvasElement) { const tex = new CanvasTexture(c); tex.wrapS = tex.wrapT = RepeatWrapping; tex.colorSpace = SRGBColorSpace; this.imgs.set(id, { canvas: c, tex, loading: null }); return tex; }
  dispose() { for (const t of this.procs.values()) t.dispose(); for (const e of this.imgs.values()) e.tex?.dispose(); this.procs.clear(); this.imgs.clear(); }
}

export function loadCanvas(src: string, max = 2048): Promise<HTMLCanvasElement> {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => {
      const k = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(im.naturalWidth * k)); c.height = Math.max(1, Math.round(im.naturalHeight * k));
      c.getContext('2d')!.drawImage(im, 0, 0, c.width, c.height);
      res(c);
    };
    im.onerror = () => rej(new Error('imagen no válida'));
    im.src = src;
  });
}
/** Imagen (archivo) → data URL reducido a `max` px (PNG si tiene transparencia, si no JPEG). */
export async function fileToDataUrl(f: Blob, max = 2048): Promise<string> {
  const url = URL.createObjectURL(f);
  try { const c = await loadCanvas(url, max); return canvasToUrl(c); } finally { URL.revokeObjectURL(url); }
}
export function canvasToUrl(c: HTMLCanvasElement): string {
  const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  let alpha = false;
  for (let i = 3; i < d.length; i += 4 * 97) if (d[i] < 250) { alpha = true; break; }
  return alpha ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.92);
}

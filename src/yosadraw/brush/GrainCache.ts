import type { BrushPreset } from './BrushPreset';
import { ImageStore } from './ImageStore';
import { Rng } from './Rng';

type Grain = BrushPreset['grain'];
export const GRAIN_TILE = 256;

/** Ruido de valor periódico (se repite sin costuras cada `period` celdas). */
function periodicNoise(rng: Rng, period: number): (x: number, y: number) => number {
  const lat = new Float32Array(period * period).map(() => rng.next());
  return (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const at = (i: number, j: number) => lat[(((j % period) + period) % period) * period + (((i % period) + period) % period)];
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

/** Valor 0..1 por píxel de cada textura procedural (1 = deja pasar la pintura). */
function proceduralGrain(type: Grain['type']): Float32Array {
  const N = GRAIN_TILE, out = new Float32Array(N * N), rng = new Rng(1337);
  const fbm = (octaves: number[]) => {
    const fns = octaves.map(p => ({ p, f: periodicNoise(rng, p) }));
    return (x: number, y: number) => {
      let s = 0, w = 0, amp = 1;
      for (const { p, f } of fns) { s += amp * f((x / N) * p, (y / N) * p); w += amp; amp *= 0.55; }
      return s / w;
    };
  };
  if (type === 'paper') {
    const f = fbm([8, 16, 32, 64, 128]);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) out[y * N + x] = f(x, y);
  } else if (type === 'noise') {
    const f = fbm([128, 256]);
    for (let i = 0; i < N * N; i++) out[i] = f(i % N, Math.floor(i / N));
  } else if (type === 'canvas') {
    // Tela de lienzo: hilos de grosor irregular que se cruzan, con fibras.
    const warp = fbm([16, 32]), fiber = fbm([64, 128, 256]);
    const T = 5.333; // 48 hilos por mosaico: periódico
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const jx = (warp(x, y) - 0.5) * 1.6, jy = (warp(y + 97, x + 31) - 0.5) * 1.6;
      const tx = Math.abs(Math.sin((Math.PI * (x + jx)) / T)), ty = Math.abs(Math.sin((Math.PI * (y + jy)) / T));
      const over = (Math.floor((x + jx) / T) + Math.floor((y + jy) / T)) % 2 === 0;
      const thread = over ? Math.pow(ty, 0.6) * 0.8 + 0.2 * tx : Math.pow(tx, 0.6) * 0.8 + 0.2 * ty;
      out[y * N + x] = 0.7 * thread + 0.3 * fiber(x, y);
    }
  } else if (type === 'pencil') {
    const streak = periodicNoise(rng, 128), paper = fbm([16, 32, 64]);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++)
      out[y * N + x] = 0.55 * streak((x / N) * 8, (y / N) * 128) + 0.45 * paper(x, y);
  } else if (type === 'stipple') {
    out.fill(0);
    for (let i = 0; i < 900; i++) {
      const cx = rng.next() * N, cy = rng.next() * N, r = 0.8 + rng.next() * 2.2;
      for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
        const dd = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        const a = Math.max(0, Math.min(1, r - dd + 0.5));
        const o = (((y % N) + N) % N) * N + (((x % N) + N) % N);
        out[o] = Math.max(out[o], a);
      }
    }
  }
  // Normaliza a 0..1.
  let min = Infinity, max = -Infinity;
  for (const v of out) { if (v < min) min = v; if (v > max) max = v; }
  const r = max - min || 1;
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - min) / r;
  return out;
}

/**
 * Texturas de grano como mosaicos alfa: alfa = 1 − profundidad · (1 − grano).
 * Se aplican con `destination-in`, así que sólo recortan la pintura.
 */
export class GrainCache {
  private base = new Map<string, Float32Array>();
  private tiles = new Map<string, HTMLCanvasElement>();
  private patterns = new WeakMap<CanvasRenderingContext2D, Map<string, CanvasPattern>>();

  constructor(readonly images: ImageStore) {}

  key(g: Grain): string {
    const img = g.type === 'image' && g.image ? ImageStore.key(g.image) : '';
    return `${g.type}|${img}|${g.depth.toFixed(2)}|${g.contrast.toFixed(2)}|${g.invert ? 1 : 0}`;
  }

  ready(g: Grain): boolean { return !g.enabled || g.type !== 'image' || !g.image || this.images.get(g.image) !== null; }

  tile(g: Grain): HTMLCanvasElement | null {
    const k = this.key(g);
    const hit = this.tiles.get(k);
    if (hit) return hit;
    let values: Float32Array | null;
    let W = GRAIN_TILE, H = GRAIN_TILE;
    if (g.type === 'image') {
      const img = g.image ? this.images.get(g.image) : null;
      if (!img) return null;
      W = img.naturalWidth; H = img.naturalHeight;
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const cx = c.getContext('2d', { willReadFrequently: true })!;
      cx.drawImage(img, 0, 0);
      const d = cx.getImageData(0, 0, W, H).data;
      values = new Float32Array(W * H);
      for (let i = 0; i < W * H; i++) values[i] = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255;
    } else {
      values = this.base.get(g.type) ?? null;
      if (!values) { values = proceduralGrain(g.type); this.base.set(g.type, values); }
    }
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const cx = c.getContext('2d')!;
    const id = cx.createImageData(W, H), d = id.data;
    for (let i = 0; i < W * H; i++) {
      let v = values[i];
      if (g.invert) v = 1 - v;
      v = Math.min(1, Math.max(0, (v - 0.5) * g.contrast + 0.5));
      const a = 1 - g.depth * (1 - v);
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255;
      d[i * 4 + 3] = Math.round(a * 255);
    }
    cx.putImageData(id, 0, 0);
    this.tiles.set(k, c);
    if (this.tiles.size > 24) this.tiles.delete(this.tiles.keys().next().value!);
    return c;
  }

  pattern(ctx: CanvasRenderingContext2D, g: Grain): CanvasPattern | null {
    const tile = this.tile(g);
    if (!tile) return null;
    let m = this.patterns.get(ctx);
    if (!m) { m = new Map(); this.patterns.set(ctx, m); }
    const k = this.key(g);
    let p = m.get(k);
    if (!p) { p = ctx.createPattern(tile, 'repeat')!; m.set(k, p); }
    return p;
  }
}

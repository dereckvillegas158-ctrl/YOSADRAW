import type { BrushPreset } from './BrushPreset';
import { ImageStore } from './ImageStore';
import { Rng } from './Rng';

type Tip = BrushPreset['tip'];

/** Tamaños de máscara: potencias de 2^(1/4) para no reescalar más de un 19%. */
export function tipBucket(d: number): number {
  const b = Math.pow(2, Math.ceil(Math.log2(Math.max(4, d)) * 4) / 4);
  return Math.min(1024, Math.ceil(b));
}

const smoothstep = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** Distancia normalizada (1 = borde) para cada forma procedural. */
function shapeDistance(shape: Tip['shape'], u: number, v: number, rough: Float32Array | null): number {
  switch (shape) {
    case 'square': return Math.max(Math.abs(u), Math.abs(v));
    case 'diamond': return Math.abs(u) + Math.abs(v);
    case 'triangle': return Math.max(v, Math.abs(u) * 0.866025 - v * 0.5) / 0.5;
    case 'star': {
      const r = Math.hypot(u, v), th = Math.atan2(v, u) + Math.PI / 2;
      const f = 0.5 + 0.5 * Math.cos(5 * th);
      return r / (0.42 + 0.58 * Math.pow(f, 1.6));
    }
    case 'rough': {
      const r = Math.hypot(u, v);
      const a = ((Math.atan2(v, u) + Math.PI) / (2 * Math.PI)) * 255;
      const i = Math.floor(a), k = a - i;
      const n = rough![i % 256] * (1 - k) + rough![(i + 1) % 256] * k;
      return r / (0.78 + 0.22 * n);
    }
    default: return Math.hypot(u, v);
  }
}

/**
 * Genera y guarda las máscaras de punta (alfa) y sus versiones coloreadas.
 * Se generan al tamaño necesario (hasta 1024 px de dispositivo), así que una
 * punta dura sigue teniendo el borde nítido al ampliar el lienzo.
 */
export class TipCache {
  private masks = new Map<string, HTMLCanvasElement>();
  private colored = new Map<string, HTMLCanvasElement>();
  private roughProfile: Float32Array;

  constructor(readonly images: ImageStore) {
    const rng = new Rng(97);
    const raw = Array.from({ length: 256 }, () => rng.next());
    // Perfil de borde irregular suavizado y periódico.
    this.roughProfile = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      let s = 0;
      for (let k = -6; k <= 6; k++) s += raw[(i + k + 256) % 256];
      this.roughProfile[i] = s / 13;
    }
    let min = Infinity, max = -Infinity;
    this.roughProfile.forEach(v => { min = Math.min(min, v); max = Math.max(max, v); });
    this.roughProfile.forEach((v, i) => (this.roughProfile[i] = (v - min) / (max - min)));
  }

  key(tip: Tip): string {
    const hard = tip.shape === 'spray' || tip.shape === 'image' ? 0 : Math.round(tip.hardness * 100);
    const img = tip.shape === 'image' && tip.image ? ImageStore.key(tip.image) + (tip.invert ? 'i' : '') : '';
    return `${tip.shape}|${hard}|${img}`;
  }

  /** true si la punta se puede dibujar ya (las imágenes se decodifican de forma asíncrona). */
  ready(tip: Tip): boolean {
    return tip.shape !== 'image' || !tip.image || this.images.get(tip.image) !== null;
  }

  mask(tip: Tip, deviceDiameter: number): HTMLCanvasElement | null {
    const size = tipBucket(deviceDiameter);
    const k = `${this.key(tip)}@${size}`;
    let c = this.masks.get(k);
    if (c) { this.masks.delete(k); this.masks.set(k, c); return c; }
    c = this.build(tip, size) ?? undefined;
    if (!c) return null;
    this.masks.set(k, c);
    if (this.masks.size > 64) this.masks.delete(this.masks.keys().next().value!);
    return c;
  }

  coloredTip(tip: Tip, deviceDiameter: number, color: string): HTMLCanvasElement | null {
    const size = tipBucket(deviceDiameter);
    const k = `${this.key(tip)}@${size}#${color}`;
    let c = this.colored.get(k);
    if (c) { this.colored.delete(k); this.colored.set(k, c); return c; }
    const m = this.mask(tip, deviceDiameter);
    if (!m) return null;
    c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d')!;
    g.fillStyle = color;
    g.fillRect(0, 0, size, size);
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(m, 0, 0);
    this.colored.set(k, c);
    // Los pinceles con mezcla generan muchos colores cercanos: caché amplia (puntas pequeñas).
    if (this.colored.size > 1024) this.colored.delete(this.colored.keys().next().value!);
    return c;
  }

  private build(tip: Tip, S: number): HTMLCanvasElement | null {
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d', { willReadFrequently: true })!;

    if (tip.shape === 'image') {
      const img = tip.image ? this.images.get(tip.image) : null;
      if (!img) return null;
      const k = S / Math.max(img.naturalWidth, img.naturalHeight);
      const w = img.naturalWidth * k, h = img.naturalHeight * k;
      g.drawImage(img, (S - w) / 2, (S - h) / 2, w, h);
      const id = g.getImageData(0, 0, S, S), d = id.data;
      for (let i = 0; i < d.length; i += 4) {
        const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
        const a = (d[i + 3] / 255) * (tip.invert ? lum : 1 - lum);
        d[i] = d[i + 1] = d[i + 2] = 255;
        d[i + 3] = Math.round(a * 255);
      }
      g.putImageData(id, 0, 0);
      return c;
    }

    if (tip.shape === 'spray') {
      const rng = new Rng(4242);
      g.fillStyle = '#fff';
      const R = S / 2;
      for (let i = 0; i < 46; i++) {
        const r = Math.sqrt(rng.next()) * R * 0.9, a = rng.next() * Math.PI * 2;
        const dr = Math.max(0.6, R * (0.025 + rng.next() * 0.05));
        g.globalAlpha = 0.55 + rng.next() * 0.45;
        g.beginPath(); g.arc(R + Math.cos(a) * r, R + Math.sin(a) * r, dr, 0, Math.PI * 2); g.fill();
      }
      return c;
    }

    const id = g.createImageData(S, S), d = id.data;
    const half = S / 2;
    const aa = Math.min(0.5, 1.5 / half); // borde antialias de ~1,5 px
    const inner = Math.min(tip.hardness, 1 - aa) * (tip.hardness >= 0.999 ? 1 : 0.98);
    const rough = tip.shape === 'rough' ? this.roughProfile : null;
    for (let y = 0; y < S; y++) {
      const v = (y + 0.5 - half) / half;
      for (let x = 0; x < S; x++) {
        const u = (x + 0.5 - half) / half;
        const dist = shapeDistance(tip.shape, u, v, rough);
        let a: number;
        if (dist <= inner) a = 1;
        else if (dist >= 1) a = 0;
        else a = 1 - smoothstep((dist - inner) / (1 - inner));
        const o = (y * S + x) * 4;
        d[o] = d[o + 1] = d[o + 2] = 255;
        d[o + 3] = Math.round(a * 255);
      }
    }
    g.putImageData(id, 0, 0);
    return c;
  }
}

/** Formas que se pueden trazar como vector cuando el sello es enorme y duro. */
export function vectorTipPath(ctx: CanvasRenderingContext2D, shape: Tip['shape']): boolean {
  ctx.beginPath();
  if (shape === 'round') ctx.arc(0, 0, 0.5, 0, Math.PI * 2);
  else if (shape === 'square') ctx.rect(-0.5, -0.5, 1, 1);
  else if (shape === 'diamond') { ctx.moveTo(0, -0.5); ctx.lineTo(0.5, 0); ctx.lineTo(0, 0.5); ctx.lineTo(-0.5, 0); ctx.closePath(); }
  else if (shape === 'triangle') { ctx.moveTo(0, -0.5); ctx.lineTo(0.433, 0.25); ctx.lineTo(-0.433, 0.25); ctx.closePath(); }
  else return false;
  return true;
}

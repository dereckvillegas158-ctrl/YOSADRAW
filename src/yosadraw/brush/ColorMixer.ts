import type { BrushPreset } from './BrushPreset';

/** Muestra del lienzo: color promedio premultiplicado → r,g,b (0..255 sin premultiplicar) y alfa 0..1. */
export type Sample = [number, number, number, number];
export type Sampler = (x: number, y: number, radius: number) => Sample;

export function parseHex(c: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
  const n = m ? parseInt(m[1], 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Mezcla de color por sello (óleo, acuarela húmeda, difuminador).
 *
 * El pincel "carga" un color K que se va contaminando con lo que encuentra:
 *   K ← K + (muestra − K) · pickup · alfa_muestra · (1 − persistencia·0.9)
 * - wet: color del sello = mezcla de K con el color del pincel según `paint`.
 * - smudge: el sello pinta sólo K con la opacidad que se arrastra (A), así
 *   también extiende los huecos transparentes.
 */
export class ColorMixer {
  private k: [number, number, number];
  private a = 1;
  private started = false;
  private brush: [number, number, number];

  constructor(private mix: BrushPreset['mix'], color: string, private sample: Sampler) {
    this.brush = parseHex(color);
    this.k = [...this.brush];
  }

  /** Color (r,g,b 0..255) y factor de alfa para el siguiente sello. */
  next(x: number, y: number, radius: number): Sample {
    const s = this.sample(x, y, radius);
    const m = this.mix;
    if (!this.started) {
      this.started = true;
      if (m.mode === 'smudge') { this.k = [s[0], s[1], s[2]]; this.a = s[3]; }
      else if (s[3] > 0) for (let i = 0; i < 3; i++) this.k[i] += (s[i] - this.k[i]) * m.pickup * s[3];
    } else {
      const rate = m.pickup * (1 - m.persistence * 0.9);
      const w = rate * s[3];
      for (let i = 0; i < 3; i++) this.k[i] += (s[i] - this.k[i]) * w;
      if (m.mode === 'smudge') this.a += (s[3] - this.a) * rate;
    }
    if (m.mode === 'smudge') return [this.k[0], this.k[1], this.k[2], this.a];
    const p = m.paint;
    return [this.k[0] + (this.brush[0] - this.k[0]) * p, this.k[1] + (this.brush[1] - this.k[1]) * p, this.k[2] + (this.brush[2] - this.k[2]) * p, 1];
  }
}

/** Muestreador sobre una ImageData en píxeles de dispositivo; `toDevice` convierte doc → dispositivo. */
export function imageSampler(img: ImageData, toDevice: (x: number, y: number) => [number, number], devPerDoc: number): Sampler {
  const { width: W, height: H, data } = img;
  return (x, y, radius) => {
    const [cx, cy] = toDevice(x, y);
    const r = Math.max(1, Math.min(24, radius * devPerDoc * 0.5));
    const step = Math.max(1, r / 3);
    let sr = 0, sg = 0, sb = 0, sa = 0, n = 0;
    for (let dy = -r; dy <= r; dy += step) for (let dx = -r; dx <= r; dx += step) {
      if (dx * dx + dy * dy > r * r) continue;
      const px = Math.round(cx + dx), py = Math.round(cy + dy);
      n++;
      if (px < 0 || py < 0 || px >= W || py >= H) continue;
      const o = (py * W + px) * 4, a = data[o + 3] / 255;
      sr += data[o] * a; sg += data[o + 1] * a; sb += data[o + 2] * a; sa += a;
    }
    if (!n || sa <= 0) return [255, 255, 255, 0];
    return [sr / sa, sg / sa, sb / sa, sa / n];
  };
}

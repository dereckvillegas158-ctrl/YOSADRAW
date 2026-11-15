import type { StrokePoint } from '../core/types';

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Perturbaciones deterministas para probar el motor con ratón o patrones:
 * - Temblor: mezcla de senoides en la banda 8–12 Hz + ruido blanco.
 * - Picos: saltos aislados de una muestra (fallos del digitalizador, golpes).
 * Se aplican a la entrada antes de que llegue a A y B, así ambos reciben
 * exactamente los mismos datos.
 */
export class NoiseInjector {
  tremor = 0; // 0..1
  spikes = 0; // 0..1
  private rng = mulberry32(1);
  private ph = [0, 0, 0, 0];
  private t0 = 0;

  beginStroke(seed: number, t0: number) {
    this.rng = mulberry32(seed);
    this.ph = this.ph.map(() => this.rng() * Math.PI * 2);
    this.t0 = t0;
  }

  apply(p: StrokePoint): StrokePoint {
    if (this.tremor <= 0 && this.spikes <= 0) return p;
    const s = (p.t - this.t0) / 1000;
    const amp = this.tremor * 4.5;
    const tau = Math.PI * 2;
    let x = p.x + amp * (0.6 * Math.sin(tau * 8.7 * s + this.ph[0]) + 0.4 * Math.sin(tau * 11.9 * s + this.ph[1]) + 0.6 * (this.rng() - 0.5));
    let y = p.y + amp * (0.6 * Math.sin(tau * 9.4 * s + this.ph[2]) + 0.4 * Math.sin(tau * 12.6 * s + this.ph[3]) + 0.6 * (this.rng() - 0.5));
    if (this.spikes > 0 && this.rng() < this.spikes * 0.035) {
      const ang = this.rng() * tau, mag = 10 + this.rng() * 22;
      x += Math.cos(ang) * mag; y += Math.sin(ang) * mag;
    }
    return { ...p, x, y };
  }
}

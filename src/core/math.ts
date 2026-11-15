import type { StrokePoint } from './types';

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const hypot = (x: number, y: number) => Math.sqrt(x * x + y * y);
export const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => hypot(a.x - b.x, a.y - b.y);

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Factor de suavizado exponencial independiente de la frecuencia de muestreo. */
export const expAlpha = (dt: number, tau: number) => (tau <= 0 ? 1 : 1 - Math.exp(-dt / tau));

export const copyPoint = (p: StrokePoint, over?: Partial<StrokePoint>): StrokePoint => ({
  x: p.x, y: p.y, pressure: p.pressure, tiltX: p.tiltX, tiltY: p.tiltY, t: p.t, ...over,
});

/**
 * Emite puntos desde `from` hasta cada destino de `targets` con separación
 * `spacing` px. Lo usan las etapas para "alcanzar" la punta del lápiz al soltar.
 */
export function catchUp(from: StrokePoint, targets: StrokePoint[], out: StrokePoint[], spacing = 2.5, speed = 1): StrokePoint {
  let cur = from;
  for (const tgt of targets) {
    const d = dist(cur, tgt);
    if (d < 0.05) continue;
    const n = Math.max(1, Math.ceil(d / spacing));
    const stepT = Math.max(0.5, d / Math.max(speed, 0.2) / n);
    for (let i = 1; i <= n; i++) {
      const k = i / n;
      out.push({
        x: lerp(cur.x, tgt.x, k), y: lerp(cur.y, tgt.y, k),
        pressure: lerp(cur.pressure, tgt.pressure, k),
        tiltX: tgt.tiltX, tiltY: tgt.tiltY, t: cur.t + stepT * i,
      });
    }
    cur = out[out.length - 1];
  }
  return cur;
}

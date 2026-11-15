import type { StrokePoint } from '../core/types';

export type PatternId = 'corners' | 'spiral' | 'cursive' | 'hatching';

export const PATTERNS: { id: PatternId; label: string }[] = [
  { id: 'corners', label: 'Esquinas y zigzag' },
  { id: 'spiral', label: 'Espiral lenta' },
  { id: 'cursive', label: 'Bucles de caligrafía' },
  { id: 'hatching', label: 'Rayado rápido' },
];

const HZ = 240;
const minJerk = (u: number) => u * u * u * (10 - 15 * u + 6 * u * u);

/** Polilínea recorrida como lo haría una mano: `stop`=1 frena del todo en cada vértice, 0 = velocidad constante. */
function polyStroke(v: [number, number][], speed: number, t0: number, stop = 1): StrokePoint[] {
  const out: StrokePoint[] = [];
  let t = t0;
  const total = v.length - 1;
  for (let i = 0; i < total; i++) {
    const [x0, y0] = v[i], [x1, y1] = v[i + 1];
    const len = Math.hypot(x1 - x0, y1 - y0);
    const dur = 80 + len / speed;
    const n = Math.max(2, Math.round((dur / 1000) * HZ));
    for (let j = i === 0 ? 0 : 1; j <= n; j++) {
      const u = stop * minJerk(j / n) + (1 - stop) * (j / n);
      const g = (i + j / n) / total;
      out.push({ x: x0 + (x1 - x0) * u, y: y0 + (y1 - y0) * u, pressure: pressureCurve(g), tiltX: 0, tiltY: 0, t: t + (dur * j) / n });
    }
    t += dur;
  }
  return out;
}

/** Curva paramétrica recorrida con perfil de velocidad suave. */
function curveStroke(f: (u: number) => [number, number], dur: number, t0: number): StrokePoint[] {
  const n = Math.round((dur / 1000) * HZ);
  const out: StrokePoint[] = [];
  for (let j = 0; j <= n; j++) {
    const g = j / n;
    const u = 0.15 * minJerk(g) + 0.85 * g;
    const [x, y] = f(u);
    out.push({ x, y, pressure: pressureCurve(g) * (0.85 + 0.15 * Math.sin(g * 19)), tiltX: 0, tiltY: 0, t: t0 + dur * g });
  }
  return out;
}

const pressureCurve = (g: number) => 0.2 + 0.75 * Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, g))), 0.5);

export function generatePattern(id: PatternId, w: number, h: number): StrokePoint[][] {
  const S = Math.min(w, h);
  const strokes: StrokePoint[][] = [];
  let t = 0;
  const add = (s: StrokePoint[]) => { strokes.push(s); t = s[s.length - 1].t + 250; };

  if (id === 'corners') {
    const r = S * 0.17;
    const cx1 = w * 0.25, cy1 = h * 0.3;
    add(polyStroke([[cx1 - r, cy1 - r], [cx1 + r, cy1 - r], [cx1 + r, cy1 + r], [cx1 - r, cy1 + r], [cx1 - r, cy1 - r]], 0.55, t));
    const cx2 = w * 0.72, cy2 = h * 0.3;
    add(polyStroke([[cx2, cy2 - r], [cx2 + r * 1.1, cy2 + r], [cx2 - r * 1.1, cy2 + r], [cx2, cy2 - r]], 0.6, t));
    const zz: [number, number][] = [];
    const n = 7, y0 = h * 0.72, amp = S * 0.11;
    for (let i = 0; i <= n; i++) zz.push([w * 0.1 + (w * 0.8 * i) / n, y0 + (i % 2 ? -amp : amp)]);
    add(polyStroke(zz, 0.9, t, 0.25)); // zigzag rápido: casi no frena en los vértices
  } else if (id === 'spiral') {
    const cx = w / 2, cy = h / 2, R = S * 0.42, turns = 3.5;
    add(curveStroke(u => {
      const a = u * turns * Math.PI * 2, r = R * (0.08 + 0.92 * u);
      return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
    }, 4200, t));
  } else if (id === 'cursive') {
    for (let row = 0; row < 2; row++) {
      const y = h * (0.32 + row * 0.38), r = S * 0.085, x0 = w * 0.08, x1 = w * 0.92;
      const loops = 6;
      add(curveStroke(u => {
        const a = u * loops * Math.PI * 2;
        return [x0 + (x1 - x0) * u - r * Math.sin(a) * 0.9, y - r * Math.cos(a) * (row ? 1.3 : 1) + r];
      }, 3200, t));
    }
  } else {
    for (let i = 0; i < 12; i++) {
      const x = w * 0.12 + (w * 0.7 * i) / 11;
      add(polyStroke([[x, h * 0.2], [x + w * 0.16, h * 0.8]], 2.6, t));
      t -= 130;
    }
  }
  return strokes;
}

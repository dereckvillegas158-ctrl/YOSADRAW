import type { StrokePoint } from '../../core/types';
import type { BrushPreset } from './BrushPreset';
import { evalDynamics, type DynamicsOutput } from './dynamics';
import { curveLUT } from './PressureCurve';
import { Rng } from './Rng';

/** Cada sello ocupa 6 floats: x, y (documento), diámetro, flujo, ángulo (rad), redondez. */
export const DAB_STRIDE = 6;

export class DabBuffer {
  data = new Float32Array(DAB_STRIDE * 256);
  count = 0;
  push(x: number, y: number, d: number, flow: number, angle: number, round: number) {
    if ((this.count + 1) * DAB_STRIDE > this.data.length) {
      const n = new Float32Array(this.data.length * 2);
      n.set(this.data);
      this.data = n;
    }
    const o = this.count++ * DAB_STRIDE;
    const a = this.data;
    a[o] = x; a[o + 1] = y; a[o + 2] = d; a[o + 3] = flow; a[o + 4] = angle; a[o + 5] = round;
  }
  clear() { this.count = 0; }
  /** Copia compacta (para guardar con el trazo). */
  trimmed(): Float32Array { return this.data.slice(0, this.count * DAB_STRIDE); }
}

interface WalkState {
  carry: number;   // distancia hasta el siguiente sello
  s: number;       // longitud recorrida
  speed: number;   // px/ms suavizada
  rng: number;     // estado del PRNG
  started: boolean;
}

/**
 * Convierte puntos del trazo (coordenadas de documento) en sellos.
 *
 * - Interpola con Catmull-Rom centrípeta (misma curva que el StrokeRenderer)
 *   y coloca sellos a intervalos de `spacing × diámetro`.
 * - Determinista: mismo preset + misma semilla + mismos puntos → mismos sellos,
 *   tanto si los puntos llegan de uno en uno (en vivo) como de golpe (al
 *   repintar). Por eso la tinta es idéntica a cualquier zoom o tras deshacer.
 * - Un segmento se confirma cuando llega el punto siguiente (necesario para la
 *   tangente); `previewTail` estima el último tramo para no añadir latencia.
 */
export class DabGenerator {
  readonly dabs = new DabBuffer();
  private pts: StrokePoint[] = [];
  private committed = 0; // segmentos confirmados
  private st: WalkState;
  private lut: Float32Array;
  private dyn: DynamicsOutput = { size: 1, flow: 1, tilt: 0, azimuth: 0, taper: 1 };
  private total: number;

  constructor(private preset: BrushPreset, seed: number, opts: { totalLength?: number } = {}) {
    this.lut = curveLUT(preset.pressure.curve);
    this.total = opts.totalLength ?? Infinity;
    this.st = { carry: 0, s: 0, speed: 0, rng: seed >>> 0, started: false };
  }

  /** Longitud recorrida hasta ahora (tras `finish`, la total). */
  get length() { return this.st.s; }
  get points(): readonly StrokePoint[] { return this.pts; }

  push(p: StrokePoint): void {
    const last = this.pts[this.pts.length - 1];
    if (last && Math.abs(last.x - p.x) < 1e-4 && Math.abs(last.y - p.y) < 1e-4) {
      // Mismo sitio: actualiza presión/inclinación sin crear un segmento nulo.
      this.pts[this.pts.length - 1] = { ...p, t: last.t };
      return;
    }
    this.pts.push(p);
    while (this.committed <= this.pts.length - 3) { this.segment(this.committed, false, this.st, this.dabs); this.committed++; }
  }

  finish(): void {
    if (this.pts.length === 1) { this.place(this.pts[0], 0, 0, this.st, this.dabs, 0); return; }
    while (this.committed <= this.pts.length - 2) { this.segment(this.committed, true, this.st, this.dabs); this.committed++; }
  }

  /** Sellos provisionales del tramo aún no confirmado (no modifica el estado). */
  previewTail(out: DabBuffer): void {
    out.clear();
    const n = this.pts.length;
    if (n === 1 && !this.st.started) { this.place(this.pts[0], 0, 0, { ...this.st }, out, 0); return; }
    if (this.committed > n - 2) return;
    const st = { ...this.st };
    for (let i = this.committed; i <= n - 2; i++) this.segment(i, true, st, out);
  }

  /* ------------------------------------------------------------------ */

  private segment(i: number, open: boolean, st: WalkState, out: DabBuffer) {
    const P = this.pts;
    const p1 = P[i], p2 = P[i + 1];
    const p0 = i > 0 ? P[i - 1] : p1;
    const p3 = !open && i + 2 < P.length ? P[i + 2] : p2;

    const d01 = Math.max(1e-4, Math.pow(dist2(p0, p1), 0.25));
    const d12 = Math.max(1e-4, Math.pow(dist2(p1, p2), 0.25));
    const d23 = Math.max(1e-4, Math.pow(dist2(p2, p3), 0.25));
    const tan = (a: number, b: number, c: number, d: number) => [
      ((b - a) / d01 - (c - a) / (d01 + d12) + (c - b) / d12) * d12,
      ((c - b) / d12 - (d - b) / (d12 + d23) + (d - c) / d23) * d12,
    ];
    const [m1x, m2x] = tan(p0.x, p1.x, p2.x, p3.x);
    const [m1y, m2y] = tan(p0.y, p1.y, p2.y, p3.y);
    const ax = 2 * p1.x - 2 * p2.x + m1x + m2x, bx = -3 * p1.x + 3 * p2.x - 2 * m1x - m2x;
    const ay = 2 * p1.y - 2 * p2.y + m1y + m2y, by = -3 * p1.y + 3 * p2.y - 2 * m1y - m2y;

    const chord = Math.sqrt(dist2(p1, p2));
    const dt = Math.max(1, p2.t - p1.t);
    st.speed = st.speed ? st.speed + 0.3 * (chord / dt - st.speed) : chord / dt;

    const n = Math.min(256, Math.max(1, Math.ceil(chord / 0.75)));
    let px = p1.x, py = p1.y;
    for (let j = 1; j <= n; j++) {
      const t = j / n, t2 = t * t, t3 = t2 * t;
      const x = ax * t3 + bx * t2 + m1x * t + p1.x;
      const y = ay * t3 + by * t2 + m1y * t + p1.y;
      const len = Math.hypot(x - px, y - py);
      if (len > 1e-6) {
        const dir = Math.atan2(y - py, x - px);
        let along = 0;
        while (st.carry <= len - along) {
          along += st.carry;
          const k = along / len;
          const tk = (j - 1 + k) / n;
          const sample = {
            x: px + (x - px) * k, y: py + (y - py) * k,
            pressure: p1.pressure + (p2.pressure - p1.pressure) * tk,
            tiltX: p1.tiltX + (p2.tiltX - p1.tiltX) * tk,
            tiltY: p1.tiltY + (p2.tiltY - p1.tiltY) * tk,
            t: p1.t + (p2.t - p1.t) * tk,
          };
          st.carry = this.place(sample, dir, st.s + along, st, out, st.speed);
        }
        st.carry -= len - along;
        st.s += len;
      }
      px = x; py = y;
    }
  }

  /** Coloca el sello (y sus copias dispersas) y devuelve la distancia hasta el siguiente. */
  private place(p: StrokePoint, dir: number, s: number, st: WalkState, out: DabBuffer, speed: number): number {
    const pr = this.preset;
    st.started = true;
    const rng = new Rng(st.rng);
    const dyn = evalDynamics(pr, this.lut, { pressure: p.pressure, tiltX: p.tiltX, tiltY: p.tiltY, speed, s, total: this.total }, this.dyn);
    const base = pr.size.size;
    const dNoJitter = base * dyn.size;

    let angle = (pr.tip.angle * Math.PI) / 180;
    if (pr.rotation.mode === 'direction') angle += dir;
    else if (pr.rotation.mode === 'azimuth') angle += dyn.azimuth;
    else if (pr.rotation.mode === 'random') angle += rng.next() * Math.PI * 2;
    const round = Math.max(0.03, pr.tip.roundness * (1 - pr.tilt.roundness * dyn.tilt * 0.85));

    const count = Math.max(1, Math.round(pr.scatter.count * (1 - pr.scatter.countJitter * rng.next())));
    const nx = -Math.sin(dir), ny = Math.cos(dir), tx = Math.cos(dir), ty = Math.sin(dir);
    for (let c = 0; c < count; c++) {
      const d = dNoJitter * (1 - pr.size.jitter * rng.next());
      const flow = dyn.flow * (1 - pr.opacity.flowJitter * rng.next());
      const a = angle + rng.signed() * Math.PI * pr.rotation.jitter;
      let x = p.x, y = p.y;
      if (pr.scatter.amount > 0) {
        const o1 = rng.signed() * pr.scatter.amount * dNoJitter;
        x += nx * o1; y += ny * o1;
        if (pr.scatter.bothAxes) { const o2 = rng.signed() * pr.scatter.amount * dNoJitter; x += tx * o2; y += ty * o2; }
      }
      if (d > 0.01 && flow > 0.001) out.push(x, y, d, Math.min(1, flow), a, round);
    }
    const step = Math.max(0.2, pr.spacing.spacing * dNoJitter * (1 + pr.spacing.jitter * 0.9 * rng.signed()));
    st.rng = rng.state;
    return step;
  }
}

function dist2(a: StrokePoint, b: StrokePoint) {
  const dx = a.x - b.x, dy = a.y - b.y;
  return dx * dx + dy * dy;
}

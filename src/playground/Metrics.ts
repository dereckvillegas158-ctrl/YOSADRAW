import type { StrokePoint } from '../core/types';

/** Giro total (grados) y longitud de una trayectoria remuestreada cada `step` px. */
export function turning(points: readonly StrokePoint[], step = 3): { turn: number; len: number } {
  if (points.length < 3) return { turn: 0, len: 0 };
  const rs: { x: number; y: number }[] = [{ x: points[0].x, y: points[0].y }];
  let acc = 0, len = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    len += d;
    let rem = d;
    while (acc + rem >= step) {
      const k = (d - rem + (step - acc)) / d;
      rs.push({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
      rem -= step - acc;
      acc = 0;
    }
    acc += rem;
  }
  let turn = 0;
  for (let i = 2; i < rs.length; i++) {
    const a1 = Math.atan2(rs[i - 1].y - rs[i - 2].y, rs[i - 1].x - rs[i - 2].x);
    const a2 = Math.atan2(rs[i].y - rs[i - 1].y, rs[i].x - rs[i - 1].x);
    let da = a2 - a1;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    turn += Math.abs(da);
  }
  return { turn: (turn * 180) / Math.PI, len };
}

/** Métricas acumuladas desde el último borrado. */
export class StrokeMetrics {
  samples = 0;
  costSum = 0;
  costMax = 0;
  lagSum = 0;
  lagMax = 0;
  lagN = 0;
  rawTurn = 0;
  rawLen = 0;
  outTurn = 0;
  outLen = 0;

  reset() { Object.assign(this, new StrokeMetrics()); }

  addCost(ms: number, n: number) { this.samples += n; this.costSum += ms; this.costMax = Math.max(this.costMax, ms); }
  addLag(px: number) { this.lagSum += px; this.lagMax = Math.max(this.lagMax, px); this.lagN++; }
  addStroke(raw: readonly StrokePoint[], out: readonly StrokePoint[]) {
    const r = turning(raw), o = turning(out);
    this.rawTurn += r.turn; this.rawLen += r.len; this.outTurn += o.turn; this.outLen += o.len;
  }

  /** µs de CPU por muestra de entrada. */
  get costPerSample() { return this.samples ? (this.costSum * 1000) / this.samples : 0; }
  get lagAvg() { return this.lagN ? this.lagSum / this.lagN : 0; }
  /** Grados de giro por cada 100 px: menos es más suave. */
  get rawRough() { return this.rawLen ? (this.rawTurn / this.rawLen) * 100 : 0; }
  get outRough() { return this.outLen ? (this.outTurn / this.outLen) * 100 : 0; }
}

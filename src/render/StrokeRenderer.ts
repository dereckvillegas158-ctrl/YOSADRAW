import type { StrokePoint } from '../core/types';

export interface BrushSettings {
  size: number;        // diámetro máximo en px
  color: string;
  usePressure: boolean;
  minRatio: number;    // ancho mínimo relativo con presión 0
  gamma: number;       // curva de presión
}

/**
 * Dibuja los puntos procesados con splines Catmull-Rom centrípetas
 * (sin bucles ni sobreoscilación en esquinas) y ancho variable por presión.
 *
 * Latencia: un segmento de spline necesita el punto siguiente para conocer su
 * tangente. Los segmentos completos se fijan en la capa `ink` en cuanto llegan;
 * el último tramo, aún provisional, se pinta en la capa `live`, que se borra en
 * cada fotograma. Así la tinta llega hasta la última muestra sin esperar.
 */
export class StrokeRenderer {
  private pts: StrokePoint[] = [];
  private committed = 0;
  active = false;

  constructor(private ink: CanvasRenderingContext2D, private live: CanvasRenderingContext2D, public brush: BrushSettings) {}

  width(p: StrokePoint): number {
    const b = this.brush;
    if (!b.usePressure) return b.size;
    const pr = Math.pow(Math.min(1, Math.max(0, p.pressure)), b.gamma);
    return b.size * (b.minRatio + (1 - b.minRatio) * pr);
  }

  begin(points: StrokePoint[]): void {
    this.pts = [];
    this.committed = 0;
    this.active = true;
    if (points.length) {
      const p = points[0];
      const ctx = this.ink;
      ctx.fillStyle = this.brush.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, this.width(p) / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    this.add(points);
  }

  add(points: StrokePoint[]): void {
    for (const p of points) this.pts.push(p);
    while (this.committed <= this.pts.length - 3) {
      this.segment(this.ink, this.committed, false);
      this.committed++;
    }
  }

  end(points: StrokePoint[]): void {
    this.add(points);
    while (this.committed <= this.pts.length - 2) {
      this.segment(this.ink, this.committed, true);
      this.committed++;
    }
    this.active = false;
  }

  /** Pinta el tramo provisional; se llama una vez por fotograma. */
  drawLive(): void {
    if (!this.active) return;
    for (let i = this.committed; i <= this.pts.length - 2; i++) this.segment(this.live, i, true);
  }

  tip(): StrokePoint | undefined { return this.pts[this.pts.length - 1]; }
  points(): readonly StrokePoint[] { return this.pts; }

  private segment(ctx: CanvasRenderingContext2D, i: number, open: boolean): void {
    const P = this.pts;
    const p1 = P[i], p2 = P[i + 1];
    const p0 = i > 0 ? P[i - 1] : p1;
    const p3 = !open && i + 2 < P.length ? P[i + 2] : p2;

    // Catmull-Rom centrípeta en forma de Hermite (alpha = 0.5).
    const d01 = Math.max(1e-4, Math.pow(dist2(p0, p1), 0.25));
    const d12 = Math.max(1e-4, Math.pow(dist2(p1, p2), 0.25));
    const d23 = Math.max(1e-4, Math.pow(dist2(p2, p3), 0.25));
    const tan = (a: number, b: number, c: number, d: number) => {
      const m1 = ((b - a) / d01 - (c - a) / (d01 + d12) + (c - b) / d12) * d12;
      const m2 = ((c - b) / d12 - (d - b) / (d12 + d23) + (d - c) / d23) * d12;
      return [m1, m2];
    };
    const [m1x, m2x] = tan(p0.x, p1.x, p2.x, p3.x);
    const [m1y, m2y] = tan(p0.y, p1.y, p2.y, p3.y);
    const ax = 2 * p1.x - 2 * p2.x + m1x + m2x, bx = -3 * p1.x + 3 * p2.x - 2 * m1x - m2x;
    const ay = 2 * p1.y - 2 * p2.y + m1y + m2y, by = -3 * p1.y + 3 * p2.y - 2 * m1y - m2y;

    const w1 = this.width(p1), w2 = this.width(p2);
    const len = Math.sqrt(dist2(p1, p2));
    const n = Math.max(1, Math.ceil(len / 1.5));

    ctx.strokeStyle = this.brush.color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    let px = p1.x, py = p1.y;
    for (let j = 1; j <= n; j++) {
      const t = j / n, t2 = t * t, t3 = t2 * t;
      const x = ax * t3 + bx * t2 + m1x * t + p1.x;
      const y = ay * t3 + by * t2 + m1y * t + p1.y;
      ctx.lineWidth = Math.max(0.35, w1 + (w2 - w1) * (t - 0.5 / n));
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(x, y);
      ctx.stroke();
      px = x; py = y;
    }
  }
}

function dist2(a: StrokePoint, b: StrokePoint) {
  const dx = a.x - b.x, dy = a.y - b.y;
  return dx * dx + dy * dy;
}

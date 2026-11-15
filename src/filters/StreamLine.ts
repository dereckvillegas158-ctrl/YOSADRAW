import { BaseStage } from '../core/BaseStage';
import type { StrokePoint } from '../core/types';
import { catchUp, clamp, copyPoint, expAlpha, hypot, lerp } from '../core/math';

interface HistPt { x: number; y: number; s: number; pressure: number; tiltX: number; tiltY: number; }
interface Corner { p: StrokePoint; dinx: number; diny: number; }

/**
 * STREAMLINE — suavizado de trayectoria.
 *
 * Modelo de "pincel remolcado" con dos componentes:
 *  - Cuerda: la punta de tinta nunca se separa del lápiz más de R px.
 *  - Muelle: dentro de la cuerda se acerca con una constante de tiempo τ.
 * La combinación elimina ondulaciones de baja frecuencia y produce curvas
 * fluidas; al soltar, la tinta alcanza al lápiz (no se pierde el final).
 *
 * Preservación de esquinas: un pincel remolcado "corta" las esquinas con un
 * radio ≈ R. Para evitarlo se detectan vértices en la trayectoria (giro > θ
 * medido en una ventana de longitud L) y se insertan como puntos de paso
 * obligatorios: la tinta va hasta el vértice a la velocidad del lápiz y luego
 * gira. Las ondulaciones pequeñas no superan θ y siguen suavizándose.
 */
export class StreamLine extends BaseStage {
  readonly name = 'StreamLine';

  /** Radio de cuerda máximo (px) al 100%. */
  maxRadius = 36;
  /** Constante de tiempo máxima (ms) al 100%. */
  maxTau = 70;
  /** Ángulo mínimo (grados) para considerar un giro como esquina. */
  cornerAngleDeg = 50;
  /** Activa la preservación de esquinas. */
  preserveCorners = true;

  private R = 0;
  private tau = 0;
  private L = 0;
  private brush!: StrokePoint;
  private pen!: StrokePoint;
  private hist: HistPt[] = [];
  private s = 0;
  private corners: Corner[] = [];
  private lastCornerS = -Infinity;
  private speed = 0;

  protected onBegin(p: StrokePoint, out: StrokePoint[]): void {
    const a = this.a;
    this.R = this.maxRadius * Math.pow(a, 1.5);
    this.tau = this.maxTau * a * a;
    this.L = clamp(this.R * 0.45, 3, 14);
    this.brush = copyPoint(p);
    this.pen = p;
    this.s = 0;
    this.hist = [{ x: p.x, y: p.y, s: 0, pressure: p.pressure, tiltX: p.tiltX, tiltY: p.tiltY }];
    this.corners = [];
    this.lastCornerS = -Infinity;
    this.speed = 0;
    out.push(this.brush);
  }

  protected onPush(p: StrokePoint, out: StrokePoint[]): void {
    const dt = Math.max(1, p.t - this.pen.t);
    const d = hypot(p.x - this.pen.x, p.y - this.pen.y);
    this.speed = lerp(this.speed, d / dt, 0.3);
    if (d > 0.01) {
      this.s += d;
      this.hist.push({ x: p.x, y: p.y, s: this.s, pressure: p.pressure, tiltX: p.tiltX, tiltY: p.tiltY });
      const keepFrom = this.s - 2 * this.L - 2;
      while (this.hist.length > 3 && this.hist[1].s < keepFrom) this.hist.shift();
      if (this.preserveCorners && this.R > 1) this.detectCorner(p);
    }
    this.pen = p;
    this.advance(dt, out);
  }

  protected onEnd(out: StrokePoint[]): void {
    catchUp(this.brush, [...this.corners.map(c => c.p), this.pen], out, 2.5, Math.max(this.speed, 0.6));
    this.corners = [];
  }

  /** Mueve la punta de tinta hacia su objetivo y emite el resultado. */
  private advance(dt: number, out: StrokePoint[]): void {
    const pen = this.pen;
    // 1) Esquinas pendientes: ir hasta el vértice antes de girar.
    while (this.corners.length) {
      const c = this.corners[0];
      const bx = this.brush.x - c.p.x, by = this.brush.y - c.p.y;
      if (bx * c.dinx + by * c.diny > 0.5) { this.corners.shift(); continue; } // ya se pasó
      const dc = hypot(bx, by);
      const step = Math.max(this.speed * dt * 1.3, dc * expAlpha(dt, Math.max(this.tau, 6)), 0.5);
      if (dc <= step) {
        this.brush = copyPoint(c.p, { t: pen.t, pressure: lerp(this.brush.pressure, c.p.pressure, 0.5) });
        out.push(this.brush);
        this.corners.shift();
        continue;
      }
      const k = step / dc;
      this.brush = copyPoint(pen, {
        x: this.brush.x - bx * k, y: this.brush.y - by * k,
        pressure: lerp(this.brush.pressure, c.p.pressure, k),
      });
      out.push(this.brush);
      return;
    }
    // 2) Cuerda + muelle hacia el lápiz.
    let x = this.brush.x, y = this.brush.y;
    let dx = pen.x - x, dy = pen.y - y;
    const d = hypot(dx, dy);
    if (d > this.R) {
      const k = (d - this.R) / d;
      x += dx * k; y += dy * k;
      dx = pen.x - x; dy = pen.y - y;
    }
    const ks = expAlpha(dt, this.tau);
    x += dx * ks; y += dy * ks;
    const pressure = lerp(this.brush.pressure, pen.pressure, expAlpha(dt, this.tau * 0.5));
    if (hypot(x - this.brush.x, y - this.brush.y) < 0.05) return;
    this.brush = copyPoint(pen, { x, y, pressure });
    out.push(this.brush);
  }

  private pointAt(s: number): HistPt {
    const h = this.hist;
    if (s <= h[0].s) return h[0];
    let lo = 0, hi = h.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (h[mid].s < s) lo = mid; else hi = mid; }
    const a = h[lo], b = h[hi];
    const k = (s - a.s) / Math.max(1e-6, b.s - a.s);
    return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), s, pressure: lerp(a.pressure, b.pressure, k), tiltX: b.tiltX, tiltY: b.tiltY };
  }

  private detectCorner(p: StrokePoint): void {
    const L = this.L, s = this.s;
    if (s < 2 * L) return;
    const b = this.pointAt(s - 2 * L), v = this.pointAt(s - L);
    const d1x = v.x - b.x, d1y = v.y - b.y, d2x = p.x - v.x, d2y = p.y - v.y;
    const n1 = hypot(d1x, d1y), n2 = hypot(d2x, d2y);
    if (n1 < 1e-3 || n2 < 1e-3) return;
    const cos = (d1x * d2x + d1y * d2y) / (n1 * n2);
    if (cos > Math.cos((this.cornerAngleDeg * Math.PI) / 180)) return;
    // Vértice = punto de la ventana más alejado de la cuerda b→p.
    const cx = p.x - b.x, cy = p.y - b.y, cn = Math.max(1e-6, hypot(cx, cy));
    let best: HistPt | null = null, bestD = -1;
    for (const h of this.hist) {
      if (h.s < s - 2 * L || h.s > s) continue;
      const dd = Math.abs((h.x - b.x) * cy - (h.y - b.y) * cx) / cn;
      if (dd > bestD) { bestD = dd; best = h; }
    }
    if (!best || best.s - this.lastCornerS < 2 * L) return;
    this.lastCornerS = best.s;
    const dinx = best.x - b.x, diny = best.y - b.y, dn = Math.max(1e-6, hypot(dinx, diny));
    this.corners.push({
      p: { x: best.x, y: best.y, pressure: best.pressure, tiltX: best.tiltX, tiltY: best.tiltY, t: p.t },
      dinx: dinx / dn, diny: diny / dn,
    });
  }
}

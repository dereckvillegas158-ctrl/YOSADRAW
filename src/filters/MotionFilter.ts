import { BaseStage } from '../core/BaseStage';
import type { StrokePoint } from '../core/types';
import { catchUp, clamp, copyPoint, hypot, lerp, smoothstep } from '../core/math';

/**
 * MOTION FILTERING — filtrado configurable de movimientos bruscos.
 *
 * No suaviza el trazo en general (eso es tarea de las otras dos etapas):
 * sólo actúa cuando el movimiento es *anómalo* respecto a la dinámica reciente.
 *
 * 1. Supresión de picos con 1 muestra de anticipación (≈ 4 ms a 240 Hz):
 *    una muestra que se aleja de la recta entre su vecina anterior y la
 *    siguiente más de un umbral (proporcional al espaciado) se considera un
 *    pico (golpe, deslizamiento del lápiz, fallo del digitalizador) y se
 *    atrae hacia el punto medio.
 * 2. Compuerta de sacudidas: se predice la posición con la velocidad previa;
 *    si la muestra se desvía mucho de la predicción (aceleración brusca), se
 *    avanza sólo una fracción del salto. Hay un mínimo de avance garantizado,
 *    por lo que un cambio de dirección real siempre se alcanza en pocas muestras.
 * 3. Limitador suave de la tasa de cambio de presión.
 */
export class MotionFilter extends BaseStage {
  readonly name = 'Motion Filtering';

  private prevRaw!: StrokePoint;
  private prevPrevRaw!: StrokePoint;
  private held: StrokePoint | null = null;
  private last!: StrokePoint;
  private finalRaw!: StrokePoint;
  private vx = 0;
  private vy = 0;

  protected onBegin(p: StrokePoint, out: StrokePoint[]): void {
    this.prevRaw = this.prevPrevRaw = p;
    this.finalRaw = p;
    this.held = null;
    this.vx = this.vy = 0;
    this.last = copyPoint(p);
    out.push(this.last);
  }

  protected onPush(p: StrokePoint, out: StrokePoint[]): void {
    this.finalRaw = p;
    if (!this.held) { this.held = p; return; }
    const fixed = this.despike(this.prevRaw, this.held, p);
    this.emit(fixed, out);
    this.prevPrevRaw = this.prevRaw;
    this.prevRaw = fixed;
    this.held = p;
  }

  protected onEnd(out: StrokePoint[]): void {
    let target = this.finalRaw;
    if (this.held) {
      // La última muestra no tiene vecina posterior: se compara con una
      // extrapolación lineal de las dos anteriores.
      const a = this.prevRaw, b = this.prevPrevRaw;
      const virt = copyPoint(a, { x: 2 * a.x - b.x, y: 2 * a.y - b.y, t: this.held.t });
      target = this.despike(a, this.held, virt);
      this.emit(target, out);
    }
    this.held = null;
    catchUp(this.last, [target], out, 2.5, 0.6);
  }

  private despike(a: StrokePoint, h: StrokePoint, c: StrokePoint): StrokePoint {
    const m = this.a;
    const mx = (a.x + c.x) / 2, my = (a.y + c.y) / 2;
    const dev = hypot(h.x - mx, h.y - my);
    const span = hypot(c.x - a.x, c.y - a.y);
    const thr = lerp(28, 2.5, m) + span * lerp(0.9, 0.3, m);
    if (dev <= thr) return h;
    const k = smoothstep(thr, thr * 2, dev) * Math.sqrt(m);
    return copyPoint(h, {
      x: lerp(h.x, mx, k), y: lerp(h.y, my, k),
      pressure: lerp(h.pressure, (a.pressure + c.pressure) / 2, k),
    });
  }

  private emit(q: StrokePoint, out: StrokePoint[]): void {
    const m = this.a, last = this.last;
    const dt = Math.max(1, q.t - last.t);
    const px = last.x + this.vx * dt, py = last.y + this.vy * dt;
    const dev = hypot(q.x - px, q.y - py);
    const scale = lerp(24, 1.2, m) + hypot(this.vx, this.vy) * dt * lerp(1.5, 0.35, m);
    const r = dev / scale;
    const alpha = Math.max(lerp(1, 0.15, m), 1 / (1 + r * r * m * 4));
    const nx = last.x + alpha * (q.x - last.x);
    const ny = last.y + alpha * (q.y - last.y);
    this.vx = lerp(this.vx, (nx - last.x) / dt, 0.6);
    this.vy = lerp(this.vy, (ny - last.y) / dt, 0.6);
    const maxDp = Math.max(0.02, lerp(1, 0.012, m) * dt);
    const pressure = last.pressure + clamp(q.pressure - last.pressure, -maxDp, maxDp);
    this.last = copyPoint(q, { x: nx, y: ny, pressure });
    out.push(this.last);
  }
}

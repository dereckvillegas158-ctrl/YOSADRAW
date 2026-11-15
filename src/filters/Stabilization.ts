import { BaseStage } from '../core/BaseStage';
import type { StrokePoint } from '../core/types';
import { catchUp, copyPoint, lerp } from '../core/math';
import { OneEuro1D, OneEuro2D } from './OneEuro';

/**
 * STABILIZATION — reducción de vibraciones y temblor involuntario.
 *
 * Objetivo: atacar la banda de frecuencia del temblor fisiológico (≈ 6–12 Hz)
 * sin "frenar" el trazo. Usa un filtro 1€ dependiente de la velocidad:
 *   corte(v) = minCutoff + beta · v
 * - Trazo lento (donde el temblor es más visible): corte ≈ 0.5–2 Hz → temblor eliminado.
 * - Trazo rápido: el corte sube y el retraso queda acotado por ≈ 1/(2π·beta) px.
 * Así se conserva la velocidad y la intención del gesto.
 *
 * La presión pasa por un 1€ 1D más ligero para quitar el ruido del sensor
 * sin aplanar los cambios intencionados.
 */
const geo = (a: number, b: number, t: number) => a * Math.pow(b / a, t);

export class Stabilization extends BaseStage {
  readonly name = 'Stabilization';

  /** Rango del corte mínimo (Hz) entre 0% y 100%. */
  cutoffRange: [number, number] = [25, 0.45];
  /** Rango de beta. El retraso máximo a velocidad alta ≈ 1/(2π·beta) px. */
  betaRange: [number, number] = [0.1, 0.014];

  private pos = new OneEuro2D();
  private pres = new OneEuro1D();
  private lastRaw!: StrokePoint;
  private lastOut!: StrokePoint;

  protected onBegin(p: StrokePoint, out: StrokePoint[]): void {
    const a = this.a;
    // Interpolación geométrica: la percepción del suavizado es logarítmica en Hz,
    // así cada 10% del deslizador produce un cambio perceptible similar.
    this.pos.minCutoff = geo(this.cutoffRange[0], this.cutoffRange[1], a);
    this.pos.beta = geo(this.betaRange[0], this.betaRange[1], a);
    this.pos.dCutoff = lerp(6, 1.2, a);
    this.pos.reset(p.x, p.y);
    this.pres.minCutoff = geo(30, 2.5, a);
    this.pres.beta = lerp(10, 1.5, a);
    this.pres.reset(p.pressure);
    this.lastRaw = p;
    this.lastOut = copyPoint(p);
    out.push(this.lastOut);
  }

  protected onPush(p: StrokePoint, out: StrokePoint[]): void {
    let dt = (p.t - this.lastRaw.t) / 1000;
    if (!(dt > 0)) dt = 1 / 240; // eventos fusionados con la misma marca de tiempo
    this.pos.filter(p.x, p.y, dt);
    const pressure = this.pres.filter(p.pressure, dt);
    this.lastRaw = p;
    this.lastOut = copyPoint(p, { x: this.pos.x, y: this.pos.y, pressure });
    out.push(this.lastOut);
  }

  protected onEnd(out: StrokePoint[]): void {
    // El trazo termina donde el usuario levantó el lápiz.
    catchUp(this.lastOut, [copyPoint(this.lastRaw, { pressure: this.lastOut.pressure })], out, 2.5, 0.6);
  }
}

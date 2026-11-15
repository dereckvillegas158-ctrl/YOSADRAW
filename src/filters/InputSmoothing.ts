import { BaseStage } from '../core/BaseStage';
import type { StrokePoint } from '../core/types';
import { copyPoint, lerp } from '../core/math';
import { OneEuro1D } from './OneEuro';

/**
 * PRESSURE & TILT SMOOTHING — suavizado de presión e inclinación.
 *
 * Los digitalizadores entregan presión con ruido de cuantización y la
 * inclinación en grados enteros, con saltos de ±1–3°. Cuando el pincel usa la
 * inclinación para girar o aplanar la punta, ese ruido se ve como temblor en
 * la forma del trazo aunque la posición sea estable.
 *
 * - Presión: filtro 1€ (adaptativo: sigue rápido los cambios intencionados).
 * - Inclinación: se filtra como vector (tan tiltX, tan tiltY) para que el
 *   acimut no salte al cruzar ±180°.
 * No toca la posición: es independiente de las otras tres etapas.
 */
export class InputSmoothing extends BaseStage {
  readonly name = 'Pressure & Tilt Smoothing';
  private pres = new OneEuro1D();
  private tx = new OneEuro1D();
  private ty = new OneEuro1D();
  private lastT = 0;

  protected onBegin(p: StrokePoint, out: StrokePoint[]): void {
    const a = this.a;
    this.pres.minCutoff = 40 * Math.pow(1.2 / 40, a);
    this.pres.beta = lerp(20, 2, a);
    for (const f of [this.tx, this.ty]) { f.minCutoff = 30 * Math.pow(0.8 / 30, a); f.beta = lerp(2, 0.2, a); }
    this.pres.reset(p.pressure);
    this.tx.reset(Math.tan((p.tiltX * Math.PI) / 180));
    this.ty.reset(Math.tan((p.tiltY * Math.PI) / 180));
    this.lastT = p.t;
    out.push(p);
  }

  protected onPush(p: StrokePoint, out: StrokePoint[]): void {
    let dt = (p.t - this.lastT) / 1000;
    if (!(dt > 0)) dt = 1 / 240;
    this.lastT = p.t;
    const pressure = Math.min(1, Math.max(0, this.pres.filter(p.pressure, dt)));
    const tx = this.tx.filter(Math.tan((Math.max(-89, Math.min(89, p.tiltX)) * Math.PI) / 180), dt);
    const ty = this.ty.filter(Math.tan((Math.max(-89, Math.min(89, p.tiltY)) * Math.PI) / 180), dt);
    out.push(copyPoint(p, { pressure, tiltX: (Math.atan(tx) * 180) / Math.PI, tiltY: (Math.atan(ty) * 180) / Math.PI }));
  }

  protected onEnd(): void { /* sin estado pendiente */ }
}

import type { StrokePoint, StrokeStage } from './types';
import { clamp } from './math';

/**
 * Base común: gestiona el bypass y "congela" la intensidad al inicio del trazo,
 * de modo que mover un deslizador a mitad de trazo no produce discontinuidades.
 */
export abstract class BaseStage implements StrokeStage {
  abstract readonly name: string;
  private _amount = 0;
  /** Intensidad congelada para el trazo actual (0..1). */
  protected a = 0;
  private active = false;

  get amount() { return this._amount; }
  set amount(v: number) { this._amount = clamp(v, 0, 1); }

  begin(p: StrokePoint, out: StrokePoint[]): void {
    this.a = this._amount;
    this.active = this.a > 0.0005;
    if (this.active) this.onBegin(p, out); else out.push(p);
  }
  push(p: StrokePoint, out: StrokePoint[]): void {
    if (this.active) this.onPush(p, out); else out.push(p);
  }
  end(out: StrokePoint[]): void {
    if (this.active) this.onEnd(out);
  }

  protected abstract onBegin(p: StrokePoint, out: StrokePoint[]): void;
  protected abstract onPush(p: StrokePoint, out: StrokePoint[]): void;
  protected abstract onEnd(out: StrokePoint[]): void;
}

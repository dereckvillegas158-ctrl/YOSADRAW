import type { StrokePoint, StrokeStage } from './types';

/**
 * Encadena etapas independientes. Cada etapa sólo ve la salida de la anterior;
 * el pipeline gestiona el arranque perezoso (una etapa empieza cuando recibe
 * su primer punto, que puede llegar tarde si la anterior retiene muestras)
 * y la propagación del vaciado al levantar el lápiz.
 */
export class StrokePipeline {
  private started: boolean[];
  /** Tiempo de CPU de la última llamada, en ms. */
  lastCostMs = 0;

  constructor(public readonly stages: StrokeStage[]) {
    this.started = stages.map(() => false);
  }

  beginStroke(p: StrokePoint): StrokePoint[] {
    this.started.fill(false);
    return this.flow([p], false);
  }
  pushPoint(p: StrokePoint): StrokePoint[] {
    return this.flow([p], false);
  }
  endStroke(): StrokePoint[] {
    return this.flow([], true);
  }

  private flow(input: StrokePoint[], ending: boolean): StrokePoint[] {
    const t0 = performance.now();
    let cur = input;
    for (let i = 0; i < this.stages.length; i++) {
      const stage = this.stages[i];
      const out: StrokePoint[] = [];
      for (const q of cur) {
        if (!this.started[i]) { stage.begin(q, out); this.started[i] = true; }
        else stage.push(q, out);
      }
      if (ending && this.started[i]) stage.end(out);
      cur = out;
    }
    this.lastCostMs = performance.now() - t0;
    return cur;
  }
}

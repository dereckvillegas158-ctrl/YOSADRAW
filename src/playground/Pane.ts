import type { StrokePoint } from '../core/types';
import { dist } from '../core/math';
import { createEngine, type EngineSettings, type StrokeEngine } from '../filters';
import { StrokeRenderer, type BrushSettings } from '../render/StrokeRenderer';
import { StrokeMetrics } from './Metrics';

/** Un lienzo de prueba: su propio motor, renderizador y métricas. */
export class Pane {
  readonly engine: StrokeEngine = createEngine();
  readonly metrics = new StrokeMetrics();
  readonly renderer: StrokeRenderer;
  private ink: CanvasRenderingContext2D;
  private raw: CanvasRenderingContext2D;
  private live: CanvasRenderingContext2D;
  private rawStroke: StrokePoint[] = [];
  private canvases: HTMLCanvasElement[];
  width = 0;
  height = 0;

  constructor(readonly id: string, readonly surface: HTMLElement, public settings: EngineSettings, brush: BrushSettings) {
    this.canvases = ['ink', 'raw', 'live'].map(cls => surface.querySelector<HTMLCanvasElement>(`canvas.${cls}`)!);
    const [ink, raw, live] = this.canvases;
    // `desynchronized` permite al navegador presentar la tinta sin esperar
    // a la composición de la página (menor latencia en ChromeOS/Windows/Android).
    this.ink = ink.getContext('2d', { desynchronized: true })!;
    this.raw = raw.getContext('2d')!;
    this.live = live.getContext('2d', { desynchronized: true })!;
    this.renderer = new StrokeRenderer(this.ink, this.live, brush);
    this.engine.apply(settings);
  }

  setSettings(s: EngineSettings) { this.settings = s; this.engine.apply(s); }

  resize() {
    const r = this.surface.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.width = r.width; this.height = r.height;
    for (const c of this.canvases) {
      c.width = Math.max(1, Math.round(r.width * dpr));
      c.height = Math.max(1, Math.round(r.height * dpr));
      c.getContext('2d')!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  clear() {
    for (const ctx of [this.ink, this.raw, this.live]) {
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height); ctx.restore();
    }
    this.metrics.reset();
  }

  begin(p: StrokePoint) {
    this.rawStroke = [p];
    const out = this.engine.pipeline.beginStroke(p);
    this.metrics.addCost(this.engine.pipeline.lastCostMs, 1);
    this.renderer.begin(out);
  }

  push(points: StrokePoint[]) {
    const pipe = this.engine.pipeline;
    let cost = 0;
    const out: StrokePoint[] = [];
    for (const p of points) {
      const o = pipe.pushPoint(p);
      cost += pipe.lastCostMs;
      for (const q of o) out.push(q);
      this.drawRaw(this.rawStroke[this.rawStroke.length - 1], p);
      this.rawStroke.push(p);
    }
    this.metrics.addCost(cost, points.length);
    this.renderer.add(out);
    const tip = this.renderer.tip();
    if (tip) this.metrics.addLag(dist(tip, points[points.length - 1]));
  }

  end() {
    const out = this.engine.pipeline.endStroke();
    this.renderer.end(out);
    this.metrics.addStroke(this.rawStroke, this.renderer.points());
  }

  /** Repinta la capa provisional; llamar una vez por fotograma. */
  frame() {
    const ctx = this.live;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height); ctx.restore();
    this.renderer.drawLive();
  }

  private drawRaw(a: StrokePoint, b: StrokePoint) {
    const ctx = this.raw;
    ctx.strokeStyle = 'rgba(226, 62, 87, 0.75)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
}

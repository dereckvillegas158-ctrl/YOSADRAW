import type { StrokePoint } from '../../core/types';
import { createEngine } from '../../filters';
import { PointerInput } from '../../input/PointerInput';
import type { BrushPreset } from '../brush/BrushPreset';
import { BrushStrokeSession, SessionBuffers } from '../brush/BrushStrokeSession';
import { buildStroke, sampleStroke } from '../brush/buildStroke';
import type { StrokePainter } from '../brush/StrokePainter';
import { ViewTransform } from '../engine/ViewTransform';
import { h } from './dom';

interface PadStroke { points: StrokePoint[]; seed: number }

/**
 * Vista previa en tiempo real del Brush Studio: una hoja donde se puede
 * dibujar con el pincel en edición (estabilizador incluido). Cada cambio de
 * parámetro vuelve a pintar todos los trazos de la hoja al instante.
 */
export class PreviewPad {
  readonly el: HTMLElement;
  private surface: HTMLElement;
  private ink: CanvasRenderingContext2D;
  private live: CanvasRenderingContext2D;
  private buffers = new SessionBuffers();
  private view = new ViewTransform();
  private dpr = 1;
  private strokes: PadStroke[] = [];
  private preset: BrushPreset | null = null;
  private session: BrushStrokeSession | null = null;
  private stab = createEngine();
  private req = 0;
  private sampleOn = true;
  color = '#1b1530';
  onPressure: ((p: number | null) => void) | null = null;

  constructor(private painter: StrokePainter) {
    const inkC = h('canvas'), liveC = h('canvas');
    this.surface = h('div', { class: 'pad-surface', 'aria-label': 'Hoja de pruebas: dibuja aquí con el pincel que estás editando' }, inkC, liveC);
    this.el = h('div', { class: 'pad' }, this.surface);
    this.ink = inkC.getContext('2d')!;
    this.live = liveC.getContext('2d')!;
    new PointerInput([this.surface], {
      begin: (_t, p) => this.begin(p),
      move: pts => this.move(pts),
      end: () => this.end(),
    });
    new ResizeObserver(() => this.resize()).observe(this.surface);
  }

  setPreset(p: BrushPreset) { this.preset = p; this.schedule(); }
  setColor(c: string) { this.color = c; this.schedule(); }
  clear() { this.strokes = []; this.sampleOn = false; this.schedule(); }
  restoreSample() { this.strokes = []; this.sampleOn = true; this.schedule(); }

  private resize() {
    const r = this.surface.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const ctx of [this.ink, this.live]) { ctx.canvas.width = Math.round(r.width * this.dpr); ctx.canvas.height = Math.round(r.height * this.dpr); }
    this.buffers.ensure(this.ink.canvas.width, this.ink.canvas.height);
    this.schedule();
  }

  private schedule() {
    if (this.req || this.session) return;
    this.req = requestAnimationFrame(() => { this.req = 0; this.render(); });
  }

  private sample(): PadStroke | null {
    if (!this.sampleOn) return null;
    const r = this.surface.getBoundingClientRect();
    if (!r.width) return null;
    return { points: sampleStroke(r.width, r.height, Math.min(60, r.height * 0.22)), seed: 5 };
  }

  private render() {
    const p = this.preset;
    const ctx = this.ink;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    if (!p) return;
    const all = [this.sample(), ...this.strokes].filter((s): s is PadStroke => !!s);
    for (const s of all) this.painter.paint(ctx, buildStroke(p, s.points, s.seed, this.color), this.view, this.dpr, this.buffers.tmpCtx);
  }

  private begin(p: StrokePoint) {
    if (!this.preset) return;
    if (this.req) { cancelAnimationFrame(this.req); this.req = 0; this.render(); }
    this.stab.apply(this.preset.stabilizer);
    this.live.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.session = new BrushStrokeSession(this.painter, { target: this.ink, overlay: this.live, view: this.view, dpr: this.dpr, buffers: this.buffers, paperColor: '#ffffff' },
      this.preset, this.color, 'brush', (Math.random() * 2 ** 32) >>> 0);
    const first = this.stab.pipeline.beginStroke(p);
    this.session.begin(first[0]);
    if (first.length > 1) this.session.add(first.slice(1));
    this.onPressure?.(p.pressure);
    this.loop();
  }

  private move(pts: StrokePoint[]) {
    if (!this.session) return;
    const out: StrokePoint[] = [];
    for (const p of pts) out.push(...this.stab.pipeline.pushPoint(p));
    if (out.length) this.session.add(out);
    this.onPressure?.(pts[pts.length - 1].pressure);
  }

  private end() {
    if (!this.session) return;
    const tail = this.stab.pipeline.endStroke();
    if (tail.length) this.session.add(tail);
    const s = this.session.end();
    this.session = null;
    this.strokes.push({ points: [...s.points], seed: s.seed });
    this.live.setTransform(1, 0, 0, 1, 0, 0);
    this.live.clearRect(0, 0, this.live.canvas.width, this.live.canvas.height);
    this.onPressure?.(null);
  }

  private loop() {
    const tick = () => {
      if (!this.session) return;
      this.live.setTransform(1, 0, 0, 1, 0, 0);
      this.live.clearRect(0, 0, this.live.canvas.width, this.live.canvas.height);
      this.live.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.session.frame();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}

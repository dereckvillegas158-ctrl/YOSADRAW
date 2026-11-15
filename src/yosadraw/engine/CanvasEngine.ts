import type { StrokePoint } from '../../core/types';
import { createEngine, type StrokeEngine } from '../../filters';
import { PointerInput } from '../../input/PointerInput';
import type { BrushPreset } from '../brush/BrushPreset';
import { BrushStrokeSession, SessionBuffers } from '../brush/BrushStrokeSession';
import type { StrokePainter } from '../brush/StrokePainter';
import { Emitter } from './Emitter';
import { History, type HistoryOp } from './History';
import { Navigation, type NavMode } from './Navigation';
import { StrokeStore, type DrawTool, type StoredStroke } from './StrokeStore';
import { invert, multiply, ViewTransform, type ViewState } from './ViewTransform';

export type Tool = DrawTool | 'hand' | 'rotate';

export interface CanvasTheme { workspace: string; paper: string; frame: string }
export interface PointerInfo { x: number; y: number; pressure: number; tilt: number; type: string; inside: boolean }
export interface RenderStats { strokes: number; points: number; dabs: number; drawn: number; renderMs: number; progressive: boolean }
export interface HistoryState { canUndo: boolean; canRedo: boolean; undoDepth: number; redoDepth: number }

export type EngineEvents = {
  view: ViewState;
  history: HistoryState;
  stats: RenderStats;
  pointer: PointerInfo | null;
  tool: Tool;
};

export interface CanvasEngineOptions {
  width: number;
  height: number;
  painter: StrokePainter;
  brush: BrushPreset;
  eraser: BrushPreset;
  color: string;
  theme?: Partial<CanvasTheme>;
}

/** Por debajo de este coste el lienzo se repinta nítido en cada fotograma del gesto. */
const LIVE_RENDER_BUDGET_MS = 7;
const SETTLE_MS = 90;
/** Tiempo máximo por fotograma del repintado progresivo. */
const SLICE_MS = 9;

/**
 * YOSADRAW Canvas Engine.
 *
 * Lógica del lienzo separada de la interfaz: la UI sólo usa esta API y sus
 * eventos. Capas: paper (área de trabajo + hoja) → ink (trazos) → live
 * (tramo provisional y cursor).
 *
 * - Los trazos se guardan como datos (puntos + sellos + preset congelado) en
 *   coordenadas de documento y se rasterizan a resolución de pantalla: ampliar
 *   no pixela.
 * - Repintado progresivo: con documentos pesados se pinta por lotes de ~9 ms en
 *   un lienzo oculto mientras se muestra el último resultado transformado por
 *   la GPU; al terminar se intercambia. La interfaz nunca se congela.
 * - Estabilización: el motor existente (createEngine) en píxeles de pantalla,
 *   con los ajustes del pincel activo.
 */
export class CanvasEngine extends Emitter<EngineEvents> {
  readonly docWidth: number;
  readonly docHeight: number;
  readonly view = new ViewTransform();
  readonly stabilizer: StrokeEngine = createEngine();
  readonly store = new StrokeStore();
  readonly history = new History();
  readonly painter: StrokePainter;
  readonly element: HTMLElement;
  theme: CanvasTheme = { workspace: '#08070d', paper: '#ffffff', frame: 'rgba(255,255,255,0.14)' };
  color: string;

  private presets: Record<DrawTool, BrushPreset>;
  private _tool: Tool = 'brush';
  private spacePan = false;
  private paper: CanvasRenderingContext2D;
  private ink: CanvasRenderingContext2D;
  private live: CanvasRenderingContext2D;
  private back = document.createElement('canvas');
  private backCtx = this.back.getContext('2d')!;
  private buffers = new SessionBuffers();
  private canvases: HTMLCanvasElement[];
  private vw = 0;
  private vh = 0;
  private dpr = 1;
  private crisp: ViewTransform | null = null;
  private inkClipped = false;
  private lastRenderMs = 0;
  private settleTimer = 0;
  private frameReq = 0;
  private dirty = { paper: true, ink: true };
  private job: { it: Generator<void, void>; view: ViewTransform } | null = null;
  private sliceBudget = SLICE_MS;
  private session: BrushStrokeSession | null = null;
  private downType = 'mouse';
  /** El trazo actual simula presión a partir de la velocidad (ratón). */
  private simulate = false;
  private sim = { x: 0, y: 0, t: 0, v: 0, p: 1 };
  private hover: { x: number; y: number; pressure: number; tilt: number; type: string } | null = null;
  private nav: Navigation;
  private resizeObs: ResizeObserver;

  constructor(container: HTMLElement, opts: CanvasEngineOptions) {
    super();
    this.docWidth = opts.width;
    this.docHeight = opts.height;
    this.painter = opts.painter;
    this.presets = { brush: opts.brush, eraser: opts.eraser };
    this.color = opts.color;
    Object.assign(this.theme, opts.theme);
    this.element = container;
    Object.assign(container.style, { position: 'relative', overflow: 'hidden', touchAction: 'none', userSelect: 'none' });

    this.canvases = ['paper', 'ink', 'live'].map(name => {
      const c = document.createElement('canvas');
      c.dataset.layer = name;
      Object.assign(c.style, { position: 'absolute', left: '0', top: '0', transformOrigin: '0 0', pointerEvents: 'none' });
      container.appendChild(c);
      return c;
    });
    this.paper = this.canvases[0].getContext('2d', { alpha: false })!;
    this.ink = this.canvases[1].getContext('2d', { desynchronized: true })!;
    this.live = this.canvases[2].getContext('2d', { desynchronized: true })!;

    // Tipo de puntero del trazo (para simular presión con ratón). Va antes que PointerInput.
    container.addEventListener('pointerdown', e => { this.downType = e.pointerType; }, { capture: true });

    this.nav = new Navigation({
      view: this.view,
      element: container,
      viewportSize: () => ({ w: this.vw, h: this.vh }),
      primaryMode: () => this.primaryMode(),
      viewChanged: () => this.viewChanged(),
      cancelStroke: () => this.cancelStroke(),
      undo: () => this.undo(),
      redo: () => this.redo(),
    });

    new PointerInput([container], {
      begin: (_t, p) => this.beginStroke(p),
      move: pts => this.moveStroke(pts),
      end: () => this.endStroke(),
    });

    container.addEventListener('pointermove', this.onHover, { passive: true });
    container.addEventListener('pointerleave', () => { this.hover = null; this.emit('pointer', null); this.requestFrame(); });
    this.painter.tips.images.onReady(() => this.rerender(false));

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.resize();
    this.view.fit(this.vw, this.vh, this.docWidth, this.docHeight);
    this.viewChanged();
    this.applyCursor();
  }

  // =================== API pública ===================

  get tool() { return this._tool; }
  setTool(t: Tool) { this._tool = t; this.applyCursor(); this.emit('tool', t); this.requestFrame(); }

  /** Pincel que usará la herramienta (Pincel o Borrador). */
  brushPreset(tool: DrawTool): BrushPreset { return this.presets[tool]; }
  setBrushPreset(tool: DrawTool, p: BrushPreset) { this.presets[tool] = p; this.requestFrame(); }
  setColor(c: string) { this.color = c; }
  setTheme(t: Partial<CanvasTheme>) { Object.assign(this.theme, t); this.dirty.paper = true; this.requestFrame(); }
  setSpacePan(on: boolean) { if (on === this.spacePan) return; this.spacePan = on; this.applyCursor(); }

  get isDrawing() { return this.session !== null; }
  get historyState(): HistoryState {
    const h = this.history;
    return { canUndo: h.canUndo, canRedo: h.canRedo, undoDepth: h.undoDepth, redoDepth: h.redoDepth };
  }

  undo() {
    if (this.session) return;
    const op = this.history.undo();
    if (!op) return;
    if (op.kind === 'add') this.store.remove(op.stroke.id);
    else this.store.restore(op.strokes);
    this.rerender(true);
    this.emit('history', this.historyState);
  }

  redo() {
    if (this.session) return;
    const op = this.history.redo();
    if (!op) return;
    this.applyOp(op);
    this.emit('history', this.historyState);
  }

  clear() {
    if (this.session || !this.store.count) return;
    const op: HistoryOp = { kind: 'clear', strokes: this.store.strokes.slice() };
    this.history.push(op);
    this.applyOp(op);
    this.emit('history', this.historyState);
  }

  zoomBy(factor: number) { this.nav.animateTo(this.nav.targetView().zoomAt(factor, this.vw / 2, this.vh / 2)); }
  zoomTo(scale: number) { this.nav.animateTo(this.nav.targetView().setScaleAt(scale, this.vw / 2, this.vh / 2)); }
  fit() { this.nav.animateTo(this.nav.targetView().fit(this.vw, this.vh, this.docWidth, this.docHeight)); }
  rotateBy(deg: number) { this.nav.animateTo(this.nav.targetView().rotateAt((deg * Math.PI) / 180, this.vw / 2, this.vh / 2)); }
  setRotation(deg: number) { this.nav.animateTo(this.nav.targetView().setRotationAt((deg * Math.PI) / 180, this.vw / 2, this.vh / 2)); }

  /** Repinta todo de inmediato (síncrono). */
  renderAll() { this.rerender(true, true); }

  destroy() { this.resizeObs.disconnect(); for (const c of this.canvases) c.remove(); }

  // =================== Trazo ===================

  private primaryMode(): NavMode {
    if (this.spacePan || this._tool === 'hand') return 'pan';
    if (this._tool === 'rotate') return 'rotate';
    return 'draw';
  }

  private toDoc(q: StrokePoint, simulate: boolean): StrokePoint {
    const d = this.view.toDoc(q.x, q.y);
    let pressure = q.pressure;
    if (simulate) {
      // Ratón sin sensor: más rápido = más fino.
      const s = this.sim;
      const dt = Math.max(1, q.t - s.t);
      const v = Math.hypot(q.x - s.x, q.y - s.y) / dt;
      s.v = s.t ? s.v + 0.3 * (v - s.v) : 0;
      s.x = q.x; s.y = q.y; s.t = q.t;
      const target = Math.min(1, Math.max(0.12, 1 - s.v / 3));
      s.p += 0.35 * (target - s.p);
      pressure = s.p;
    }
    return { ...q, x: d.x, y: d.y, pressure };
  }

  private beginStroke(p: StrokePoint) {
    if (this.primaryMode() !== 'draw' || this.nav.active) return;
    this.nav.cancelAnimations();
    if (!this.crisp || !this.crisp.equals(this.view) || this.job) this.rerender(true, true);
    const tool = this._tool as DrawTool;
    const preset = this.presets[tool];
    this.stabilizer.apply(preset.stabilizer);
    this.simulate = this.downType === 'mouse' && preset.pressure.simulateMouse;
    this.sim = { x: p.x, y: p.y, t: 0, v: 0, p: 0.6 };
    this.applyInkClip();
    this.live.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.session = new BrushStrokeSession(this.painter, {
      target: this.ink, overlay: this.live, view: this.view, dpr: this.dpr, buffers: this.buffers, paperColor: this.theme.paper,
    }, preset, this.color, tool, (Math.random() * 2 ** 32) >>> 0);
    const first = this.stabilizer.pipeline.beginStroke(p).map(q => this.toDoc(q, this.simulate));
    this.session.begin(first[0] ?? this.toDoc(p, false));
    if (first.length > 1) this.session.add(first.slice(1));
    this.hover = { x: p.x, y: p.y, pressure: p.pressure, tilt: Math.hypot(p.tiltX, p.tiltY), type: this.downType };
    this.requestFrame();
  }

  private moveStroke(points: StrokePoint[]) {
    const s = this.session;
    if (!s) return;
    const simulate = this.simulate;
    const out: StrokePoint[] = [];
    for (const p of points) for (const q of this.stabilizer.pipeline.pushPoint(p)) out.push(q);
    if (out.length) s.add(out.map(q => this.toDoc(q, simulate)));
    const last = points[points.length - 1];
    this.hover = { x: last.x, y: last.y, pressure: simulate ? this.sim.p : last.pressure, tilt: Math.hypot(last.tiltX, last.tiltY), type: this.downType };
    this.emitPointer();
    this.requestFrame();
  }

  private endStroke() {
    const s = this.session;
    if (!s) return;
    const simulate = this.simulate;
    const tail = this.stabilizer.pipeline.endStroke();
    if (tail.length) s.add(tail.map(q => this.toDoc(q, simulate)));
    const finished = s.end();
    this.session = null;
    const stroke = this.store.create(finished);
    this.store.add(stroke);
    this.history.push({ kind: 'add', stroke });
    this.emit('history', this.historyState);
    this.emitStats(this.lastRenderMs, -1, false);
    this.requestFrame();
  }

  /** Descarta el trazo en curso (p. ej. al apoyar un segundo dedo para un gesto). */
  private cancelStroke() {
    if (!this.session) return;
    this.stabilizer.pipeline.endStroke();
    this.session.cancel();
    this.session = null;
    this.requestFrame();
  }

  private applyOp(op: HistoryOp) {
    if (op.kind === 'add') {
      this.store.add(op.stroke);
      if (this.crisp?.equals(this.view) && !this.job) {
        this.applyInkClip();
        this.painter.paint(this.ink, op.stroke, this.view, this.dpr, this.buffers.tmpCtx);
        this.emitStats(this.lastRenderMs, -1, false);
      } else this.rerender(true);
    } else {
      this.store.clear();
      this.rerender(true);
    }
  }

  // =================== Render ===================

  private resize() {
    const r = this.element.getBoundingClientRect();
    this.vw = Math.max(1, r.width);
    this.vh = Math.max(1, r.height);
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    const W = Math.round(this.vw * this.dpr), H = Math.round(this.vh * this.dpr);
    for (const c of [...this.canvases, this.back]) { c.width = W; c.height = H; }
    for (const c of this.canvases) { c.style.width = `${this.vw}px`; c.style.height = `${this.vh}px`; }
    this.buffers.ensure(W, H);
    this.inkClipped = false;
    this.abandonJob();
    this.crisp = null;
    this.dirty.paper = this.dirty.ink = true;
    this.frame();
  }

  private viewChanged() {
    this.dirty.paper = this.dirty.ink = true;
    this.emit('view', { scale: this.view.scale, rotation: this.view.rotation, x: this.view.x, y: this.view.y });
    this.applyCursor();
    this.requestFrame();
  }

  private requestFrame() {
    if (this.frameReq) return;
    this.frameReq = requestAnimationFrame(() => { this.frameReq = 0; this.frame(); });
  }

  /** Activa el recorte a la hoja en la capa de tinta para la vista actual. */
  private applyInkClip() {
    const ctx = this.ink, d = this.dpr, m = this.view.matrix();
    if (this.inkClipped) ctx.restore();
    ctx.save();
    ctx.setTransform(d * m[0], d * m[1], d * m[2], d * m[3], d * m[4], d * m[5]);
    ctx.beginPath();
    ctx.rect(0, 0, this.docWidth, this.docHeight);
    ctx.clip();
    ctx.setTransform(d, 0, 0, d, 0, 0);
    this.inkClipped = true;
  }

  private abandonJob() {
    if (this.job) { this.job.it.return(); this.job = null; }
  }

  /** Repinta. `sync` termina en esta llamada; si no, por lotes en los siguientes fotogramas. */
  private rerender(preferSync: boolean, force = false) {
    this.abandonJob();
    this.job = { it: this.renderSteps(this.view.clone()), view: this.view.clone() };
    const sync = force || (preferSync && this.lastRenderMs < 40);
    if (sync) {
      this.sliceBudget = Infinity;
      while (this.job && !this.job.it.next().done) { /* hasta el final */ }
      this.sliceBudget = SLICE_MS;
    } else this.requestFrame();
  }

  private *renderSteps(view: ViewTransform): Generator<void, void> {
    const ctx = this.backCtx, d = this.dpr, m = view.matrix();
    let work = 0, slice = performance.now(), drawn = 0, sliced = false;
    ctx.save();
    try {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.back.width, this.back.height);
      ctx.setTransform(d * m[0], d * m[1], d * m[2], d * m[3], d * m[4], d * m[5]);
      ctx.beginPath();
      ctx.rect(0, 0, this.docWidth, this.docHeight);
      ctx.clip();
      ctx.setTransform(d, 0, 0, d, 0, 0);
      for (const s of this.store.visible(view.visibleDocBounds(this.vw, this.vh))) {
        if (!this.painter.ready(s.preset)) continue; // se repinta cuando la imagen esté lista
        this.painter.paint(ctx, s, view, d, this.buffers.tmpCtx);
        drawn++;
        const now = performance.now();
        if (now - slice > this.sliceBudget) { work += now - slice; sliced = true; yield; slice = performance.now(); }
      }
    } finally {
      ctx.restore();
    }
    work += performance.now() - slice;
    // Intercambio: la capa visible pasa a mostrar el resultado nuevo.
    const ink = this.ink;
    if (this.inkClipped) { ink.restore(); this.inkClipped = false; }
    ink.setTransform(1, 0, 0, 1, 0, 0);
    ink.globalCompositeOperation = 'copy';
    ink.drawImage(this.back, 0, 0);
    ink.globalCompositeOperation = 'source-over';
    this.applyInkClip();
    this.crisp = view.clone();
    this.canvases[1].style.transform = '';
    this.lastRenderMs = work;
    this.job = null;
    this.emitStats(work, drawn, sliced);
  }

  private frame() {
    if (this.dirty.paper) { this.drawPaper(); this.dirty.paper = false; }
    if (this.dirty.ink) {
      this.dirty.ink = false;
      const current = this.crisp?.equals(this.view);
      if (this.job && !this.job.view.equals(this.view)) this.abandonJob();
      if (!current && !this.job) {
        if (this.crisp) {
          const t = multiply(this.view.matrix(), invert(this.crisp.matrix()));
          this.canvases[1].style.transform = `matrix(${t.join(',')})`;
        }
        if (!this.crisp || this.lastRenderMs <= LIVE_RENDER_BUDGET_MS) this.rerender(true, true);
        else {
          clearTimeout(this.settleTimer);
          this.settleTimer = window.setTimeout(() => { if (!this.session && !this.nav.active) this.rerender(false); else this.dirty.ink = true; }, SETTLE_MS);
        }
      }
    }
    if (this.job) {
      if (this.job.it.next().done === false) this.requestFrame();
    }
    this.drawLive();
  }

  private drawPaper() {
    const ctx = this.paper, d = this.dpr;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.fillStyle = this.theme.workspace;
    ctx.fillRect(0, 0, this.vw, this.vh);
    const m = this.view.matrix();
    ctx.setTransform(d * m[0], d * m[1], d * m[2], d * m[3], d * m[4], d * m[5]);
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = 24 * d;
    ctx.shadowOffsetY = 6 * d;
    ctx.fillStyle = this.theme.paper;
    ctx.fillRect(0, 0, this.docWidth, this.docHeight);
    ctx.restore();
    ctx.strokeStyle = this.theme.frame;
    ctx.lineWidth = 1 / this.view.scale;
    ctx.strokeRect(0, 0, this.docWidth, this.docHeight);
  }

  private drawLive() {
    const ctx = this.live, d = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.setTransform(d, 0, 0, d, 0, 0);
    if (this.session) { this.session.frame(); return; }
    const h = this.hover;
    if (h && h.type !== 'touch' && this.primaryMode() === 'draw' && !this.nav.active) {
      const p = this.presets[this._tool as DrawTool];
      const r = Math.max(1.5, (p.size.size * this.view.scale) / 2);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(h.x, h.y, r + 0.5, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.stroke();
      ctx.beginPath(); ctx.arc(h.x, h.y, r - 0.5 > 0.5 ? r - 0.5 : r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(20,14,40,0.85)'; ctx.stroke();
    }
  }

  // =================== Puntero / cursor ===================

  private onHover = (e: PointerEvent) => {
    if (this.session) return;
    const r = this.element.getBoundingClientRect();
    this.hover = {
      x: e.clientX - r.left, y: e.clientY - r.top, type: e.pointerType,
      pressure: e.pointerType === 'pen' ? e.pressure : e.buttons ? 1 : 0, tilt: Math.hypot(e.tiltX || 0, e.tiltY || 0),
    };
    this.emitPointer();
    this.requestFrame();
  };

  private emitPointer() {
    const h = this.hover;
    if (!h) return;
    const d = this.view.toDoc(h.x, h.y);
    this.emit('pointer', { x: d.x, y: d.y, pressure: h.pressure, tilt: h.tilt, type: h.type, inside: d.x >= 0 && d.y >= 0 && d.x <= this.docWidth && d.y <= this.docHeight });
  }

  private emitStats(renderMs: number, drawn: number, progressive: boolean) {
    this.emit('stats', { strokes: this.store.count, points: this.store.totalPoints, dabs: this.store.totalDabs, drawn: drawn < 0 ? this.store.count : drawn, renderMs, progressive });
  }

  private applyCursor() {
    const mode = this.primaryMode();
    this.element.style.cursor = mode === 'pan' ? (this.nav?.panning ? 'grabbing' : 'grab') : mode === 'rotate' ? 'alias' : 'none';
  }
}

export type { StoredStroke };

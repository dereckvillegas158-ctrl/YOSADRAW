import type { StrokePoint } from '../../core/types';
import { createEngine, type StrokeEngine } from '../../filters';
import { PointerInput } from '../../input/PointerInput';
import type { BrushPreset } from '../brush/BrushPreset';
import { BrushStrokeSession, SessionBuffers } from '../brush/BrushStrokeSession';
import type { StrokePainter } from '../brush/StrokePainter';
import { Document, History, MAX_LAYERS, type Command, type Layer } from '../doc/Document';
import { distanceToRuler, projectOnRuler, symmetryMatrices, type Ruler, type Symmetry } from '../doc/geometry';
import { blendOp, ItemRenderer } from '../doc/ItemRenderer';
import { strokeSelectionOutline } from '../doc/Selection';
import { Emitter } from './Emitter';
import { Navigation, type NavMode } from './Navigation';
import { invert, multiply, ViewTransform, type Mat, type ViewState } from './ViewTransform';

export type EngineMode = 'paint' | 'erase' | 'pan' | 'rotate' | 'custom';

export interface CanvasTheme { workspace: string; paper: string; frame: string }
export interface PointerInfo { x: number; y: number; pressure: number; tilt: number; type: string; inside: boolean }
export interface RenderStats { layers: number; items: number; dabs: number; renderMs: number; progressive: boolean }
export interface HistoryState { canUndo: boolean; canRedo: boolean; undoDepth: number; redoDepth: number; undoLabel?: string; redoLabel?: string }

/** Evento de puntero para herramientas no de pincel (coordenadas de documento y de pantalla). */
export interface ToolEvent { x: number; y: number; sx: number; sy: number; pressure: number; shift: boolean; alt: boolean; ctrl: boolean; type: string }

/** Herramienta que actúa sobre el lienzo con sus propios gestos (selección, formas, bote…). */
export interface ToolHandler {
  cursor?: string;
  down?(e: ToolEvent): void;
  move?(e: ToolEvent): void;
  up?(e: ToolEvent): void;
  hover?(e: ToolEvent): void;
  cancel?(): void;
  /** Dibuja guías propias en la capa de interfaz (contexto en px CSS). */
  overlay?(ctx: CanvasRenderingContext2D): void;
}

export type EngineEvents = {
  view: ViewState;
  history: HistoryState;
  stats: RenderStats;
  pointer: PointerInfo | null;
  mode: EngineMode;
  /** Cambió el documento: capas, propiedades, capa activa o selección. */
  doc: { structure: boolean; selection: boolean };
  /** Color tomado con Alt + clic. */
  picked: string;
  notice: string;
};

export interface CanvasEngineOptions {
  width: number;
  height: number;
  painter: StrokePainter;
  brush: BrushPreset;
  color: string;
  theme?: Partial<CanvasTheme>;
}

interface LayerView { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; crisp: ViewTransform | null; dirty: boolean; clipped: boolean; ms: number }

const LIVE_RENDER_BUDGET_MS = 7;
const SETTLE_MS = 90;
const SLICE_MS = 9;

/**
 * YOSADRAW Canvas Engine.
 *
 * - Documento con capas; cada capa tiene su propio lienzo en el DOM con su
 *   opacidad y modo de fusión, así el navegador las compone exactamente.
 * - Los elementos (trazos, formas, degradados) se guardan como datos y se
 *   rasterizan a la resolución de la pantalla: ampliar no pixela.
 * - Repintado progresivo por capa y por lotes de ~9 ms.
 * - Pincel y borrador usan el motor de pinceles y el estabilizador; el resto
 *   de herramientas recibe los gestos a través de un `ToolHandler`.
 * - Todo cambio del documento es un comando del historial.
 */
export class CanvasEngine extends Emitter<EngineEvents> {
  readonly doc: Document;
  readonly history = new History();
  readonly view = new ViewTransform();
  readonly stabilizer: StrokeEngine = createEngine();
  readonly painter: StrokePainter;
  readonly items: ItemRenderer;
  readonly element: HTMLElement;
  theme: CanvasTheme = { workspace: '#08070d', paper: '#ffffff', frame: 'rgba(255,255,255,0.14)' };
  color: string;
  ruler: Ruler = { enabled: false, x0: 0, y0: 0, x1: 0, y1: 0 };
  symmetry: Symmetry = { enabled: false, mode: 'vertical', cx: 0, cy: 0, count: 6 };
  /** Distancia (px de pantalla) a la que un trazo se engancha a la regla. */
  rulerSnap = 60;

  private preset: BrushPreset;
  private _mode: EngineMode = 'paint';
  private handler: ToolHandler | null = null;
  private spacePan = false;
  private stack: HTMLElement;
  private paper: CanvasRenderingContext2D;
  private live: CanvasRenderingContext2D;
  private liveCanvas: HTMLCanvasElement;
  private layerViews = new Map<string, LayerView>();
  private back = document.createElement('canvas');
  private backCtx = this.back.getContext('2d')!;
  private selShade = document.createElement('canvas');
  private selShadeKey = '';
  private buffers = new SessionBuffers();
  private vw = 0;
  private vh = 0;
  private dpr = 1;
  private paperDirty = true;
  private viewDirty = true;
  private settleTimer = 0;
  private frameReq = 0;
  private job: { it: Generator<void, void>; view: ViewTransform } | null = null;
  private sliceBudget = SLICE_MS;
  private session: BrushStrokeSession | null = null;
  private rulerLocked = false;
  private downType = 'mouse';
  private downAlt = false;
  private simulate = false;
  private sim = { x: 0, y: 0, t: 0, v: 0, p: 1 };
  private toolPointer: number | null = null;
  private hover: { x: number; y: number; pressure: number; tilt: number; type: string } | null = null;
  private nav: Navigation;
  private resizeObs: ResizeObserver;

  constructor(container: HTMLElement, opts: CanvasEngineOptions) {
    super();
    this.doc = new Document(opts.width, opts.height);
    this.painter = opts.painter;
    this.items = new ItemRenderer(opts.painter, opts.width, opts.height);
    this.preset = opts.brush;
    this.color = opts.color;
    this.symmetry.cx = opts.width / 2;
    this.symmetry.cy = opts.height / 2;
    this.ruler = { enabled: false, x0: opts.width * 0.25, y0: opts.height / 2, x1: opts.width * 0.75, y1: opts.height / 2 };
    Object.assign(this.theme, opts.theme);
    this.element = container;
    Object.assign(container.style, { position: 'relative', overflow: 'hidden', touchAction: 'none', userSelect: 'none' });

    this.stack = document.createElement('div');
    Object.assign(this.stack.style, { position: 'absolute', inset: '0', transformOrigin: '0 0', pointerEvents: 'none', isolation: 'isolate' });
    const paperCanvas = this.makeCanvas('paper');
    this.stack.append(paperCanvas);
    this.liveCanvas = this.makeCanvas('live');
    container.append(this.stack, this.liveCanvas);
    this.paper = paperCanvas.getContext('2d', { alpha: false })!;
    this.live = this.liveCanvas.getContext('2d', { desynchronized: true })!;

    container.addEventListener('pointerdown', e => { this.downType = e.pointerType; this.downAlt = e.altKey; }, { capture: true });

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

    container.addEventListener('pointerdown', this.onToolDown);
    container.addEventListener('pointermove', this.onPointerMove, { passive: true });
    container.addEventListener('pointerup', this.onToolUp);
    container.addEventListener('pointercancel', this.onToolUp);
    container.addEventListener('pointerleave', () => { this.hover = null; this.emit('pointer', null); this.requestFrame(); });
    this.painter.tips.images.onReady(() => this.invalidateAll(false));

    this.syncLayers();
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.resize();
    this.view.fit(this.vw, this.vh, this.doc.width, this.doc.height);
    this.viewChanged();
    this.applyCursor();
  }

  get docWidth() { return this.doc.width; }
  get docHeight() { return this.doc.height; }
  get dprValue() { return this.dpr; }

  private makeCanvas(name: string) {
    const c = document.createElement('canvas');
    c.dataset.layer = name;
    Object.assign(c.style, { position: 'absolute', left: '0', top: '0', transformOrigin: '0 0', pointerEvents: 'none' });
    return c;
  }

  // =================== Modo y herramienta ===================

  get mode() { return this._mode; }
  /** Pincel / borrador / mano / rotar, o herramienta propia (`handler`). */
  setMode(mode: EngineMode, handler: ToolHandler | null = null) {
    if (this.toolPointer !== null) { this.handler?.cancel?.(); this.toolPointer = null; }
    this._mode = mode;
    this.handler = mode === 'custom' ? handler : null;
    this.applyCursor();
    this.emit('mode', mode);
    this.requestFrame();
  }
  get brushPreset() { return this.preset; }
  setBrushPreset(p: BrushPreset) { this.preset = p; this.requestFrame(); }
  setColor(c: string) { this.color = c; }
  setTheme(t: Partial<CanvasTheme>) { Object.assign(this.theme, t); this.paperDirty = true; this.requestFrame(); }
  setSpacePan(on: boolean) { if (on === this.spacePan) return; this.spacePan = on; this.applyCursor(); }
  /** Repinta la capa de interfaz (guías de herramientas). */
  requestOverlay() { this.requestFrame(); }

  get isDrawing() { return this.session !== null || this.toolPointer !== null; }
  get historyState(): HistoryState {
    const h = this.history;
    return { canUndo: h.canUndo, canRedo: h.canRedo, undoDepth: h.undoDepth, redoDepth: h.redoDepth, undoLabel: h.nextUndo, redoLabel: h.nextRedo };
  }

  // =================== Documento ===================

  /** Ejecuta un comando y lo añade al historial. `rendered` = la capa ya muestra el resultado. */
  exec(cmd: Command | null, rendered = false): boolean {
    if (!cmd || this.session) return false;
    this.history.exec(cmd);
    this.afterChange(cmd, rendered);
    return true;
  }

  undo() {
    if (this.isDrawing) return;
    const c = this.history.undo();
    if (c) this.afterChange(c, false);
  }

  redo() {
    if (this.isDrawing) return;
    const c = this.history.redo();
    if (c) this.afterChange(c, false);
  }

  private afterChange(cmd: Command, rendered: boolean) {
    if (cmd.structure) this.syncLayers();
    if (!rendered) for (const id of cmd.layers) { const v = this.layerViews.get(id); if (v) v.dirty = true; }
    if (!rendered && cmd.layers.length) this.rerender(true);
    this.emit('history', this.historyState);
    this.emit('doc', { structure: !!cmd.structure, selection: !!cmd.selection });
    this.emitStats(this.lastMs(), false);
    this.requestFrame();
  }

  setActiveLayer(id: string) {
    if (!this.doc.layer(id) || this.session) return;
    this.doc.activeId = id;
    this.emit('doc', { structure: true, selection: false });
  }

  addLayer(): boolean {
    if (this.doc.layers.length >= MAX_LAYERS) { this.emit('notice', `Máximo ${MAX_LAYERS} capas`); return false; }
    return this.exec(this.doc.cmdAddLayer(this.doc.activeId));
  }

  /** Vista previa de propiedades (sin historial) mientras se arrastra un control. */
  previewLayerProps(id: string, patch: Partial<Pick<Layer, 'opacity' | 'blend' | 'visible'>>) {
    const l = this.doc.layer(id);
    if (!l) return;
    Object.assign(l, patch);
    this.applyLayerStyle(l);
  }
  /** Confirma propiedades; `from` son los valores previos si hubo vista previa. */
  setLayerProps(id: string, patch: Partial<Pick<Layer, 'name' | 'visible' | 'locked' | 'opacity' | 'blend'>>, from?: Partial<Layer>) {
    const l = this.doc.layer(id);
    if (!l) return;
    if (from) Object.assign(l, from);
    this.exec(this.doc.cmdLayerProps(id, patch));
  }

  // =================== Vista ===================

  zoomBy(factor: number) { this.nav.animateTo(this.nav.targetView().zoomAt(factor, this.vw / 2, this.vh / 2)); }
  zoomTo(scale: number) { this.nav.animateTo(this.nav.targetView().setScaleAt(scale, this.vw / 2, this.vh / 2)); }
  fit() { this.nav.animateTo(this.nav.targetView().fit(this.vw, this.vh, this.doc.width, this.doc.height)); }
  rotateBy(deg: number) { this.nav.animateTo(this.nav.targetView().rotateAt((deg * Math.PI) / 180, this.vw / 2, this.vh / 2)); }
  setRotation(deg: number) { this.nav.animateTo(this.nav.targetView().setRotationAt((deg * Math.PI) / 180, this.vw / 2, this.vh / 2)); }
  /** Documento → px CSS de la vista actual. */
  get V(): Mat { return this.view.matrix(); }

  destroy() { this.resizeObs.disconnect(); this.stack.remove(); this.liveCanvas.remove(); }

  // =================== Trazo con pincel ===================

  private primaryMode(): NavMode {
    if (this.spacePan || this._mode === 'pan') return 'pan';
    if (this._mode === 'rotate') return 'rotate';
    return 'draw';
  }

  /** La capa activa se puede editar; si no, avisa y devuelve null. */
  editableLayer(): Layer | null {
    const l = this.doc.active;
    if (!l.visible) { this.emit('notice', 'La capa activa está oculta'); return null; }
    if (l.locked) { this.emit('notice', 'La capa activa está bloqueada'); return null; }
    return l;
  }

  private toDoc(q: StrokePoint): StrokePoint {
    let d = this.view.toDoc(q.x, q.y);
    if (this.rulerLocked) d = projectOnRuler(this.ruler, d);
    let pressure = q.pressure;
    if (this.simulate) {
      const s = this.sim;
      const dt = Math.max(1, q.t - s.t);
      const v = Math.hypot(q.x - s.x, q.y - s.y) / dt;
      s.v = s.t ? s.v + 0.3 * (v - s.v) : 0;
      s.x = q.x; s.y = q.y; s.t = q.t;
      s.p += 0.35 * (Math.min(1, Math.max(0.12, 1 - s.v / 3)) - s.p);
      pressure = s.p;
    }
    return { ...q, x: d.x, y: d.y, pressure };
  }

  private beginStroke(p: StrokePoint) {
    if ((this._mode !== 'paint' && this._mode !== 'erase') || this.primaryMode() !== 'draw' || this.nav.active) return;
    if (this.downAlt) { this.pickColor(p.x, p.y); return; }
    const layer = this.editableLayer();
    if (!layer) return;
    this.nav.cancelAnimations();
    this.finishRendering();
    const view = this.layerViews.get(layer.id)!;
    const tool = this._mode === 'erase' ? 'eraser' : 'brush';
    const preset = this.preset;
    this.stabilizer.apply(preset.stabilizer);
    this.simulate = this.downType === 'mouse' && preset.pressure.simulateMouse;
    this.sim = { x: p.x, y: p.y, t: 0, v: 0, p: 0.6 };
    const start = this.view.toDoc(p.x, p.y);
    this.rulerLocked = this.ruler.enabled && distanceToRuler(this.ruler, start) * this.view.scale <= this.rulerSnap;
    this.applyClip(view);
    this.live.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const sel = this.doc.selection;
    this.session = new BrushStrokeSession(this.painter, {
      target: view.ctx, overlay: this.live, M: this.V, dpr: this.dpr, buffers: this.buffers, paperColor: this.theme.paper,
      clip: sel ? this.items.selectionMask(sel, this.V, this.dpr, view.canvas.width, view.canvas.height) : null,
      mirrors: symmetryMatrices(this.symmetry),
    }, preset, this.color, tool, (Math.random() * 2 ** 32) >>> 0);
    const first = this.stabilizer.pipeline.beginStroke(p).map(q => this.toDoc(q));
    this.session.begin(first[0] ?? this.toDoc(p));
    if (first.length > 1) this.session.add(first.slice(1));
    this.hover = { x: p.x, y: p.y, pressure: p.pressure, tilt: Math.hypot(p.tiltX, p.tiltY), type: this.downType };
    this.requestFrame();
  }

  private moveStroke(points: StrokePoint[]) {
    const s = this.session;
    if (!s) return;
    const out: StrokePoint[] = [];
    for (const p of points) for (const q of this.stabilizer.pipeline.pushPoint(p)) out.push(q);
    if (out.length) s.add(out.map(q => this.toDoc(q)));
    const last = points[points.length - 1];
    this.hover = { x: last.x, y: last.y, pressure: this.simulate ? this.sim.p : last.pressure, tilt: Math.hypot(last.tiltX, last.tiltY), type: this.downType };
    this.emitPointer();
    this.requestFrame();
  }

  private endStroke() {
    const s = this.session;
    if (!s) return;
    const tail = this.stabilizer.pipeline.endStroke();
    if (tail.length) s.add(tail.map(q => this.toDoc(q)));
    const finished = s.end();
    this.session = null;
    this.rulerLocked = false;
    const layer = this.doc.active;
    const item = this.doc.item({ kind: 'stroke', stroke: finished }, { clip: this.doc.selection });
    this.exec(this.doc.cmdAddItems(layer.id, [item], s.tool === 'eraser' ? 'Borrar' : 'Trazo'), true);
  }

  /** Descarta el trazo o gesto en curso (p. ej. al apoyar un segundo dedo). */
  private cancelStroke() {
    if (this.toolPointer !== null) { this.handler?.cancel?.(); this.toolPointer = null; }
    if (!this.session) return;
    this.stabilizer.pipeline.endStroke();
    this.session.cancel();
    this.session = null;
    this.rulerLocked = false;
    this.requestFrame();
  }

  // =================== Herramientas propias ===================

  private toolEvent(e: PointerEvent): ToolEvent {
    const r = this.element.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const d = this.view.toDoc(sx, sy);
    return { x: d.x, y: d.y, sx, sy, pressure: e.pointerType === 'pen' ? e.pressure : 1, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey, type: e.pointerType };
  }

  private onToolDown = (e: PointerEvent) => {
    if (this._mode !== 'custom' || !this.handler || this.primaryMode() !== 'draw' || this.nav.active || this.toolPointer !== null) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.pointerType === 'touch' && this.nav.penUsed) return;
    this.finishRendering();
    this.toolPointer = e.pointerId;
    try { this.element.setPointerCapture(e.pointerId); } catch { /* sin captura */ }
    this.handler.down?.(this.toolEvent(e));
    this.requestFrame();
  };

  private onPointerMove = (e: PointerEvent) => {
    const ev = this.toolEvent(e);
    if (this.toolPointer === e.pointerId) this.handler?.move?.(ev);
    else if (!this.session) {
      this.handler?.hover?.(ev);
      this.hover = { x: ev.sx, y: ev.sy, type: e.pointerType, pressure: e.pointerType === 'pen' ? e.pressure : e.buttons ? 1 : 0, tilt: Math.hypot(e.tiltX || 0, e.tiltY || 0) };
      this.emitPointer();
    }
    this.requestFrame();
  };

  private onToolUp = (e: PointerEvent) => {
    if (this.toolPointer !== e.pointerId) return;
    this.toolPointer = null;
    if (e.type === 'pointercancel') this.handler?.cancel?.(); else this.handler?.up?.(this.toolEvent(e));
    this.requestFrame();
  };

  // =================== Muestreo y rasterizado ===================

  /** Color en un punto de pantalla: 'all' = composición visible sobre el papel; 'layer' = capa activa. */
  sampleColor(sx: number, sy: number, mode: 'all' | 'layer' = 'all', size = 1): [number, number, number, number] {
    this.finishRendering();
    const n = Math.max(1, size | 0), half = (n - 1) / 2;
    const c = document.createElement('canvas');
    c.width = c.height = n;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    const X = Math.round(sx * this.dpr - half), Y = Math.round(sy * this.dpr - half);
    const layers = mode === 'all' ? this.doc.layers.filter(l => l.visible) : [this.doc.active];
    if (mode === 'all') { g.fillStyle = this.theme.paper; g.fillRect(0, 0, n, n); }
    for (const l of layers) {
      const v = this.layerViews.get(l.id);
      if (!v) continue;
      g.globalAlpha = mode === 'all' ? l.opacity : 1;
      g.globalCompositeOperation = mode === 'all' ? blendOp(l.blend) : 'source-over';
      g.drawImage(v.canvas, X, Y, n, n, 0, 0, n, n);
    }
    const d = g.getImageData(0, 0, n, n).data;
    let r = 0, gg = 0, b = 0, a = 0;
    for (let i = 0; i < d.length; i += 4) { const al = d[i + 3] / 255; r += d[i] * al; gg += d[i + 1] * al; b += d[i + 2] * al; a += al; }
    if (a <= 0) return [0, 0, 0, 0];
    return [Math.round(r / a), Math.round(gg / a), Math.round(b / a), a / (n * n)];
  }

  /** Alt + clic con pincel: toma el color visible. */
  pickColor(sx: number, sy: number) {
    const [r, g, b, a] = this.sampleColor(sx, sy, 'all', 3);
    if (a <= 0) return;
    const hex = `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`;
    this.emit('picked', hex);
  }

  /**
   * Dibuja capas a resolución de documento (× scale) en un lienzo nuevo, para
   * operaciones de píxeles (bote, varita, levantar selección).
   */
  rasterize(layers: Layer[], scale = 1, opts: { clip?: boolean } = {}): HTMLCanvasElement {
    const W = Math.round(this.doc.width * scale), H = Math.round(this.doc.height * scale);
    const out = document.createElement('canvas');
    out.width = W; out.height = H;
    const ctx = out.getContext('2d', { willReadFrequently: true })!;
    const renderer = new ItemRenderer(this.painter, this.doc.width, this.doc.height);
    const V: Mat = [scale, 0, 0, scale, 0, 0];
    const tmp = document.createElement('canvas');
    tmp.width = W; tmp.height = H;
    const t = tmp.getContext('2d')!;
    for (const l of layers) {
      t.setTransform(1, 0, 0, 1, 0, 0);
      t.clearRect(0, 0, W, H);
      renderer.renderItems(t, l.items, V, 1);
      ctx.globalAlpha = layers.length > 1 ? l.opacity : 1;
      ctx.globalCompositeOperation = layers.length > 1 ? blendOp(l.blend) : 'source-over';
      ctx.drawImage(tmp, 0, 0);
    }
    void opts;
    return out;
  }

  /** Vista previa de una transformación de capa (GPU, sin repintar). null = quitar. */
  previewLayerTransform(id: string, T: Mat | null) {
    const v = this.layerViews.get(id);
    if (!v || !v.crisp) return;
    const base = T ? multiply(this.V, multiply(T, invert(v.crisp.matrix()))) : multiply(this.V, invert(v.crisp.matrix()));
    v.canvas.style.transform = T || !v.crisp.equals(this.view) ? `matrix(${base.join(',')})` : '';
  }

  // =================== Render ===================

  private syncLayers() {
    const ids = new Set(this.doc.layers.map(l => l.id));
    for (const [id, v] of this.layerViews) if (!ids.has(id)) { v.canvas.remove(); this.layerViews.delete(id); }
    let prev: Element = this.stack.firstElementChild!; // papel
    for (const l of this.doc.layers) {
      let v = this.layerViews.get(l.id);
      if (!v) {
        const canvas = this.makeCanvas('layer');
        const ctx = canvas.getContext('2d', { desynchronized: true })!;
        v = { canvas, ctx, crisp: null, dirty: true, clipped: false, ms: 0 };
        this.layerViews.set(l.id, v);
        this.sizeLayer(v);
      }
      if (prev.nextElementSibling !== v.canvas) prev.after(v.canvas);
      prev = v.canvas;
      this.applyLayerStyle(l);
    }
  }

  private applyLayerStyle(l: Layer) {
    const v = this.layerViews.get(l.id);
    if (!v) return;
    v.canvas.style.opacity = String(l.opacity);
    v.canvas.style.mixBlendMode = l.blend;
    v.canvas.style.visibility = l.visible ? 'visible' : 'hidden';
  }

  private sizeLayer(v: LayerView) {
    const W = Math.round(this.vw * this.dpr), H = Math.round(this.vh * this.dpr);
    v.canvas.width = W; v.canvas.height = H;
    v.canvas.style.width = `${this.vw}px`; v.canvas.style.height = `${this.vh}px`;
    v.clipped = false; v.crisp = null; v.dirty = true;
  }

  private resize() {
    const r = this.element.getBoundingClientRect();
    this.vw = Math.max(1, r.width);
    this.vh = Math.max(1, r.height);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.round(this.vw * this.dpr), H = Math.round(this.vh * this.dpr);
    for (const c of [this.paper.canvas, this.liveCanvas, this.back]) { c.width = W; c.height = H; }
    for (const c of [this.paper.canvas, this.liveCanvas]) { c.style.width = `${this.vw}px`; c.style.height = `${this.vh}px`; }
    for (const v of this.layerViews.values()) this.sizeLayer(v);
    this.buffers.ensure(W, H);
    this.abandonJob();
    this.paperDirty = true;
    this.viewDirty = true;
    this.selShadeKey = '';
    this.frame();
  }

  private viewChanged() {
    this.paperDirty = true;
    this.viewDirty = true;
    this.emit('view', { scale: this.view.scale, rotation: this.view.rotation, x: this.view.x, y: this.view.y });
    this.applyCursor();
    this.requestFrame();
  }

  private requestFrame() {
    if (this.frameReq) return;
    this.frameReq = requestAnimationFrame(() => { this.frameReq = 0; this.frame(); });
  }

  /** Recorte a la hoja en un lienzo de capa para la vista actual. */
  private applyClip(v: LayerView) {
    const ctx = v.ctx, d = this.dpr, m = this.V;
    if (v.clipped) ctx.restore();
    ctx.save();
    ctx.setTransform(d * m[0], d * m[1], d * m[2], d * m[3], d * m[4], d * m[5]);
    ctx.beginPath();
    ctx.rect(0, 0, this.doc.width, this.doc.height);
    ctx.clip();
    ctx.setTransform(d, 0, 0, d, 0, 0);
    v.clipped = true;
  }

  private abandonJob() { if (this.job) { this.job.it.return(); this.job = null; } }
  private lastMs() { let t = 0; for (const v of this.layerViews.values()) t += v.ms; return t; }
  private stale(): Layer[] {
    return this.doc.layers.filter(l => { const v = this.layerViews.get(l.id); return v && (v.dirty || !v.crisp || !v.crisp.equals(this.view)); });
  }

  /** Termina en el acto cualquier repintado pendiente (antes de dibujar o muestrear). */
  finishRendering() { if (this.stale().length || this.job) this.rerender(true, true); }

  /** Repinta todas las capas ya (síncrono). */
  renderAll() { for (const v of this.layerViews.values()) v.dirty = true; this.rerender(true, true); }

  private invalidateAll(sync: boolean) { for (const v of this.layerViews.values()) v.dirty = true; this.rerender(sync); }

  private rerender(preferSync: boolean, force = false) {
    this.abandonJob();
    const layers = this.stale();
    if (!layers.length) return;
    this.job = { it: this.renderSteps(layers, this.view.clone()), view: this.view.clone() };
    const cost = layers.reduce((t, l) => t + (this.layerViews.get(l.id)?.ms ?? 0), 0);
    if (force || (preferSync && cost < 40)) {
      this.sliceBudget = Infinity;
      while (this.job && !this.job.it.next().done) { /* hasta el final */ }
      this.sliceBudget = SLICE_MS;
    } else this.requestFrame();
  }

  private *renderSteps(layers: Layer[], view: ViewTransform): Generator<void, void> {
    const ctx = this.backCtx, d = this.dpr, m = view.matrix();
    const bounds = view.visibleDocBounds(this.vw, this.vh);
    let sliced = false, total = 0;
    for (const layer of layers) {
      const v = this.layerViews.get(layer.id);
      if (!v) continue;
      let work = 0, slice = performance.now();
      ctx.save();
      try {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, this.back.width, this.back.height);
        ctx.setTransform(d * m[0], d * m[1], d * m[2], d * m[3], d * m[4], d * m[5]);
        ctx.beginPath();
        ctx.rect(0, 0, this.doc.width, this.doc.height);
        ctx.clip();
        ctx.setTransform(d, 0, 0, d, 0, 0);
        for (const it of layer.items) {
          if (it.bounds.maxX < bounds.minX || it.bounds.minX > bounds.maxX || it.bounds.maxY < bounds.minY || it.bounds.minY > bounds.maxY) continue;
          this.items.renderItem(ctx, it, m, d);
          const now = performance.now();
          if (now - slice > this.sliceBudget) { work += now - slice; sliced = true; yield; slice = performance.now(); }
        }
      } finally { ctx.restore(); }
      work += performance.now() - slice;
      // Intercambio: el lienzo de la capa pasa a mostrar el resultado nuevo.
      if (v.clipped) { v.ctx.restore(); v.clipped = false; }
      v.ctx.setTransform(1, 0, 0, 1, 0, 0);
      v.ctx.globalCompositeOperation = 'copy';
      v.ctx.drawImage(this.back, 0, 0);
      v.ctx.globalCompositeOperation = 'source-over';
      this.applyClip(v);
      v.crisp = view.clone();
      v.dirty = false;
      v.ms = work;
      v.canvas.style.transform = '';
      total += work;
    }
    this.job = null;
    this.emitStats(total, sliced);
  }

  private frame() {
    if (this.paperDirty) { this.drawPaper(); this.paperDirty = false; }
    if (this.viewDirty) {
      this.viewDirty = false;
      if (this.job && !this.job.view.equals(this.view)) this.abandonJob();
      for (const v of this.layerViews.values()) {
        if (v.crisp && !v.crisp.equals(this.view)) v.canvas.style.transform = `matrix(${multiply(this.V, invert(v.crisp.matrix())).join(',')})`;
      }
      if (!this.job && this.stale().length) {
        if (this.lastMs() <= LIVE_RENDER_BUDGET_MS) this.rerender(true, true);
        else {
          clearTimeout(this.settleTimer);
          this.settleTimer = window.setTimeout(() => { if (!this.isDrawing && !this.nav.active) this.rerender(false); else { this.viewDirty = true; this.requestFrame(); } }, SETTLE_MS);
        }
      }
    }
    if (this.job && this.job.it.next().done === false) this.requestFrame();
    this.drawLive();
  }

  private drawPaper() {
    const ctx = this.paper, d = this.dpr, m = this.V;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.fillStyle = this.theme.workspace;
    ctx.fillRect(0, 0, this.vw, this.vh);
    ctx.setTransform(d * m[0], d * m[1], d * m[2], d * m[3], d * m[4], d * m[5]);
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = 24 * d;
    ctx.shadowOffsetY = 6 * d;
    ctx.fillStyle = this.theme.paper;
    ctx.fillRect(0, 0, this.doc.width, this.doc.height);
    ctx.restore();
    ctx.strokeStyle = this.theme.frame;
    ctx.lineWidth = 1 / this.view.scale;
    ctx.strokeRect(0, 0, this.doc.width, this.doc.height);
  }

  private drawSelection(ctx: CanvasRenderingContext2D) {
    const sel = this.doc.selection;
    if (!sel) return;
    const W = this.liveCanvas.width, H = this.liveCanvas.height;
    const key = `${this.V.join(',')}|${W}x${H}`;
    if (this.selShadeKey !== key || (this.selShade as unknown as { sel?: unknown }).sel !== sel) {
      // Sombreado fuera de la selección.
      this.selShade.width = W; this.selShade.height = H;
      const g = this.selShade.getContext('2d')!;
      g.fillStyle = 'rgba(16, 8, 40, 0.42)';
      g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = 'destination-out';
      g.drawImage(this.items.selectionMask(sel, this.V, this.dpr, W, H), 0, 0);
      this.selShadeKey = key;
      (this.selShade as unknown as { sel?: unknown }).sel = sel;
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.selShade, 0, 0);
    ctx.restore();
    ctx.save();
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    strokeSelectionOutline(ctx, sel, this.V);
    ctx.lineDashOffset = 5;
    ctx.strokeStyle = 'rgba(20,12,40,0.9)';
    strokeSelectionOutline(ctx, sel, this.V);
    ctx.restore();
  }

  private drawAssists(ctx: CanvasRenderingContext2D) {
    const m = this.V;
    if (this.ruler.enabled) {
      const a = this.view.toScreen(this.ruler.x0, this.ruler.y0), b = this.view.toScreen(this.ruler.x1, this.ruler.y1);
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
      const ex = (dx / len) * 4000, ey = (dy / len) * 4000;
      ctx.save();
      ctx.lineWidth = 1;
      ctx.strokeStyle = this.rulerLocked ? 'rgba(157,107,255,0.95)' : 'rgba(157,107,255,0.6)';
      ctx.setLineDash([10, 6]);
      ctx.beginPath(); ctx.moveTo(a.x - ex, a.y - ey); ctx.lineTo(b.x + ex, b.y + ey); ctx.stroke();
      ctx.setLineDash([]);
      for (const p of [a, b]) { ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2); ctx.fillStyle = '#9d6bff'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.stroke(); }
      ctx.restore();
    }
    if (this.symmetry.enabled) {
      const s = this.symmetry;
      const c = this.view.toScreen(s.cx, s.cy);
      ctx.save();
      ctx.strokeStyle = 'rgba(95, 211, 165, 0.75)';
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 5]);
      const axes: number[] = s.mode === 'vertical' ? [Math.PI / 2] : s.mode === 'horizontal' ? [0] : s.mode === 'quadrant' ? [0, Math.PI / 2]
        : Array.from({ length: Math.max(2, Math.round(s.count)) }, (_, i) => Math.PI / 2 + (i * Math.PI) / Math.max(2, Math.round(s.count)));
      const rot = this.view.rotation;
      for (const a of axes) {
        const dx = Math.cos(a + rot) * 5000, dy = Math.sin(a + rot) * 5000;
        ctx.beginPath(); ctx.moveTo(c.x - dx, c.y - dy); ctx.lineTo(c.x + dx, c.y + dy); ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(c.x, c.y, 6, 0, Math.PI * 2); ctx.fillStyle = '#5fd3a5'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.stroke();
      ctx.restore();
    }
    void m;
  }

  private drawLive() {
    const ctx = this.live, d = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.setTransform(d, 0, 0, d, 0, 0);
    if (this.session) {
      ctx.save();
      this.session.frame();
      ctx.restore();
      ctx.setTransform(d, 0, 0, d, 0, 0);
      this.drawAssists(ctx);
      return;
    }
    this.drawSelection(ctx);
    this.drawAssists(ctx);
    if (this.handler?.overlay) { ctx.save(); this.handler.overlay(ctx); ctx.restore(); }
    const h = this.hover;
    if (h && h.type !== 'touch' && (this._mode === 'paint' || this._mode === 'erase') && this.primaryMode() === 'draw' && !this.nav.active) {
      const r = Math.max(1.5, (this.preset.size.size * this.view.scale) / 2);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(h.x, h.y, r + 0.5, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.stroke();
      ctx.beginPath(); ctx.arc(h.x, h.y, r - 0.5 > 0.5 ? r - 0.5 : r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(20,14,40,0.85)'; ctx.stroke();
    }
  }

  // =================== Puntero / estado ===================

  private emitPointer() {
    const h = this.hover;
    if (!h) return;
    const d = this.view.toDoc(h.x, h.y);
    this.emit('pointer', { x: d.x, y: d.y, pressure: h.pressure, tilt: h.tilt, type: h.type, inside: d.x >= 0 && d.y >= 0 && d.x <= this.doc.width && d.y <= this.doc.height });
  }

  private emitStats(renderMs: number, progressive: boolean) {
    let items = 0, dabs = 0;
    const count = (list: readonly import('../doc/items').Item[]) => {
      for (const it of list) {
        items++;
        if (it.kind === 'stroke') for (const s of it.stroke.sets) dabs += s.count;
        if (it.kind === 'group') count(it.items);
      }
    };
    for (const l of this.doc.layers) count(l.items);
    this.emit('stats', { layers: this.doc.layers.length, items, dabs, renderMs, progressive });
  }

  private applyCursor() {
    const mode = this.primaryMode();
    this.element.style.cursor = mode === 'pan' ? (this.nav?.panning ? 'grabbing' : 'grab')
      : mode === 'rotate' ? 'alias'
      : this._mode === 'custom' ? (this.handler?.cursor ?? 'crosshair') : 'none';
  }
  /** Para herramientas que cambian de cursor según el contexto. */
  refreshCursor() { this.applyCursor(); }
}

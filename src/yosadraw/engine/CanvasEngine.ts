import type { StrokePoint } from '../../core/types';
import { createEngine, type StrokeEngine } from '../../filters';
import { PointerInput } from '../../input/PointerInput';
import type { BrushPreset } from '../brush/BrushPreset';
import { BrushStrokeSession, finishStrokeOffline, SessionBuffers } from '../brush/BrushStrokeSession';
import type { StrokePainter } from '../brush/StrokePainter';
import { Document, History, MAX_LAYERS, type Command, type Layer } from '../doc/Document';
import { distanceToRuler, projectOnRuler, symmetryMatrices, type Ruler, type Symmetry } from '../doc/geometry';
import { blendOp, ItemRenderer } from '../doc/ItemRenderer';
import { strokeSelectionOutline } from '../doc/Selection';
import { Emitter } from './Emitter';
import { fromOverlayUi, Navigation, type NavMode } from './Navigation';
import { invert, multiply, ViewTransform, type AABB, type Mat, type ViewState } from './ViewTransform';
import type { Item } from '../doc/items';
import type { Rect } from '../brush/StrokePainter';

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
  /** El extremo borrador del lápiz se apoyó (true) o se levantó (false). */
  stylusEraser: boolean;
  /** Se cargó otro documento (abrir o crear un proyecto). */
  document: Document;
};

/** Qué hace un dedo sobre el lienzo. */
export type FingerMode = 'auto' | 'draw' | 'navigate';

export interface CanvasEngineOptions {
  width: number;
  height: number;
  painter: StrokePainter;
  brush: BrushPreset;
  color: string;
  theme?: Partial<CanvasTheme>;
  /** Documento inicial (por defecto, uno vacío de width × height). */
  doc?: Document;
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
  /** Documento actual; se sustituye con `loadDocument`. */
  doc: Document;
  history = new History();
  readonly view = new ViewTransform();
  readonly stabilizer: StrokeEngine = createEngine();
  readonly painter: StrokePainter;
  items: ItemRenderer;
  readonly element: HTMLElement;
  theme: CanvasTheme = { workspace: '#08070d', paper: '#ffffff', frame: 'rgba(255,255,255,0.14)' };
  color: string;
  ruler: Ruler = { enabled: false, x0: 0, y0: 0, x1: 0, y1: 0 };
  symmetry: Symmetry = { enabled: false, mode: 'vertical', cx: 0, cy: 0, count: 6 };
  /** Distancia (px de pantalla) a la que un trazo se engancha a la regla. */
  rulerSnap = 60;
  /**
   * Dedo: 'auto' dibuja hasta que se usa un lápiz (luego sólo navega: rechazo de palma),
   * 'draw' siempre dibuja, 'navigate' sólo mueve, amplía y gira.
   */
  fingerMode: FingerMode = 'auto';
  /** Mantener el dedo quieto (o pulsar el botón del lápiz) toma el color. */
  holdToPick = true;
  holdDelay = 500;

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
  private pens = new Set<number>();
  private touches = new Set<number>();
  private strokeStart = 0;
  private hold: { id: number; x: number; y: number; timer: number } | null = null;
  /** Puntero que está tomando color (mantener pulsado o botón del lápiz) y su lupa. */
  private picking: { id: number; x: number; y: number; color: string | null } | null = null;
  private stylusEraser = false;
  private hover: { x: number; y: number; pressure: number; tilt: number; type: string } | null = null;
  private nav: Navigation;
  private resizeObs: ResizeObserver;

  constructor(container: HTMLElement, opts: CanvasEngineOptions) {
    super();
    this.doc = opts.doc ?? new Document(opts.width, opts.height);
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

    container.addEventListener('pointerdown', this.onCaptureDown, { capture: true });
    container.addEventListener('pointermove', this.onCaptureMove, { capture: true, passive: true });
    for (const t of ['pointerup', 'pointercancel'] as const) container.addEventListener(t, this.onCaptureUp, { capture: true });
    // Mantener pulsado en Android abre el menú contextual: en el lienzo no hay menú.
    container.addEventListener('contextmenu', e => e.preventDefault());

    this.nav = new Navigation({
      view: this.view,
      element: container,
      viewportSize: () => ({ w: this.vw, h: this.vh }),
      primaryMode: () => this.primaryMode(),
      viewChanged: () => this.viewChanged(),
      cancelStroke: () => this.cancelStroke(),
      undo: () => this.undo(),
      redo: () => this.redo(),
      fingerNavigates: () => !this.fingerDraws(),
      touchStrokeAge: () => (this.downType === 'touch' && this.isDrawing ? performance.now() - this.strokeStart : -1),
      penDown: () => this.pens.size > 0,
    });

    new PointerInput([container], {
      begin: (_t, p) => this.beginStroke(p),
      move: pts => this.moveStroke(pts),
      end: () => this.endStroke(),
      accept: e => this.acceptStroke(e),
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

  get isDrawing() { return this.session !== null || this.toolPointer !== null || this.pending !== null; }
  /** Sube con cada cambio del documento (hacer, deshacer, rehacer): sirve para saber si hay cambios sin guardar. */
  get revision() { return this._revision; }
  private _revision = 0;

  /**
   * Abre otro documento: descarta el trazo en curso, vacía el historial y las
   * vistas de capa, y encaja (o restaura) la vista. Las herramientas siguen igual.
   */
  loadDocument(doc: Document, view?: ViewState | null) {
    this.cancelStroke();
    this.disarmHold();
    this.picking = null;
    this.pending = null;
    this.ghosts = [];
    this.abandonJob();
    this.doc = doc;
    this.history = new History();
    this.items = new ItemRenderer(this.painter, doc.width, doc.height);
    this.symmetry = { ...this.symmetry, enabled: false, cx: doc.width / 2, cy: doc.height / 2 };
    this.ruler = { enabled: false, x0: doc.width * 0.25, y0: doc.height / 2, x1: doc.width * 0.75, y1: doc.height / 2 };
    for (const v of this.layerViews.values()) v.canvas.remove();
    this.layerViews.clear();
    this.selShadeKey = '';
    this.syncLayers();
    if (view && view.scale > 0) this.view.set(view); else this.view.fit(this.vw, this.vh, doc.width, doc.height);
    this._revision++;
    this.viewChanged();
    this.invalidateAll(false);
    this.emit('document', doc);
    this.emit('history', this.historyState);
    this.emit('doc', { structure: true, selection: true });
    this.emitStats(0, false);
  }

  /** Color del papel (blanco si el fondo es transparente, para mezclas y previsualizaciones). */
  get paperColor() { return this.doc.settings.background ?? '#ffffff'; }
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
    this._revision++;
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
  setLayerProps(id: string, patch: Partial<Pick<Layer, 'name' | 'visible' | 'locked' | 'alphaLock' | 'opacity' | 'blend'>>, from?: Partial<Layer>) {
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
    if (layer.alphaLock && this._mode === 'erase') { this.emit('notice', 'La capa tiene el alfa bloqueado: el borrador no puede cambiar su transparencia'); return; }
    this.nav.cancelAnimations();
    this.strokeStart = performance.now();
    // Capa aún repintándose (p. ej. justo después de un zoom) y cara de terminar: el trazo
    // espera sin bloquear. Se guardan los puntos y se muestra una línea provisional; si llega
    // un segundo dedo (gesto), se descarta sin haber congelado la app.
    if (this.stale().includes(layer) && this.estimate([layer], this.view) > 16) {
      this.pending = { layer: layer.id, points: [p] };
      this.rerender(false);
      this.requestFrame();
      return;
    }
    this.finishLayer(layer.id);
    this.startSession(layer, p);
  }

  /** Trazos ya aplicados cuya capa aún se repinta: se siguen viendo como línea provisional. */
  private ghosts: { layer: string; points: StrokePoint[]; color: string; width: number; erase: boolean }[] = [];

  private commitPendingOffline(): boolean {
    const pd = this.pending!;
    const layer = this.doc.layer(pd.layer);
    const preset = this.preset;
    if (!layer || !this.stale().includes(layer) || (preset.mix.mode !== 'none' && preset.render.mode === 'stamp')) return false;
    this.pending = null;
    this.stabilizer.apply(preset.stabilizer);
    this.simulate = this.downType === 'mouse' && preset.pressure.simulateMouse;
    const p0 = pd.points[0];
    this.sim = { x: p0.x, y: p0.y, t: 0, v: 0, p: 0.6 };
    this.rulerLocked = this.ruler.enabled && distanceToRuler(this.ruler, this.view.toDoc(p0.x, p0.y)) * this.view.scale <= this.rulerSnap;
    const pipe = this.stabilizer.pipeline;
    const out: StrokePoint[] = [...pipe.beginStroke(p0)];
    for (const q of pd.points.slice(1)) out.push(...pipe.pushPoint(q));
    out.push(...pipe.endStroke());
    const docPts = out.map(q => this.toDoc(q));
    this.rulerLocked = false;
    const tool = this._mode === 'erase' ? 'eraser' : 'brush';
    const stroke = finishStrokeOffline(preset, this.color, tool, (Math.random() * 2 ** 32) >>> 0, docPts.length ? docPts : [this.toDoc(p0)], symmetryMatrices(this.symmetry));
    this.ghosts.push({ layer: layer.id, points: pd.points, color: this.color, width: Math.max(1, preset.size.size * this.view.scale * 0.8), erase: tool === 'eraser' });
    const item = this.doc.paintItem(layer.id, { kind: 'stroke', stroke }, { clip: this.doc.selection });
    this.exec(this.doc.cmdAddItems(layer.id, [item], tool === 'eraser' ? 'Borrar' : 'Trazo'), false);
    return true;
  }

  /** Trazo esperando a que su capa termine de repintarse. */
  private pending: { layer: string; points: StrokePoint[] } | null = null;

  /** Arranca el trazo que esperaba (con todos los puntos recibidos mientras tanto). */
  private flushPending(sync: boolean) {
    const pd = this.pending;
    if (!pd) return;
    const layer = this.doc.layer(pd.layer);
    if (!layer) { this.pending = null; return; }
    if (this.stale().includes(layer)) { if (!sync) return; this.finishLayer(layer.id); }
    this.pending = null;
    this.startSession(layer, pd.points[0]);
    if (pd.points.length > 1) this.moveStroke(pd.points.slice(1));
  }

  private startSession(layer: Layer, p: StrokePoint) {
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
      target: view.ctx, overlay: this.live, M: this.V, dpr: this.dpr, buffers: this.buffers, paperColor: this.paperColor,
      clip: sel ? this.items.selectionMask(sel, this.V, this.dpr, view.canvas.width, view.canvas.height) : null,
      mirrors: symmetryMatrices(this.symmetry), atop: layer.alphaLock,
    }, preset, this.color, tool, (Math.random() * 2 ** 32) >>> 0);
    const first = this.stabilizer.pipeline.beginStroke(p).map(q => this.toDoc(q));
    this.session.begin(first[0] ?? this.toDoc(p));
    if (first.length > 1) this.session.add(first.slice(1));
    this.hover = { x: p.x, y: p.y, pressure: p.pressure, tilt: Math.hypot(p.tiltX, p.tiltY), type: this.downType };
    this.requestFrame();
  }

  private moveStroke(points: StrokePoint[]) {
    if (this.pending) { this.pending.points.push(...points); this.requestFrame(); return; }
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
    // Se levantó el dedo antes de que la capa estuviera lista: el trazo se calcula sin pintarlo,
    // se añade al documento y la capa sigue repintándose por partes (sin bloquear).
    if (this.pending && this.commitPendingOffline()) return;
    if (this.pending) this.flushPending(true);
    const s = this.session;
    if (!s) return;
    const tail = this.stabilizer.pipeline.endStroke();
    if (tail.length) s.add(tail.map(q => this.toDoc(q)));
    const finished = s.end();
    this.session = null;
    this.rulerLocked = false;
    const layer = this.doc.active;
    const item = this.doc.paintItem(layer.id, { kind: 'stroke', stroke: finished }, { clip: this.doc.selection });
    this.exec(this.doc.cmdAddItems(layer.id, [item], s.tool === 'eraser' ? 'Borrar' : 'Trazo'), true);
  }

  /** Descarta el trazo o gesto en curso (p. ej. al apoyar un segundo dedo). */
  private cancelStroke() {
    if (this.toolPointer !== null) { this.handler?.cancel?.(); this.toolPointer = null; }
    if (this.pending) { this.pending = null; this.requestFrame(); }
    if (!this.session) return;
    this.stabilizer.pipeline.endStroke();
    this.session.cancel();
    this.session = null;
    this.rulerLocked = false;
    this.requestFrame();
  }

  // =================== Dedo y lápiz ===================

  /** El dedo dibuja (según `fingerMode` y si ya se ha usado un lápiz). */
  fingerDraws() { return this.fingerMode === 'draw' || (this.fingerMode === 'auto' && !this.nav.penUsed); }

  /** ¿Puede este puntero empezar un trazo o un gesto de herramienta? */
  private acceptStroke(e: PointerEvent): boolean {
    if (this.picking || this.inputLocked || fromOverlayUi(e)) return false;
    if (e.pointerType === 'pen') return !(e.button === 2 || (e.buttons & 2));
    if (e.pointerType === 'touch') return this.fingerDraws() && this.pens.size === 0 && this.touches.size <= 1;
    return true;
  }

  private local(e: PointerEvent) {
    const r = this.element.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onCaptureDown = (e: PointerEvent) => {
    if (fromOverlayUi(e)) return;
    this.downType = e.pointerType;
    this.downAlt = e.altKey;
    if (this.hold && this.hold.id !== e.pointerId) this.disarmHold();
    if (e.pointerType === 'pen') {
      this.pens.add(e.pointerId);
      // Extremo borrador (S Pen, Surface Pen…): la app cambia al borrador mientras se usa.
      const eraser = e.button === 5 || (e.buttons & 32) !== 0;
      if (eraser !== this.stylusEraser) { this.stylusEraser = eraser; this.emit('stylusEraser', eraser); }
      // Botón lateral del lápiz: cuentagotas (no dibuja).
      if ((e.button === 2 || (e.buttons & 2)) && this.holdToPick && this.pickMode()) {
        e.stopImmediatePropagation();
        e.preventDefault();
        this.startPicking(e.pointerId, this.local(e));
      }
      return;
    }
    if (e.pointerType === 'touch') {
      if (this.pens.size) { e.stopImmediatePropagation(); return; } // palma apoyada mientras se dibuja con lápiz
      this.touches.add(e.pointerId);
      if (this.touches.size === 1 && this.holdToPick && this.pickMode()) {
        const p = this.local(e);
        this.hold = { id: e.pointerId, x: p.x, y: p.y, timer: window.setTimeout(this.fireHold, this.holdDelay) };
      }
    }
  };

  private onCaptureMove = (e: PointerEvent) => {
    if (this.picking?.id === e.pointerId) { const p = this.local(e); this.picking.x = p.x; this.picking.y = p.y; this.samplePick(); return; }
    const h = this.hold;
    if (h && h.id === e.pointerId) {
      const p = this.local(e);
      if (Math.hypot(p.x - h.x, p.y - h.y) > 10) this.disarmHold();
    }
  };

  private onCaptureUp = (e: PointerEvent) => {
    if (this.hold?.id === e.pointerId) this.disarmHold();
    this.touches.delete(e.pointerId);
    if (this.pens.delete(e.pointerId) && this.stylusEraser) { this.stylusEraser = false; this.emit('stylusEraser', false); }
    if (this.picking?.id === e.pointerId) {
      const c = this.picking.color;
      this.picking = null;
      if (c && e.type === 'pointerup') this.emit('picked', c);
      this.requestFrame();
    }
  };

  /** Tomar color tiene sentido con herramientas de pintura o si el dedo sólo navega. */
  private pickMode() {
    if (this.primaryMode() !== 'draw') return false;
    return this._mode === 'paint' || !this.fingerDraws();
  }

  private disarmHold() {
    if (this.hold) { clearTimeout(this.hold.timer); this.hold = null; }
  }

  private fireHold = () => {
    const h = this.hold;
    this.hold = null;
    if (!h || this.touches.size !== 1 || this.nav.active) return;
    // El dedo quieto empezó un punto: se descarta y se pasa a tomar color.
    this.cancelStroke();
    this.startPicking(h.id, h);
    try { navigator.vibrate?.(12); } catch { /* sin vibración */ }
  };

  private startPicking(id: number, p: { x: number; y: number }) {
    this.cancelStroke();
    this.nav.cancelGesture();
    this.picking = { id, x: p.x, y: p.y, color: null };
    this.samplePick();
  }

  private samplePick() {
    const pk = this.picking;
    if (!pk) return;
    const [r, g, b, a] = this.sampleColor(pk.x, pk.y, 'all', 1);
    pk.color = a > 0 ? `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}` : pk.color;
    this.requestFrame();
  }

  /** Lupa del cuentagotas: anillo con el color nuevo (arriba) y el actual (abajo), sobre el dedo. */
  private drawLoupe(ctx: CanvasRenderingContext2D) {
    const pk = this.picking;
    if (!pk) return;
    const R = 46, cx = pk.x, cy = Math.max(R + 8, pk.y - 90);
    ctx.save();
    ctx.lineWidth = 14;
    ctx.beginPath(); ctx.arc(cx, cy, R, Math.PI, 0); ctx.strokeStyle = pk.color ?? this.color; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI); ctx.strokeStyle = this.color; ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath(); ctx.arc(cx, cy, R + 7.5, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, R - 7.5, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(20,14,40,0.9)';
    ctx.beginPath(); ctx.moveTo(pk.x - 8, pk.y); ctx.lineTo(pk.x + 8, pk.y); ctx.moveTo(pk.x, pk.y - 8); ctx.lineTo(pk.x, pk.y + 8); ctx.stroke();
    ctx.restore();
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
    if (!this.acceptStroke(e)) return;
    this.finishLayer(this.doc.activeId);
    this.strokeStart = performance.now();
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
    if (mode === 'all' && this.doc.settings.background) { g.fillStyle = this.doc.settings.background; g.fillRect(0, 0, n, n); }
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

  /**
   * Imagen del documento (W × H) compuesta con lo que ya está pintado en pantalla,
   * sin repintar nada: sirve si se ve el documento entero, sin girar, con las capas
   * al día y con resolución suficiente. Si no, devuelve null (hay que rasterizar).
   */
  snapshotFromView(W: number, H: number): HTMLCanvasElement | null {
    if (this.view.rotation !== 0 || this.isDrawing) return null;
    const m = this.V, d = this.dpr;
    const x0 = m[4] * d, y0 = m[5] * d, sw = this.doc.width * m[0] * d, sh = this.doc.height * m[3] * d;
    if (x0 < -0.5 || y0 < -0.5 || x0 + sw > this.back.width + 0.5 || y0 + sh > this.back.height + 0.5 || sw < W * 0.75) return null;
    const visible = this.doc.layers.filter(l => l.visible);
    if (visible.some(l => { const v = this.layerViews.get(l.id); return !v || v.dirty || !v.crisp || !v.crisp.equals(this.view); })) return null;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d')!;
    if (this.doc.settings.background) { g.fillStyle = this.doc.settings.background; g.fillRect(0, 0, W, H); }
    g.imageSmoothingQuality = 'high';
    for (const l of visible) {
      g.globalAlpha = l.opacity;
      g.globalCompositeOperation = blendOp(l.blend);
      g.drawImage(this.layerViews.get(l.id)!.canvas, x0, y0, sw, sh, 0, 0, W, H);
    }
    return c;
  }

  // =================== Efectos ===================

  /** Con la ventana de efectos abierta no se pinta (sólo se navega para inspeccionar). */
  inputLocked = false;
  private fxCanvas: HTMLCanvasElement | null = null;
  private fxHidden: HTMLCanvasElement[] = [];

  /**
   * Imagen de pantalla (px físicos, vista actual sin girar el contenido) de una
   * capa o de la composición de las capas visibles, para la vista previa de efectos.
   * Devuelve también dónde cae el documento y cuántos px de pantalla mide un px de documento.
   */
  viewSource(target: { layer: string } | 'all'): { canvas: HTMLCanvasElement; unit: number; doc: [number, number, number, number]; mask: HTMLCanvasElement | null } | null {
    this.finishRendering();
    const W = this.back.width, H = this.back.height;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d')!;
    const layers = target === 'all' ? this.doc.layers.filter(l => l.visible) : [this.doc.layer(target.layer)].filter((l): l is Layer => !!l);
    if (!layers.length) return null;
    for (const l of layers) {
      const v = this.layerViews.get(l.id);
      if (!v) continue;
      g.globalAlpha = target === 'all' ? l.opacity : 1;
      g.globalCompositeOperation = target === 'all' ? blendOp(l.blend) : 'source-over';
      g.drawImage(v.canvas, 0, 0);
    }
    const m = this.V, d = this.dpr;
    const pts = [[0, 0], [this.doc.width, 0], [0, this.doc.height], [this.doc.width, this.doc.height]].map(([x, y]) => [d * (m[0] * x + m[2] * y + m[4]), d * (m[1] * x + m[3] * y + m[5])]);
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const doc: [number, number, number, number] = [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
    const sel = this.doc.selection;
    return { canvas: c, unit: this.view.scale * d, doc, mask: sel ? this.items.selectionMask(sel, m, d, W, H) : null };
  }

  /** Muestra (o quita, con null) el resultado de la vista previa en lugar de la capa o de todas. */
  showEffectPreview(result: HTMLCanvasElement | null, target: { layer: string } | 'all' = 'all') {
    for (const c of this.fxHidden) c.style.visibility = '';
    this.fxHidden = [];
    this.fxCanvas?.remove();
    this.fxCanvas = null;
    for (const l of this.doc.layers) this.applyLayerStyle(l);
    if (!result) return;
    const c = result;
    Object.assign(c.style, { position: 'absolute', left: '0', top: '0', width: `${this.vw}px`, height: `${this.vh}px`, pointerEvents: 'none' });
    if (target === 'all') {
      const vis = this.doc.layers.filter(l => l.visible).map(l => this.layerViews.get(l.id)?.canvas).filter((x): x is HTMLCanvasElement => !!x);
      vis.forEach(x => { x.style.visibility = 'hidden'; });
      this.fxHidden = vis;
      (vis[vis.length - 1] ?? this.stack.firstElementChild!).after(c);
    } else {
      const l = this.doc.layer(target.layer), v = l && this.layerViews.get(l.id);
      if (!l || !v) return;
      c.style.opacity = String(l.opacity);
      c.style.mixBlendMode = l.blend;
      v.canvas.style.visibility = 'hidden';
      this.fxHidden = [v.canvas];
      v.canvas.after(c);
    }
    this.fxCanvas = c;
  }

  /** Composición de las capas visibles a resolución de documento (con opacidad y fusión). */
  rasterizeVisible(): HTMLCanvasElement {
    const out = document.createElement('canvas');
    out.width = this.doc.width; out.height = this.doc.height;
    const g = out.getContext('2d')!;
    for (const l of this.doc.layers) {
      if (!l.visible || !l.items.length) continue;
      const r = this.rasterize([l], 1);
      g.globalAlpha = l.opacity;
      g.globalCompositeOperation = blendOp(l.blend);
      g.drawImage(r, 0, 0);
    }
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
    // Las líneas provisionales están en coordenadas de pantalla: con otra vista ya no encajan.
    this.ghosts = [];
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

  /** Mismo encuadre salvo un resto de traslación inferior a medio píxel físico (no merece repintar). */
  private nearView(c: ViewTransform, v: ViewTransform) {
    const tol = 0.5 / this.dpr;
    return c.scale === v.scale && c.rotation === v.rotation && Math.abs(c.x - v.x) < tol && Math.abs(c.y - v.y) < tol;
  }

  private stale(): Layer[] {
    // Las capas ocultas no se repintan (al mostrarlas se marcan sucias y entran aquí).
    return this.doc.layers.filter(l => { const v = this.layerViews.get(l.id); return l.visible && v && (v.dirty || !v.crisp || !this.nearView(v.crisp, this.view)); });
  }

  // ---------- Coste estimado del repintado ----------
  // Se estima por los sellos que de verdad se van a dibujar (elementos visibles o en la franja
  // descubierta al desplazar), no por lo que tardó el último repintado: si antes se veía poco
  // (zoom grande) y ahora todo, el último tiempo engañaba y se repintaba todo de golpe.
  private static costCache = new WeakMap<object, number>();
  private msPerUnit = 0.0015;
  private costOf(it: Item): number {
    let c = CanvasEngine.costCache.get(it);
    if (c === undefined) {
      if (it.kind === 'stroke') c = 30 + (it.stroke.preset.render.mode === 'smooth' ? it.stroke.points.length * 6 : it.stroke.sets.reduce((a, st) => a + st.count, 0));
      else if (it.kind === 'group') c = 30 + it.items.reduce((a, i) => a + this.costOf(i), 0);
      else if (it.kind === 'bitmap') c = 400;
      else c = 150;
      CanvasEngine.costCache.set(it, c);
    }
    return c;
  }

  /** Desplazamiento puro (misma escala y giro): se reutilizan los píxeles y sólo se pinta lo descubierto. */
  private shiftOf(v: LayerView, view: ViewTransform): { dx: number; dy: number } | null {
    const c = v.crisp;
    if (!c || v.dirty || c.scale !== view.scale || c.rotation !== view.rotation) return null;
    const d = this.dpr, dx = Math.round((view.x - c.x) * d), dy = Math.round((view.y - c.y) * d);
    if (Math.abs(dx) >= this.back.width * 0.7 || Math.abs(dy) >= this.back.height * 0.7) return null;
    return { dx, dy };
  }

  /** Rectángulos (px físicos) que hay que pintar y la vista con que se pintan. */
  private plan(v: LayerView, view: ViewTransform): { view: ViewTransform; regions: Rect[]; shift: { dx: number; dy: number } | null } {
    const W = this.back.width, H = this.back.height;
    const sh = this.shiftOf(v, view);
    if (!sh) return { view, regions: [{ x0: 0, y0: 0, x1: W, y1: H }], shift: null };
    const eff = v.crisp!.clone();
    eff.x += sh.dx / this.dpr;
    eff.y += sh.dy / this.dpr;
    const regions: Rect[] = [];
    if (sh.dx > 0) regions.push({ x0: 0, y0: 0, x1: sh.dx, y1: H });
    if (sh.dx < 0) regions.push({ x0: W + sh.dx, y0: 0, x1: W, y1: H });
    // La franja horizontal no repite la esquina ya cubierta por la vertical (pintar dos veces acumularía alfa).
    const xa = sh.dx > 0 ? sh.dx : 0, xb = sh.dx < 0 ? W + sh.dx : W;
    if (sh.dy > 0) regions.push({ x0: xa, y0: 0, x1: xb, y1: sh.dy });
    if (sh.dy < 0) regions.push({ x0: xa, y0: H + sh.dy, x1: xb, y1: H });
    return { view: eff, regions, shift: sh };
  }

  private regionBounds(view: ViewTransform, r: Rect): AABB {
    const d = this.dpr;
    const pts = [view.toDoc(r.x0 / d, r.y0 / d), view.toDoc(r.x1 / d, r.y0 / d), view.toDoc(r.x0 / d, r.y1 / d), view.toDoc(r.x1 / d, r.y1 / d)];
    return { minX: Math.min(...pts.map(p => p.x)), minY: Math.min(...pts.map(p => p.y)), maxX: Math.max(...pts.map(p => p.x)), maxY: Math.max(...pts.map(p => p.y)) };
  }

  /** ms estimados para repintar estas capas con esta vista. */
  private estimate(layers: Layer[], view: ViewTransform): number {
    let units = 0;
    for (const l of layers) {
      const v = this.layerViews.get(l.id);
      if (!v) continue;
      const pl = this.plan(v, view);
      for (const r of pl.regions) {
        const b = this.regionBounds(pl.view, r);
        for (const it of l.items) if (!(it.bounds.maxX < b.minX || it.bounds.minX > b.maxX || it.bounds.maxY < b.minY || it.bounds.minY > b.maxY)) units += this.costOf(it);
      }
    }
    return units * this.msPerUnit;
  }

  /** Termina en el acto cualquier repintado pendiente (antes de muestrear colores de todas las capas). */
  finishRendering() { if (this.stale().length || this.job) this.rerender(true, true); }

  /**
   * Deja al día sólo una capa (la que se va a pintar): las demás siguen
   * repintándose por partes sin bloquear el primer trazo.
   */
  finishLayer(id: string) {
    const l = this.doc.layer(id);
    if (!l || !this.stale().includes(l)) return;
    this.abandonJob();
    const it = this.renderSteps([l], this.view.clone());
    this.sliceBudget = Infinity;
    while (!it.next().done) { /* hasta el final */ }
    this.sliceBudget = SLICE_MS;
    if (this.stale().length) this.rerender(false);
  }

  /** Repinta todas las capas ya (síncrono). */
  renderAll() { for (const v of this.layerViews.values()) v.dirty = true; this.rerender(true, true); }

  private invalidateAll(sync: boolean) { for (const v of this.layerViews.values()) v.dirty = true; this.rerender(sync); }

  private rerender(preferSync: boolean, force = false) {
    this.abandonJob();
    // La capa activa primero: es donde se va a dibujar.
    const layers = this.stale().sort((a, b) => Number(b.id === this.doc.activeId) - Number(a.id === this.doc.activeId));
    if (!layers.length) return;
    const view = this.view.clone();
    this.job = { it: this.renderSteps(layers, view), view };
    if (force || (preferSync && this.estimate(layers, view) < 40)) {
      this.sliceBudget = Infinity;
      while (this.job && !this.job.it.next().done) { /* hasta el final */ }
      this.sliceBudget = SLICE_MS;
    } else this.requestFrame();
  }

  /** Transformación CSS que encaja el contenido pintado (vista `crisp`) con la vista actual. */
  private layerTransform(v: LayerView) {
    v.canvas.style.transform = !v.crisp || v.crisp.equals(this.view) ? '' : `matrix(${multiply(this.V, invert(v.crisp.matrix())).join(',')})`;
  }

  private *renderSteps(layers: Layer[], view: ViewTransform): Generator<void, void> {
    const ctx = this.backCtx, d = this.dpr;
    let sliced = false, total = 0;
    for (const layer of layers) {
      const v = this.layerViews.get(layer.id);
      if (!v) continue;
      const pl = this.plan(v, view);
      const m = pl.view.matrix();
      let work = 0, units = 0, slice = performance.now();
      ctx.save();
      try {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, this.back.width, this.back.height);
        // Desplazamiento: se reutiliza lo ya pintado y sólo se rellenan las franjas nuevas.
        if (pl.shift) ctx.drawImage(v.canvas, pl.shift.dx, pl.shift.dy);
        for (const r of pl.regions) {
          const b = this.regionBounds(pl.view, r);
          ctx.save();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.beginPath();
          ctx.rect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
          ctx.clip();
          ctx.setTransform(d * m[0], d * m[1], d * m[2], d * m[3], d * m[4], d * m[5]);
          ctx.beginPath();
          ctx.rect(0, 0, this.doc.width, this.doc.height);
          ctx.clip();
          ctx.setTransform(d, 0, 0, d, 0, 0);
          try {
            for (const it of layer.items) {
              if (it.bounds.maxX < b.minX || it.bounds.minX > b.maxX || it.bounds.maxY < b.minY || it.bounds.minY > b.maxY) continue;
              this.items.renderItem(ctx, it, m, d);
              units += this.costOf(it);
              const now = performance.now();
              if (now - slice > this.sliceBudget) { work += now - slice; sliced = true; yield; slice = performance.now(); }
            }
          } finally { ctx.restore(); }
        }
      } finally { ctx.restore(); }
      work += performance.now() - slice;
      // Aprende el coste real por sello de este dispositivo (media móvil).
      if (units > 3000 && work > 2) this.msPerUnit = this.msPerUnit * 0.7 + (work / units) * 0.3;
      // Intercambio: el lienzo de la capa pasa a mostrar el resultado nuevo.
      if (v.clipped) { v.ctx.restore(); v.clipped = false; }
      v.ctx.setTransform(1, 0, 0, 1, 0, 0);
      v.ctx.globalCompositeOperation = 'copy';
      v.ctx.drawImage(this.back, 0, 0);
      v.ctx.globalCompositeOperation = 'source-over';
      v.crisp = pl.view.clone();
      this.applyClip(v);
      v.dirty = false;
      v.ms = work;
      this.layerTransform(v);
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
      for (const v of this.layerViews.values()) this.layerTransform(v);
      const stale = this.stale();
      if (!this.job && stale.length) {
        if (this.estimate(stale, this.view) <= LIVE_RENDER_BUDGET_MS) this.rerender(true, true);
        else {
          clearTimeout(this.settleTimer);
          this.settleTimer = window.setTimeout(() => { if (!this.isDrawing && !this.nav.active) this.rerender(false); else { this.viewDirty = true; this.requestFrame(); } }, SETTLE_MS);
        }
      }
    }
    if (this.job) {
      // Con un trazo esperando, se dedica más tiempo por fotograma a terminar su capa.
      this.sliceBudget = this.pending ? 28 : SLICE_MS;
      if (this.job.it.next().done === false) this.requestFrame();
      this.sliceBudget = SLICE_MS;
    }
    if (this.pending) { this.flushPending(false); if (this.pending) this.requestFrame(); }
    if (this.ghosts.length) { const st = new Set(this.stale().map(l => l.id)); this.ghosts = this.ghosts.filter(g => st.has(g.layer)); }
    this.drawLive();
  }

  private checkerPattern: CanvasPattern | null = null;
  private checker(ctx: CanvasRenderingContext2D) {
    if (!this.checkerPattern) {
      const c = document.createElement('canvas');
      c.width = c.height = 16;
      const g = c.getContext('2d')!;
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, 16, 16);
      g.fillStyle = '#e4e1ec'; g.fillRect(0, 0, 8, 8); g.fillRect(8, 8, 8, 8);
      this.checkerPattern = ctx.createPattern(c, 'repeat')!;
    }
    return this.checkerPattern;
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
    const bg = this.doc.settings.background;
    ctx.fillStyle = bg ?? '#ffffff';
    ctx.fillRect(0, 0, this.doc.width, this.doc.height);
    ctx.restore();
    if (!bg) {
      // Fondo transparente: damero de tamaño fijo en pantalla, recortado al documento.
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, this.doc.width, this.doc.height); ctx.clip();
      ctx.setTransform(d, 0, 0, d, 0, 0);
      ctx.fillStyle = this.checker(ctx);
      ctx.fillRect(0, 0, this.vw, this.vh);
      ctx.restore();
    }
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
    // Líneas provisionales mientras la capa termina de repintarse.
    const provisional = [...this.ghosts];
    if (this.pending) provisional.push({ layer: this.pending.layer, points: this.pending.points, color: this.color, width: Math.max(1, this.preset.size.size * this.view.scale * 0.8), erase: this._mode === 'erase' });
    for (const g of provisional) {
      const pts = g.points;
      ctx.save();
      ctx.strokeStyle = g.erase ? 'rgba(255,255,255,0.8)' : g.color;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = g.width;
      ctx.lineCap = ctx.lineJoin = 'round';
      ctx.beginPath();
      pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      if (pts.length === 1) ctx.lineTo(pts[0].x + 0.01, pts[0].y);
      ctx.stroke();
      ctx.restore();
    }
    this.drawSelection(ctx);
    this.drawAssists(ctx);
    if (this.handler?.overlay) { ctx.save(); this.handler.overlay(ctx); ctx.restore(); }
    if (this.picking) { this.drawLoupe(ctx); return; }
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

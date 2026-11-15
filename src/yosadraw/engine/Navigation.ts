import { interpolateView, ViewTransform, type ViewState } from './ViewTransform';

export type NavMode = 'draw' | 'pan' | 'rotate';

/** Lo que la navegación necesita del motor (sin depender de él directamente). */
export interface NavHost {
  readonly view: ViewTransform;
  readonly element: HTMLElement;
  viewportSize(): { w: number; h: number };
  primaryMode(): NavMode;
  viewChanged(): void;
  cancelStroke(): void;
  undo(): void;
  redo(): void;
  /** Un dedo solo navega (no dibuja). */
  fingerNavigates(): boolean;
  /** ms desde que empezó el trazo con el dedo en curso, o -1 si no hay. */
  touchStrokeAge(): number;
  /** Hay un lápiz apoyado (los toques son la palma). */
  penDown(): boolean;
}

type Gesture =
  | { kind: 'pan'; id: number; x: number; y: number }
  | { kind: 'rotate'; id: number; angle: number; raw: number; cx: number; cy: number }
  | { kind: 'pinch'; a: number; b: number; dA: { x: number; y: number }; dB: { x: number; y: number } };

const DEG = Math.PI / 180;

/** Controles flotantes dentro del lienzo (marcados con data-ui): no son toques del lienzo. */
export const fromOverlayUi = (e: Event) => !!(e.target as Element | null)?.closest?.('[data-ui]');
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Navegación del lienzo: desplazamiento, zoom y rotación.
 * - Rueda: desplaza · Ctrl/⌘ + rueda o pellizco del trackpad: zoom en el cursor · Alt + rueda: rota.
 * - Botón central del ratón, herramienta Mano o barra espaciadora: desplaza.
 * - Herramienta Rotar: gira alrededor del centro (Mayús: pasos de 15°).
 * - Táctil: dos dedos = zoom + giro + desplazamiento simultáneos;
 *   toque con dos dedos = deshacer, con tres = rehacer. Un dedo desplaza si
 *   el dedo no dibuja. Un segundo dedo que llega tarde a un trazo ya largo se
 *   ignora (apoyo accidental), y con el lápiz apoyado no cuenta ningún toque.
 */
export class Navigation {
  private pointers = new Map<number, { x: number; y: number; type: string }>();
  private gesture: Gesture | null = null;
  private penSeen = false;
  private touchSession: { start: number; max: number; moved: number } | null = null;

  private zoomTarget: { scale: number; x: number; y: number } | null = null;
  private anim: { from: ViewState; to: ViewState; start: number; dur: number } | null = null;
  private raf = 0;
  private lastTick = 0;

  constructor(private host: NavHost) {
    const el = host.element;
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', this.onUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
  }

  get active() { return this.gesture !== null; }
  /** Suelta el gesto en curso sin terminarlo (p. ej. al pasar a tomar color). */
  cancelGesture() { if (this.gesture) { this.gesture = null; this.host.viewChanged(); } }
  get panning() { return this.gesture?.kind === 'pan'; }
  /** Se ha usado un lápiz: a partir de ahí el dedo sólo navega. */
  get penUsed() { return this.penSeen; }

  private local(e: PointerEvent | WheelEvent) {
    const r = this.host.element.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  // ---------- Animaciones ----------
  /** Vista final esperada: si hay una animación en curso, su destino (para encadenar clics). */
  targetView(): ViewTransform {
    return this.anim ? new ViewTransform().set(this.anim.to) : this.host.view.clone();
  }

  cancelAnimations() { this.zoomTarget = null; this.anim = null; }

  animateTo(to: ViewState, dur = 240) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) dur = 0;
    this.zoomTarget = null;
    if (dur <= 0) { this.host.view.set(to); this.host.viewChanged(); return; }
    this.anim = { from: this.host.view.clone(), to, start: performance.now(), dur };
    this.loop();
  }

  /** Zoom suave hacia una escala objetivo, anclado en un punto de pantalla. */
  smoothZoom(factor: number, x: number, y: number) {
    this.anim = null;
    const base = this.zoomTarget ? this.zoomTarget.scale : this.host.view.scale;
    this.zoomTarget = { scale: base * factor, x, y };
    this.loop();
  }

  private loop() {
    if (this.raf) return;
    this.lastTick = performance.now();
    const tick = (now: number) => {
      this.raf = 0;
      const dt = Math.min(50, now - this.lastTick);
      this.lastTick = now;
      const view = this.host.view;
      let more = false;
      if (this.anim) {
        const { w, h } = this.host.viewportSize();
        const t = Math.min(1, (now - this.anim.start) / this.anim.dur);
        view.set(t >= 1 ? this.anim.to : interpolateView(this.anim.from, this.anim.to, easeOutCubic(t), w, h));
        if (t >= 1) this.anim = null; else more = true;
      } else if (this.zoomTarget) {
        const z = this.zoomTarget;
        const k = 1 - Math.exp(-dt / 55);
        const next = view.scale * Math.pow(z.scale / view.scale, k);
        view.setScaleAt(next, z.x, z.y);
        if (Math.abs(Math.log(z.scale / view.scale)) < 0.002 || view.scale !== next) { view.setScaleAt(z.scale, z.x, z.y); this.zoomTarget = null; }
        else more = true;
      }
      this.host.viewChanged();
      if (more) this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  // ---------- Rueda / trackpad ----------
  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const p = this.local(e);
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const dx = e.deltaX * unit, dy = e.deltaY * unit;
    if (e.ctrlKey || e.metaKey) {
      const factor = Math.exp(-dy * 0.0022);
      // Pellizco de trackpad: deltas pequeños y continuos → inmediato.
      // Rueda de ratón: saltos grandes → zoom animado.
      if (Math.abs(dy) < 30) { this.cancelAnimations(); this.host.view.zoomAt(factor, p.x, p.y); this.host.viewChanged(); }
      else this.smoothZoom(factor, p.x, p.y);
    } else if (e.altKey) {
      this.cancelAnimations();
      this.host.view.rotateAt((dy || dx) * 0.15 * DEG, p.x, p.y);
      this.host.viewChanged();
    } else {
      this.cancelAnimations();
      if (e.shiftKey && !dx) this.host.view.panBy(-dy, 0); else this.host.view.panBy(-dx, -dy);
      this.host.viewChanged();
    }
  };

  // ---------- Punteros ----------
  private onDown = (e: PointerEvent) => {
    if (fromOverlayUi(e)) return;
    const p = this.local(e);
    if (e.pointerType === 'pen') this.penSeen = true;
    if (e.pointerType === 'touch' && this.host.penDown()) return;
    if (e.pointerType === 'touch' && this.host.touchStrokeAge() > 350) return;
    this.pointers.set(e.pointerId, { ...p, type: e.pointerType });

    if (e.pointerType === 'touch') {
      const touches = [...this.pointers.entries()].filter(([, v]) => v.type === 'touch');
      if (!this.touchSession) this.touchSession = { start: performance.now(), max: 0, moved: 0 };
      this.touchSession.max = Math.max(this.touchSession.max, touches.length);
      if (touches.length === 2) {
        this.host.cancelStroke();
        const [[a, pa], [b, pb]] = touches;
        this.start({ kind: 'pinch', a, b, dA: this.host.view.toDoc(pa.x, pa.y), dB: this.host.view.toDoc(pb.x, pb.y) }, e);
        return;
      }
      if (touches.length === 1) {
        if (this.host.primaryMode() !== 'draw') this.startPrimary(e, p);
        else if (this.host.fingerNavigates()) this.start({ kind: 'pan', id: e.pointerId, ...p }, e);
      }
      return;
    }
    if (e.pointerType === 'mouse' && e.button === 1) { e.preventDefault(); this.start({ kind: 'pan', id: e.pointerId, ...p }, e); return; }
    if (e.button === 0) this.startPrimary(e, p);
  };

  private startPrimary(e: PointerEvent, p: { x: number; y: number }) {
    const mode = this.host.primaryMode();
    if (mode === 'pan') this.start({ kind: 'pan', id: e.pointerId, ...p }, e);
    else if (mode === 'rotate') {
      const { w, h } = this.host.viewportSize();
      const cx = w / 2, cy = h / 2;
      this.start({ kind: 'rotate', id: e.pointerId, angle: Math.atan2(p.y - cy, p.x - cx), raw: this.host.view.rotation, cx, cy }, e);
    }
  }

  private start(g: Gesture, e: PointerEvent) {
    this.cancelAnimations();
    this.gesture = g;
    try { this.host.element.setPointerCapture(e.pointerId); } catch { /* ya capturado */ }
    this.host.viewChanged();
  }

  private onMove = (e: PointerEvent) => {
    const rec = this.pointers.get(e.pointerId);
    if (!rec) return;
    const p = this.local(e);
    if (this.touchSession && rec.type === 'touch') this.touchSession.moved += Math.hypot(p.x - rec.x, p.y - rec.y);
    rec.x = p.x; rec.y = p.y;
    const g = this.gesture;
    if (!g) return;
    const view = this.host.view;
    if (g.kind === 'pan' && g.id === e.pointerId) {
      view.panBy(p.x - g.x, p.y - g.y);
      g.x = p.x; g.y = p.y;
    } else if (g.kind === 'rotate' && g.id === e.pointerId) {
      const ang = Math.atan2(p.y - g.cy, p.x - g.cx);
      let d = ang - g.angle;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      g.angle = ang;
      g.raw += d;
      const target = e.shiftKey ? Math.round(g.raw / (15 * DEG)) * 15 * DEG : g.raw;
      view.setRotationAt(target, g.cx, g.cy);
    } else if (g.kind === 'pinch') {
      const a = this.pointers.get(g.a), b = this.pointers.get(g.b);
      if (!a || !b) return;
      view.fromPointPairs(g.dA, g.dB, a, b);
    } else return;
    this.host.viewChanged();
  };

  private onUp = (e: PointerEvent) => {
    const rec = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    const g = this.gesture;
    if (g && ((g.kind === 'pinch' && (g.a === e.pointerId || g.b === e.pointerId)) || (g.kind !== 'pinch' && g.id === e.pointerId))) {
      this.gesture = null;
      this.host.viewChanged();
    }
    if (rec?.type === 'touch' && ![...this.pointers.values()].some(v => v.type === 'touch') && this.touchSession) {
      const s = this.touchSession;
      this.touchSession = null;
      const quick = performance.now() - s.start < 300 && s.moved < 16;
      if (quick && s.max === 2) this.host.undo();
      else if (quick && s.max === 3) this.host.redo();
    }
  };
}

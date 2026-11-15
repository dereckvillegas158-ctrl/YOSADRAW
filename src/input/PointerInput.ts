import type { StrokePoint } from '../core/types';

export interface PointerSink {
  begin(target: HTMLElement, p: StrokePoint): void;
  move(points: StrokePoint[]): void;
  end(): void;
  /**
   * Opcional: decide si este puntero puede empezar un trazo (política de dedo/lápiz
   * de la app). Si no se da, se usa el rechazo de palma por defecto.
   */
  accept?(e: PointerEvent): boolean;
}

/**
 * Captura de entrada de baja latencia:
 * - `pointerrawupdate` cuando existe (Chromium, contexto seguro): llega antes
 *   que `pointermove`, sin esperar al siguiente fotograma.
 * - `getCoalescedEvents()` para recuperar todas las muestras del digitalizador
 *   (240 Hz o más en tabletas), no sólo una por fotograma.
 * - Presión e inclinación reales para `pen`; 1 para ratón y dedo.
 * - Rechazo de palma: una vez detectado un lápiz, los toques con el dedo se ignoran.
 */
export class PointerInput {
  private activeId: number | null = null;
  private target: HTMLElement | null = null;
  private penSeen = false;
  private readonly useRaw = 'onpointerrawupdate' in window;

  constructor(surfaces: HTMLElement[], private sink: PointerSink) {
    for (const el of surfaces) {
      el.style.touchAction = 'none';
      el.addEventListener('pointerdown', this.onDown);
      el.addEventListener('contextmenu', e => e.preventDefault());
    }
    const moveType = this.useRaw ? 'pointerrawupdate' : 'pointermove';
    window.addEventListener(moveType as 'pointermove', this.onMove, { passive: true });
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
  }

  private toPoint(e: PointerEvent, rect: DOMRect): StrokePoint {
    const pen = e.pointerType === 'pen';
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      pressure: pen ? (e.pressure > 0 ? e.pressure : 0.01) : 1,
      tiltX: e.tiltX || 0,
      tiltY: e.tiltY || 0,
      t: e.timeStamp,
    };
  }

  private onDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (e.pointerType === 'pen') this.penSeen = true;
    if (this.sink.accept) { if (!this.sink.accept(e)) return; }
    else if (e.pointerType === 'touch' && this.penSeen) return; // rechazo de palma
    if (this.activeId !== null) return;
    const el = e.currentTarget as HTMLElement;
    this.activeId = e.pointerId;
    this.target = el;
    try { el.setPointerCapture(e.pointerId); } catch { /* sin captura */ }
    e.preventDefault();
    this.sink.begin(el, this.toPoint(e, el.getBoundingClientRect()));
  };

  private onMove = (e: PointerEvent) => {
    if (e.pointerId !== this.activeId || !this.target) return;
    const rect = this.target.getBoundingClientRect();
    const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    const events = list.length ? list : [e];
    this.sink.move(events.map(ev => this.toPoint(ev, rect)));
  };

  private onUp = (e: PointerEvent) => {
    if (e.pointerId !== this.activeId) return;
    this.activeId = null;
    this.target = null;
    this.sink.end();
  };

  get drawing() { return this.activeId !== null; }
}

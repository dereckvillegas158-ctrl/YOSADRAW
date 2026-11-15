import type { CurvePoint } from '../brush/BrushPreset';
import { evalCurve } from '../brush/PressureCurve';
import { h } from './dom';

/**
 * Editor de la curva de presión. Arrastra puntos; doble clic en un punto
 * central lo quita; doble clic en otro sitio añade uno (máx. 8).
 * Teclado: Tab para elegir punto, flechas para moverlo.
 */
export class CurveEditor {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private pts: CurvePoint[];
  private drag = -1;
  private focus = 1;
  private marker: number | null = null;

  constructor(points: CurvePoint[], private onChange: (pts: CurvePoint[]) => void) {
    this.pts = points.map(p => [...p] as CurvePoint);
    this.canvas = h('canvas', { class: 'curve-canvas', tabindex: '0', role: 'img', 'aria-label': 'Curva de presión: entrada en horizontal, efecto en vertical' });
    this.el = h('div', { class: 'curve' }, this.canvas, h('div', { class: 'curve-axes' }, h('span', null, 'Presión del lápiz →'), h('span', null, '↑ Efecto')));
    this.canvas.addEventListener('pointerdown', this.down);
    this.canvas.addEventListener('pointermove', this.move);
    this.canvas.addEventListener('pointerup', () => { this.drag = -1; });
    this.canvas.addEventListener('dblclick', this.dbl);
    this.canvas.addEventListener('keydown', this.key);
    new ResizeObserver(() => this.draw()).observe(this.canvas);
  }

  set(points: CurvePoint[]) { this.pts = points.map(p => [...p] as CurvePoint); this.draw(); }
  /** Muestra la presión actual del lápiz sobre la curva. */
  showInput(p: number | null) { this.marker = p; this.draw(); }

  private geo() {
    const r = this.canvas.getBoundingClientRect();
    const pad = 10;
    return { r, pad, w: r.width - pad * 2, hgt: r.height - pad * 2 };
  }
  private toPx(p: CurvePoint) { const g = this.geo(); return { x: g.pad + p[0] * g.w, y: g.pad + (1 - p[1]) * g.hgt }; }
  private fromEvent(e: PointerEvent | MouseEvent): CurvePoint {
    const g = this.geo();
    return [Math.min(1, Math.max(0, (e.clientX - g.r.left - g.pad) / g.w)), Math.min(1, Math.max(0, 1 - (e.clientY - g.r.top - g.pad) / g.hgt))];
  }
  private hit(e: PointerEvent | MouseEvent): number {
    const g = this.geo();
    let best = -1, bd = 14;
    this.pts.forEach((p, i) => { const q = this.toPx(p); const d = Math.hypot(q.x - (e.clientX - g.r.left), q.y - (e.clientY - g.r.top)); if (d < bd) { bd = d; best = i; } });
    return best;
  }

  private setPoint(i: number, [x, y]: CurvePoint) {
    const n = this.pts.length;
    if (i === 0) x = 0; else if (i === n - 1) x = 1;
    else x = Math.min(this.pts[i + 1][0] - 0.02, Math.max(this.pts[i - 1][0] + 0.02, x));
    this.pts[i] = [x, y];
    this.draw();
    this.onChange(this.pts.map(p => [...p] as CurvePoint));
  }

  private down = (e: PointerEvent) => {
    this.drag = this.hit(e);
    if (this.drag >= 0) { this.focus = this.drag; this.canvas.setPointerCapture(e.pointerId); }
  };
  private move = (e: PointerEvent) => { if (this.drag >= 0) this.setPoint(this.drag, this.fromEvent(e)); };
  private dbl = (e: MouseEvent) => {
    const i = this.hit(e);
    if (i > 0 && i < this.pts.length - 1) this.pts.splice(i, 1);
    else if (i < 0 && this.pts.length < 8) {
      const [x] = this.fromEvent(e);
      const k = this.pts.findIndex(p => p[0] > x);
      if (k > 0 && x - this.pts[k - 1][0] > 0.03 && this.pts[k][0] - x > 0.03) this.pts.splice(k, 0, [x, evalCurve(this.pts, x)]);
    } else return;
    this.draw();
    this.onChange(this.pts.map(p => [...p] as CurvePoint));
  };
  private key = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    const p = this.pts[this.focus];
    if (!p) return;
    const map: Record<string, CurvePoint> = { ArrowUp: [p[0], p[1] + step], ArrowDown: [p[0], p[1] - step], ArrowLeft: [p[0] - step, p[1]], ArrowRight: [p[0] + step, p[1]] };
    if (map[e.key]) { e.preventDefault(); this.setPoint(this.focus, [Math.min(1, Math.max(0, map[e.key][0])), Math.min(1, Math.max(0, map[e.key][1]))]); }
    else if (e.key === 'Tab' && !e.shiftKey && this.focus < this.pts.length - 1) { e.preventDefault(); this.focus++; this.draw(); }
    else if (e.key === 'Tab' && e.shiftKey && this.focus > 0) { e.preventDefault(); this.focus--; this.draw(); }
  };

  private draw() {
    const c = this.canvas, r = c.getBoundingClientRect();
    if (!r.width) return;
    const d = window.devicePixelRatio || 1;
    c.width = Math.round(r.width * d); c.height = Math.round(r.height * d);
    const g = c.getContext('2d')!;
    g.setTransform(d, 0, 0, d, 0, 0);
    const { pad, w, hgt } = this.geo();
    const css = getComputedStyle(c);
    const line = css.getPropertyValue('--line').trim() || '#2a2440';
    const accent = css.getPropertyValue('--accent').trim() || '#9d6bff';
    const fg = css.getPropertyValue('--fg').trim() || '#fff';
    g.strokeStyle = line; g.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      g.beginPath(); g.moveTo(pad + (w * i) / 4, pad); g.lineTo(pad + (w * i) / 4, pad + hgt); g.stroke();
      g.beginPath(); g.moveTo(pad, pad + (hgt * i) / 4); g.lineTo(pad + w, pad + (hgt * i) / 4); g.stroke();
    }
    g.setLineDash([3, 4]); g.beginPath(); g.moveTo(pad, pad + hgt); g.lineTo(pad + w, pad); g.stroke(); g.setLineDash([]);
    g.strokeStyle = accent; g.lineWidth = 2.5; g.beginPath();
    for (let i = 0; i <= 120; i++) { const x = i / 120, y = evalCurve(this.pts, x); const X = pad + x * w, Y = pad + (1 - y) * hgt; if (i) g.lineTo(X, Y); else g.moveTo(X, Y); }
    g.stroke();
    if (this.marker !== null) {
      const x = pad + this.marker * w, y = pad + (1 - evalCurve(this.pts, this.marker)) * hgt;
      g.fillStyle = fg; g.beginPath(); g.arc(x, y, 3.5, 0, Math.PI * 2); g.fill();
    }
    this.pts.forEach((p, i) => {
      const q = this.toPx(p);
      g.beginPath(); g.arc(q.x, q.y, 6, 0, Math.PI * 2);
      g.fillStyle = i === this.focus && document.activeElement === c ? accent : '#15121f';
      g.fill(); g.strokeStyle = accent; g.lineWidth = 2; g.stroke();
    });
  }
}

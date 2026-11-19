import { EASES, valueAt, type Bez, type EaseType, type Key, type Prop } from '../../motion/keys';
import { forEachProp, propByPath, propLabel, type Clip } from '../../motion/model';
import { h } from '../dom';
import { MI } from './icons';
import type { MotionStudio } from './MotionStudio';

type Drag = { kind: 'key'; i: number; x0: number; y0: number; t0: number; v0: number } | { kind: 'handle'; i: number; which: 0 | 1 } | { kind: 'scrub' } | null;

/**
 * Editor de curvas: la propiedad elegida como gráfica valor/tiempo. Se arrastran
 * los keyframes (tiempo y valor) y, en los tramos Bézier, sus dos manejadores; se
 * cambia la curva de cada tramo (lineal, suave, acelerar, frenar, Bézier, rebasar,
 * rebote, elástico, mantener).
 */
export class MCurves {
  readonly el: HTMLElement;
  private canvas = document.createElement('canvas');
  private propSel: HTMLSelectElement;
  private easeBar: HTMLElement;
  private info: HTMLElement;
  private selKey = -1;
  private drag: Drag = null;
  private raf = 0;
  onBack: () => void = () => {};

  constructor(private s: MotionStudio) {
    this.propSel = h('select', { class: 'mo-sel', 'aria-label': 'Propiedad' });
    this.propSel.addEventListener('change', () => { const c = s.one; if (c) s.focus = { clip: c.id, path: this.propSel.value }; this.selKey = -1; this.render(); });
    this.easeBar = h('div', { class: 'mo-tgroup mo-eases' });
    this.info = h('span', { class: 'mo-unit' });
    const bar = h('div', { class: 'mo-tlbar' },
      h('button', { type: 'button', class: 'btn sm', html: `${MI.timeline} Línea de tiempo`, on: { click: () => this.onBack() } }),
      this.propSel, this.easeBar, h('div', { class: 'mo-spacer' }), this.info);
    this.canvas.className = 'mo-curvecanvas';
    this.el = h('section', { class: 'mo-curves', 'aria-label': 'Editor de curvas', hidden: true }, bar, h('div', { class: 'mo-canvaswrap' }, this.canvas));
    new ResizeObserver(() => this.draw()).observe(this.el);
    s.on('select', () => { this.selKey = -1; this.render(); });
    s.on('change', () => this.render());
    s.on('time', () => this.draw());
    this.canvas.addEventListener('pointerdown', e => this.down(e));
    this.canvas.addEventListener('pointermove', e => this.move(e));
    this.canvas.addEventListener('pointerup', () => this.up());
    this.canvas.addEventListener('dblclick', e => this.dbl(e));
  }

  private get clip(): Clip | null { return this.s.one; }
  private get prop(): Prop<number> | null {
    const c = this.clip, f = this.s.focus;
    if (!c || !f || f.clip !== c.id) return null;
    const p = propByPath(c, f.path) as Prop<unknown> | null;
    return p && typeof p.v === 'number' ? (p as Prop<number>) : null;
  }

  render() {
    if (this.el.hidden || !this.s.active) return;
    const c = this.clip;
    this.propSel.replaceChildren();
    if (c) {
      const opts: [string, string][] = [];
      forEachProp(c, (p, path) => { if (typeof p.v === 'number') opts.push([path, `${propLabel(c, path)}${p.k?.length ? ` · ${p.k.length} ◆` : ''}`]); });
      // Primero las animadas.
      opts.sort((a, b) => Number(b[1].includes('◆')) - Number(a[1].includes('◆')));
      for (const [v, l] of opts) this.propSel.append(h('option', { value: v }, l));
      if (!this.s.focus || this.s.focus.clip !== c.id) this.s.focus = { clip: c.id, path: opts.find(o => o[1].includes('◆'))?.[0] ?? 'tf.x' };
      this.propSel.value = this.s.focus.path;
    }
    this.propSel.disabled = !c;
    const p = this.prop, k = p?.k?.[this.selKey];
    this.easeBar.replaceChildren(...(k && this.selKey < p!.k!.length - 1 ? EASES.map(e => h('button', { type: 'button', class: `btn xs${k.e === e.id ? ' on' : ''}`, 'aria-pressed': String(k.e === e.id), on: { click: () => this.setEase(e.id) } }, e.label.split(' (')[0])) : [h('span', { class: 'mo-unit' }, c ? (p?.k?.length ? 'Elige un keyframe para cambiar la curva del tramo siguiente.' : 'Esta propiedad no tiene keyframes: añádelos con su rombo ◇.') : 'Elige un clip.')]));
    this.info.textContent = k ? `t = ${k.t.toFixed(3)} s · valor = ${+k.v.toFixed(3)}` : '';
    this.draw();
  }

  show(on: boolean) { this.el.hidden = !on; if (on) this.render(); }

  private setEase(e: EaseType) {
    const c = this.clip, f = this.s.focus, i = this.selKey;
    if (!c || !f) return;
    this.s.edit('Curva', (_m, comp) => { const x = comp.clips.find(y => y.id === c.id); const k = x && propByPath(x, f.path)?.k?.[i]; if (k) { k.e = e; if (e === 'bezier' && !k.b) k.b = [0.42, 0, 0.58, 1]; } });
  }

  // ---------------------------------------------------------------- geometría

  private box() {
    const c = this.clip!, p = this.prop!;
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    const pad = 28;
    let lo = Infinity, hi = -Infinity;
    const N = 200;
    for (let i = 0; i <= N; i++) { const v = valueAt(p, (i / N) * c.dur); lo = Math.min(lo, v); hi = Math.max(hi, v); }
    for (const k of p.k ?? []) { lo = Math.min(lo, k.v); hi = Math.max(hi, k.v); }
    if (hi - lo < 1e-6) { lo -= 1; hi += 1; }
    const m = (hi - lo) * 0.12; lo -= m; hi += m;
    const tx = (t: number) => pad + (t / Math.max(1e-6, c.dur)) * (W - 2 * pad);
    const vy = (v: number) => H - pad - ((v - lo) / (hi - lo)) * (H - 2 * pad);
    const xt = (x: number) => ((x - pad) / (W - 2 * pad)) * c.dur;
    const yv = (y: number) => lo + ((H - pad - y) / (H - 2 * pad)) * (hi - lo);
    return { W, H, tx, vy, xt, yv, lo, hi, pad };
  }

  private handles(k: Key<number>, n: Key<number>, b: ReturnType<MCurves['box']>) {
    const bz: Bez = k.b ?? [0.42, 0, 0.58, 1];
    const dt = n.t - k.t, dv = n.v - k.v;
    return [{ x: b.tx(k.t + bz[0] * dt), y: b.vy(k.v + bz[1] * dv) }, { x: b.tx(k.t + bz[2] * dt), y: b.vy(k.v + bz[3] * dv) }];
  }

  draw() {
    if (this.raf || this.el.hidden) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.paint(); });
  }

  private paint() {
    const cv = this.canvas, wrap = cv.parentElement!;
    const W = wrap.clientWidth, H = wrap.clientHeight, dpr = devicePixelRatio || 1;
    if (W < 2 || H < 2) return;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = `${W}px`; cv.style.height = `${H}px`; }
    const g = cv.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#0f0d17'; g.fillRect(0, 0, W, H);
    const c = this.clip, p = this.prop;
    if (!c || !p) { g.fillStyle = '#8d84a8'; g.font = '13px "Instrument Sans", sans-serif'; g.fillText(c ? 'Elige una propiedad numérica.' : 'Elige un clip para ver sus curvas.', 20, 30); return; }
    const b = this.box();
    // Rejilla.
    g.strokeStyle = '#221d31'; g.lineWidth = 1; g.fillStyle = '#6f6788'; g.font = '10px "JetBrains Mono", monospace';
    for (let i = 0; i <= 4; i++) { const v = b.lo + ((b.hi - b.lo) * i) / 4, y = b.vy(v); g.beginPath(); g.moveTo(b.pad, y); g.lineTo(W - b.pad, y); g.stroke(); g.fillText(String(+v.toFixed(2)), 2, y - 2); }
    for (let i = 0; i <= 8; i++) { const t = (c.dur * i) / 8, x = b.tx(t); g.beginPath(); g.moveTo(x, b.pad / 2); g.lineTo(x, H - b.pad); g.stroke(); g.fillText(`${t.toFixed(2)}s`, x + 2, H - 8); }
    // Curva.
    g.strokeStyle = '#c3a5ff'; g.lineWidth = 2; g.beginPath();
    const N = Math.max(100, Math.round(W));
    for (let i = 0; i <= N; i++) { const t = (i / N) * c.dur, x = b.tx(t), y = b.vy(valueAt(p, t)); if (i) g.lineTo(x, y); else g.moveTo(x, y); }
    g.stroke();
    // Manejadores Bézier del tramo elegido.
    const ks = p.k ?? [];
    const k = ks[this.selKey], n = ks[this.selKey + 1];
    if (k && n && k.e === 'bezier') {
      const [h1, h2] = this.handles(k, n, b);
      g.strokeStyle = '#ffd36b'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(b.tx(k.t), b.vy(k.v)); g.lineTo(h1.x, h1.y); g.moveTo(b.tx(n.t), b.vy(n.v)); g.lineTo(h2.x, h2.y); g.stroke();
      g.fillStyle = '#ffd36b'; for (const q of [h1, h2]) { g.beginPath(); g.arc(q.x, q.y, 5, 0, Math.PI * 2); g.fill(); }
    }
    // Keyframes.
    ks.forEach((kk, i) => { const x = b.tx(kk.t), y = b.vy(kk.v); g.fillStyle = i === this.selKey ? '#ffffff' : '#ffd36b'; g.strokeStyle = '#2a1f00'; g.beginPath(); g.moveTo(x, y - 6); g.lineTo(x + 6, y); g.lineTo(x, y + 6); g.lineTo(x - 6, y); g.closePath(); g.fill(); g.stroke(); });
    // Cabezal.
    const lt = this.s.time - c.start;
    if (lt >= 0 && lt <= c.dur) { g.fillStyle = '#ff5a7a'; g.fillRect(Math.round(b.tx(lt)), 0, 1.5, H); }
  }

  // ---------------------------------------------------------------- interacción

  private pt(e: MouseEvent) { const r = this.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

  private down(e: PointerEvent) {
    const c = this.clip, p = this.prop;
    if (!c || !p) return;
    const { x, y } = this.pt(e);
    const b = this.box(), ks = p.k ?? [];
    this.canvas.setPointerCapture(e.pointerId);
    const k = ks[this.selKey], n = ks[this.selKey + 1];
    if (k && n && k.e === 'bezier') {
      const hs = this.handles(k, n, b);
      for (const w of [0, 1] as const) if (Math.hypot(hs[w].x - x, hs[w].y - y) < 8) { this.s.hist?.begin(); this.drag = { kind: 'handle', i: this.selKey, which: w }; return; }
    }
    const i = ks.findIndex(kk => Math.hypot(b.tx(kk.t) - x, b.vy(kk.v) - y) < 9);
    if (i >= 0) { this.selKey = i; this.s.hist?.begin(); this.drag = { kind: 'key', i, x0: x, y0: y, t0: ks[i].t, v0: ks[i].v }; this.render(); return; }
    // Fuera de un keyframe: elige el tramo (el keyframe a su izquierda) y mueve el cabezal.
    const t = b.xt(x);
    const seg = [...ks].reverse().findIndex(kk => kk.t <= t);
    this.selKey = seg >= 0 ? ks.length - 1 - seg : -1;
    this.drag = { kind: 'scrub' };
    this.s.seek(c.start + Math.max(0, Math.min(c.dur, t)));
    this.render();
  }

  private move(e: PointerEvent) {
    const d = this.drag, c = this.clip, f = this.s.focus;
    if (!d || !c || !f) return;
    const { x, y } = this.pt(e);
    const b = this.box();
    if (d.kind === 'scrub') { this.s.seek(c.start + Math.max(0, Math.min(c.dur, b.xt(x)))); return; }
    this.s.live((_m, comp) => {
      const cl = comp.clips.find(z => z.id === c.id);
      const p = cl && (propByPath(cl, f.path) as Prop<number> | null);
      if (!p?.k) return;
      if (d.kind === 'key') {
        const k = p.k[d.i];
        if (!k) return;
        const prev = p.k[d.i - 1], next = p.k[d.i + 1];
        let t = d.t0 + b.xt(x) - b.xt(d.x0);
        t = Math.round(t * this.s.fps) / this.s.fps;
        t = Math.max(prev ? prev.t + 1 / this.s.fps : 0, Math.min(next ? next.t - 1 / this.s.fps : c.dur, t));
        k.t = t;
        k.v = e.shiftKey ? d.v0 : d.v0 + b.yv(y) - b.yv(d.y0);
        p.v = p.k[0].v;
      } else if (d.kind === 'handle') {
        const k = p.k[d.i], n = p.k[d.i + 1];
        if (!k || !n) return;
        const bz: Bez = k.b ? [...k.b] as Bez : [0.42, 0, 0.58, 1];
        const u = Math.max(0, Math.min(1, (b.xt(x) - k.t) / (n.t - k.t || 1)));
        const v = Math.abs(n.v - k.v) > 1e-9 ? (b.yv(y) - k.v) / (n.v - k.v) : 0;
        bz[d.which * 2] = u; bz[d.which * 2 + 1] = Math.max(-2, Math.min(3, v));
        k.b = bz;
      }
    });
    this.render();
  }

  private up() {
    const d = this.drag;
    this.drag = null;
    if (d && d.kind !== 'scrub') this.s.commit(d.kind === 'key' ? 'Mover keyframe' : 'Curva Bézier');
  }

  /** Doble clic en la curva: keyframe nuevo ahí con el valor de la curva. */
  private dbl(e: MouseEvent) {
    const c = this.clip, f = this.s.focus, p = this.prop;
    if (!c || !f || !p) return;
    const { x } = this.pt(e);
    const t = Math.round(Math.max(0, Math.min(c.dur, this.box().xt(x))) * this.s.fps) / this.s.fps;
    this.s.edit('Añadir keyframe', (_m, comp) => {
      const cl = comp.clips.find(z => z.id === c.id);
      const q = cl && (propByPath(cl, f.path) as Prop<number> | null);
      if (!q) return false;
      const v = valueAt(q, t);
      q.k ??= [];
      if (q.k.some(k => Math.abs(k.t - t) < 1e-4)) return false;
      q.k.push({ t, v, e: 'inout' }); q.k.sort((a, b) => a.t - b.t);
      return true;
    });
  }
}

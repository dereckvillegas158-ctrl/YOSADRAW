import type { Prop } from '../../motion/keys';
import { EASE_PRESETS } from '../../motion/keytools';
import { h } from '../../ui/dom';
import { fmtTC, menu } from '../../ui/motion/util';
import { PROP_LABELS, type Obj3 } from '../model';
import type { Studio3D } from '../Studio3D';
import { I3 } from './icons3';

const RULER = 24, ROW = 22, HEAD = 170;
type Row = { o: Obj3; path: string | null; p: Prop<unknown> | null; props: { path: string; p: Prop<unknown> }[] };

/**
 * Línea de tiempo del editor 3D: reproducir, pausar, ir de fotograma en fotograma y
 * de keyframe en keyframe; una fila por objeto elegido y otra por cada propiedad
 * animada (posición, rotación, escala, opacidad, materiales, luces, cámara). Los
 * rombos se mueven arrastrando; clic derecho para su curva o borrarlos.
 */
export class Timeline3 {
  readonly el: HTMLElement;
  private cv = document.createElement('canvas');
  private timeEl = h('span', { class: 's3-time' });
  private playBtn: HTMLButtonElement;
  private autoBtn: HTMLButtonElement;
  private pps = 80; private sx = 0; private sy = 0;
  private raf = 0;
  private drag: null | { kind: 'scrub' } | { kind: 'key'; row: Row; t0: number; x0: number; moved: boolean } = null;

  constructor(private s: Studio3D) {
    const b = (icon: string, title: string, run: () => void, cls = 'icon sm') => h('button', { type: 'button', class: cls, title, 'aria-label': title, html: icon, on: { click: run } });
    this.playBtn = b(I3.play, 'Reproducir / pausa (Espacio)', () => s.toggle());
    this.autoBtn = b('<b class="mo-rec">●</b>', 'Auto Keyframe: cada cambio crea su keyframe en el cabezal', () => { s.prefs.autoKey = !s.prefs.autoKey; s.deps.persist(); this.sync(); s.emitView(); });
    const ease = h('select', { class: 'mo-sel', 'aria-label': 'Curva', title: 'Curva de los keyframes del cabezal (en los objetos elegidos)' }, h('option', { value: '' }, 'Curva…'), ...EASE_PRESETS.map(e => h('option', { value: e.id }, e.label)), h('option', { value: 'bezier' }, 'Bézier'), h('option', { value: 'auto' }, 'Suavizado automático (todos)'));
    ease.addEventListener('change', () => { const v = ease.value; ease.value = ''; if (!v) return; if (v === 'auto') s.easeKeys('smooth', true); else if (v === 'bezier') s.easeKeys({ e: 'bezier', b: [0.42, 0, 0.58, 1] }); else { const p = EASE_PRESETS.find(x => x.id === v)!; s.easeKeys({ e: p.e, b: p.b }); } });
    const bar = h('div', { class: 'mo-tlbar' },
      h('div', { class: 'mo-tgroup' }, b(I3.first, 'Al principio', () => s.seek(0)), b(I3.prev, 'Fotograma anterior (←)', () => s.step(-1)), this.playBtn, b(I3.next, 'Fotograma siguiente (→)', () => s.step(1)), this.timeEl),
      h('div', { class: 'mo-tgroup' }, b(I3.prevKey, 'Keyframe anterior (J)', () => s.jumpKey(-1)), this.autoBtn,
        b(I3.diamondFill, 'Keyframe de transformación en los elegidos (I)', () => s.keyTransform()),
        b(`${I3.diamond}<span class="mo-minus">−</span>`, 'Quitar los keyframes del cabezal (Alt+I)', () => s.removeKeysNow()),
        b(I3.nextKey, 'Keyframe siguiente (K)', () => s.jumpKey(1))),
      h('div', { class: 'mo-tgroup' }, b(I3.keyCopy, 'Copiar los keyframes del objeto activo', () => s.copyKeys()), b(I3.keyPaste, 'Pegar keyframes en los elegidos (en el cabezal)', () => s.pasteKeys()), ease),
      h('div', { class: 'mo-spacer' }),
      h('div', { class: 'mo-tgroup' }, b(I3.fit, 'Ver toda la animación', () => this.fit())));
    this.cv.className = 'mo-tlcanvas s3-tlcanvas';
    this.el = h('section', { class: 'mo-timeline s3-timeline', 'aria-label': 'Línea de tiempo 3D' }, bar, h('div', { class: 'mo-canvaswrap' }, this.cv));
    new ResizeObserver(() => this.draw()).observe(this.el);
    for (const ev of ['change', 'select', 'time', 'open'] as const) s.on(ev, () => { this.sync(); this.draw(); });
    s.on('play', p => { this.playBtn.innerHTML = p ? I3.pause : I3.play; });
    s.on('open', () => requestAnimationFrame(() => this.fit()));
    this.cv.addEventListener('pointerdown', e => this.down(e));
    this.cv.addEventListener('pointermove', e => this.move(e));
    this.cv.addEventListener('pointerup', () => this.up());
    this.cv.addEventListener('wheel', e => { e.preventDefault(); if (e.ctrlKey) { this.pps = Math.max(5, Math.min(1000, this.pps * Math.pow(1.0015, -e.deltaY))); } else if (e.shiftKey) this.sx = Math.max(0, this.sx + e.deltaY / this.pps); else this.sy = Math.max(0, this.sy + e.deltaY); this.draw(); }, { passive: false });
    this.cv.addEventListener('contextmenu', e => { e.preventDefault(); this.context(e); });
  }
  private sync() {
    const s = this.s;
    if (!s.active) return;
    this.timeEl.textContent = `${fmtTC(s.time, s.fps)} / ${fmtTC(s.scene.dur, s.fps)}`;
    this.autoBtn.classList.toggle('on', s.prefs.autoKey);
  }
  fit() { const W = this.cv.parentElement?.clientWidth || 600; if (this.s.active) this.pps = Math.max(5, (W - HEAD - 20) / Math.max(0.5, this.s.scene.dur)); this.sx = 0; this.draw(); }
  private tToX(t: number) { return HEAD + (t - this.sx) * this.pps; }
  private xToT(x: number) { return Math.max(0, (x - HEAD) / this.pps + this.sx); }
  private rows(): Row[] {
    const s = this.s, out: Row[] = [];
    for (const o of s.selected) {
      const props = s.propsOf(o).filter(x => x.p.k?.length);
      out.push({ o, path: null, p: null, props });
      for (const x of props) out.push({ o, path: x.path, p: x.p, props: [x] });
    }
    return out;
  }
  draw() { if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.paint(); }); }
  private paint() {
    const s = this.s;
    if (!s.active) return;
    const wrap = this.cv.parentElement!, W = wrap.clientWidth, H = wrap.clientHeight, dpr = devicePixelRatio || 1;
    if (W < 2 || H < 2) return;
    if (this.cv.width !== Math.round(W * dpr) || this.cv.height !== Math.round(H * dpr)) { this.cv.width = Math.round(W * dpr); this.cv.height = Math.round(H * dpr); this.cv.style.width = `${W}px`; this.cv.style.height = `${H}px`; }
    const g = this.cv.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#0f0d17'; g.fillRect(0, 0, W, H);
    const dur = s.scene.dur;
    const xe = this.tToX(dur);
    if (xe < W) { g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(xe, RULER, W - xe, H); }
    const rows = this.rows();
    g.font = '11.5px "Instrument Sans", sans-serif'; g.textBaseline = 'middle';
    rows.forEach((r, i) => {
      const y = RULER + i * ROW - this.sy;
      if (y + ROW < RULER || y > H) return;
      g.fillStyle = r.path ? '#110f1a' : '#17132a'; g.fillRect(0, y, W, ROW - 1);
      g.fillStyle = r.path ? '#a89fc4' : '#fff';
      const label = r.path ? (PROP_LABELS[r.path.replace(/^mat\./, '')] ?? r.path) + (r.path.startsWith('mat.') ? ' (material)' : '') : r.o.name;
      g.fillText(label, r.path ? 18 : 8, y + ROW / 2, HEAD - 24);
      const times = new Set<number>();
      for (const x of r.props) for (const k of x.p.k ?? []) times.add(Math.round(k.t * 1000) / 1000);
      // Tramos entre keyframes.
      if (r.p?.k && r.p.k.length > 1) { g.strokeStyle = 'rgba(255,211,107,.45)'; g.beginPath(); g.moveTo(this.tToX(r.p.k[0].t), y + ROW / 2); g.lineTo(this.tToX(r.p.k[r.p.k.length - 1].t), y + ROW / 2); g.stroke(); }
      for (const t of times) {
        const x = this.tToX(t); if (x < HEAD - 6 || x > W + 6) continue;
        const now = Math.abs(t - s.time) < 0.5 / s.fps;
        g.fillStyle = now ? '#fff' : '#ffd36b'; g.strokeStyle = '#2a1f00';
        const rr = r.path ? 5 : 6;
        g.beginPath(); g.moveTo(x, y + ROW / 2 - rr); g.lineTo(x + rr, y + ROW / 2); g.lineTo(x, y + ROW / 2 + rr); g.lineTo(x - rr, y + ROW / 2); g.closePath(); g.fill(); g.stroke();
      }
    });
    if (!rows.length) { g.fillStyle = '#8d84a8'; g.fillText('Elige objetos para ver sus keyframes. Pulsa I (o el rombo ◆) para crear un keyframe de su posición, rotación y escala.', HEAD + 10, RULER + 20); }
    // Regla.
    g.fillStyle = '#181425'; g.fillRect(0, 0, W, RULER);
    const steps = [1 / s.fps, 2 / s.fps, 5 / s.fps, 0.5, 1, 2, 5, 10, 30, 60];
    const step = steps.find(x => x * this.pps >= 60) ?? 60;
    g.fillStyle = '#8d84a8'; g.font = '10px "JetBrains Mono", monospace'; g.textBaseline = 'top';
    for (let t = Math.floor(this.sx / step) * step; t < this.xToT(W); t += step) { const x = Math.round(this.tToX(t)); if (x < HEAD) continue; g.fillRect(x, RULER - 9, 1, 9); g.fillText(fmtTC(t, s.fps), x + 3, 4); }
    g.fillStyle = '#181425'; g.fillRect(0, 0, HEAD, H < RULER ? H : RULER);
    g.fillStyle = '#221d31'; g.fillRect(HEAD - 1, 0, 1, H);
    const xp = this.tToX(s.time);
    if (xp >= HEAD) { g.fillStyle = '#ff5a7a'; g.fillRect(Math.round(xp), 0, 1.5, H); g.beginPath(); g.moveTo(xp - 6, 0); g.lineTo(xp + 7, 0); g.lineTo(xp + 0.5, 10); g.closePath(); g.fill(); }
  }
  private pt(e: MouseEvent) { const r = this.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  private hitKey(x: number, y: number): { row: Row; t: number } | null {
    const i = Math.floor((y - RULER + this.sy) / ROW), row = this.rows()[i];
    if (!row || x < HEAD) return null;
    let best: number | null = null, bd = 7;
    for (const pr of row.props) for (const k of pr.p.k ?? []) { const d = Math.abs(this.tToX(k.t) - x); if (d < bd) { bd = d; best = k.t; } }
    return best === null ? null : { row, t: best };
  }
  private down(e: PointerEvent) {
    const s = this.s;
    if (!s.active || e.button === 2) return;
    const { x, y } = this.pt(e);
    this.cv.setPointerCapture(e.pointerId);
    const k = y > RULER ? this.hitKey(x, y) : null;
    if (k) { s.hist?.begin(); this.drag = { kind: 'key', row: k.row, t0: k.t, x0: x, moved: false }; return; }
    if (x >= HEAD) { s.pause(); this.drag = { kind: 'scrub' }; s.seek(this.xToT(x)); }
  }
  private move(e: PointerEvent) {
    const s = this.s, d = this.drag;
    if (!d) return;
    const { x } = this.pt(e);
    if (d.kind === 'scrub') { s.seek(this.xToT(x)); return; }
    if (!d.moved && Math.abs(x - d.x0) < 3) return;
    d.moved = true;
    // Mueve los keyframes de ese instante (de la propiedad o, en la fila del objeto, de todas).
    const nt = Math.max(0, Math.min(s.scene.dur, Math.round(this.xToT(x) * s.fps) / s.fps));
    s.live(() => {
      for (const pr of d.row.props) for (const k of pr.p.k ?? []) if (Math.abs(k.t - d.t0) < 1e-3) k.t = nt;
      for (const pr of d.row.props) pr.p.k?.sort((a, b) => a.t - b.t);
    });
    d.t0 = nt;
    this.draw();
  }
  private up() {
    const s = this.s, d = this.drag;
    this.drag = null;
    if (d?.kind === 'key') {
      if (!d.moved) { s.cancel(); s.seek(d.t0); return; }
      // Un keyframe que queda encima de otro lo sustituye.
      s.live(() => { for (const pr of d.row.props) if (pr.p.k) { const moved = pr.p.k.filter(k => Math.abs(k.t - d.t0) < 1e-4); const keep = moved[moved.length - 1]; pr.p.k = pr.p.k.filter(k => Math.abs(k.t - d.t0) >= 1e-4 || k === keep); } });
      s.commit('Mover keyframe');
    }
  }
  private context(e: MouseEvent) {
    const s = this.s, { x, y } = this.pt(e);
    const k = this.hitKey(x, y);
    if (!k) return;
    s.seek(k.t);
    menu(e.clientX, e.clientY, 'Keyframe', [
      ...EASE_PRESETS.map(p => ({ label: `Curva: ${p.label}`, run: () => s.easeKeys({ e: p.e, b: p.b }) })),
      { label: 'Curva: Bézier', run: () => s.easeKeys({ e: 'bezier', b: [0.42, 0, 0.58, 1] }) },
      { label: 'Suavizado automático', run: () => s.easeKeys('smooth') },
      null,
      { label: 'Copiar keyframes del objeto', run: () => s.copyKeys() },
      { label: 'Quitar los keyframes de este instante', danger: true, run: () => s.removeKeysNow() },
    ]);
  }
}

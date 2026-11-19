import { prop, setValue, valueAt } from '../../motion/keys';
import { activeClips, clipSize, isAudioOnly, mid, type Clip } from '../../motion/model';
import type { M6 } from '../../motion/render';
import { h } from '../dom';
import { MI } from './icons';
import type { MotionStudio } from './MotionStudio';
import { fmtTC } from './util';

type Pt = { x: number; y: number };
const ap = (M: M6, x: number, y: number): Pt => ({ x: M[0] * x + M[2] * y + M[4], y: M[1] * x + M[3] * y + M[5] });
function inv(M: M6): M6 {
  const d = M[0] * M[3] - M[1] * M[2] || 1e-9;
  return [M[3] / d, -M[1] / d, -M[2] / d, M[0] / d, (M[2] * M[5] - M[3] * M[4]) / d, (M[1] * M[4] - M[0] * M[5]) / d];
}

type Drag =
  | { kind: 'move'; start: Pt; base: Map<string, Pt>; inv: M6 }
  | { kind: 'scale'; c: Clip; corner: [number, number]; M: M6; anchor: Pt; sx: number; sy: number; start: Pt }
  | { kind: 'rotate'; c: Clip; center: Pt; a0: number; rot: number }
  | { kind: 'anchor'; c: Clip; M: M6; size: { w: number; h: number } }
  | { kind: 'draw'; start: Pt; cur: Pt; what: 'shape' | 'mask' }
  | null;

/**
 * Visor de YOSADRAW MOTION: muestra la composición en el cabezal y, encima, los
 * controles del clip elegido: mover, escalar (esquinas: proporcional; lados: un eje;
 * Mayús: libre), girar (Mayús: de 15 en 15°) y mover el punto de anclaje (Alt o el
 * círculo central). Con las herramientas de texto, formas o máscara se crea arrastrando.
 */
export class MViewer {
  readonly el: HTMLElement;
  private stage: HTMLElement;
  private overlay = document.createElement('canvas');
  private zoom: 'fit' | number = 'fit';
  private drag: Drag = null;
  private tc: HTMLElement;
  private playBtn: HTMLButtonElement;
  private loopBtn: HTMLButtonElement;
  private fpsLabel: HTMLElement;
  private qualitySel: HTMLSelectElement;
  private zoomSel: HTMLSelectElement;
  private crumbs: HTMLElement;

  constructor(private s: MotionStudio) {
    const view = s.view;
    view.className = 'mo-view';
    this.overlay.className = 'mo-overlay';
    this.stage = h('div', { class: 'mo-stage' }, h('div', { class: 'mo-frame' }, view, this.overlay));
    const btn = (icon: string, title: string, run: () => void) => h('button', { type: 'button', class: 'icon sm', title, 'aria-label': title, html: icon, on: { click: run } });
    this.playBtn = btn(MI.play, `Reproducir${s.keys.hint('play')}`, () => s.player.toggle());
    this.loopBtn = btn(MI.loop, 'Repetir', () => { s.prefs.loop = !s.prefs.loop; s.player.opts.loop = s.prefs.loop; this.sync(); s.deps.persist(); });
    this.tc = h('span', { class: 'mo-tc', title: 'Tiempo (h:min:s:fotograma). Pulsa para ir a un tiempo.' });
    this.tc.addEventListener('click', () => this.gotoPrompt());
    this.fpsLabel = h('span', { class: 'mo-fps' });
    this.qualitySel = h('select', { class: 'mo-sel', title: 'Calidad de la vista previa (no afecta a la exportación)', 'aria-label': 'Calidad de la vista previa' },
      ...([['auto', 'Auto'], ['1', 'Completa'], ['0.5', '1/2'], ['0.25', '1/4']] as const).map(([v, l]) => h('option', { value: v }, l)));
    this.qualitySel.addEventListener('change', () => {
      const v = this.qualitySel.value;
      s.prefs.quality = v === 'auto' ? 'auto' : Number(v) as 1;
      s.player.opts.quality = s.prefs.quality; s.player.autoScale = 1;
      s.player.invalidate(); s.deps.persist();
    });
    this.zoomSel = h('select', { class: 'mo-sel', title: 'Zoom del visor', 'aria-label': 'Zoom del visor' },
      ...([['fit', 'Ajustar'], ['0.25', '25%'], ['0.5', '50%'], ['1', '100%'], ['2', '200%']] as const).map(([v, l]) => h('option', { value: v }, l)));
    this.zoomSel.addEventListener('change', () => { this.zoom = this.zoomSel.value === 'fit' ? 'fit' : Number(this.zoomSel.value); this.layout(); });
    this.crumbs = h('div', { class: 'mo-crumbs' });
    const transport = h('div', { class: 'mo-transport' },
      h('div', { class: 'mo-tgroup' }, this.qualitySel, this.zoomSel),
      h('div', { class: 'mo-tgroup mo-tmain' },
        btn(MI.first, `Al principio${s.keys.hint('home')}`, () => s.seek(0)),
        btn(MI.prev, `Fotograma anterior${s.keys.hint('prev-frame')}`, () => s.step(-1)),
        this.playBtn,
        btn(MI.next, `Fotograma siguiente${s.keys.hint('next-frame')}`, () => s.step(1)),
        btn(MI.last, `Al final${s.keys.hint('end')}`, () => s.seek(s.comp.dur)),
        this.loopBtn),
      h('div', { class: 'mo-tgroup' }, this.fpsLabel, this.tc));
    this.el = h('section', { class: 'mo-viewer', 'aria-label': 'Visor' }, this.crumbs, this.stage, transport);
    new ResizeObserver(() => this.layout()).observe(this.stage);
    s.on('time', () => { this.showTime(); if (!s.player.playing) this.drawOverlay(); else this.overlayOff(); });
    s.on('change', () => { this.layout(); this.drawOverlay(); });
    s.on('select', () => this.drawOverlay());
    s.on('tool', () => { this.stage.dataset.tool = s.tool; this.drawOverlay(); });
    s.on('play', p => { this.playBtn.innerHTML = p ? MI.pause : MI.play; this.playBtn.title = p ? 'Pausa' : `Reproducir${s.keys.hint('play')}`; if (!p) this.drawOverlay(); });
    s.on('open', () => { this.sync(); this.layout(); });
    this.overlay.addEventListener('pointerdown', e => this.down(e));
    this.overlay.addEventListener('pointermove', e => this.move(e));
    this.overlay.addEventListener('pointerup', e => this.up(e));
    this.overlay.addEventListener('pointercancel', () => { if (this.drag) { this.drag = null; s.hist?.cancel(); } });
    this.overlay.addEventListener('dblclick', e => this.dbl(e));
    // Soltar medios de la biblioteca o del sistema en el visor: van al cabezal.
    this.stage.addEventListener('dragover', e => { e.preventDefault(); this.stage.classList.add('drop'); });
    this.stage.addEventListener('dragleave', () => this.stage.classList.remove('drop'));
    this.stage.addEventListener('drop', e => {
      e.preventDefault(); this.stage.classList.remove('drop');
      const ids = e.dataTransfer?.getData('application/x-yosa-media');
      if (ids) s.addMediaToTimeline(ids.split(','));
      else if (e.dataTransfer?.files.length) void s.importFiles([...e.dataTransfer.files], true);
    });
    window.setInterval(() => { if (s.player.playing) this.fpsLabel.textContent = `${s.player.fps} fps${s.player.opts.quality === 'auto' && s.player.autoScale < 1 ? ` · ${Math.round(s.player.autoScale * 100)}%` : ''}`; else this.fpsLabel.textContent = ''; }, 500);
  }

  sync() {
    if (!this.s.active) return;
    this.qualitySel.value = String(this.s.prefs.quality);
    this.loopBtn.classList.toggle('on', this.s.prefs.loop);
    this.loopBtn.setAttribute('aria-pressed', String(this.s.prefs.loop));
    this.showTime();
  }

  private showTime() {
    if (!this.s.active) return;
    const c = this.s.comp;
    this.tc.textContent = `${fmtTC(this.s.time, c.fps)} / ${fmtTC(c.dur, c.fps)}`;
  }

  private async gotoPrompt() {
    const { promptText } = await import('../modal');
    const v = await promptText('Ir a', fmtTC(this.s.time, this.s.fps), { label: 'Tiempo (h:min:s:fotograma o segundos)' });
    if (v === null) return;
    const p = v.split(':').map(Number);
    if (p.some(x => !Number.isFinite(x))) return;
    let t = 0;
    if (p.length === 1) t = p[0];
    else { const f = p.pop()!; t = p.reduce((a, x) => a * 60 + x, 0) + f / this.s.fps; }
    this.s.seek(t);
  }

  /** Recalcula el tamaño del visor. */
  layout() {
    if (!this.s.active) return;
    const c = this.s.comp;
    const r = this.stage.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return;
    const fit = Math.min((r.width - 24) / c.w, (r.height - 24) / c.h);
    const k = this.zoom === 'fit' ? Math.max(0.02, fit) : this.zoom / (devicePixelRatio || 1);
    const W = Math.round(c.w * k), H = Math.round(c.h * k);
    const frame = this.stage.firstElementChild as HTMLElement;
    frame.style.width = `${W}px`; frame.style.height = `${H}px`;
    frame.classList.toggle('transparent', !c.bg);
    if (Math.abs(this.s.fit - k) > 1e-4) { this.s.fit = k; this.s.player.invalidate(); }
    const dpr = devicePixelRatio || 1;
    if (this.overlay.width !== Math.round(W * dpr) || this.overlay.height !== Math.round(H * dpr)) { this.overlay.width = Math.round(W * dpr); this.overlay.height = Math.round(H * dpr); }
    // Migas: composición anidada abierta.
    const m = this.s.m;
    this.crumbs.replaceChildren();
    if (m.open !== m.main) {
      this.crumbs.append(h('button', { type: 'button', class: 'btn sm ghost', html: `${MI.back} Volver a «${m.comps.find(x => x.id === m.main)?.name ?? 'Principal'}»`, on: { click: () => this.s.openComp(m.main) } }), h('span', null, `Editando: ${c.name}`));
    }
    this.crumbs.hidden = m.open === m.main;
    this.drawOverlay();
  }

  // ---------------------------------------------------------------- controles

  /** Clips visuales visibles en el cabezal, de arriba abajo. */
  private visible(): Clip[] {
    const s = this.s, comp = s.comp;
    return activeClips(comp, s.time).filter(c => { const tr = comp.tracks.find(t => t.id === c.track); return tr && tr.kind === 'visual' && !tr.hidden && !isAudioOnly(s.m, c); }).reverse();
  }
  private matrixOf(c: Clip): { M: M6; size: { w: number; h: number } } {
    const s = this.s, comp = s.comp;
    const tr = comp.tracks.find(t => t.id === c.track);
    const size = clipSize(s.m, c, s.time - c.start);
    return { M: s.player.comp.matrix(comp, c, s.time, s.fit, tr?.parallax ?? 1, size), size };
  }
  private overlayOff() { const g = this.overlay.getContext('2d')!; g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, this.overlay.width, this.overlay.height); }

  drawOverlay() {
    const s = this.s;
    if (!s.active) return;
    const g = this.overlay.getContext('2d')!, dpr = devicePixelRatio || 1;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.overlay.width, this.overlay.height);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const d = this.drag;
    if (d?.kind === 'draw') {
      g.strokeStyle = '#c3a5ff'; g.lineWidth = 1.5; g.setLineDash([5, 4]);
      const x = Math.min(d.start.x, d.cur.x), y = Math.min(d.start.y, d.cur.y), w = Math.abs(d.cur.x - d.start.x), hh = Math.abs(d.cur.y - d.start.y);
      g.beginPath();
      if ((d.what === 'mask' && s.maskType === 'ellipse') || (d.what === 'shape' && s.shape === 'ellipse')) g.ellipse(x + w / 2, y + hh / 2, w / 2, hh / 2, 0, 0, Math.PI * 2); else g.rect(x, y, w, hh);
      g.stroke(); g.setLineDash([]);
    }
    const t = s.time;
    for (const c of s.selected) {
      if (t < c.start || t >= c.start + c.dur) continue;
      const tr = s.comp.tracks.find(x => x.id === c.track);
      if (!tr || tr.kind !== 'visual' || isAudioOnly(s.m, c)) continue;
      const { M, size } = this.matrixOf(c);
      const pts = [ap(M, 0, 0), ap(M, size.w, 0), ap(M, size.w, size.h), ap(M, 0, size.h)];
      g.lineWidth = 1.5; g.strokeStyle = '#9d6bff';
      g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath(); g.stroke();
      // Máscaras (contorno discontinuo).
      const lt = t - c.start;
      g.setLineDash([4, 3]); g.strokeStyle = '#ffd36b';
      for (const mk of c.masks) {
        const x = valueAt(mk.x, lt), y = valueAt(mk.y, lt), w = valueAt(mk.w, lt), hh = valueAt(mk.h, lt);
        g.save(); g.transform(M[0], M[1], M[2], M[3], M[4], M[5]);
        g.beginPath(); if (mk.type === 'ellipse') g.ellipse(x + w / 2, y + hh / 2, Math.abs(w / 2), Math.abs(hh / 2), 0, 0, Math.PI * 2); else g.rect(x, y, w, hh);
        g.restore(); g.stroke();
      }
      g.setLineDash([]);
      if (s.sel.size !== 1) continue;
      for (const [u, v] of HANDLES) { const p = ap(M, u * size.w, v * size.h); g.fillStyle = '#fff'; g.strokeStyle = '#6d3fe0'; g.beginPath(); g.rect(p.x - 4.5, p.y - 4.5, 9, 9); g.fill(); g.stroke(); }
      const rh = this.rotHandle(M, size);
      g.strokeStyle = '#9d6bff'; g.beginPath(); const top = ap(M, size.w / 2, 0); g.moveTo(top.x, top.y); g.lineTo(rh.x, rh.y); g.stroke();
      g.fillStyle = '#9d6bff'; g.beginPath(); g.arc(rh.x, rh.y, 5.5, 0, Math.PI * 2); g.fill();
      const a = ap(M, valueAt(c.tf.ax, lt) * size.w, valueAt(c.tf.ay, lt) * size.h);
      g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.beginPath(); g.arc(a.x, a.y, 6, 0, Math.PI * 2); g.moveTo(a.x - 10, a.y); g.lineTo(a.x + 10, a.y); g.moveTo(a.x, a.y - 10); g.lineTo(a.x, a.y + 10); g.stroke();
    }
  }

  private rotHandle(M: M6, size: { w: number; h: number }): Pt {
    const top = ap(M, size.w / 2, 0), mid = ap(M, size.w / 2, size.h / 2);
    const dx = top.x - mid.x, dy = top.y - mid.y, l = Math.hypot(dx, dy) || 1;
    return { x: top.x + (dx / l) * 28, y: top.y + (dy / l) * 28 };
  }

  private pt(e: PointerEvent | MouseEvent): Pt { const r = this.overlay.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  /** Px del visor → px de la composición (sin cámara). */
  private toComp(p: Pt): Pt { return { x: p.x / this.s.fit, y: p.y / this.s.fit }; }

  private hitClip(p: Pt): Clip | null {
    for (const c of this.visible()) {
      const { M, size } = this.matrixOf(c);
      const l = ap(inv(M), p.x, p.y);
      if (l.x >= 0 && l.y >= 0 && l.x <= size.w && l.y <= size.h) return c;
    }
    return null;
  }

  private down(e: PointerEvent) {
    const s = this.s;
    if (!s.active || e.button > 0) return;
    if (s.player.playing) s.player.pause();
    const p = this.pt(e);
    this.overlay.setPointerCapture(e.pointerId);
    if (s.tool === 'text') { const q = this.toComp(p); s.addText(q.x, q.y); s.setTool('select'); return; }
    if (s.tool === 'shape' || s.tool === 'mask') {
      if (s.tool === 'mask' && !s.one) { const c = this.hitClip(p); if (c) s.select([c.id]); else return; }
      this.drag = { kind: 'draw', start: p, cur: p, what: s.tool };
      return;
    }
    if (s.tool === 'razor') { const c = this.hitClip(p); if (c) { s.select([c.id]); s.split(); } return; }
    // Controles del clip elegido.
    const one = s.one;
    if (one && s.time >= one.start && s.time < one.start + one.dur) {
      const { M, size } = this.matrixOf(one);
      const lt = s.time - one.start;
      const a = ap(M, valueAt(one.tf.ax, lt) * size.w, valueAt(one.tf.ay, lt) * size.h);
      if (Math.hypot(p.x - a.x, p.y - a.y) < 9 || (e.altKey && this.hitClip(p)?.id === one.id)) { s.hist?.begin(); this.drag = { kind: 'anchor', c: one, M, size }; return; }
      const rh = this.rotHandle(M, size);
      if (Math.hypot(p.x - rh.x, p.y - rh.y) < 10) { s.hist?.begin(); this.drag = { kind: 'rotate', c: one, center: a, a0: Math.atan2(p.y - a.y, p.x - a.x), rot: valueAt(one.tf.rot, lt) }; return; }
      for (const [u, v] of HANDLES) {
        const q = ap(M, u * size.w, v * size.h);
        if (Math.abs(p.x - q.x) < 8 && Math.abs(p.y - q.y) < 8) {
          s.hist?.begin();
          this.drag = { kind: 'scale', c: one, corner: [u, v], M, anchor: { x: valueAt(one.tf.ax, lt) * size.w, y: valueAt(one.tf.ay, lt) * size.h }, sx: valueAt(one.tf.sx, lt), sy: valueAt(one.tf.sy, lt), start: ap(inv(M), p.x, p.y) };
          return;
        }
      }
    }
    const hit = this.hitClip(p);
    if (!hit) { s.select([]); this.drawOverlay(); return; }
    if (!s.sel.has(hit.id) || e.shiftKey || e.ctrlKey) s.select([hit.id], e.shiftKey || e.ctrlKey);
    if (s.locked(hit)) return;
    const base = new Map<string, Pt>();
    for (const c of s.selected) { const lt = s.time - c.start; base.set(c.id, { x: valueAt(c.tf.x, lt), y: valueAt(c.tf.y, lt) }); }
    const tr = s.comp.tracks.find(t => t.id === hit.track);
    s.hist?.begin();
    this.drag = { kind: 'move', start: p, base, inv: inv(s.player.comp.parentMatrix(s.comp, s.time, s.fit, tr?.parallax ?? 1)) };
  }

  private move(e: PointerEvent) {
    const d = this.drag, s = this.s;
    const p = this.pt(e);
    if (!d) { this.overlay.style.cursor = this.cursorAt(p); return; }
    if (d.kind === 'draw') { d.cur = p; this.drawOverlay(); return; }
    const set = (c: Clip, pr: { v: number; k?: unknown[] }, v: number) => setValue(pr as never, Math.max(0, Math.min(c.dur, s.time - c.start)), v as never);
    s.live(() => {
      if (d.kind === 'move') {
        const a = ap(d.inv, d.start.x, d.start.y), b = ap(d.inv, p.x, p.y);
        let dx = b.x - a.x, dy = b.y - a.y;
        if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        for (const c of s.selected) { const o = d.base.get(c.id); if (!o || s.locked(c)) continue; set(c, c.tf.x, Math.round((o.x + dx) * 10) / 10); set(c, c.tf.y, Math.round((o.y + dy) * 10) / 10); }
      } else if (d.kind === 'rotate') {
        let r = d.rot + ((Math.atan2(p.y - d.center.y, p.x - d.center.x) - d.a0) * 180) / Math.PI;
        if (e.shiftKey) r = Math.round(r / 15) * 15;
        set(d.c, d.c.tf.rot, Math.round(r * 10) / 10);
      } else if (d.kind === 'scale') {
        const l = ap(inv(d.M), p.x, p.y);
        const [u, v] = d.corner;
        const fx = Math.abs(d.start.x - d.anchor.x) > 1 ? (l.x - d.anchor.x) / (d.start.x - d.anchor.x) : 1;
        const fy = Math.abs(d.start.y - d.anchor.y) > 1 ? (l.y - d.anchor.y) / (d.start.y - d.anchor.y) : 1;
        const corner = u !== 0.5 && v !== 0.5;
        let kx = u === 0.5 ? 1 : fx, ky = v === 0.5 ? 1 : fy;
        if (corner && !e.shiftKey) { const k = Math.abs(fx) > Math.abs(fy) ? fx : fy; kx = ky = k; }
        set(d.c, d.c.tf.sx, Math.round(d.sx * kx * 1000) / 1000);
        set(d.c, d.c.tf.sy, Math.round(d.sy * ky * 1000) / 1000);
      } else if (d.kind === 'anchor') {
        const c = d.c, lt = Math.max(0, Math.min(c.dur, s.time - c.start));
        const l = ap(inv(d.M), p.x, p.y);
        const ax0 = valueAt(c.tf.ax, lt), ay0 = valueAt(c.tf.ay, lt);
        const ax = l.x / d.size.w, ay = l.y / d.size.h;
        // La imagen no se mueve: la posición compensa el cambio de anclaje.
        const P = ap(d.M, ax * d.size.w, ay * d.size.h), P0 = ap(d.M, ax0 * d.size.w, ay0 * d.size.h);
        const tr = s.comp.tracks.find(t => t.id === c.track);
        const pinv = inv(s.player.comp.parentMatrix(s.comp, s.time, s.fit, tr?.parallax ?? 1));
        const q = ap(pinv, P.x, P.y), q0 = ap(pinv, P0.x, P0.y);
        setValue(c.tf.ax, lt, Math.round(ax * 1000) / 1000); setValue(c.tf.ay, lt, Math.round(ay * 1000) / 1000);
        setValue(c.tf.x, lt, valueAt(c.tf.x, lt) + q.x - q0.x); setValue(c.tf.y, lt, valueAt(c.tf.y, lt) + q.y - q0.y);
        d.M = this.matrixOf(c).M;
      }
    });
    this.drawOverlay();
  }

  private up(e: PointerEvent) {
    const d = this.drag, s = this.s;
    this.drag = null;
    if (!d) return;
    if (d.kind === 'draw') {
      const a = this.toComp(d.start), b = this.toComp(this.pt(e));
      const w = Math.abs(b.x - a.x), hh = Math.abs(b.y - a.y);
      if (d.what === 'shape') { if (w > 3 && hh > 3) s.addShape(s.shape, (a.x + b.x) / 2, (a.y + b.y) / 2, w, hh); else s.addShape(s.shape, a.x, a.y); s.setTool('select'); }
      else {
        const c = s.one;
        if (!c || w < 3 || hh < 3) { this.drawOverlay(); return; }
        const { M } = this.matrixOf(c), I = inv(M);
        const p1 = ap(I, Math.min(d.start.x, d.cur.x), Math.min(d.start.y, d.cur.y)), p2 = ap(I, Math.max(d.start.x, d.cur.x), Math.max(d.start.y, d.cur.y));
        s.edit('Añadir máscara', () => {
          c.masks.push({ id: mid('mk'), type: s.maskType, x: prop(Math.min(p1.x, p2.x)), y: prop(Math.min(p1.y, p2.y)), w: prop(Math.abs(p2.x - p1.x)), h: prop(Math.abs(p2.y - p1.y)), feather: prop(0), invert: false, mode: 'add' });
        });
      }
      this.drawOverlay();
      return;
    }
    s.commit(d.kind === 'move' ? 'Mover' : d.kind === 'rotate' ? 'Girar' : d.kind === 'scale' ? 'Escalar' : 'Mover anclaje');
  }

  private dbl(e: MouseEvent) {
    const c = this.hitClip(this.pt(e));
    if (!c) return;
    if (c.kind === 'comp') this.s.openComp(c.comp);
    else if (c.kind === 'text') this.el.dispatchEvent(new CustomEvent('mo-edit-text', { bubbles: true, detail: c.id }));
  }

  private cursorAt(p: Pt): string {
    const s = this.s;
    if (s.tool === 'text') return 'text';
    if (s.tool !== 'select') return 'crosshair';
    const one = s.one;
    if (one && s.time >= one.start && s.time < one.start + one.dur) {
      const { M, size } = this.matrixOf(one);
      const rh = this.rotHandle(M, size);
      if (Math.hypot(p.x - rh.x, p.y - rh.y) < 10) return 'grab';
      for (const [u, v] of HANDLES) { const q = ap(M, u * size.w, v * size.h); if (Math.abs(p.x - q.x) < 8 && Math.abs(p.y - q.y) < 8) return u === 0.5 ? 'ns-resize' : v === 0.5 ? 'ew-resize' : 'nwse-resize'; }
    }
    return this.hitClip(p) ? 'move' : 'default';
  }
}

const HANDLES: [number, number][] = [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [0, 0.5]];

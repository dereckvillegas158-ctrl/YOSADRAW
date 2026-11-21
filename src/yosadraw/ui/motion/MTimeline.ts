import { EASES, setValue } from '../../motion/keys';
import {
  clipEnd, keyTimes, clone, forEachProp, moveClips, snapTo, sourceTime, splitClip, trimClip,
  type Clip, type Composition, type MediaItem, type Track,
} from '../../motion/model';
import { h, toast } from '../dom';
import { confirmDialog, promptText } from '../modal';
import { MI } from './icons';
import type { MotionStudio } from './MotionStudio';
import { fmtTC, menu, type MenuItem } from './util';

const RULER = 28;
const ROW: Record<Track['kind'], number> = { visual: 54, audio: 44 };
const HEAD_W = 156;

const COLORS: Record<string, string> = {
  video: '#6a5cff', image: '#2fa59a', svg: '#2fa59a', gif: '#2f8fa5', seq: '#2f8fa5', drawing: '#c26bff', anim: '#c26bff', audio: '#2f9e6e',
  text: '#e08a2e', shape: '#d85a9a', solid: '#7b7394', comp: '#4c7fe0',
};

type Hit = { c: Clip; zone: 'l' | 'r' | 'body' | 'key' | 'lane'; keyT?: number };
type Drag =
  | { kind: 'scrub' }
  | { kind: 'move'; x0: number; y0: number; orig: Map<string, { start: number; track: string }>; moved: boolean; anchor: Clip }
  | { kind: 'trim'; id: string; edge: 'l' | 'r'; orig: Clip; x0: number }
  | { kind: 'key'; id: string; t0: number; x0: number; orig: Map<string, { c: Clip; times: number[] }>; moved: boolean }
  | { kind: 'kmarquee'; x0: number; y0: number; x1: number; y1: number; base: Map<string, number[]> }
  | { kind: 'marquee'; x0: number; y0: number; x1: number; y1: number; base: Set<string> }
  | { kind: 'marker'; id: string }
  | { kind: 'pan'; x0: number; y0: number; sx: number; sy: number }
  | null;

/**
 * Línea de tiempo multipista de YOSADRAW MOTION (canvas: escala a horas de vídeo y
 * cientos de clips sin crear un nodo por clip). Pistas de vídeo/imagen/texto/formas
 * arriba (la de arriba se ve encima) y de audio abajo; clips con miniatura, forma de
 * onda, transiciones, velocidad y keyframes; mover (también entre pistas), recortar
 * por los bordes (en cadena con «ripple»), cortar, ajuste magnético a bordes,
 * cabezal y marcadores, selección múltiple con recuadro, zoom y desplazamiento.
 */
export class MTimeline {
  readonly el: HTMLElement;
  private canvas = document.createElement('canvas');
  private heads: HTMLElement;
  private body: HTMLElement;
  /** px por segundo y desplazamientos. */
  pps = 60;
  sx = 0;
  sy = 0;
  private drag: Drag = null;
  private keyTip = '';
  private multiBtn!: HTMLButtonElement;
  private lastX = 0;
  private snapLine: number | null = null;
  private raf = 0;
  private thumbs = new Map<string, HTMLCanvasElement | null>();
  private peaks = new Map<string, Float32Array | null>();
  private zoomIn: HTMLInputElement;
  private toolBtns = new Map<string, HTMLButtonElement>();
  private toggles = new Map<string, HTMLButtonElement>();
  /** Cambiar a las curvas (lo pone el estudio). */
  onCurves: () => void = () => {};

  constructor(private s: MotionStudio) {
    const btn = (icon: string, title: string, run: () => void, cls = 'icon sm') => h('button', { type: 'button', class: cls, title, 'aria-label': title, html: icon, on: { click: run } });
    const tool = (id: 'select' | 'razor', icon: string, title: string) => { const b = btn(icon, title, () => s.setTool(id)); this.toolBtns.set(id, b); return b; };
    const tog = (id: 'snap' | 'ripple', icon: string, title: string, run: () => void) => { const b = btn(icon, title, run); this.toggles.set(id, b); return b; };
    this.zoomIn = h('input', { type: 'range', min: '0', max: '100', step: '1', class: 'mo-zoom', 'aria-label': 'Zoom de la línea de tiempo', title: 'Zoom (Ctrl + rueda)' });
    this.zoomIn.addEventListener('input', () => this.setZoom(this.sliderToPps(Number(this.zoomIn.value))));
    const bar = h('div', { class: 'mo-tlbar' },
      h('div', { class: 'mo-tgroup' }, tool('select', MI.select, `Seleccionar y mover${s.keys.hint('tool-select')}`), tool('razor', MI.razor, `Cortar${s.keys.hint('tool-razor')}`)),
      h('div', { class: 'mo-tgroup' },
        btn(MI.split, `Dividir en el cabezal${s.keys.hint('split')}`, () => s.split()),
        btn(MI.trash, `Eliminar${s.keys.hint('delete')}`, () => s.remove()),
        btn(MI.dup, `Duplicar${s.keys.hint('duplicate')}`, () => s.duplicate())),
      h('div', { class: 'mo-tgroup' },
        tog('snap', MI.magnet, `Ajuste magnético${s.keys.hint('snap')}`, () => this.toggle('snap')),
        tog('ripple', MI.ripple, `Edición en cadena: al borrar o recortar, lo que sigue se desplaza${s.keys.hint('ripple')}`, () => this.toggle('ripple'))),
      h('div', { class: 'mo-tgroup' },
        btn(MI.keyCopy, `Copiar keyframes: los rombos elegidos o, si no hay, todos los del clip${s.keys.hint('copy')}`, () => s.copyKeyframes(s.hasKeySel ? undefined : 'all')),
        btn(MI.keyPaste, `Pegar keyframes en el cabezal del clip elegido${s.keys.hint('paste')}`, () => s.pasteKeyframes()),
        this.multiBtn = btn(MI.keyMulti, 'Selección múltiple de keyframes: cada toque en un rombo lo suma o lo quita (en PC también Mayús/Ctrl + clic, o arrastrar en la fila de rombos para un recuadro)', () => { s.keyMulti = !s.keyMulti; s.keysChanged(); }),
        btn(MI.more, 'Más acciones de keyframes', () => { const r = this.multiBtn.getBoundingClientRect(); keyMenu(s, r.left, r.bottom); })),
      h('div', { class: 'mo-tgroup' },
        btn(MI.marker, `Marcador en el cabezal${s.keys.hint('marker')}`, () => s.addMarker()),
        btn('<b class="mo-io">I</b>', `Inicio del intervalo de trabajo${s.keys.hint('range-in')}`, () => s.setRange('in')),
        btn('<b class="mo-io">O</b>', `Fin del intervalo de trabajo${s.keys.hint('range-out')}`, () => s.setRange('out'))),
      h('div', { class: 'mo-tgroup' },
        btn(`${MI.film}<span>+</span>`, 'Añadir pista de vídeo', () => s.addTrack('visual'), 'icon sm mo-addtrack'),
        btn(`${MI.audio}<span>+</span>`, 'Añadir pista de audio', () => s.addTrack('audio'), 'icon sm mo-addtrack')),
      h('div', { class: 'mo-spacer' }),
      h('div', { class: 'mo-tgroup' },
        btn(MI.curves, `Editor de curvas${s.keys.hint('curves')}`, () => this.onCurves()),
        btn(MI.zoomOut, `Alejar${s.keys.hint('zoom-out')}`, () => this.setZoom(this.pps / 1.5)), this.zoomIn,
        btn(MI.zoomIn, `Acercar${s.keys.hint('zoom-in')}`, () => this.setZoom(this.pps * 1.5)),
        btn(MI.fit, `Ver todo${s.keys.hint('zoom-fit')}`, () => this.zoomFit())));
    this.heads = h('div', { class: 'mo-heads' });
    this.canvas.className = 'mo-tlcanvas';
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('aria-label', 'Línea de tiempo');
    this.body = h('div', { class: 'mo-tlbody' }, h('div', { class: 'mo-headcol', style: { width: `${HEAD_W}px` } }, h('div', { class: 'mo-headtop' }), this.heads), h('div', { class: 'mo-canvaswrap' }, this.canvas));
    this.el = h('section', { class: 'mo-timeline', 'aria-label': 'Línea de tiempo' }, bar, this.body);
    new ResizeObserver(() => this.draw()).observe(this.body);
    s.on('change', () => { this.renderHeads(); this.draw(); });
    s.on('select', () => { this.multiBtn.classList.toggle('on', s.keyMulti); this.multiBtn.setAttribute('aria-pressed', String(s.keyMulti)); this.draw(); });
    s.on('time', t => { if (s.player.playing) this.follow(t); this.draw(); });
    s.on('tool', () => this.syncBar());
    s.on('open', () => { this.thumbs.clear(); this.peaks.clear(); this.renderHeads(); this.zoomFit(); this.syncBar(); });
    s.on('media', () => { this.thumbs.clear(); this.peaks.clear(); this.draw(); });
    const cv = this.canvas;
    cv.addEventListener('pointerdown', e => this.down(e));
    cv.addEventListener('pointermove', e => this.move(e));
    cv.addEventListener('pointerup', e => this.up(e));
    cv.addEventListener('pointercancel', () => { this.drag = null; s.hist?.cancel(); this.draw(); });
    cv.addEventListener('dblclick', e => this.dbl(e));
    cv.addEventListener('contextmenu', e => { e.preventDefault(); this.context(e); });
    cv.addEventListener('wheel', e => this.wheel(e), { passive: false });
    cv.addEventListener('dragover', e => { e.preventDefault(); });
    cv.addEventListener('drop', e => this.drop(e));
  }

  // ---------------------------------------------------------------- utilidades

  private get comp(): Composition { return this.s.comp; }
  private tToX(t: number) { return (t - this.sx) * this.pps; }
  private xToT(x: number) { return Math.max(0, x / this.pps + this.sx); }
  private rows(): { tr: Track; y: number; h: number }[] {
    let y = RULER - this.sy;
    return this.comp.tracks.map(tr => { const r = { tr, y, h: ROW[tr.kind] }; y += ROW[tr.kind]; return r; });
  }
  private rowAt(y: number) { return this.rows().find(r => y >= r.y && y < r.y + r.h) ?? null; }
  private pt(e: MouseEvent) { const r = this.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  private sliderToPps(v: number) { return 4 * Math.pow(600 / 4, v / 100); }
  private ppsToSlider(p: number) { return (Math.log(p / 4) / Math.log(600 / 4)) * 100; }

  setZoom(pps: number, aroundX?: number) {
    const W = this.canvas.clientWidth;
    const ax = aroundX ?? (this.tToX(this.s.time) >= 0 && this.tToX(this.s.time) <= W ? this.tToX(this.s.time) : W / 2);
    const t = this.xToT(ax);
    this.pps = Math.max(2, Math.min(1200, pps));
    this.sx = Math.max(0, t - ax / this.pps);
    this.zoomIn.value = String(this.ppsToSlider(this.pps));
    this.draw();
  }
  zoomFit() {
    if (!this.s.active) return;
    const W = Math.max(200, this.canvas.clientWidth || 800);
    this.pps = Math.max(2, Math.min(1200, (W - 30) / Math.max(1, this.comp.dur)));
    this.sx = 0;
    this.zoomIn.value = String(this.ppsToSlider(this.pps));
    this.draw();
  }
  private follow(t: number) {
    const W = this.canvas.clientWidth;
    const x = this.tToX(t);
    if (x > W - 40 || x < 0) { this.sx = Math.max(0, t - 40 / this.pps); }
  }
  toggle(id: 'snap' | 'ripple') {
    const s = this.s;
    if (id === 'snap') { s.m.snap = !s.m.snap; toast(s.m.snap ? 'Ajuste magnético activado' : 'Ajuste magnético desactivado'); }
    else { s.prefs.ripple = !s.prefs.ripple; s.deps.persist(); toast(s.prefs.ripple ? 'Edición en cadena: lo que sigue se desplaza' : 'Edición en cadena desactivada'); }
    this.syncBar();
  }
  private syncBar() {
    const s = this.s;
    if (!s.active) return;
    for (const [id, b] of this.toolBtns) { b.classList.toggle('on', s.tool === id); b.setAttribute('aria-pressed', String(s.tool === id)); }
    const st = { snap: s.m.snap, ripple: s.prefs.ripple };
    for (const [id, b] of this.toggles) { b.classList.toggle('on', st[id as 'snap']); b.setAttribute('aria-pressed', String(st[id as 'snap'])); }
    this.canvas.dataset.tool = s.tool;
  }

  // ---------------------------------------------------------------- cabeceras de pista

  private renderHeads() {
    const s = this.s;
    if (!s.active) return;
    this.heads.replaceChildren();
    this.heads.style.transform = `translateY(${-this.sy}px)`;
    this.syncBar();
    const solo = this.comp.tracks.some(t => t.solo);
    for (const tr of this.comp.tracks) {
      const set = (label: string, fn: (t: Track) => void) => s.edit(label, (_m, comp) => { const t = comp.tracks.find(x => x.id === tr.id); if (t) fn(t); });
      const ib = (icon: string, title: string, on: boolean, run: () => void) => h('button', { type: 'button', class: `icon xs${on ? ' on' : ''}`, title, 'aria-label': title, 'aria-pressed': String(on), html: icon, on: { click: run } });
      const name = h('span', { class: 'mo-tname', title: 'Doble clic para renombrar' }, tr.name);
      name.addEventListener('dblclick', async () => { const n = await promptText('Renombrar pista', tr.name); if (n) set('Renombrar pista', t => { t.name = n.slice(0, 40); }); });
      const row = h('div', { class: `mo-head ${tr.kind}${tr.locked ? ' locked' : ''}${solo && !tr.solo && tr.kind === 'audio' ? ' dim' : ''}`, style: { height: `${ROW[tr.kind]}px` } },
        h('span', { class: 'mo-tkind', html: tr.kind === 'visual' ? MI.film : MI.audio }), name,
        h('div', { class: 'mo-tbtns' },
          tr.kind === 'visual'
            ? ib(tr.hidden ? MI.eyeOff : MI.eye, tr.hidden ? 'Mostrar pista' : 'Ocultar pista', tr.hidden, () => set(tr.hidden ? 'Mostrar pista' : 'Ocultar pista', t => { t.hidden = !t.hidden; }))
            : ib(tr.muted ? MI.mute : MI.speaker, tr.muted ? 'Activar sonido' : 'Silenciar pista', tr.muted, () => set('Silenciar pista', t => { t.muted = !t.muted; })),
          ib(MI.solo, 'Solo (sólo suena esta pista)', tr.solo, () => set('Solo', t => { t.solo = !t.solo; })),
          ib(tr.locked ? MI.lock : MI.unlock, tr.locked ? 'Desbloquear pista' : 'Bloquear pista', tr.locked, () => set('Bloquear pista', t => { t.locked = !t.locked; }))));
      row.addEventListener('contextmenu', e => { e.preventDefault(); this.trackMenu(tr, e.clientX, e.clientY); });
      row.querySelector('.mo-tkind')!.addEventListener('click', e => this.trackMenu(tr, (e as MouseEvent).clientX, (e as MouseEvent).clientY));
      this.heads.append(row);
    }
  }

  private trackMenu(tr: Track, x: number, y: number) {
    const s = this.s;
    const comp = this.comp, i = comp.tracks.indexOf(tr);
    const same = (j: number) => comp.tracks[j]?.kind === tr.kind;
    menu(x, y, tr.name, [
      { label: 'Renombrar…', run: async () => { const n = await promptText('Renombrar pista', tr.name); if (n) s.edit('Renombrar pista', (_m, c) => { c.tracks.find(t => t.id === tr.id)!.name = n.slice(0, 40); }); } },
      { label: 'Subir', disabled: !same(i - 1), run: () => s.edit('Mover pista', (_m, c) => { const j = c.tracks.findIndex(t => t.id === tr.id); [c.tracks[j - 1], c.tracks[j]] = [c.tracks[j], c.tracks[j - 1]]; }) },
      { label: 'Bajar', disabled: !same(i + 1), run: () => s.edit('Mover pista', (_m, c) => { const j = c.tracks.findIndex(t => t.id === tr.id); [c.tracks[j + 1], c.tracks[j]] = [c.tracks[j], c.tracks[j + 1]]; }) },
      tr.kind === 'visual' ? { label: `Paralaje con la cámara: ${tr.parallax}…`, run: async () => {
        const v = await promptText('Paralaje (1 = normal, 0 = fija a la pantalla, 2 = el doble de cerca)', String(tr.parallax));
        const n = Number(v?.replace(',', '.'));
        if (v !== null && Number.isFinite(n)) s.edit('Paralaje', (_m, c) => { c.tracks.find(t => t.id === tr.id)!.parallax = Math.max(-2, Math.min(5, n)); });
      } } : null,
      { label: 'Seleccionar todos sus clips', run: () => s.select(comp.clips.filter(c => c.track === tr.id).map(c => c.id)) },
      null,
      { label: 'Eliminar pista', danger: true, disabled: comp.tracks.filter(t => t.kind === tr.kind).length < 2, run: async () => {
        const n = comp.clips.filter(c => c.track === tr.id).length;
        if (n && !(await confirmDialog('Eliminar pista', `La pista «${tr.name}» tiene ${n} ${n === 1 ? 'clip' : 'clips'}, que también se eliminarán.`, 'Eliminar', true))) return;
        s.edit('Eliminar pista', (_m, c) => { c.tracks = c.tracks.filter(t => t.id !== tr.id); c.clips = c.clips.filter(cl => cl.track !== tr.id); });
      } },
    ]);
  }

  // ---------------------------------------------------------------- dibujo

  draw() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.paint(); });
  }

  private paint() {
    const s = this.s;
    if (!s.active) return;
    const cv = this.canvas, wrap = cv.parentElement!;
    const W = wrap.clientWidth, H = wrap.clientHeight, dpr = devicePixelRatio || 1;
    if (W < 2 || H < 2) return;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = `${W}px`; cv.style.height = `${H}px`; }
    const comp = this.comp;
    const total = this.comp.tracks.reduce((a, t) => a + ROW[t.kind], 0);
    this.sy = Math.max(0, Math.min(this.sy, total - (H - RULER) + 20));
    this.heads.style.transform = `translateY(${-this.sy}px)`;
    const g = cv.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#0f0d17'; g.fillRect(0, 0, W, H);
    // Pistas.
    for (const r of this.rows()) {
      if (r.y + r.h < RULER || r.y > H) continue;
      g.fillStyle = r.tr.kind === 'audio' ? '#121a17' : '#15121f';
      g.fillRect(0, r.y, W, r.h - 1);
      if (r.tr.locked) { g.fillStyle = 'rgba(255,255,255,.035)'; for (let x = -r.h; x < W; x += 12) { g.beginPath(); g.moveTo(x, r.y + r.h); g.lineTo(x + r.h, r.y); g.lineTo(x + r.h + 5, r.y); g.lineTo(x + 5, r.y + r.h); g.fill(); } }
      g.fillStyle = '#221d31'; g.fillRect(0, r.y + r.h - 1, W, 1);
    }
    // Fin de la composición.
    const xe = this.tToX(comp.dur);
    if (xe < W) { g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(Math.max(0, xe), RULER, W, H); }
    // Clips.
    const rows = new Map(this.rows().map(r => [r.tr.id, r]));
    const t0 = this.sx, t1 = this.xToT(W);
    for (const c of comp.clips) {
      if (clipEnd(c) < t0 || c.start > t1) continue;
      const r = rows.get(c.track);
      if (!r || r.y + r.h < RULER || r.y > H) continue;
      this.paintClip(g, c, r.y + 3, r.h - 7, W);
    }
    // Marcadores (líneas).
    for (const mk of comp.markers) { const x = this.tToX(mk.t); if (x < 0 || x > W) continue; g.fillStyle = `${mk.color}55`; g.fillRect(Math.round(x), RULER, 1, H); }
    // Recuadro de selección.
    const d = this.drag;
    if (d?.kind === 'kmarquee') { g.fillStyle = 'rgba(255,211,107,.14)'; g.strokeStyle = '#ffd36b'; g.lineWidth = 1; g.setLineDash([4, 3]); const x = Math.min(d.x0, d.x1), y = Math.min(d.y0, d.y1); g.fillRect(x, y, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0)); g.strokeRect(x + 0.5, y + 0.5, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0)); g.setLineDash([]); }
    if (d?.kind === 'key' && this.keyTip) {
      // Cuánto se mueven los keyframes (en fotogramas), junto al puntero.
      g.font = '600 11px "Instrument Sans", sans-serif'; g.textBaseline = 'middle';
      const tw = g.measureText(this.keyTip).width + 10;
      g.fillStyle = 'rgba(20,16,30,.9)'; g.fillRect(this.lastX - tw / 2, RULER + 2, tw, 16);
      g.fillStyle = '#ffd36b'; g.fillText(this.keyTip, this.lastX - tw / 2 + 5, RULER + 10);
    }
    if (d?.kind === 'marquee') { g.fillStyle = 'rgba(157,107,255,.12)'; g.strokeStyle = '#9d6bff'; g.lineWidth = 1; const x = Math.min(d.x0, d.x1), y = Math.min(d.y0, d.y1); g.fillRect(x, y, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0)); g.strokeRect(x + 0.5, y + 0.5, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0)); }
    // Regla.
    this.paintRuler(g, W);
    // Línea de ajuste.
    if (this.snapLine !== null) { const x = this.tToX(this.snapLine); g.fillStyle = '#ffd36b'; g.fillRect(Math.round(x), 0, 1, H); }
    // Cabezal.
    const xp = this.tToX(s.time);
    if (xp >= -2 && xp <= W + 2) {
      g.fillStyle = '#ff5a7a'; g.fillRect(Math.round(xp), 0, 1.5, H);
      g.beginPath(); g.moveTo(xp - 6, 0); g.lineTo(xp + 7, 0); g.lineTo(xp + 7, 12); g.lineTo(xp + 0.5, 18); g.lineTo(xp - 6, 12); g.closePath(); g.fill();
    }
  }

  private paintRuler(g: CanvasRenderingContext2D, W: number) {
    const comp = this.comp;
    g.fillStyle = '#181425'; g.fillRect(0, 0, W, RULER);
    // Intervalo de trabajo.
    if (comp.range) { const a = this.tToX(comp.range[0]), b = this.tToX(comp.range[1]); g.fillStyle = 'rgba(157,107,255,.32)'; g.fillRect(a, RULER - 7, b - a, 7); g.fillStyle = 'rgba(157,107,255,.07)'; g.fillRect(a, RULER, b - a, 4000); }
    // Paso de las marcas: fotogramas o segundos según el zoom.
    const steps = [1 / comp.fps, 2 / comp.fps, 5 / comp.fps, 10 / comp.fps, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
    const step = steps.find(st => st * this.pps >= 70) ?? 3600;
    const minor = step / 5;
    g.fillStyle = '#3a3350';
    for (let t = Math.floor(this.sx / minor) * minor; t < this.xToT(W); t += minor) { const x = Math.round(this.tToX(t)); g.fillRect(x, RULER - 5, 1, 5); }
    g.fillStyle = '#8d84a8'; g.font = '10px "JetBrains Mono", monospace'; g.textBaseline = 'top';
    for (let t = Math.floor(this.sx / step) * step; t < this.xToT(W); t += step) {
      const x = Math.round(this.tToX(t));
      g.fillRect(x, RULER - 11, 1, 11);
      g.fillText(fmtTC(t, comp.fps), x + 3, 4);
    }
    for (const mk of comp.markers) {
      const x = this.tToX(mk.t);
      if (x < -8 || x > W + 8) continue;
      g.fillStyle = mk.color; g.beginPath(); g.moveTo(x, RULER - 1); g.lineTo(x - 5, RULER - 9); g.lineTo(x - 5, RULER - 15); g.lineTo(x + 5, RULER - 15); g.lineTo(x + 5, RULER - 9); g.closePath(); g.fill();
    }
    g.fillStyle = '#2d2740'; g.fillRect(0, RULER - 1, W, 1);
  }

  private paintClip(g: CanvasRenderingContext2D, c: Clip, y: number, hh: number, W: number) {
    const s = this.s;
    const md = c.kind === 'media' ? s.m.media.find(x => x.id === c.media) ?? null : null;
    const kind = c.kind === 'media' ? md?.kind ?? 'video' : c.kind;
    const x0 = this.tToX(c.start), x1 = this.tToX(clipEnd(c));
    const x = Math.max(-4, x0), w = Math.min(W + 4, x1) - x;
    if (w <= 0) return;
    const sel = s.sel.has(c.id);
    const missing = md ? s.media.missing.has(md.id) : false;
    g.save();
    g.globalAlpha = c.enabled ? 1 : 0.45;
    g.beginPath(); g.roundRect(x0 + 0.5, y, Math.max(2, x1 - x0 - 1), hh, 5);
    g.fillStyle = missing ? '#6b2a3a' : COLORS[kind] ?? '#6a5cff';
    g.fill();
    g.clip();
    // Miniatura (visuales) y forma de onda (con sonido).
    if (md && kind !== 'audio' && hh > 30) {
      const th = this.thumb(md);
      if (th) { const tw = (hh - 16) * (th.width / th.height); for (let tx = Math.max(x0, x0 + Math.floor((x - x0) / tw) * tw); tx < Math.min(x1, W); tx += tw) g.drawImage(th, tx, y + 14, tw, hh - 16); }
    }
    if (md && (md.kind === 'audio' || md.hasAudio)) this.paintWave(g, c as Extract<Clip, { kind: 'media' }>, md, x0, x1, y, hh, W, md.kind === 'audio');
    // Encabezado del clip.
    g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(x, y, w, 14);
    g.fillStyle = '#fff'; g.font = '600 10.5px "Instrument Sans", sans-serif'; g.textBaseline = 'top';
    const tags = [c.kind === 'media' && c.speed !== 1 ? `${+c.speed.toFixed(2)}×` : '', c.kind === 'media' && c.reverse ? '◀' : '', c.kind === 'media' && c.freeze !== null ? '❄' : '', c.group ? '⛓' : '', c.fx.length ? `fx${c.fx.length}` : '', c.masks.length ? '◐' : '', missing ? '¡falta!' : ''].filter(Boolean).join(' ');
    g.fillText(`${c.kind === 'text' ? `T  ${c.text.split('\n')[0]}` : c.name}${tags ? `  ${tags}` : ''}`, Math.max(x0, 0) + 5, y + 2, Math.max(10, w - 10));
    // Transiciones.
    const tri = (tx: number, tw: number, left: boolean) => { g.fillStyle = 'rgba(255,255,255,.28)'; g.beginPath(); if (left) { g.moveTo(tx, y + hh); g.lineTo(tx, y + 14); g.lineTo(tx + tw, y + 14); } else { g.moveTo(tx, y + 14); g.lineTo(tx, y + 14); g.lineTo(tx - tw, y + 14); g.lineTo(tx, y + hh); } g.closePath(); g.fill(); };
    if (c.tin.type !== 'none') tri(x0, Math.min(c.tin.dur, c.dur) * this.pps, true);
    if (c.tout.type !== 'none') tri(x1, Math.min(c.tout.dur, c.dur) * this.pps, false);
    if (c.kind === 'media' && (c.fadeIn > 0 || c.fadeOut > 0)) {
      g.strokeStyle = '#fff'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x0, y + hh); g.lineTo(x0 + c.fadeIn * this.pps, y + 14); g.lineTo(x1 - c.fadeOut * this.pps, y + 14); g.lineTo(x1, y + hh); g.stroke();
    }
    // Keyframes del clip elegido.
    if (sel) {
      const ts = new Set<number>();
      forEachProp(c, p => { for (const k of p.k ?? []) ts.add(Math.round(k.t * 1000) / 1000); });
      const ks = this.s.keySel.get(c.id) ?? [];
      g.strokeStyle = '#2a1f00';
      for (const t of ts) { g.fillStyle = ks.some(x => Math.abs(x - t) < 1e-3) ? '#ffffff' : '#ffd36b'; const kx = this.tToX(c.start + t), ky = y + hh - 7; g.beginPath(); g.moveTo(kx, ky - 5); g.lineTo(kx + 5, ky); g.lineTo(kx, ky + 5); g.lineTo(kx - 5, ky); g.closePath(); g.fill(); g.stroke(); }
    }
    g.restore();
    if (sel) { g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.roundRect(x0 + 1, y + 0.5, Math.max(2, x1 - x0 - 2), hh - 1, 5); g.stroke(); }
    // Asas de recorte.
    if (sel && x1 - x0 > 16) { g.fillStyle = '#fff'; g.fillRect(x0 + 1, y + hh / 2 - 8, 3, 16); g.fillRect(x1 - 4, y + hh / 2 - 8, 3, 16); }
  }

  private thumb(md: MediaItem): HTMLCanvasElement | null {
    if (this.thumbs.has(md.id)) return this.thumbs.get(md.id)!;
    this.thumbs.set(md.id, null);
    void this.s.media.thumb(md, 96, 54).then(t => { this.thumbs.set(md.id, t); this.draw(); }).catch(() => undefined);
    return null;
  }

  private paintWave(g: CanvasRenderingContext2D, c: Extract<Clip, { kind: 'media' }>, md: MediaItem, x0: number, x1: number, y: number, hh: number, W: number, full: boolean) {
    let pk = this.peaks.get(md.id);
    if (pk === undefined) {
      this.peaks.set(md.id, null);
      void this.s.media.peaks(md).then(p => { this.peaks.set(md.id, p); this.draw(); }).catch(() => undefined);
      return;
    }
    if (!pk) return;
    const top = full ? y + 15 : y + hh * 0.62, H = full ? hh - 16 : hh * 0.36, mid = top + H / 2;
    g.fillStyle = full ? 'rgba(255,255,255,.55)' : 'rgba(180,255,220,.55)';
    const a = Math.max(0, x0), b = Math.min(W, x1);
    for (let x = Math.floor(a); x < b; x++) {
      const lt = (x - x0) / this.pps;
      const st = sourceTime(c, lt, md.dur);
      const i = Math.floor(st * 200);
      let v = 0;
      const span = Math.max(1, Math.ceil(200 * c.speed / this.pps));
      for (let k = i; k < i + span && k < pk.length; k++) v = Math.max(v, pk[k]);
      v = Math.min(1, v * Math.max(0, c.volume.v) * 1.1);
      g.fillRect(x, mid - (v * H) / 2, 1, Math.max(1, v * H));
    }
  }

  // ---------------------------------------------------------------- interacción

  private hit(x: number, y: number): Hit | null {
    const r = this.rowAt(y);
    if (!r || y < RULER) return null;
    const t = this.xToT(x);
    const c = [...this.comp.clips].reverse().find(cl => cl.track === r.tr.id && t >= cl.start && t <= clipEnd(cl));
    if (!c) return null;
    const x0 = this.tToX(c.start), x1 = this.tToX(clipEnd(c));
    // Keyframes (fila inferior del clip elegido).
    if (this.s.sel.has(c.id) && y > r.y + r.h - 18) {
      let best: number | undefined, bd = 7;
      forEachProp(c, p => { for (const k of p.k ?? []) { const d = Math.abs(this.tToX(c.start + k.t) - x); if (d < bd) { bd = d; best = k.t; } } });
      if (best !== undefined) return { c, zone: 'key', keyT: best };
      // Fila de rombos sin tocar ninguno: arrastrar elige keyframes con un recuadro.
      let any = false; forEachProp(c, p => { any ||= !!p.k?.length; });
      if (any) return { c, zone: 'lane' };
    }
    const edge = Math.min(8, (x1 - x0) / 4);
    if (x - x0 < edge) return { c, zone: 'l' };
    if (x1 - x < edge) return { c, zone: 'r' };
    return { c, zone: 'body' };
  }

  private snapT(t: number, exclude: Set<string>): number {
    this.snapLine = null;
    if (!this.s.m.snap) return Math.round(t * this.comp.fps) / this.comp.fps;
    const r = snapTo(this.comp, t, 8 / this.pps, exclude, this.s.time);
    if (r !== t) { this.snapLine = r; return r; }
    return Math.round(t * this.comp.fps) / this.comp.fps;
  }

  private down(e: PointerEvent) {
    const s = this.s;
    if (!s.active || e.button === 2) return;
    this.canvas.focus();
    const { x, y } = this.pt(e);
    this.canvas.setPointerCapture(e.pointerId);
    if (y < RULER) {
      const mk = this.comp.markers.find(m => Math.abs(this.tToX(m.t) - x) < 6 && y > RULER - 16);
      if (mk) { s.hist?.begin(); this.drag = { kind: 'marker', id: mk.id }; return; }
      if (s.player.playing) s.player.pause();
      this.drag = { kind: 'scrub' }; s.seek(this.xToT(x)); return;
    }
    const hit = this.hit(x, y);
    if (s.tool === 'razor' && hit) { const t = this.snapT(this.xToT(x), new Set()); s.edit('Cortar', (m, comp) => !!splitClip(comp, m, hit.c.id, t)); this.snapLine = null; return; }
    // Táctil: arrastrar en vacío desplaza la línea de tiempo (en lugar de seleccionar con recuadro).
    if (!hit && e.pointerType === 'touch') { this.drag = { kind: 'pan', x0: x, y0: y, sx: this.sx, sy: this.sy }; return; }
    // Alt + arrastrar en vacío, o arrastrar en la fila de rombos: recuadro de keyframes.
    if ((!hit && e.altKey && s.sel.size) || hit?.zone === 'lane') {
      const add = e.shiftKey || e.ctrlKey || s.keyMulti;
      this.drag = { kind: 'kmarquee', x0: x, y0: y, x1: x, y1: y, base: add ? new Map([...s.keySel].map(([k, v]) => [k, [...v]])) : new Map() };
      if (!add) s.clearKeys();
      return;
    }
    if (!hit) { this.drag = { kind: 'marquee', x0: x, y0: y, x1: x, y1: y, base: e.shiftKey || e.ctrlKey ? new Set(s.sel) : new Set() }; if (!e.shiftKey && !e.ctrlKey) s.select([]); return; }
    if (!s.sel.has(hit.c.id) || ((e.shiftKey || e.ctrlKey) && hit.zone !== 'key')) s.select([hit.c.id], e.shiftKey || e.ctrlKey);
    if (s.locked(hit.c)) return;
    s.hist?.begin();
    if (hit.zone === 'key') {
      // Rombo: se elige (Mayús/Ctrl suma) y al arrastrar se mueven todos los elegidos del clip.
      // Mayús/Ctrl (o el modo «selección múltiple») suman o quitan; al arrastrar se mueven
      // todos los keyframes elegidos, también los de otros clips.
      const cur = s.keySel.get(hit.c.id) ?? [];
      const add = e.shiftKey || e.ctrlKey || s.keyMulti;
      const isSel = cur.some(t => Math.abs(t - hit.keyT!) < 1e-3);
      if (!isSel || add) s.selectKeys(hit.c.id, [hit.keyT!], add);
      if (!(s.keySel.get(hit.c.id) ?? []).some(t => Math.abs(t - hit.keyT!) < 1e-3)) { s.hist?.cancel(); this.draw(); return; }
      const orig = new Map<string, { c: Clip; times: number[] }>();
      for (const [id, ts] of s.keySel) { const c = this.comp.clips.find(cl => cl.id === id); if (c && ts.length) orig.set(id, { c: clone(c), times: [...ts] }); }
      this.drag = { kind: 'key', id: hit.c.id, t0: hit.keyT!, x0: x, orig, moved: false };
      return;
    }
    s.clearKeys();
    if (hit.zone === 'l' || hit.zone === 'r') { this.drag = { kind: 'trim', id: hit.c.id, edge: hit.zone, orig: clone(hit.c), x0: x }; return; }
    const orig = new Map<string, { start: number; track: string }>();
    for (const c of this.comp.clips) orig.set(c.id, { start: c.start, track: c.track });
    this.drag = { kind: 'move', x0: x, y0: y, orig, moved: false, anchor: hit.c };
  }

  private move(e: PointerEvent) {
    const s = this.s, d = this.drag;
    const { x, y } = this.pt(e);
    this.lastX = x;
    if (!d) {
      const hit = y > RULER ? this.hit(x, y) : null;
      this.canvas.style.cursor = s.tool === 'razor' ? 'crosshair' : !hit ? 'default' : hit.zone === 'l' || hit.zone === 'r' ? 'ew-resize' : hit.zone === 'key' ? 'pointer' : 'grab';
      return;
    }
    if (d.kind === 'scrub') { s.seek(this.xToT(x)); return; }
    if (d.kind === 'pan') { this.sx = Math.max(0, d.sx - (x - d.x0) / this.pps); this.sy = Math.max(0, d.sy - (y - d.y0)); this.draw(); return; }
    if (d.kind === 'marker') { const t = this.snapT(this.xToT(x), new Set()); s.live((_m, comp) => { const mk = comp.markers.find(m => m.id === d.id); if (mk) mk.t = t; }); this.draw(); return; }
    if (d.kind === 'marquee') {
      d.x1 = x; d.y1 = y;
      const ta = this.xToT(Math.min(d.x0, x)), tb = this.xToT(Math.max(d.x0, x));
      const rows = this.rows().filter(r => r.y + r.h > Math.min(d.y0, y) && r.y < Math.max(d.y0, y)).map(r => r.tr.id);
      const ids = this.comp.clips.filter(c => rows.includes(c.track) && clipEnd(c) > ta && c.start < tb).map(c => c.id);
      s.sel = new Set([...d.base, ...ids]);
      s.select([...s.sel]);
      this.draw();
      return;
    }
    if (d.kind === 'move') {
      if (!d.moved && Math.hypot(x - d.x0, y - d.y0) < 4) return;
      d.moved = true;
      const ids = [...s.sel];
      const r0 = this.rowAt(d.y0), r1 = this.rowAt(y);
      const tracks = this.comp.tracks;
      let dTrack = r0 && r1 ? tracks.indexOf(r1.tr) - tracks.indexOf(r0.tr) : 0;
      s.live((_m, comp) => {
        for (const c of comp.clips) { const o = d.orig.get(c.id); if (o) { c.start = o.start; c.track = o.track; } }
        // Ajuste: el borde (inicio o final) del clip agarrado más cercano a un punto de ajuste.
        const o = d.orig.get(d.anchor.id)!;
        const raw = o.start + (x - d.x0) / this.pps;
        const excl = new Set(ids);
        const a = this.snapT(raw, excl), b = this.snapT(raw + d.anchor.dur, excl) - d.anchor.dur;
        const dt = (Math.abs(a - raw) <= Math.abs(b - raw) ? a : b) - o.start;
        if (dTrack) {
          // Sólo entre pistas del mismo tipo.
          const kinds = new Set(comp.clips.filter(c => ids.includes(c.id)).map(c => comp.tracks.find(t => t.id === c.track)!.kind));
          if (kinds.size > 1 || !r1 || !kinds.has(r1.tr.kind)) dTrack = 0;
        }
        moveClips(comp, ids, dt, dTrack);
      });
      this.draw();
      return;
    }
    if (d.kind === 'trim') {
      // Desde el borde original más lo que se movió el puntero (sin salto al agarrar).
      const edge0 = d.edge === 'l' ? d.orig.start : clipEnd(d.orig);
      const t = this.snapT(edge0 + (x - d.x0) / this.pps, new Set([d.id]));
      s.live((m, comp) => {
        const i = comp.clips.findIndex(c => c.id === d.id);
        if (i < 0) return;
        // Se parte siempre del clip original (el recorte es reversible mientras se arrastra).
        const restore = clone(d.orig);
        const delta = d.edge === 'r' ? clipEnd(comp.clips[i]) - clipEnd(restore) : 0;
        if (delta && s.prefs.ripple) for (const o of comp.clips) if (o.id !== d.id && o.track === restore.track && o.start >= clipEnd(comp.clips[i]) - 1e-6) o.start -= delta;
        comp.clips[i] = restore;
        trimClip(comp, m, d.id, d.edge, t, s.prefs.ripple);
      });
      this.draw();
      return;
    }
    if (d.kind === 'key') {
      const anchor = d.orig.get(d.id);
      if (!anchor) return;
      if (!d.moved && Math.abs(x - d.x0) < 3) return;
      d.moved = true;
      // El rombo agarrado se ajusta al cabezal, marcadores y cortes (imán) o al fotograma.
      const tAbs = anchor.c.start + d.t0;
      let dt = this.snapT(tAbs + (x - d.x0) / this.pps, new Set()) - tAbs;
      // Desplazamiento común, limitado para que ninguno salga de su clip.
      for (const { c, times } of d.orig.values()) dt = Math.max(-Math.min(...times), Math.min(c.dur - Math.max(...times), dt));
      s.live((_m, comp) => {
        for (const [id, { c: c0, times }] of d.orig) {
          const i = comp.clips.findIndex(c => c.id === id);
          if (i < 0) continue;
          const c = clone(c0);
          forEachProp(c, p => {
            if (!p.k) return;
            const moving = p.k.filter(k => times.some(t => Math.abs(k.t - t) < 1e-3));
            // Un keyframe que no se mueve y queda debajo de uno movido desaparece (como en otros editores).
            p.k = p.k.filter(k => moving.includes(k) || !moving.some(m => Math.abs(m.t + dt - k.t) < 1e-4));
            for (const k of moving) k.t += dt;
            p.k.sort((a, b) => a.t - b.t);
          });
          comp.clips[i] = c;
        }
      });
      for (const [id, { times }] of d.orig) s.keySel.set(id, times.map(t => t + dt));
      this.keyTip = `${dt >= 0 ? '+' : '−'}${Math.round(Math.abs(dt) * this.comp.fps)} f`;
      this.draw();
    }
    if (d.kind === 'kmarquee') {
      d.x1 = x; d.y1 = y;
      const xa = Math.min(d.x0, x), xb = Math.max(d.x0, x), ya = Math.min(d.y0, y), yb = Math.max(d.y0, y);
      const next = new Map([...d.base].map(([k, v]) => [k, [...v]]));
      for (const r of this.rows()) {
        const ky = r.y + r.h - 7;
        if (ky < ya - 5 || ky > yb + 5) continue;
        for (const c of this.comp.clips) {
          if (c.track !== r.tr.id || !s.sel.has(c.id)) continue;
          for (const t of keyTimes(c)) {
            const kx = this.tToX(c.start + t);
            if (kx < xa - 5 || kx > xb + 5) continue;
            const cur = next.get(c.id) ?? [];
            if (!cur.some(v => Math.abs(v - t) < 1e-3)) cur.push(t);
            next.set(c.id, cur);
          }
        }
      }
      s.keySel = next;
      this.draw();
      return;
    }
  }

  private up(_e: PointerEvent) {
    const s = this.s, d = this.drag;
    this.drag = null;
    this.snapLine = null;
    if (!d) return;
    if (d.kind === 'move') { if (d.moved) s.commit('Mover clips'); else { s.hist?.cancel(); if (!_e.shiftKey && !_e.ctrlKey) s.select([d.anchor.id]); } }
    else if (d.kind === 'trim') s.commit('Recortar');
    else if (d.kind === 'key') { this.keyTip = ''; if (d.moved) s.commit(s.keyCount > 1 ? `Mover ${s.keyCount} keyframes` : 'Mover keyframe'); else { s.hist?.cancel(); s.seek(this.comp.clips.find(c => c.id === d.id)!.start + d.t0); } s.keysChanged(); }
    else if (d.kind === 'kmarquee') { s.keysChanged(); if (s.keyCount) toast(`${s.keyCount} ${s.keyCount === 1 ? 'keyframe elegido' : 'keyframes elegidos'}`); }
    else if (d.kind === 'marker') s.commit('Mover marcador');
    else if (d.kind === 'pan' && Math.abs(this.sx - d.sx) * this.pps < 4 && Math.abs(this.sy - d.sy) < 4) s.select([]);
    this.draw();
  }

  private dbl(e: MouseEvent) {
    const s = this.s;
    const { x, y } = this.pt(e);
    if (y < RULER) {
      const mk = this.comp.markers.find(m => Math.abs(this.tToX(m.t) - x) < 6);
      if (mk) void this.markerMenu(mk.id, e.clientX, e.clientY);
      return;
    }
    const hit = this.hit(x, y);
    if (!hit) return;
    if (hit.c.kind === 'comp') s.openComp(hit.c.comp);
    else if (hit.c.kind === 'text') this.el.dispatchEvent(new CustomEvent('mo-edit-text', { bubbles: true, detail: hit.c.id }));
    else if (hit.zone === 'key' && hit.keyT !== undefined) s.seek(hit.c.start + hit.keyT);
  }

  private markerMenu(id: string, x: number, y: number) {
    const s = this.s;
    const mk = this.comp.markers.find(m => m.id === id);
    if (!mk) return;
    menu(x, y, mk.name, [
      { label: 'Ir al marcador', run: () => s.seek(mk.t) },
      { label: 'Renombrar…', run: async () => { const n = await promptText('Nombre del marcador', mk.name); if (n !== null) s.edit('Renombrar marcador', (_m, c) => { c.markers.find(m => m.id === id)!.name = n.slice(0, 60); }); } },
      { label: 'Color: naranja', run: () => s.edit('Color del marcador', (_m, c) => { c.markers.find(m => m.id === id)!.color = '#ffb347'; }) },
      { label: 'Color: verde', run: () => s.edit('Color del marcador', (_m, c) => { c.markers.find(m => m.id === id)!.color = '#5fd3a5'; }) },
      { label: 'Color: azul', run: () => s.edit('Color del marcador', (_m, c) => { c.markers.find(m => m.id === id)!.color = '#5b8cff'; }) },
      null,
      { label: 'Eliminar marcador', danger: true, run: () => s.edit('Eliminar marcador', (_m, c) => { c.markers = c.markers.filter(m => m.id !== id); }) },
    ]);
  }

  private context(e: MouseEvent) {
    const s = this.s;
    const { x, y } = this.pt(e);
    if (y < RULER) { const mk = this.comp.markers.find(m => Math.abs(this.tToX(m.t) - x) < 6); if (mk) this.markerMenu(mk.id, e.clientX, e.clientY); return; }
    const hit = this.hit(x, y);
    if (!hit) {
      menu(e.clientX, e.clientY, 'Línea de tiempo', [
        { label: 'Pegar aquí', run: () => { s.seek(this.xToT(x)); s.paste(); } },
        { label: 'Añadir marcador aquí', run: () => { s.seek(this.xToT(x)); s.addMarker(); } },
        { label: 'Añadir pista de vídeo', run: () => s.addTrack('visual') },
        { label: 'Añadir pista de audio', run: () => s.addTrack('audio') },
      ]);
      return;
    }
    if (!s.sel.has(hit.c.id)) s.select([hit.c.id]);
    if (hit.zone === 'key') { if (!(s.keySel.get(hit.c.id) ?? []).some(t => Math.abs(t - hit.keyT!) < 1e-3)) s.selectKeys(hit.c.id, [hit.keyT!]); keyMenu(s, e.clientX, e.clientY); return; }
    clipMenu(s, e.clientX, e.clientY, this.xToT(x));
  }

  private wheel(e: WheelEvent) {
    e.preventDefault();
    const { x } = this.pt(e);
    if (e.ctrlKey || e.metaKey) { this.setZoom(this.pps * Math.pow(1.0015, -e.deltaY), x); return; }
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) { this.sx = Math.max(0, this.sx + (e.shiftKey ? e.deltaY : e.deltaX) / this.pps); this.draw(); return; }
    this.sy = Math.max(0, this.sy + e.deltaY);
    this.draw();
  }

  private drop(e: DragEvent) {
    e.preventDefault();
    const s = this.s;
    const { x, y } = this.pt(e);
    const t = this.snapT(this.xToT(x), new Set());
    this.snapLine = null;
    const r = this.rowAt(y);
    const ids = e.dataTransfer?.getData('application/x-yosa-media');
    if (ids) s.addMediaToTimeline(ids.split(','), t, r?.tr.id);
    else if (e.dataTransfer?.files.length) void s.importFiles([...e.dataTransfer.files], true, t, r?.tr.id);
  }
}

/** Elegir keyframes (menús de PC y teléfono). */
export function keySelectItems(s: MotionStudio): MenuItem[] {
  return [
    { label: s.keyMulti ? '✓ Selección múltiple (cada toque suma o quita)' : 'Selección múltiple (cada toque suma o quita)', run: () => { s.keyMulti = !s.keyMulti; s.keysChanged(); toast(s.keyMulti ? 'Selección múltiple: toca varios rombos para elegirlos' : 'Selección múltiple desactivada'); } },
    { label: 'Elegir todos los keyframes del clip', disabled: !s.sel.size, run: () => s.selectAllKeys() },
    { label: 'Elegir los keyframes del cabezal', run: () => s.selectKeysAtPlayhead() },
    { label: 'Invertir la selección', disabled: !s.sel.size, run: () => s.invertKeySel() },
    { label: 'Quitar la selección de keyframes', disabled: !s.hasKeySel, run: () => s.clearKeys() },
  ];
}

/** Acciones sobre los keyframes elegidos (menús de PC y teléfono). */
export function keyEditItems(s: MotionStudio): MenuItem[] {
  const n = s.keyCount, none = !n;
  return [
    { label: n ? `Copiar ${n === 1 ? 'el keyframe' : `los ${n} keyframes`}` : 'Copiar todos los keyframes del clip', disabled: none && !s.one, run: () => s.copyKeyframes(n ? undefined : 'all') },
    { label: 'Pegar keyframes en el cabezal', disabled: !s.hasKeyClip || !s.sel.size, run: () => s.pasteKeyframes() },
    { label: 'Duplicar en el cabezal', disabled: none, run: () => s.duplicateKeys() },
    { label: 'Llevar al cabezal', disabled: none, run: () => s.keysToPlayhead() },
    { label: 'Mover 1 fotograma ←', disabled: none, run: () => s.nudgeKeys(-1) },
    { label: 'Mover 1 fotograma →', disabled: none, run: () => s.nudgeKeys(1) },
    { label: 'Invertir (la animación va al revés)', disabled: n < 2, run: () => s.reverseKeys() },
    { label: 'Estirar el tiempo ×2 (más lento)', disabled: n < 2, run: () => s.stretchKeys(2) },
    { label: 'Comprimir el tiempo ×½ (más rápido)', disabled: n < 2, run: () => s.stretchKeys(0.5) },
    { label: 'Cambiar la duración…', disabled: n < 2, run: () => void stretchPrompt(s) },
    { label: 'Repartir a la misma distancia', disabled: n < 3, run: () => s.distributeKeys() },
    { label: 'Borrar', danger: true, disabled: none, run: () => s.deleteKeyframes() },
  ];
}

async function stretchPrompt(s: MotionStudio) {
  const v = await promptText('Duración de los keyframes elegidos', '100', { label: 'Porcentaje del tiempo actual (200 = el doble de lento, 50 = el doble de rápido)', ok: 'Aplicar' });
  const k = Number(String(v ?? '').replace(',', '.').replace('%', '')) / 100;
  if (v !== null && Number.isFinite(k) && k > 0 && k !== 1) s.stretchKeys(Math.min(20, k));
}

/** Menú de los keyframes elegidos. */
export function keyMenu(s: MotionStudio, x: number, y: number) {
  const n = s.keyCount;
  menu(x, y, `${n} ${n === 1 ? 'keyframe' : 'keyframes'}`, [
    ...keyEditItems(s),
    null,
    ...keySelectItems(s),
    null,
    ...EASES.map(e => ({ label: `Curva: ${e.label}`, run: () => s.easeKeyframes(e.id) })),
  ]);
}

/** Menú de acciones de los clips elegidos (línea de tiempo y teléfono). */
export function clipMenu(s: MotionStudio, x: number, y: number, at = s.time) {
  const c = s.one;
  const md = c?.kind === 'media' ? s.m.media.find(m => m.id === c.media) : null;
  const n = s.sel.size;
  menu(x, y, n === 1 ? c!.name : `${n} clips`, [
    { label: 'Dividir en el cabezal', run: () => s.split() },
    { label: 'Dividir aquí', disabled: !c, run: () => s.split(at) },
    { label: 'Duplicar', run: () => s.duplicate() },
    { label: 'Copiar', run: () => s.copy() },
    { label: 'Cortar', run: () => s.copy(true) },
    null,
    { label: 'Copiar todos sus keyframes', disabled: !c, run: () => s.copyKeyframes('all') },
    { label: 'Pegar keyframes en el cabezal', disabled: !s.hasKeyClip, run: () => s.pasteKeyframes() },
    null,
    { label: 'Copiar atributos', disabled: !c, run: () => s.copyAttributes() },
    { label: 'Pegar atributos', disabled: !s.hasAttrs, run: () => s.pasteAttributes() },
    null,
    { label: n > 1 ? 'Agrupar / desagrupar' : 'Desagrupar', disabled: n < 2 && !c?.group, run: () => (n > 1 ? s.group() : s.edit('Desagrupar', () => { c!.group = null; })) },
    { label: 'Precomponer (composición anidada)', run: () => s.precompose() },
    c?.kind === 'comp' ? { label: 'Abrir composición', run: () => s.openComp(c.comp) } : null,
    md?.kind === 'video' ? { label: 'Congelar fotograma en el cabezal', run: () => s.freeze() } : null,
    c?.kind === 'media' && md && (md.kind === 'video' || md.kind === 'audio') ? { label: c.reverse ? 'Reproducir hacia delante' : 'Invertir (reproducir al revés)', run: () => s.edit('Invertir', () => { (c as { reverse: boolean }).reverse = !(c as { reverse: boolean }).reverse; }) } : null,
    md?.kind === 'video' && md.hasAudio ? { label: 'Separar el audio a otra pista', run: () => detachAudio(s) } : null,
    { label: c?.enabled === false ? 'Activar clip' : 'Desactivar clip', run: () => s.edit('Activar / desactivar', () => { const on = !s.selected.every(x => x.enabled); for (const x of s.selected) x.enabled = on; }) },
    null,
    { label: 'Eliminar', danger: true, run: () => s.remove(false) },
    { label: 'Eliminar y cerrar hueco', danger: true, run: () => s.remove(true) },
  ]);
}

/** Separa el sonido de un clip de vídeo: el vídeo queda en silencio y el audio pasa a un clip propio. */
function detachAudio(s: MotionStudio) {
  const c = s.one;
  if (!c || c.kind !== 'media') return;
  s.edit('Separar audio', (_m, comp) => {
    const a = clone(c);
    a.id = `${c.id}a${Date.now().toString(36)}`;
    a.track = s.freeTrack(comp, 'audio', c.start, c.dur).id;
    a.fx = []; a.masks = []; a.tin = { type: 'none', dur: 0.5 }; a.tout = { type: 'none', dur: 0.5 };
    a.group = c.group ?? `gr${Date.now().toString(36)}`;
    c.group = a.group;
    setValue(c.volume, 0, 0);
    delete c.volume.k;
    c.volume.v = 0;
    comp.clips.push(a);
  });
  toast('Audio separado (agrupado con el vídeo: se mueven juntos)', 'ok');
}

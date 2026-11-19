import { CATEGORIES, defaults, EFFECTS, type Param } from '../../effects/effects';
import { animated, applyPreset, EASES, keyAt, MOTION_PRESETS, prop, toggleKey, valueAt, type EaseType, type Prop } from '../../motion/keys';
import {
  clipEnd, clone, compOf, forEachProp, mid, newComposition, propByPath, propLabel, setSpeed, TRANSITIONS,
  type Clip, type Composition, type FxInst, type MediaClip, type ShapeType, type TextAnim, type TransitionType,
} from '../../motion/model';
import { h, toast } from '../dom';
import { BLENDS } from '../LayersPanel';
import { confirmDialog, promptText } from '../modal';
import { MI } from './icons';
import type { MotionStudio } from './MotionStudio';
import { fmtTC, menu } from './util';

type Sync = () => void;
const FONTS = ['Outfit', 'Instrument Sans', 'JetBrains Mono', 'Arial', 'Georgia', 'Times New Roman', 'Courier New', 'Impact', 'Trebuchet MS', 'Verdana', 'Comic Sans MS', 'system-ui', 'serif', 'sans-serif', 'monospace'];

/**
 * Panel de propiedades del editor de vídeo: lo que se elige en la línea de tiempo o
 * el visor. Cada propiedad animable tiene su rombo de keyframe (vacío: sin animar;
 * contorno: animada; lleno: hay keyframe en el cabezal) y flechas para ir de uno a
 * otro. Si la propiedad está animada, cambiar el valor crea o ajusta el keyframe del
 * cabezal. Sin selección, muestra la composición (tamaño, FPS, fondo, cámara 2D).
 */
export class MInspector {
  readonly el: HTMLElement;
  private body: HTMLElement;
  private syncs: Sync[] = [];
  private tab: 'clip' | 'fx' | 'anim' = 'clip';
  private openFx = new Set<string>();

  constructor(private s: MotionStudio) {
    this.body = h('div', { class: 'mo-insp-body' });
    this.el = h('div', { class: 'mo-inspector' }, this.body);
    s.on('select', () => this.render());
    s.on('open', () => this.render());
    s.on('media', () => this.render());
    s.on('change', l => { if (l && !l.startsWith('·')) this.render(); else this.sync(); });
    s.on('time', () => { if (!s.player.playing) this.sync(); });
    this.el.addEventListener('mo-focus-text', () => (this.el.querySelector('textarea') as HTMLTextAreaElement | null)?.focus());
  }

  setTab(t: 'clip' | 'fx' | 'anim') { this.tab = t; this.render(); }
  private sync() { for (const f of this.syncs) f(); }

  render() {
    const s = this.s;
    if (!s.active) return;
    // Conserva el foco (al reconstruir tras un cambio) y el desplazamiento.
    const ae = document.activeElement as HTMLElement | null;
    const focusKey = ae && this.el.contains(ae) ? ae.dataset.k : undefined;
    const scroll = this.body.scrollTop;
    this.syncs = [];
    this.body.replaceChildren();
    const sel = s.selected;
    if (!sel.length) this.compPanel(s.comp);
    else if (sel.length > 1) this.multiPanel(sel);
    else {
      const c = sel[0];
      const tabs = h('div', { class: 'mo-tabs', role: 'tablist' }, ...([['clip', 'Clip'], ['fx', `Efectos${c.fx.length ? ` (${c.fx.length})` : ''}`], ['anim', 'Animar']] as const)
        .map(([id, l]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(this.tab === id), on: { click: () => this.setTab(id) } }, l)));
      this.body.append(tabs);
      if (this.tab === 'clip') this.clipPanel(c);
      else if (this.tab === 'fx') this.fxPanel(c);
      else this.animPanel(c);
    }
    this.body.scrollTop = scroll;
    if (focusKey) { const el = this.el.querySelector<HTMLElement>(`[data-k="${CSS.escape(focusKey)}"]`); el?.focus(); }
  }

  // ---------------------------------------------------------------- piezas

  private section(title: string, ...kids: (Node | null)[]) {
    const sec = h('details', { class: 'mo-sec', open: true }, h('summary', null, title), ...kids.filter((k): k is Node => !!k));
    this.body.append(sec);
    return sec;
  }

  /** Fila numérica animable. `k` = factor de presentación (p. ej. 100 para %). */
  private num(c: Clip | null, p: Prop, label: string, o: { min?: number; max?: number; step?: number; k?: number; unit?: string; path?: string; anim?: boolean; key: string; onSet?: (v: number) => void }) {
    const s = this.s;
    const k = o.k ?? 1, step = o.step ?? 1;
    const lt = () => (c ? Math.max(0, Math.min(c.dur, s.time - c.start)) : s.time);
    const input = h('input', { type: 'number', step: String(step), class: 'mo-num', 'data-k': o.key, 'aria-label': label });
    if (o.min !== undefined) input.min = String(o.min * k);
    if (o.max !== undefined) input.max = String(o.max * k);
    const clamp = (v: number) => Math.max(o.min ?? -Infinity, Math.min(o.max ?? Infinity, v));
    const apply = (v: number, live: boolean) => {
      v = clamp(v);
      if (o.onSet) { o.onSet(v); return; }
      if (c) s.setProp(c, p, v, live);
      else if (live) s.live(() => { setV(p, lt(), v); }); else s.edit(label, () => { setV(p, lt(), v); });
    };
    input.addEventListener('change', () => { const v = Number(input.value.replace(',', '.')) / k; if (Number.isFinite(v)) apply(v, false); });
    // Arrastrar la etiqueta cambia el valor (como en los editores de vídeo).
    const lab = h('label', { class: 'mo-lab', title: `${label}: arrastra para cambiar; clic para verla en el editor de curvas` }, label);
    lab.addEventListener('pointerdown', e => {
      const x0 = e.clientX, v0 = valueAt(p, lt());
      let moved = false;
      lab.setPointerCapture(e.pointerId);
      const mv = (ev: PointerEvent) => { const dx = ev.clientX - x0; if (Math.abs(dx) > 2) moved = true; if (moved) apply(v0 + (dx * step * (ev.shiftKey ? 10 : 1)) / k, true); };
      const up = () => { lab.removeEventListener('pointermove', mv); lab.removeEventListener('pointerup', up); if (moved) s.commit(label); else if (c && o.path) { s.focus = { clip: c.id, path: o.path }; this.el.dispatchEvent(new CustomEvent('mo-curves', { bubbles: true })); } };
      lab.addEventListener('pointermove', mv); lab.addEventListener('pointerup', up);
    });
    const kb = o.anim === false ? null : this.keyBtn(c, p, label);
    const row = h('div', { class: 'mo-prop' }, lab, input, o.unit ? h('span', { class: 'mo-unit' }, o.unit) : null, ...(kb ?? []));
    const sync = () => { if (document.activeElement !== input) { const v = valueAt(p, lt()) * k; input.value = String(Math.round(v / (step < 1 ? step : 1)) * (step < 1 ? step : 1)).slice(0, 10); } };
    this.syncs.push(sync); sync();
    return row;
  }

  /** Rombo de keyframe y flechas anterior/siguiente. */
  private keyBtn(c: Clip | null, p: Prop<unknown>, label: string): HTMLElement[] {
    const s = this.s;
    const lt = () => (c ? Math.max(0, Math.min(c.dur, s.time - c.start)) : s.time);
    const base = c ? c.start : 0;
    const b = h('button', { type: 'button', class: 'mo-key', title: `Keyframe de ${label}`, 'aria-label': `Keyframe de ${label}` });
    const prev = h('button', { type: 'button', class: 'mo-keynav', title: 'Keyframe anterior', 'aria-label': 'Keyframe anterior', html: '‹' });
    const next = h('button', { type: 'button', class: 'mo-keynav', title: 'Keyframe siguiente', 'aria-label': 'Keyframe siguiente', html: '›' });
    b.addEventListener('click', () => s.edit(keyAt(p, lt()) ? `Quitar keyframe de ${label}` : `Keyframe de ${label}`, () => { toggleKey(p, lt()); }));
    // Clic derecho (o mantener pulsado): copiar o pegar los keyframes de esta propiedad.
    if (c) b.addEventListener('contextmenu', e => {
      e.preventDefault();
      let path = '';
      forEachProp(c, (q, n) => { if (q === p) path = n; });
      if (!path) return;
      menu(e.clientX, e.clientY, label, [
        { label: `Copiar keyframes de ${label}`, disabled: !animated(p), run: () => { s.select([c.id]); s.copyKeyframes([path]); } },
        { label: `Pegar keyframes aquí (en ${label})`, disabled: !s.hasKeyClip, run: () => { s.select([c.id]); s.pasteKeyframes(path); } },
        { label: 'Pegar keyframes en sus propiedades', disabled: !s.hasKeyClip, run: () => { s.select([c.id]); s.pasteKeyframes(); } },
      ]);
    });
    prev.addEventListener('click', () => { const t = lt(); const k = [...(p.k ?? [])].reverse().find(x => x.t < t - 1e-4); if (k) s.seek(base + k.t); });
    next.addEventListener('click', () => { const t = lt(); const k = (p.k ?? []).find(x => x.t > t + 1e-4); if (k) s.seek(base + k.t); });
    const sync = () => {
      const on = !!keyAt(p, lt()), an = animated(p);
      b.innerHTML = on ? MI.diamondFill : MI.diamond;
      b.classList.toggle('animated', an); b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
      prev.hidden = next.hidden = !an;
    };
    this.syncs.push(sync); sync();
    return [prev, b, next];
  }

  private color(c: Clip | null, p: Prop<string>, label: string, key: string, anim = true) {
    const s = this.s;
    const lt = () => (c ? Math.max(0, Math.min(c.dur, s.time - c.start)) : s.time);
    const input = h('input', { type: 'color', class: 'mo-color', 'data-k': key, 'aria-label': label });
    input.addEventListener('input', () => { if (c) s.setProp(c, p, input.value, true); });
    input.addEventListener('change', () => { if (c) { s.setProp(c, p, input.value, true); s.commit(label); } });
    const row = h('div', { class: 'mo-prop' }, h('label', { class: 'mo-lab' }, label), input, ...(anim ? this.keyBtn(c, p as Prop<unknown>, label) : []));
    const sync = () => { if (document.activeElement !== input) input.value = valueAt(p, lt()); };
    this.syncs.push(sync); sync();
    return row;
  }

  /** Control simple (no animable) de un clip. */
  private plain(label: string, el: HTMLElement) { return h('div', { class: 'mo-prop' }, h('label', { class: 'mo-lab' }, label), el); }
  private select(label: string, value: string, opts: [string, string][], set: (v: string) => void, key: string) {
    const sel = h('select', { class: 'mo-sel', 'data-k': key, 'aria-label': label }, ...opts.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
    sel.addEventListener('change', () => set(sel.value));
    return this.plain(label, sel);
  }
  private check(label: string, value: boolean, set: (v: boolean) => void, key: string) {
    const cb = h('input', { type: 'checkbox', checked: value, 'data-k': key });
    cb.addEventListener('change', () => set(cb.checked));
    return h('label', { class: 'mo-prop mo-checkrow' }, cb, h('span', null, label));
  }
  private plainNum(label: string, value: number, set: (v: number) => void, key: string, o: { min?: number; max?: number; step?: number; unit?: string } = {}) {
    const input = h('input', { type: 'number', class: 'mo-num', value: String(+value.toFixed(3)), step: String(o.step ?? 1), 'data-k': key, 'aria-label': label });
    if (o.min !== undefined) input.min = String(o.min);
    if (o.max !== undefined) input.max = String(o.max);
    input.addEventListener('change', () => { const v = Number(input.value.replace(',', '.')); if (Number.isFinite(v)) set(Math.max(o.min ?? -Infinity, Math.min(o.max ?? Infinity, v))); });
    return h('div', { class: 'mo-prop' }, h('label', { class: 'mo-lab' }, label), input, o.unit ? h('span', { class: 'mo-unit' }, o.unit) : null);
  }
  private plainColor(label: string, value: string, set: (v: string) => void, key: string) {
    const input = h('input', { type: 'color', class: 'mo-color', value, 'data-k': key, 'aria-label': label });
    input.addEventListener('change', () => set(input.value));
    return this.plain(label, input);
  }
  private btns(...b: [string, () => void, string?][]) { return h('div', { class: 'mo-btnrow' }, ...b.map(([l, run, title]) => h('button', { type: 'button', class: 'btn sm', title: title ?? l, on: { click: run } }, l))); }
  /** Cambio de un campo del clip (paso de historial). */
  private set(c: Clip, label: string, fn: (c: Clip) => void) { this.s.edit(label, (_m, comp) => { const x = comp.clips.find(y => y.id === c.id); if (x) fn(x); }); }

  // ---------------------------------------------------------------- composición

  private compPanel(comp: Composition) {
    const s = this.s;
    const setC = (label: string, fn: (c: Composition) => void) => s.edit(label, m => { fn(compOf(m)); });
    const sizeW = this.plainNum('Ancho', comp.w, v => setC('Tamaño de la composición', c => { c.w = Math.round(v); }), 'cw', { min: 16, max: 8192, unit: 'px' });
    const sizeH = this.plainNum('Alto', comp.h, v => setC('Tamaño de la composición', c => { c.h = Math.round(v); }), 'ch', { min: 16, max: 8192, unit: 'px' });
    const presets = this.select('Formato', '', [['', 'Elegir…'], ['1920x1080', 'Full HD 16:9'], ['1280x720', 'HD 16:9'], ['3840x2160', '4K 16:9'], ['1080x1920', 'Vertical 9:16'], ['1080x1080', 'Cuadrado 1:1'], ['1080x1350', 'Retrato 4:5']],
      v => { if (!v) return; const [w, hh] = v.split('x').map(Number); setC('Formato de la composición', c => { c.w = w; c.h = hh; }); }, 'cfmt');
    this.section(`Composición «${comp.name}»`,
      h('div', { class: 'mo-prop' }, h('label', { class: 'mo-lab' }, 'Nombre'), (() => { const i = h('input', { type: 'text', value: comp.name, 'data-k': 'cname', maxlength: '60' }); i.addEventListener('change', () => setC('Renombrar composición', c => { c.name = i.value.trim() || c.name; })); return i; })()),
      presets, sizeW, sizeH,
      this.select('FPS', String(comp.fps), [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60].map(f => [String(f), `${f} fps`] as [string, string]).concat(([24, 25, 30, 50, 60].includes(comp.fps) || [23.976, 29.97, 48, 59.94].includes(comp.fps)) ? [] : [[String(comp.fps), `${comp.fps} fps`]]), v => setC('FPS', c => { c.fps = Number(v); }), 'cfps'),
      this.plainNum('Duración', comp.dur, v => setC('Duración', c => { c.dur = Math.max(1 / c.fps, v, ...c.clips.map(clipEnd)); }), 'cdur', { min: 0.1, step: 0.1, unit: 's' }),
      this.check('Fondo transparente', !comp.bg, v => setC('Fondo', c => { c.bg = v ? null : '#000000'; }), 'cbgt'),
      comp.bg ? this.plainColor('Fondo', comp.bg, v => setC('Fondo', c => { c.bg = v; }), 'cbg') : null,
      h('p', { class: 'ctl-help' }, `Intervalo de trabajo: ${comp.range ? `${fmtTC(comp.range[0], comp.fps)} – ${fmtTC(comp.range[1], comp.fps)}` : 'toda la composición'} (teclas I y O).`));
    // Cámara 2D.
    const cam = comp.camera;
    this.section('Cámara 2D',
      this.check('Usar cámara (las pistas con paralaje distinto se mueven a distinta velocidad)', cam.on, v => setC('Cámara', c => { c.camera.on = v; }), 'camon'),
      cam.on ? this.num(null, cam.x, 'Cámara X', { key: 'camx', unit: 'px' }) : null,
      cam.on ? this.num(null, cam.y, 'Cámara Y', { key: 'camy', unit: 'px' }) : null,
      cam.on ? this.num(null, cam.zoom, 'Zoom', { key: 'camz', k: 100, min: 0.05, max: 20, step: 1, unit: '%' }) : null,
      cam.on ? this.num(null, cam.rot, 'Giro', { key: 'camr', unit: '°' }) : null);
    // Composiciones.
    const list = h('div', { class: 'mo-comps' });
    for (const c of s.m.comps) {
      const used = s.m.comps.some(o => o.clips.some(cl => cl.kind === 'comp' && cl.comp === c.id));
      list.append(h('div', { class: `mo-comprow${c.id === s.m.open ? ' on' : ''}` },
        h('button', { type: 'button', class: 'btn sm ghost', on: { click: () => s.openComp(c.id) } }, `${c.id === s.m.main ? '★ ' : ''}${c.name}`),
        h('span', { class: 'mo-unit' }, `${c.w}×${c.h} · ${+c.dur.toFixed(2)} s`),
        c.id !== s.m.main ? h('button', { type: 'button', class: 'icon xs', title: 'Eliminar composición', 'aria-label': 'Eliminar composición', html: MI.trash, on: { click: async () => {
          if (used && !(await confirmDialog('Eliminar composición', `«${c.name}» se usa como clip en otra composición; esos clips también se eliminarán.`, 'Eliminar', true))) return;
          if (s.m.open === c.id) s.openComp(s.m.main);
          s.edit('Eliminar composición', m => { m.comps = m.comps.filter(x => x.id !== c.id); for (const o of m.comps) o.clips = o.clips.filter(cl => !(cl.kind === 'comp' && cl.comp === c.id)); });
        } } }) : null));
    }
    this.section('Composiciones', list, this.btns(['Nueva composición vacía', () => {
      s.edit('Nueva composición', m => { const c = newComposition(comp.w, comp.h, comp.fps, 5, `Composición ${m.comps.length + 1}`); c.bg = null; m.comps.push(c); });
      toast('Composición creada: ábrela para editarla y arrástrala como clip desde aquí con «Añadir como clip».');
    }], ['Añadir como clip la composición…', () => void this.addCompClip()]));
    this.section('Añadir',
      this.btns(['Texto', () => s.addText()], ['Rectángulo', () => s.addShape('rect')], ['Elipse', () => s.addShape('ellipse')], ['Estrella', () => s.addShape('star')], ['Sólido de color', () => s.addSolid()]),
      h('p', { class: 'ctl-help' }, 'Elige un clip en la línea de tiempo o en el visor para ver sus propiedades.'));
  }

  private async addCompClip() {
    const s = this.s;
    const others = s.m.comps.filter(c => c.id !== s.m.open);
    if (!others.length) { toast('Crea antes otra composición.'); return; }
    const v = await promptText(`¿Qué composición? (${others.map((c, i) => `${i + 1}: ${c.name}`).join(', ')})`, '1');
    const c = others[Number(v) - 1];
    if (!c) return;
    // No se puede meter una composición dentro de sí misma (ni en cadena).
    const contains = (a: string, b: string, d = 0): boolean => d < 10 && !!s.m.comps.find(x => x.id === a)?.clips.some(cl => cl.kind === 'comp' && (cl.comp === b || contains(cl.comp, b, d + 1)));
    if (contains(c.id, s.m.open)) { toast('Esa composición ya contiene a esta: se formaría un bucle.', 'error'); return; }
    s.edit('Añadir composición', (_m, comp) => {
      const tr = s.freeTrack(comp, 'visual', s.time, c.dur);
      comp.clips.push({ ...JSON.parse(JSON.stringify({ id: mid('cl'), track: tr.id, name: c.name, start: s.time, dur: c.dur, enabled: true, group: null, blend: 'normal', fx: [], masks: [], tin: { type: 'none', dur: 0.5 }, tout: { type: 'none', dur: 0.5 }, crop: [0, 0, 0, 0] })), tf: { x: prop(comp.w / 2), y: prop(comp.h / 2), sx: prop(Math.min(1, comp.w / c.w, comp.h / c.h)), sy: prop(Math.min(1, comp.w / c.w, comp.h / c.h)), rot: prop(0), opacity: prop(1), ax: prop(0.5), ay: prop(0.5), skx: prop(0), sky: prop(0) }, kind: 'comp', comp: c.id, in: 0, speed: 1 });
    });
  }

  // ---------------------------------------------------------------- varios clips

  private multiPanel(sel: Clip[]) {
    const s = this.s;
    const all = (label: string, fn: (c: Clip) => void) => s.edit(label, (_m, comp) => { for (const c of comp.clips) if (s.sel.has(c.id)) fn(c); });
    this.section(`${sel.length} clips elegidos`,
      this.btns(['Agrupar / desagrupar', () => s.group()], ['Precomponer', () => s.precompose()], ['Pegar atributos', () => s.pasteAttributes()]),
      this.select('Fusión', '', [['', '—'], ...BLENDS.map(b => [b.value, b.label] as [string, string])], v => { if (v) all('Modo de fusión', c => { c.blend = v as Clip['blend']; }); }, 'mblend'),
      this.select('Transición de entrada', '', [['', '—'], ...TRANSITIONS], v => { if (v) all('Transición', c => { c.tin = { type: v as TransitionType, dur: c.tin.dur }; }); }, 'mtin'),
      this.select('Transición de salida', '', [['', '—'], ...TRANSITIONS], v => { if (v) all('Transición', c => { c.tout = { type: v as TransitionType, dur: c.tout.dur }; }); }, 'mtout'),
      this.btns(['Activar todos', () => all('Activar', c => { c.enabled = true; })], ['Desactivar todos', () => all('Desactivar', c => { c.enabled = false; })]),
      this.btns(['Eliminar', () => s.remove(false)], ['Eliminar y cerrar hueco', () => s.remove(true)]));
  }

  // ---------------------------------------------------------------- clip

  private clipPanel(c: Clip) {
    const s = this.s;
    const md = c.kind === 'media' ? s.m.media.find(x => x.id === c.media) ?? null : null;
    const name = h('input', { type: 'text', value: c.name, 'data-k': 'name', maxlength: '80', 'aria-label': 'Nombre del clip' });
    name.addEventListener('change', () => this.set(c, 'Renombrar clip', x => { x.name = name.value.trim() || x.name; }));
    const fps = s.fps;
    this.section('Clip',
      this.plain('Nombre', name),
      this.plainNum('Inicio', c.start, v => this.set(c, 'Mover', x => { x.start = Math.round(v * fps) / fps; }), 'start', { min: 0, step: 1 / fps, unit: 's' }),
      this.plainNum('Duración', c.dur, v => this.set(c, 'Duración', x => { x.dur = Math.max(1 / fps, Math.round(v * fps) / fps); if (x.kind === 'media' && md && ['video', 'audio'].includes(md.kind) && !x.loop && x.freeze === null) x.dur = Math.min(x.dur, (md.dur - x.in) / x.speed); }), 'dur', { min: 1 / fps, step: 1 / fps, unit: 's' }),
      this.check('Activo (visible y audible)', c.enabled, v => this.set(c, 'Activar', x => { x.enabled = v; }), 'enabled'),
      c.kind === 'media' || c.kind === 'comp' ? this.speedRow(c, md?.dur ?? compOf(s.m, c.kind === 'comp' ? c.comp : undefined).dur) : null,
      c.kind === 'media' && md && (md.kind === 'video' || md.kind === 'audio' || md.kind === 'gif') ? this.check('Invertir (al revés)', c.reverse, v => this.set(c, 'Invertir', x => { (x as MediaClip).reverse = v; }), 'rev') : null,
      c.kind === 'media' && md && md.kind !== 'image' && md.kind !== 'svg' && md.kind !== 'drawing' ? this.check('Repetir en bucle si el clip es más largo', c.loop, v => this.set(c, 'Bucle', x => { (x as MediaClip).loop = v; }), 'loop') : null,
      c.kind === 'media' && c.freeze !== null ? h('p', { class: 'ctl-help' }, `Fotograma congelado en ${c.freeze.toFixed(2)} s del original.`) : null);

    if (c.kind === 'text') this.textPanel(c);
    if (c.kind === 'shape') this.shapePanel(c);
    if (c.kind === 'solid') this.section('Color', this.color(c, c.color, 'Color', 'solid'));

    const visual = !(md?.kind === 'audio');
    if (visual) {
      const tf = c.tf;
      this.section('Transformación',
        this.num(c, tf.x, 'Posición X', { key: 'x', path: 'tf.x', unit: 'px', step: 1 }),
        this.num(c, tf.y, 'Posición Y', { key: 'y', path: 'tf.y', unit: 'px', step: 1 }),
        this.num(c, tf.sx, 'Escala X', { key: 'sx', path: 'tf.sx', k: 100, step: 1, unit: '%' }),
        this.num(c, tf.sy, 'Escala Y', { key: 'sy', path: 'tf.sy', k: 100, step: 1, unit: '%' }),
        this.num(c, tf.rot, 'Rotación', { key: 'rot', path: 'tf.rot', unit: '°', step: 1 }),
        this.num(c, tf.opacity, 'Opacidad', { key: 'op', path: 'tf.opacity', k: 100, min: 0, max: 1, step: 1, unit: '%' }),
        this.num(c, tf.ax, 'Anclaje X', { key: 'ax', path: 'tf.ax', k: 100, step: 1, unit: '%' }),
        this.num(c, tf.ay, 'Anclaje Y', { key: 'ay', path: 'tf.ay', k: 100, step: 1, unit: '%' }),
        this.num(c, tf.skx, 'Inclinación X', { key: 'skx', path: 'tf.skx', min: -85, max: 85, unit: '°' }),
        this.num(c, tf.sky, 'Inclinación Y', { key: 'sky', path: 'tf.sky', min: -85, max: 85, unit: '°' }),
        this.btns(
          ['Centrar', () => this.set(c, 'Centrar', x => { const comp = s.comp; setNow(s, x, x.tf.x, comp.w / 2); setNow(s, x, x.tf.y, comp.h / 2); })],
          ['Ajustar', () => this.fitTo(c, 'fit'), 'Que se vea entera dentro de la composición'],
          ['Rellenar', () => this.fitTo(c, 'fill'), 'Que cubra toda la composición'],
          ['Restablecer', () => this.set(c, 'Restablecer transformación', x => { for (const p of [x.tf.rot, x.tf.skx, x.tf.sky]) { delete p.k; p.v = 0; } for (const p of [x.tf.opacity]) { delete p.k; p.v = 1; } x.tf.ax = prop(0.5); x.tf.ay = prop(0.5); })]),
        this.select('Fusión', c.blend, BLENDS.map(b => [b.value, b.label]), v => this.set(c, 'Modo de fusión', x => { x.blend = v as Clip['blend']; }), 'blend'));
      if (c.kind === 'media' || c.kind === 'comp') {
        const cr = c.crop;
        const crop = (i: number, label: string) => this.plainNum(label, Math.round(cr[i] * 100), v => this.set(c, 'Recortar', x => { x.crop[i] = Math.max(0, Math.min(0.95, v / 100)); }), `crop${i}`, { min: 0, max: 95, unit: '%' });
        this.section('Recorte', crop(0, 'Izquierda'), crop(1, 'Arriba'), crop(2, 'Derecha'), crop(3, 'Abajo'));
      }
      this.masksPanel(c);
    }
    if (c.kind === 'media' && md && (md.kind === 'audio' || md.hasAudio)) {
      this.section('Audio',
        this.num(c, c.volume, 'Volumen', { key: 'vol', path: 'volume', k: 100, min: 0, max: 4, step: 1, unit: '%' }),
        this.num(c, c.pan, 'Panorámica', { key: 'pan', path: 'pan', k: 100, min: -1, max: 1, step: 1, unit: 'I/D' }),
        this.plainNum('Fundido de entrada', c.fadeIn, v => this.set(c, 'Fundido', x => { (x as MediaClip).fadeIn = Math.min(v, x.dur); }), 'fin', { min: 0, step: 0.1, unit: 's' }),
        this.plainNum('Fundido de salida', c.fadeOut, v => this.set(c, 'Fundido', x => { (x as MediaClip).fadeOut = Math.min(v, x.dur); }), 'fout', { min: 0, step: 0.1, unit: 's' }),
        this.btns(['Silenciar', () => this.set(c, 'Silenciar', x => { const v = (x as MediaClip).volume; delete v.k; v.v = 0; })], ['Volumen 100 %', () => this.set(c, 'Volumen', x => { const v = (x as MediaClip).volume; delete v.k; v.v = 1; })]));
    }
  }

  private speedRow(c: MediaClip | Extract<Clip, { kind: 'comp' }>, srcDur: number) {
    const s = this.s;
    const sel = h('select', { class: 'mo-sel', 'data-k': 'speed', 'aria-label': 'Velocidad' }, ...[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 8].map(v => h('option', { value: String(v), selected: Math.abs(v - c.speed) < 1e-3 }, `${v}×`)), h('option', { value: 'x' }, 'Otra…'));
    if (![0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 8].some(v => Math.abs(v - c.speed) < 1e-3)) sel.prepend(h('option', { value: String(c.speed), selected: true }, `${+c.speed.toFixed(3)}×`));
    sel.addEventListener('change', async () => {
      let v = Number(sel.value);
      if (sel.value === 'x') { const t = await promptText('Velocidad (0,05 a 16)', String(c.speed)); v = Number(t?.replace(',', '.')); }
      if (!(v > 0)) { this.render(); return; }
      this.set(c, 'Velocidad', x => {
        setSpeed(x as MediaClip, v);
        // No pasar del final del origen.
        const m = x as MediaClip;
        if (!(m.kind === 'media' && m.loop) && Number.isFinite(srcDur) && srcDur > 0) m.dur = Math.min(m.dur, (srcDur - m.in) / m.speed);
      });
      void s;
    });
    return this.plain('Velocidad', sel);
  }

  private fitTo(c: Clip, mode: 'fit' | 'fill') {
    const s = this.s;
    const md = c.kind === 'media' ? s.m.media.find(x => x.id === c.media) : null;
    const w = c.kind === 'comp' ? compOf(s.m, c.comp).w : md?.w || 0, hh = c.kind === 'comp' ? compOf(s.m, c.comp).h : md?.h || 0;
    if (!w || !hh) { toast('Sólo para vídeo, imágenes y composiciones.'); return; }
    const comp = s.comp;
    const k = mode === 'fit' ? Math.min(comp.w / w, comp.h / hh) : Math.max(comp.w / w, comp.h / hh);
    this.set(c, mode === 'fit' ? 'Ajustar' : 'Rellenar', x => { setNow(s, x, x.tf.sx, k); setNow(s, x, x.tf.sy, k); setNow(s, x, x.tf.x, comp.w / 2); setNow(s, x, x.tf.y, comp.h / 2); });
  }

  private textPanel(c: Extract<Clip, { kind: 'text' }>) {
    const s = this.s;
    const ta = h('textarea', { rows: '3', 'data-k': 'text', 'aria-label': 'Texto', class: 'mo-text' }, c.text);
    ta.addEventListener('change', () => this.set(c, 'Texto', x => { const t = x as typeof c; t.text = ta.value || ' '; t.name = ta.value.split('\n')[0].slice(0, 30) || 'Texto'; }));
    const fonts = [...FONTS, ...s.m.media.filter(m => m.kind === 'font').map(m => m.name.replace(/\.[^.]+$/, ''))];
    if (!fonts.includes(c.font)) fonts.unshift(c.font);
    const st = (label: string, fn: (t: typeof c) => void) => this.set(c, label, x => fn(x as typeof c));
    this.section('Texto',
      ta,
      this.select('Fuente', c.font, fonts.map(f => [f, f]), v => st('Fuente', t => { t.font = v; }), 'font'),
      this.plainNum('Tamaño', c.size, v => st('Tamaño de letra', t => { t.size = Math.max(4, v); }), 'size', { min: 4, max: 2000, unit: 'px' }),
      this.select('Grosor', String(c.weight), [['300', 'Fino'], ['400', 'Normal'], ['600', 'Seminegrita'], ['800', 'Negrita'], ['900', 'Extra']], v => st('Grosor', t => { t.weight = Number(v); }), 'weight'),
      this.check('Cursiva', c.italic, v => st('Cursiva', t => { t.italic = v; }), 'italic'),
      this.select('Alineación', c.align, [['left', 'Izquierda'], ['center', 'Centro'], ['right', 'Derecha']], v => st('Alineación', t => { t.align = v as typeof c.align; }), 'align'),
      this.plainNum('Interlineado', c.lineH, v => st('Interlineado', t => { t.lineH = Math.max(0.5, v); }), 'lineh', { min: 0.5, max: 4, step: 0.05 }),
      this.num(c, c.spacing, 'Espaciado', { key: 'spacing', path: 'spacing', unit: 'px' }),
      this.num(c, c.bend, 'Curvatura (arco)', { key: 'bend', path: 'bend', k: 100, min: -1, max: 1, unit: '%' }),
      h('p', { class: 'ctl-help' }, 'Fuentes propias: impórtalas en la biblioteca (TTF, OTF, WOFF).'));
    this.section('Relleno y contorno',
      this.color(c, c.fill, 'Color', 'fill'),
      this.check('Degradado', c.grad.on, v => st('Degradado', t => { t.grad.on = v; }), 'gon'),
      c.grad.on ? this.color(c, c.grad.c2, 'Segundo color', 'g2') : null,
      c.grad.on ? this.plainNum('Ángulo', c.grad.angle, v => st('Degradado', t => { t.grad.angle = v; }), 'gang', { unit: '°' }) : null,
      this.check('Contorno', c.stroke.on, v => st('Contorno', t => { t.stroke.on = v; }), 'son'),
      c.stroke.on ? this.color(c, c.stroke.color, 'Color del contorno', 'sc') : null,
      c.stroke.on ? this.num(c, c.stroke.w, 'Grosor del contorno', { key: 'sw', path: 'strokeW', min: 0, max: 200, unit: 'px' }) : null,
      this.check('Sombra', c.shadow.on, v => st('Sombra', t => { t.shadow.on = v; }), 'shon'),
      c.shadow.on ? this.plainColor('Color de la sombra', c.shadow.color, v => st('Sombra', t => { t.shadow.color = v; }), 'shc') : null,
      c.shadow.on ? this.plainNum('Desenfoque', c.shadow.blur, v => st('Sombra', t => { t.shadow.blur = Math.max(0, v); }), 'shb', { min: 0, unit: 'px' }) : null,
      c.shadow.on ? this.plainNum('Desplazamiento X', c.shadow.dx, v => st('Sombra', t => { t.shadow.dx = v; }), 'shx', { unit: 'px' }) : null,
      c.shadow.on ? this.plainNum('Desplazamiento Y', c.shadow.dy, v => st('Sombra', t => { t.shadow.dy = v; }), 'shy', { unit: 'px' }) : null,
      this.check('Fondo (caja de subtítulo)', c.bg.on, v => st('Fondo del texto', t => { t.bg.on = v; }), 'bgon'),
      c.bg.on ? this.plainColor('Color del fondo', c.bg.color, v => st('Fondo del texto', t => { t.bg.color = v; }), 'bgc') : null,
      c.bg.on ? this.plainNum('Margen', c.bg.pad, v => st('Fondo del texto', t => { t.bg.pad = Math.max(0, v); }), 'bgp', { min: 0, unit: 'px' }) : null,
      c.bg.on ? this.plainNum('Redondeo', c.bg.radius, v => st('Fondo del texto', t => { t.bg.radius = Math.max(0, v); }), 'bgr', { min: 0, unit: 'px' }) : null);
    this.section('Animación del texto',
      this.select('Tipo', c.anim, [['none', 'Ninguna'], ['typewriter', 'Máquina de escribir'], ['chars-fade', 'Letras que aparecen'], ['chars-up', 'Letras que suben'], ['words-pop', 'Palabras con rebote']], v => st('Animación de texto', t => {
        t.anim = v as TextAnim;
        // Al elegir una animación, el progreso va de 0 a 1 en el primer segundo (editable).
        if (v !== 'none' && !t.reveal.k?.length) t.reveal = { v: 0, k: [{ t: 0, v: 0, e: 'linear' }, { t: Math.min(1, t.dur), v: 1, e: 'linear' }] };
      }), 'tanim'),
      c.anim !== 'none' ? this.num(c, c.reveal, 'Progreso', { key: 'reveal', path: 'reveal', k: 100, min: 0, max: 1, unit: '%' }) : null);
  }

  private shapePanel(c: Extract<Clip, { kind: 'shape' }>) {
    const st = (label: string, fn: (t: typeof c) => void) => this.set(c, label, x => fn(x as typeof c));
    this.section('Forma',
      this.select('Forma', c.shape, [['rect', 'Rectángulo'], ['ellipse', 'Elipse'], ['polygon', 'Polígono'], ['star', 'Estrella'], ['line', 'Línea'], ['arrow', 'Flecha']], v => st('Forma', t => { t.shape = v as ShapeType; }), 'shape'),
      this.num(c, c.w, 'Ancho', { key: 'w', path: 'w', min: 1, unit: 'px' }),
      this.num(c, c.h, 'Alto', { key: 'h', path: 'h', min: 1, unit: 'px' }),
      c.shape === 'rect' ? this.num(c, c.radius, 'Redondeo', { key: 'radius', path: 'radius', min: 0, unit: 'px' }) : null,
      c.shape === 'polygon' || c.shape === 'star' ? this.plainNum('Lados / puntas', c.sides, v => st('Lados', t => { t.sides = Math.max(3, Math.min(40, Math.round(v))); }), 'sides', { min: 3, max: 40 }) : null,
      c.shape === 'star' ? this.plainNum('Radio interior', Math.round(c.inner * 100), v => st('Radio interior', t => { t.inner = Math.max(0.05, Math.min(0.95, v / 100)); }), 'inner', { min: 5, max: 95, unit: '%' }) : null);
    this.section('Relleno y trazo',
      this.check('Relleno', c.fillOn, v => st('Relleno', t => { t.fillOn = v; }), 'fon'),
      c.fillOn ? this.color(c, c.fill, 'Color', 'fill') : null,
      c.fillOn ? this.check('Degradado', c.grad.on, v => st('Degradado', t => { t.grad.on = v; }), 'gon') : null,
      c.fillOn && c.grad.on ? this.color(c, c.grad.c2, 'Segundo color', 'g2') : null,
      c.fillOn && c.grad.on ? this.plainNum('Ángulo', c.grad.angle, v => st('Degradado', t => { t.grad.angle = v; }), 'gang', { unit: '°' }) : null,
      this.check('Trazo', c.strokeOn, v => st('Trazo', t => { t.strokeOn = v; }), 'son'),
      c.strokeOn ? this.color(c, c.stroke, 'Color del trazo', 'sc') : null,
      c.strokeOn ? this.num(c, c.strokeW, 'Grosor', { key: 'sw', path: 'strokeW', min: 0, max: 500, unit: 'px' }) : null,
      c.strokeOn ? this.plainNum('Discontinuo', c.dash, v => st('Discontinuo', t => { t.dash = Math.max(0, v); }), 'dash', { min: 0, unit: 'px' }) : null,
      c.strokeOn ? this.num(c, c.trim, 'Trazado (dibujar el contorno)', { key: 'trim', path: 'trim', k: 100, min: 0, max: 1, unit: '%' }) : null);
  }

  private masksPanel(c: Clip) {
    const s = this.s;
    const list = h('div', { class: 'mo-masks' });
    c.masks.forEach((mk, i) => {
      const sm = (label: string, fn: (m: typeof mk) => void) => this.set(c, label, x => { const m = x.masks.find(y => y.id === mk.id); if (m) fn(m); });
      list.append(h('div', { class: 'mo-mask' },
        h('div', { class: 'mo-maskhead' }, h('strong', null, `Máscara ${i + 1}`),
          h('select', { class: 'mo-sel', 'aria-label': 'Forma de la máscara', on: { change: (e: Event) => sm('Máscara', m => { m.type = (e.target as HTMLSelectElement).value as 'rect'; }) } }, h('option', { value: 'rect', selected: mk.type === 'rect' }, 'Rectángulo'), h('option', { value: 'ellipse', selected: mk.type === 'ellipse' }, 'Elipse')),
          h('select', { class: 'mo-sel', 'aria-label': 'Modo', on: { change: (e: Event) => sm('Máscara', m => { m.mode = (e.target as HTMLSelectElement).value as 'add'; }) } }, h('option', { value: 'add', selected: mk.mode === 'add' }, 'Sumar'), h('option', { value: 'subtract', selected: mk.mode === 'subtract' }, 'Restar')),
          h('button', { type: 'button', class: 'icon xs', title: 'Eliminar máscara', 'aria-label': 'Eliminar máscara', html: MI.trash, on: { click: () => this.set(c, 'Eliminar máscara', x => { x.masks = x.masks.filter(y => y.id !== mk.id); }) } })),
        this.num(c, mk.x, 'X', { key: `mx${i}`, path: `mask.${mk.id}.x`, unit: 'px' }),
        this.num(c, mk.y, 'Y', { key: `my${i}`, path: `mask.${mk.id}.y`, unit: 'px' }),
        this.num(c, mk.w, 'Ancho', { key: `mw${i}`, path: `mask.${mk.id}.w`, unit: 'px' }),
        this.num(c, mk.h, 'Alto', { key: `mh${i}`, path: `mask.${mk.id}.h`, unit: 'px' }),
        this.num(c, mk.feather, 'Suavizado', { key: `mf${i}`, path: `mask.${mk.id}.feather`, min: 0, max: 500, unit: 'px' }),
        this.check('Invertir', mk.invert, v => sm('Invertir máscara', m => { m.invert = v; }), `minv${i}`)));
    });
    this.section('Máscaras', list,
      this.btns(['Dibujar rectángulo', () => { s.maskType = 'rect'; s.setTool('mask'); toast('Arrastra sobre el clip en el visor'); }], ['Dibujar elipse', () => { s.maskType = 'ellipse'; s.setTool('mask'); toast('Arrastra sobre el clip en el visor'); }]),
      h('p', { class: 'ctl-help' }, 'Las máscaras se animan con sus rombos (rotoscopia por keyframes).'));
  }

  // ---------------------------------------------------------------- efectos

  private fxPanel(c: Clip) {
    const s = this.s;
    const add = h('select', { class: 'mo-sel', 'aria-label': 'Añadir efecto', 'data-k': 'addfx' }, h('option', { value: '' }, '+ Añadir efecto…'),
      ...CATEGORIES.map(cat => h('optgroup', { label: cat.label }, ...EFFECTS.filter(e => e.cat === cat.id).map(e => h('option', { value: e.id }, e.label)))));
    add.addEventListener('change', () => {
      const def = EFFECTS.find(e => e.id === add.value);
      if (!def) return;
      const inst: FxInst = { id: mid('fx'), fx: def.id, on: true, p: Object.fromEntries(Object.entries(defaults(def)).map(([k, v]) => [k, prop(v)])) };
      if (def.id === 'lut') { const lut = s.m.media.find(m => m.kind === 'lut'); if (lut) inst.p.lut = prop(lut.id); else toast('Importa un LUT (.cube) en la biblioteca para usar este efecto.'); }
      this.openFx.add(inst.id);
      this.set(c, `Efecto ${def.label}`, x => { x.fx.push(inst); });
    });
    const presets = s.m.presets.filter(p => p.kind === 'fx');
    const pre = h('select', { class: 'mo-sel', 'aria-label': 'Aplicar preset de efectos' }, h('option', { value: '' }, presets.length ? 'Aplicar preset…' : 'Sin presets guardados'), ...presets.map(p => h('option', { value: p.id }, p.name)));
    pre.addEventListener('change', () => { const p = presets.find(x => x.id === pre.value); if (p) this.set(c, `Preset ${p.name}`, x => { x.fx.push(...clone(p.data as FxInst[]).map(f => ({ ...f, id: mid('fx') }))); }); });
    const explore = h('button', { type: 'button', class: 'btn sm', on: { click: () => this.el.dispatchEvent(new CustomEvent('mo-browse', { bubbles: true, detail: 'filters' })) } }, 'Explorar filtros y efectos…');
    this.section('Pila de efectos (de arriba abajo)', add, explore,
      h('div', { class: 'mo-btnrow' }, pre, h('button', { type: 'button', class: 'btn sm', disabled: !c.fx.length, on: { click: async () => {
        const n = await promptText('Nombre del preset de efectos', c.fx.map(f => EFFECTS.find(e => e.id === f.fx)?.label ?? f.fx).join(' + ').slice(0, 40));
        if (n) s.edit('Guardar preset', m => { m.presets.push({ id: mid('pr'), name: n.slice(0, 60), kind: 'fx', data: clone(c.fx) }); });
      } } }, 'Guardar como preset')));
    if (!c.fx.length) this.body.append(h('p', { class: 'ctl-help mo-pad' }, 'Sin efectos. Los efectos no destruyen el original: se pueden apagar, reordenar, animar y quitar.'));
    c.fx.forEach((f, i) => this.fxCard(c, f, i));
  }

  private fxCard(c: Clip, f: FxInst, i: number) {
    const s = this.s;
    const def = EFFECTS.find(e => e.id === f.fx);
    if (!def) return;
    const sf = (label: string, fn: (x: FxInst, list: FxInst[]) => void) => this.set(c, label, x => { const y = x.fx.find(z => z.id === f.id); if (y) fn(y, x.fx); });
    const open = this.openFx.has(f.id);
    const body = h('div', { class: 'mo-fxbody', hidden: !open });
    const head = h('div', { class: 'mo-fxhead' },
      h('input', { type: 'checkbox', checked: f.on, title: 'Activar efecto', 'aria-label': `Activar ${def.label}`, on: { change: (e: Event) => sf('Activar efecto', x => { x.on = (e.target as HTMLInputElement).checked; }) } }),
      h('button', { type: 'button', class: 'mo-fxname', 'aria-expanded': String(open), on: { click: () => { if (this.openFx.has(f.id)) this.openFx.delete(f.id); else this.openFx.add(f.id); body.hidden = !body.hidden; } } }, def.label),
      h('button', { type: 'button', class: 'icon xs', title: 'Subir', 'aria-label': 'Subir efecto', disabled: i === 0, html: '↑', on: { click: () => sf('Reordenar efectos', (_x, list) => { const j = list.findIndex(z => z.id === f.id); [list[j - 1], list[j]] = [list[j], list[j - 1]]; }) } }),
      h('button', { type: 'button', class: 'icon xs', title: 'Bajar', 'aria-label': 'Bajar efecto', disabled: i === c.fx.length - 1, html: '↓', on: { click: () => sf('Reordenar efectos', (_x, list) => { const j = list.findIndex(z => z.id === f.id); [list[j + 1], list[j]] = [list[j], list[j + 1]]; }) } }),
      h('button', { type: 'button', class: 'icon xs', title: 'Duplicar', 'aria-label': 'Duplicar efecto', html: MI.dup, on: { click: () => sf('Duplicar efecto', (x, list) => { list.splice(list.indexOf(x) + 1, 0, { ...clone(x), id: mid('fx') }); }) } }),
      h('button', { type: 'button', class: 'icon xs', title: 'Quitar', 'aria-label': 'Quitar efecto', html: MI.trash, on: { click: () => this.set(c, 'Quitar efecto', x => { x.fx = x.fx.filter(z => z.id !== f.id); }) } }));
    for (const p of def.params) body.append(this.param(c, f, p));
    const card = h('div', { class: `mo-fx${f.on ? '' : ' off'}` }, head, body);
    this.body.append(card);
    void s;
  }

  private param(c: Clip, f: FxInst, p: Param): HTMLElement {
    const s = this.s;
    f.p[p.key] ??= prop(p.def as never);
    const pr = f.p[p.key] as Prop<number | string | boolean>;
    const path = `fx.${f.id}.${p.key}`;
    if (p.type === 'range') return this.num(c, pr as Prop, p.label, { key: path, path, min: p.min, max: p.max, step: p.step ?? 1, unit: p.unit });
    if (p.type === 'color') return this.color(c, pr as Prop<string>, p.label, path);
    if (p.type === 'toggle') return this.check(p.label, !!valueAt(pr, s.time - c.start), v => this.set(c, p.label, x => { const y = x.fx.find(z => z.id === f.id); if (y) { const q = y.p[p.key] as Prop<boolean>; delete q.k; q.v = v; } }), path);
    // Selección (el LUT elige entre los LUT importados).
    const opts: [string, string][] = f.fx === 'lut' && p.key === 'lut' ? s.m.media.filter(m => m.kind === 'lut').map(m => [m.id, m.name]) : p.options;
    if (!opts.length) return h('p', { class: 'ctl-help' }, 'Importa un archivo .cube en la biblioteca.');
    return this.select(p.label, String(valueAt(pr, 0)), opts, v => this.set(c, p.label, x => { const y = x.fx.find(z => z.id === f.id); if (y) { const q = y.p[p.key] as Prop<string>; delete q.k; q.v = v; } }), path);
  }

  // ---------------------------------------------------------------- animar

  private animPanel(c: Clip) {
    const s = this.s;
    const tr = (side: 'tin' | 'tout') => {
      const t = c[side];
      return h('div', null,
        this.select(side === 'tin' ? 'Entrada' : 'Salida', t.type, TRANSITIONS, v => this.set(c, 'Transición', x => { x[side] = { type: v as TransitionType, dur: x[side].dur }; }), `${side}t`),
        t.type !== 'none' ? this.plainNum('Duración', t.dur, v => this.set(c, 'Transición', x => { x[side] = { type: x[side].type, dur: Math.max(1 / s.fps, Math.min(x.dur, v)) }; }), `${side}d`, { min: 0.04, step: 0.1, unit: 's' }) : null);
    };
    this.section('Transiciones', tr('tin'), tr('tout'), h('p', { class: 'ctl-help' }, 'Para un fundido cruzado, solapa dos clips en pistas distintas con entrada «Fundido» en el de arriba.'));
    const groups = ['Entrada', 'Salida', 'Bucle'] as const;
    const len = h('input', { type: 'number', value: String(Math.min(s.presetLen, +(c.dur / 2).toFixed(2))), min: '0.05', step: '0.05', class: 'mo-num', 'aria-label': 'Duración del movimiento' });
    len.addEventListener('change', () => { const v = Number(len.value); if (v > 0) s.presetLen = v; });
    this.section('Presets de movimiento',
      h('div', { class: 'mo-prop' }, h('label', { class: 'mo-lab' }, 'Duración'), len, h('span', { class: 'mo-unit' }, 's')),
      ...groups.map(g => h('div', { class: 'mo-presets' }, h('span', { class: 'mo-unit' }, g), ...MOTION_PRESETS.filter(p => p.group === g).map(p => h('button', { type: 'button', class: 'btn xs', on: { click: () => this.set(c, p.label, x => { applyPreset(x.tf, p.id, x.dur, Math.max(0.05, Number(len.value) || s.presetLen), s.comp.w, s.comp.h); }) } }, p.label)))),
      this.animPresets(c),
      h('button', { type: 'button', class: 'btn sm', on: { click: () => this.el.dispatchEvent(new CustomEvent('mo-browse', { bubbles: true, detail: 'anims' })) } }, 'Ver todas con vista previa…'));
    // Keyframes del clip (todas las propiedades animadas).
    const rows = h('div', { class: 'mo-keys' });
    forEachProp(c, (p, path) => {
      if (!p.k?.length) return;
      const lab = propLabel(c, path);
      const head = h('button', { type: 'button', class: `mo-keyprop${s.focus?.path === path ? ' on' : ''}`, title: 'Ver en el editor de curvas', on: { click: () => { s.focus = { clip: c.id, path }; this.el.dispatchEvent(new CustomEvent('mo-curves', { bubbles: true })); this.render(); } } }, `${lab} · ${p.k.length}`);
      head.addEventListener('contextmenu', e => { e.preventDefault(); menu(e.clientX, e.clientY, lab, [
        { label: `Copiar keyframes de ${lab}`, run: () => s.copyKeyframes([path]) },
        { label: `Pegar keyframes en ${lab}`, disabled: !s.hasKeyClip, run: () => s.pasteKeyframes(path) },
      ]); });
      rows.append(head);
      p.k.forEach((k, i) => {
        const sk = (label: string, fn: (kk: NonNullable<typeof p.k>[number], pp: Prop<unknown>) => void) => this.set(c, label, x => { const pp = propByPath(x, path); const kk = pp?.k?.[i]; if (pp && kk) fn(kk, pp); });
        const tIn = h('input', { type: 'number', class: 'mo-num', step: String(1 / s.fps), value: String(+k.t.toFixed(3)), 'aria-label': 'Tiempo del keyframe (s)', 'data-k': `kt${path}${i}` });
        tIn.addEventListener('change', () => { const v = Math.max(0, Math.min(c.dur, Math.round(Number(tIn.value) * s.fps) / s.fps)); sk('Mover keyframe', (kk, pp) => { kk.t = v; pp.k!.sort((a, b) => a.t - b.t); }); });
        const ease = h('select', { class: 'mo-sel', 'aria-label': 'Curva hacia el siguiente', 'data-k': `ke${path}${i}` }, ...EASES.map(e => h('option', { value: e.id, selected: e.id === k.e }, e.label)));
        ease.addEventListener('change', () => sk('Curva', kk => { kk.e = ease.value as EaseType; if (kk.e === 'bezier' && !kk.b) kk.b = [0.42, 0, 0.58, 1]; }));
        rows.append(h('div', { class: 'mo-keyrow' },
          h('button', { type: 'button', class: 'icon xs', title: 'Ir al keyframe', 'aria-label': 'Ir al keyframe', html: MI.diamondFill, on: { click: () => s.seek(c.start + k.t) } }),
          tIn, h('span', { class: 'mo-unit' }, typeof k.v === 'number' ? (+k.v.toFixed(3)).toString() : String(k.v)),
          i < p.k!.length - 1 ? ease : h('span', { class: 'mo-unit' }, '(último)'),
          h('button', { type: 'button', class: 'icon xs', title: 'Quitar keyframe', 'aria-label': 'Quitar keyframe', html: MI.trash, on: { click: () => sk('Quitar keyframe', (_kk, pp) => { pp.k!.splice(i, 1); if (!pp.k!.length) delete pp.k; }) } })));
      });
    });
    this.section('Keyframes', rows.childElementCount ? rows : h('p', { class: 'ctl-help' }, 'Sin keyframes. Pulsa un rombo ◇ junto a una propiedad (pestaña Clip) o la tecla K.'),
      this.btns(['Copiar todos', () => s.copyKeyframes('all'), 'Copia todos los keyframes de este clip'], ['Pegar en el cabezal', () => s.pasteKeyframes(), 'Pega los keyframes copiados (de este u otro clip) desde el cabezal']),
      this.btns(['Quitar todos los keyframes', () => this.set(c, 'Quitar keyframes', x => forEachProp(x, (p, path) => { if (p.k?.length) { p.v = valueAt(p, s.time - c.start); delete p.k; } void path; }))]));
  }

  private animPresets(c: Clip) {
    const s = this.s;
    const presets = s.m.presets.filter(p => p.kind === 'anim');
    const sel = h('select', { class: 'mo-sel', 'aria-label': 'Aplicar preset de animación' }, h('option', { value: '' }, presets.length ? 'Mis presets…' : 'Sin presets propios'), ...presets.map(p => h('option', { value: p.id }, p.name)));
    sel.addEventListener('change', () => {
      const p = presets.find(x => x.id === sel.value);
      if (!p) return;
      this.set(c, `Preset ${p.name}`, x => { const tf = clone(p.data as Clip['tf']); for (const k of Object.keys(tf) as (keyof Clip['tf'])[]) if (tf[k].k?.length) x.tf[k] = tf[k]; });
    });
    const save = h('button', { type: 'button', class: 'btn sm', on: { click: async () => {
      if (!Object.values(c.tf).some(p => p.k?.length)) { toast('Este clip no tiene keyframes de transformación.'); return; }
      const n = await promptText('Nombre del preset de animación', 'Mi animación');
      if (n) s.edit('Guardar preset', m => { m.presets.push({ id: mid('pr'), name: n.slice(0, 60), kind: 'anim', data: clone(c.tf) }); });
    } } }, 'Guardar mi animación');
    return h('div', { class: 'mo-btnrow' }, sel, save);
  }
}

function setV(p: Prop, t: number, v: number) { if (p.k?.length) { const k = keyAt(p, t); if (k) k.v = v; else { p.k.push({ t, v, e: 'inout' }); p.k.sort((a, b) => a.t - b.t); } } else p.v = v; }
/** Valor en el cabezal (crea keyframe si la propiedad está animada). */
function setNow(s: MotionStudio, c: Clip, p: Prop, v: number) { setV(p, Math.max(0, Math.min(c.dur, s.time - c.start)), v); }

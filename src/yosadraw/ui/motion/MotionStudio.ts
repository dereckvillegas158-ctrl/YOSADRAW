import type { StrokePainter } from '../../brush/StrokePainter';
import type { Document } from '../../doc/Document';
import type { CanvasEngine } from '../../engine';
import { Emitter } from '../../engine/Emitter';
import { animated, keyAt, setValue, toggleKey, valueAt, type Prop } from '../../motion/keys';
import { MediaManager } from '../../motion/media';
import {
  clipEnd, clone, compClip, propByPath, propLabel, compOf, copyAttrs, deleteClips, duplicateClips, findClip, forEachProp, freezeFrame, mediaClip, mid, MotionHistory, moveClips, newTrack,
  pasteAttrs, precompose, copyKeys, pasteKeys, deleteKeysAt, easeKeysAt, keyTimes, retimeKeys, shapeClip, solidClip, splitClip, textClip, toggleGroup, trimClip,
  type Attrs, type Clip, type Composition, type MediaItem, type Motion, type ShapeType, type Track,
} from '../../motion/model';
import { Player } from '../../motion/player';
import {
  copyMultiKeys, eachSegmentKey, easeSpecOf, freezeAt, invertEase, linkLoops, makeLink, pasteMultiKeys, pastePreview, quickAnimate, repeatKeys, repeatsToFill,
  setEase, smoothKeys, type EaseSpec, type MultiKeyClipboard, type QuickSpec,
} from '../../motion/keytools';
import type { ProjectLibrary } from '../../project/library';
import { toast } from '../dom';
import { MotionKeys } from './shortcuts';
import type { MotionPrefs } from './prefs';

export type { MotionPrefs } from './prefs';
export { normalizeMotionPrefs } from './prefs';

export type MotionTool = 'select' | 'razor' | 'text' | 'shape' | 'mask';

/** Clave de la selección de keyframes: el clip (todas sus propiedades) o clip + propiedad. */
const KSEP = '\u0001';
export const selKey = (id: string, path?: string | null) => (path ? `${id}${KSEP}${path}` : id);
export const parseSelKey = (k: string): { id: string; path: string | null } => { const i = k.indexOf(KSEP); return i < 0 ? { id: k, path: null } : { id: k.slice(0, i), path: k.slice(i + 1) }; };

export interface MotionHostDeps {
  engine: CanvasEngine; projects: ProjectLibrary; painter: StrokePainter;
  prefs: MotionPrefs; persist: () => void;
}

/**
 * Estado y acciones del editor de vídeo YOSADRAW MOTION (sin interfaz): el proyecto
 * (dentro del documento abierto), su historial, la selección, la herramienta, el
 * reproductor y los medios. Los paneles escuchan sus eventos y llaman a sus acciones.
 */
export class MotionStudio extends Emitter<{ change: string; time: number; select: void; tool: MotionTool; play: boolean; media: void; open: boolean }> {
  hist: MotionHistory | null = null;
  readonly media: MediaManager;
  readonly player: Player;
  readonly keys: MotionKeys;
  doc: Document | null = null;
  sel = new Set<string>();
  /** Propiedad elegida (para el editor de curvas): clip y ruta. */
  focus: { clip: string; path: string } | null = null;
  tool: MotionTool = 'select';
  /** Duración de los presets de movimiento (s). */
  presetLen = 0.8;
  shape: ShapeType = 'rect';
  maskType: 'rect' | 'ellipse' = 'rect';
  private clipboard: Clip[] = [];
  /**
   * Keyframes elegidos en la línea de tiempo: clave → tiempos (s del clip). La clave es
   * el id del clip (todas sus propiedades en esos tiempos, fila del clip) o clip + ruta
   * (sólo esa propiedad, fila de propiedad); ver `selKey`.
   */
  keySel = new Map<string, number[]>();
  /** Selección múltiple de keyframes sin teclado (teléfono): cada toque suma o quita. */
  keyMulti = false;
  private keyClip: MultiKeyClipboard | null = null;
  /** Curva copiada (para pegarla en otros keyframes). */
  private easeClip: EaseSpec | null = null;
  /** Vista previa de pegado: los rombos fantasma siguen al puntero hasta hacer clic. */
  pastePreviewOn = false;
  /** Qué se copió por última vez (Ctrl+V pega eso). */
  private lastCopy: 'clips' | 'keys' = 'clips';
  private attrs: Attrs | null = null;
  /** Lienzo del visor (lo pone MViewer). */
  readonly view = document.createElement('canvas');
  /** Escala del visor (px de pantalla por px de composición). */
  fit = 0.5;

  constructor(readonly deps: MotionHostDeps) {
    super();
    this.media = new MediaManager(deps.projects.blobStore, deps.painter, deps.projects);
    this.keys = new MotionKeys(deps.prefs.keys);
    this.player = new Player(this.media, () => this.m, this.view, () => this.fit);
    this.player.opts = { quality: deps.prefs.quality, proxies: deps.prefs.proxies, loop: deps.prefs.loop };
    this.player.onTime = t => { if (this.hist) this.hist.m.time = t; this.emit('time', t); };
    this.player.onState = p => this.emit('play', p);
  }

  get prefs() { return this.deps.prefs; }
  get active() { return !!this.hist; }
  get m(): Motion { return this.hist!.m; }
  get comp(): Composition { return compOf(this.m); }
  get time() { return this.player.time; }
  get fps() { return this.comp.fps; }
  get frame() { return 1 / this.comp.fps; }

  // ---------------------------------------------------------------- abrir y cerrar

  /** Abre el proyecto de vídeo del documento. */
  async open(doc: Document) {
    this.close();
    this.doc = doc;
    this.hist = new MotionHistory(doc.motion!, (m, label) => this.changed(m, label));
    this.sel.clear(); this.focus = null;
    this.player.time = Math.min(this.m.time, this.comp.dur);
    this.emit('open', true);
    await this.media.checkMissing(this.m.media).catch(() => undefined);
    for (const md of this.m.media) if (md.kind === 'font') void this.media.font(md).catch(() => undefined);
    this.emit('media', undefined);
    this.player.invalidate();
  }

  close() {
    if (!this.hist) return;
    this.player.dispose();
    this.media.dispose();
    this.hist = null;
    this.doc = null;
    this.sel.clear();
    this.emit('open', false);
  }

  private changed(m: Motion, label: string) {
    if (this.doc) this.doc.motion = m;
    // Limpia la selección de clips que ya no existen.
    for (const id of [...this.sel]) if (!this.comp.clips.some(c => c.id === id)) this.sel.delete(id);
    if (this.player.time > this.comp.dur) this.player.time = this.comp.dur;
    this.player.invalidate();
    if (label) this.deps.engine.markChanged();
    this.emit('change', label);
  }

  // ---------------------------------------------------------------- edición

  /** Cambio que se registra en el historial (un paso). */
  edit(label: string, fn: (m: Motion, comp: Composition) => boolean | void): boolean {
    if (!this.hist) return false;
    if (this.hist.pending) this.hist.commit('Cambio');
    try { return this.hist.edit(label, m => fn(m, compOf(m))); }
    catch (e) { toast(e instanceof Error ? e.message : String(e), 'error'); return false; }
  }
  /** Cambio continuo (arrastrar un control): se ve en vivo y `commit` lo registra. */
  live(fn: (m: Motion, comp: Composition) => void) {
    if (!this.hist) return;
    this.hist.begin();
    fn(this.m, this.comp);
    this.player.invalidate();
    this.emit('change', '');
  }
  commit(label: string) { this.hist?.commit(label); }
  undo() { if (this.hist?.undo()) toast(`Deshecho`, 'info'); }
  redo() { this.hist?.redo(); }

  // ---------------------------------------------------------------- tiempo

  seek(t: number, snap = true) {
    const c = this.comp;
    t = Math.max(0, Math.min(c.dur, t));
    if (snap) t = Math.round(t * c.fps) / c.fps;
    this.player.seek(t);
  }
  step(frames: number) { if (this.player.playing) this.player.pause(); this.seek(this.time + frames / this.fps); }
  /** Bordes de clips (para saltar de corte en corte). */
  edits(): number[] { return [...new Set([0, ...this.comp.clips.flatMap(c => [c.start, clipEnd(c)])])].sort((a, b) => a - b); }
  jumpEdit(dir: 1 | -1) {
    const t = this.time, e = this.edits();
    const x = dir > 0 ? e.find(v => v > t + 1e-6) : [...e].reverse().find(v => v < t - 1e-6);
    if (x !== undefined) this.seek(x);
  }

  // ---------------------------------------------------------------- selección

  select(ids: string[], add = false) {
    if (!add) this.sel.clear();
    for (const id of ids) { if (add && this.sel.has(id) && ids.length === 1) this.sel.delete(id); else this.sel.add(id); }
    for (const k of [...this.keySel.keys()]) if (!this.sel.has(parseSelKey(k).id)) this.keySel.delete(k);
    const first = this.selected[0];
    if (!first || (this.focus && this.focus.clip !== first.id)) this.focus = null;
    this.emit('select', undefined);
  }
  get selected(): Clip[] { return this.hist ? this.comp.clips.filter(c => this.sel.has(c.id)) : []; }
  get one(): Clip | null { const s = this.selected; return s.length === 1 ? s[0] : null; }
  /** La biblioteca de medios cambió (otros paneles vuelven a leerla). */
  mediaChanged() { this.emit('media', undefined); }
  setTool(t: MotionTool) { this.tool = t; this.emit('tool', t); }

  // ---------------------------------------------------------------- pistas

  /** Pista libre del tipo pedido en [t, t+dur) (crea una si no hay). */
  freeTrack(comp: Composition, kind: Track['kind'], t: number, dur: number, prefer?: string): Track {
    const free = (tr: Track) => tr.kind === kind && !tr.locked && !comp.clips.some(c => c.track === tr.id && c.start < t + dur - 1e-6 && clipEnd(c) > t + 1e-6);
    const p = prefer ? comp.tracks.find(x => x.id === prefer) : null;
    if (p && free(p)) return p;
    // Visual: de abajo arriba (la primera libre por encima de las ocupadas); audio: de arriba abajo.
    const list = kind === 'visual' ? [...comp.tracks].reverse() : comp.tracks;
    const hit = list.find(free);
    if (hit) return hit;
    const n = comp.tracks.filter(x => x.kind === kind).length + 1;
    const tr = newTrack(kind, kind === 'visual' ? `Vídeo ${n}` : `Audio ${n}`);
    if (kind === 'visual') comp.tracks.unshift(tr); else comp.tracks.push(tr);
    return tr;
  }

  addTrack(kind: Track['kind']) {
    this.edit(kind === 'visual' ? 'Añadir pista de vídeo' : 'Añadir pista de audio', (_m, comp) => {
      const n = comp.tracks.filter(x => x.kind === kind).length + 1;
      const tr = newTrack(kind, kind === 'visual' ? `Vídeo ${n}` : `Audio ${n}`);
      if (kind === 'visual') comp.tracks.unshift(tr); else comp.tracks.push(tr);
    });
  }

  // ---------------------------------------------------------------- añadir

  /** Importa archivos a la biblioteca (y opcionalmente los pone en la línea de tiempo). */
  async importFiles(files: File[], toTimeline = false, at?: number, track?: string) {
    if (!files.length || !this.hist) return;
    const seqImgs = files.length > 1 && files.every(f => /\.(png|jpe?g|webp)$/i.test(f.name)) && files.every(f => /\d+\.[a-z]+$/i.test(f.name)) && new Set(files.map(f => f.name.replace(/\d+\.[a-z]+$/i, ''))).size === 1;
    let items: MediaItem[] = [], errors: string[] = [];
    const note = (msg: string) => this.emit('change', `·${msg}`);
    if (seqImgs && files.length >= 3) {
      try { items = [await this.media.importSequence(files, this.fps)]; } catch (e) { errors.push(e instanceof Error ? e.message : String(e)); }
    } else ({ items, errors } = await this.media.importFiles(files, '', note));
    for (const e of errors) toast(`No se pudo importar ${e}`, 'error');
    if (!items.length) { this.emit('change', ''); return; }
    this.edit(items.length === 1 ? `Importar ${items[0].name}` : `Importar ${items.length} medios`, (m, comp) => {
      m.media.push(...items);
      if (toTimeline) this.placeMedia(comp, items, at ?? this.time, track);
    });
    this.emit('media', undefined);
    toast(items.length === 1 ? `Importado: ${items[0].name}` : `${items.length} medios importados`, 'ok');
  }

  /** Pone medios en la línea de tiempo (uno detrás de otro). */
  placeMedia(comp: Composition, items: MediaItem[], at: number, track?: string): Clip[] {
    const out: Clip[] = [];
    let t = at;
    for (const md of items) {
      if (md.kind === 'font' || md.kind === 'lut') continue;
      const kind = md.kind === 'audio' ? 'audio' : 'visual';
      const tmp = mediaClip(comp, md, '', t);
      const tr = this.freeTrack(comp, kind, t, tmp.dur, track);
      tmp.track = tr.id;
      comp.clips.push(tmp);
      out.push(tmp);
      t += tmp.dur;
    }
    this.sel = new Set(out.map(c => c.id));
    return out;
  }

  /**
   * Varias capas de un dibujo a la vez: cada una en su pista (nuevas, encima de las
   * que hay), en el mismo instante y con la misma transformación, así se ven alineadas
   * como en el dibujo (la primera, abajo).
   */
  placeStack(comp: Composition, items: MediaItem[], at: number): Clip[] {
    const out: Clip[] = [];
    for (const md of items) {
      const tr = newTrack('visual', md.name.split(' · ').pop()!.slice(0, 30) || 'Capa');
      comp.tracks.unshift(tr);
      const c = mediaClip(comp, md, tr.id, at);
      comp.clips.push(c);
      out.push(c);
    }
    this.sel = new Set(out.map(c => c.id));
    return out;
  }

  addMediaToTimeline(ids: string[], at = this.time, track?: string) {
    const items = this.m.media.filter(x => ids.includes(x.id));
    if (!items.length) return;
    if (items.every(x => x.kind === 'font' || x.kind === 'lut')) { toast('Las fuentes se usan en los textos y los LUT en el efecto «LUT 3D».'); return; }
    this.edit('Añadir a la línea de tiempo', (_m, comp) => { this.placeMedia(comp, items, at, track); });
    this.emit('select', undefined);
  }

  addText(x?: number, y?: number, text = 'Tu texto') {
    this.edit('Añadir texto', (_m, comp) => {
      const tr = this.freeTrack(comp, 'visual', this.time, 5);
      const c = textClip(comp, tr.id, this.time, text);
      if (x !== undefined && y !== undefined) { c.tf.x.v = x; c.tf.y.v = y; }
      comp.clips.push(c);
      this.sel = new Set([c.id]);
    });
    this.emit('select', undefined);
  }
  addShape(shape: ShapeType, x?: number, y?: number, w?: number, h?: number) {
    this.edit('Añadir forma', (_m, comp) => {
      const tr = this.freeTrack(comp, 'visual', this.time, 5);
      const c = shapeClip(comp, tr.id, this.time, shape);
      if (x !== undefined && y !== undefined) { c.tf.x.v = x; c.tf.y.v = y; }
      if (w && h) { c.w.v = Math.max(4, w); c.h.v = Math.max(4, h); }
      comp.clips.push(c);
      this.sel = new Set([c.id]);
    });
    this.emit('select', undefined);
  }
  addSolid(color = '#9d6bff') {
    this.edit('Añadir sólido', (_m, comp) => {
      const tr = this.freeTrack(comp, 'visual', this.time, 5);
      const c = solidClip(comp, tr.id, this.time, color);
      comp.clips.push(c);
      this.sel = new Set([c.id]);
    });
    this.emit('select', undefined);
  }
  /** Nueva composición vacía (para anidar) y su clip en la actual. */
  addComposition() {
    this.edit('Nueva composición', (m, comp) => {
      const sub = { ...clone(comp), id: mid('cp'), name: `Composición ${m.comps.length + 1}`, clips: [], markers: [], range: null, bg: null, dur: 5 };
      sub.tracks = sub.tracks.map(t => ({ ...t, id: mid('tr') }));
      m.comps.push(sub);
      const tr = this.freeTrack(comp, 'visual', this.time, 5);
      const c = compClip(comp, sub, tr.id, this.time);
      comp.clips.push(c);
      this.sel = new Set([c.id]);
    });
  }
  /** Abre una composición anidada (o vuelve a la principal). */
  openComp(id: string) {
    if (!this.m.comps.some(c => c.id === id)) return;
    this.player.pause();
    this.m.open = id;
    this.sel.clear(); this.focus = null;
    this.player.time = 0;
    this.player.invalidate();
    this.emit('change', '');
    this.emit('select', undefined);
  }

  // ---------------------------------------------------------------- operaciones con clips

  split(at = this.time) {
    const ids = this.sel.size ? [...this.sel] : this.comp.clips.filter(c => c.start < at && clipEnd(c) > at && !this.locked(c)).map(c => c.id);
    let n = 0;
    this.edit('Dividir', (m, comp) => { for (const id of ids) if (splitClip(comp, m, id, at)) n++; return n > 0; });
    if (!n) toast('Coloca el cabezal dentro de un clip para dividirlo.');
  }
  locked(c: Clip) { return !!this.comp.tracks.find(t => t.id === c.track)?.locked; }
  remove(ripple = this.prefs.ripple) {
    if (this.hasKeySel) { this.deleteKeyframes(); return; }
    const ids = [...this.sel].filter(id => { const c = findClip(this.comp, id); return c && !this.locked(c); });
    if (!ids.length) return;
    this.edit(ripple ? 'Eliminar (cerrar hueco)' : 'Eliminar', (_m, comp) => deleteClips(comp, ids, ripple));
    this.sel.clear();
    this.emit('select', undefined);
  }
  duplicate() {
    if (this.hasKeySel) { this.duplicateKeys(); return; }
    const ids = [...this.sel];
    if (!ids.length) return;
    this.edit('Duplicar', (_m, comp) => { const out = duplicateClips(comp, ids); this.sel = new Set(out.map(c => c.id)); });
    this.emit('select', undefined);
  }
  // ---------------------------------------------------------------- keyframes

  /** Elige keyframes (por tiempo) de un clip; `add` suma a la selección. */
  selectKeys(clipId: string, times: number[], add = false, path: string | null = null, toggle = true) {
    add ||= this.keyMulti;
    if (!add) this.keySel.clear();
    const key = selKey(clipId, path);
    const cur = this.keySel.get(key) ?? [];
    for (const t of times) { const i = cur.findIndex(x => Math.abs(x - t) < 1e-3); if (i >= 0 && add && toggle && times.length === 1) cur.splice(i, 1); else if (i < 0) cur.push(t); }
    if (cur.length) this.keySel.set(key, cur); else this.keySel.delete(key);
    this.emit('select', undefined);
  }
  /** ¿Está elegido el keyframe `t` de `clipId` (en esa propiedad o en todo el clip)? */
  isKeySel(clipId: string, t: number, path: string | null = null) {
    const has = (k: string) => (this.keySel.get(k) ?? []).some(x => Math.abs(x - t) < 1e-3);
    return has(clipId) || (!!path && has(selKey(clipId, path)));
  }
  /**
   * La selección como lista de partes: clip, propiedad (null = todas) y tiempos. Los
   * tiempos que ya están elegidos en todo el clip no se repiten en sus propiedades.
   */
  keyEntries(): { key: string; id: string; path: string | null; times: number[] }[] {
    const out: { key: string; id: string; path: string | null; times: number[] }[] = [];
    for (const [key, ts] of this.keySel) {
      const { id, path } = parseSelKey(key);
      const whole = path ? this.keySel.get(id) ?? [] : [];
      const times = path ? ts.filter(t => !whole.some(x => Math.abs(x - t) < 1e-3)) : ts;
      if (times.length) out.push({ key, id, path, times: [...times].sort((a, b) => a - b) });
    }
    return out;
  }
  /** Las partes agrupadas por clip (para copiar). */
  private keyPicks() {
    const m = new Map<string, { times: number[] | null; paths: string[] | null }[]>();
    for (const e of this.keyEntries()) { const l = m.get(e.id) ?? []; l.push({ times: e.times, paths: e.path ? [e.path] : null }); m.set(e.id, l); }
    return m;
  }
  /** Avisa de que cambió la selección de keyframes (panel, menús, barra). */
  keysChanged() { this.emit('select', undefined); }
  get keyCount() { return [...this.keySel.values()].reduce((a, v) => a + v.length, 0); }
  /** Todos los keyframes de los clips elegidos. */
  selectAllKeys() {
    this.keySel.clear();
    for (const c of this.selected) { const ts = keyTimes(c); if (ts.length) this.keySel.set(c.id, ts); }
    if (!this.keySel.size) toast(this.sel.size ? 'Los clips elegidos no tienen keyframes.' : 'Elige uno o más clips.');
    this.emit('select', undefined);
  }
  /** Los keyframes que están en el cabezal (en los clips elegidos o, si no hay, en todos). */
  selectKeysAtPlayhead(add = false) {
    if (!add && !this.keyMulti) this.keySel.clear();
    const clips = this.selected.length ? this.selected : this.comp.clips;
    let n = 0;
    for (const c of clips) {
      const lt = this.time - c.start;
      const hit = keyTimes(c).filter(t => Math.abs(t - lt) < 0.5 / this.fps);
      if (!hit.length) continue;
      this.sel.add(c.id);
      const cur = this.keySel.get(c.id) ?? [];
      for (const t of hit) if (!cur.some(x => Math.abs(x - t) < 1e-3)) cur.push(t);
      this.keySel.set(c.id, cur); n += hit.length;
    }
    if (!n) toast('No hay keyframes en el cabezal.');
    this.emit('select', undefined);
  }
  /** Invierte la selección de keyframes dentro de los clips elegidos. */
  invertKeySel() {
    for (const c of this.selected) {
      const cur = this.keySel.get(c.id) ?? [];
      const next = keyTimes(c).filter(t => !cur.some(x => Math.abs(x - t) < 1e-3));
      if (next.length) this.keySel.set(c.id, next); else this.keySel.delete(c.id);
    }
    this.emit('select', undefined);
  }
  /** Retoca el tiempo de los keyframes elegidos; `map(c, times)` da la función t → t' de cada clip. */
  private retime(label: string, map: (c: Clip, times: number[]) => ((t: number) => number) | null) {
    if (!this.hasKeySel) { toast('Elige uno o más keyframes (rombos).'); return; }
    const next = new Map<string, number[]>();
    const entries = this.keyEntries();
    // La función de cada clip se calcula con todos sus tiempos elegidos (también los de sus propiedades).
    const byClip = new Map<string, number[]>();
    for (const e of entries) byClip.set(e.id, [...(byClip.get(e.id) ?? []), ...e.times].sort((a, b) => a - b));
    this.edit(label, (_m, comp) => {
      const fns = new Map<string, ((t: number) => number) | null>();
      for (const [id, ts] of byClip) { const c = findClip(comp, id); if (c) fns.set(id, map(c, ts)); }
      for (const e of entries) {
        const c = findClip(comp, e.id);
        if (!c) continue;
        const f = fns.get(e.id);
        next.set(e.key, f ? retimeKeys(c, e.times, f, comp.fps, e.path ? [e.path] : null) : e.times);
      }
    });
    this.keySel = next;
    this.emit('select', undefined);
  }
  /** Primer keyframe elegido, en tiempo de la composición. */
  private keySelStart() {
    let t0 = Infinity;
    for (const e of this.keyEntries()) { const c = findClip(this.comp, e.id); if (c) t0 = Math.min(t0, c.start + e.times[0]); }
    return t0;
  }
  /** Mueve los keyframes elegidos `frames` fotogramas. */
  nudgeKeys(frames: number) {
    const dt = frames / this.fps;
    this.retime('Mover keyframes', (c, ts) => { const lim = Math.max(-ts[0], Math.min(c.dur - ts[ts.length - 1], dt)); return t => t + lim; });
  }
  /** Lleva los keyframes elegidos al cabezal (el primero queda en el cabezal; el resto, a la misma distancia). */
  keysToPlayhead() {
    const dt = this.time - this.keySelStart();
    if (!Number.isFinite(dt)) return;
    this.retime('Keyframes al cabezal', () => t => t + dt);
  }
  /** Invierte el orden en el tiempo (la animación va al revés). */
  reverseKeys() { this.retime('Invertir keyframes', (_c, ts) => (ts.length > 1 ? t => ts[0] + ts[ts.length - 1] - t : null)); }
  /** Estira o comprime el tiempo entre los keyframes elegidos (desde el primero). */
  stretchKeys(k: number) { this.retime(k > 1 ? 'Estirar keyframes' : 'Comprimir keyframes', (_c, ts) => t => ts[0] + (t - ts[0]) * k); }
  /** Reparte los keyframes elegidos a la misma distancia entre el primero y el último. */
  distributeKeys() {
    this.retime('Repartir keyframes', (_c, ts) => {
      if (ts.length < 3) return null;
      const a = ts[0], b = ts[ts.length - 1];
      return t => { const i = ts.findIndex(x => Math.abs(x - t) < 1e-3); return a + ((b - a) * i) / (ts.length - 1); };
    });
  }
  /** Duplica los keyframes elegidos en el cabezal (en sus mismos clips y propiedades). */
  duplicateKeys() {
    if (!this.hasKeySel) { toast('Elige uno o más keyframes (rombos).'); return; }
    const t0 = this.keySelStart();
    let n = 0;
    const next = new Map<string, number[]>();
    this.edit('Duplicar keyframes', (_m, comp) => {
      for (const e of this.keyEntries()) {
        const c = findClip(comp, e.id);
        const kc = c && copyKeys(c, e.times, e.path ? [e.path] : null);
        if (!c || !kc) continue;
        const first = e.times[0], at = this.time + (c.start + first - t0) - c.start;
        n += pasteKeys(c, kc, at);
        next.set(e.key, e.times.map(t => Math.max(0, Math.min(c.dur, Math.round((at + t - first) * comp.fps) / comp.fps))));
      }
      return n > 0;
    });
    if (n) { this.keySel = next; this.emit('select', undefined); }
  }
  clearKeys() { if (this.keySel.size) { this.keySel.clear(); this.emit('select', undefined); } }
  get hasKeySel() { return [...this.keySel.values()].some(v => v.length); }
  get hasKeyClip() { return !!this.keyClip; }
  get keyClipLayers() { return this.keyClip?.items.length ?? 0; }

  /**
   * Copia keyframes: los elegidos (de uno o varios clips); si no hay, los de `paths`
   * o todos los de los clips elegidos. Cada clip conserva su distancia en el tiempo.
   */
  copyKeyframes(paths?: string[] | 'all') {
    let sel = new Map<string, { times: number[] | null; paths: string[] | null }[]>();
    if (this.hasKeySel && !paths) sel = this.keyPicks();
    else for (const c of this.selected) sel.set(c.id, [{ times: null, paths: Array.isArray(paths) ? paths : null }]);
    const kc = sel.size ? copyMultiKeys(this.comp, sel) : null;
    if (!kc) { toast('No hay keyframes que copiar.'); return; }
    this.keyClip = kc;
    this.lastCopy = 'keys';
    const n = kc.items.reduce((a, i) => a + i.kc.items.reduce((b, x) => b + x.keys.length, 0), 0);
    toast(`${n} ${n === 1 ? 'keyframe copiado' : 'keyframes copiados'}${kc.items.length > 1 ? ` de ${kc.items.length} capas` : ''}: pégalos con el cabezal donde quieras`, 'ok');
  }

  /** Destinos de un pegado de keyframes: los clips elegidos o, si no hay, los de origen. */
  private keyTargets(): Clip[] {
    if (this.selected.length) return this.selected;
    const ids = new Set(this.keyClip?.items.map(i => i.src) ?? []);
    return this.comp.clips.filter(c => ids.has(c.id));
  }
  /** Dónde caerían los keyframes copiados si se pegan en `at` (vista previa). */
  pasteGhosts(at: number | 'orig'): { clip: string; t: number }[] {
    return this.keyClip ? pastePreview(this.comp, this.keyClip, this.keyTargets(), at) : [];
  }

  /**
   * Pega los keyframes copiados en los clips elegidos: en el cabezal (o en `at`),
   * conservando la distancia entre ellos y entre capas, o en sus tiempos originales
   * (`at` = 'orig'). `onto` = todos en esa propiedad. Los pegados quedan elegidos.
   */
  pasteKeyframes(onto?: string, at: number | 'orig' = this.time) {
    const kc = this.keyClip;
    this.pastePreviewOn = false;
    if (!kc) { toast('Primero copia keyframes.'); return; }
    const targets = this.keyTargets();
    if (!targets.length) { toast('Elige el clip donde pegar los keyframes.'); return; }
    let r = { n: 0, sel: new Map<string, number[]>() };
    this.edit(kc.items.length > 1 ? `Pegar keyframes de ${kc.items.length} capas` : 'Pegar keyframes', (_m, comp) => {
      r = pasteMultiKeys(comp, kc, targets.map(c => findClip(comp, c.id)!).filter(Boolean), at, onto);
      return r.n > 0;
    });
    if (!r.n) { toast(onto ? 'Esa propiedad no admite estos keyframes (otro tipo de valor).' : 'El clip no tiene esas propiedades (p. ej. otro efecto) o el cabezal está fuera del clip.', 'error'); this.emit('select', undefined); return; }
    this.keySel = r.sel;
    for (const id of r.sel.keys()) this.sel.add(id);
    if (targets.length < kc.items.length) toast(`Se copiaron ${kc.items.length} capas y hay ${targets.length} ${targets.length === 1 ? 'clip elegido' : 'clips elegidos'}: se pegan las primeras.`);
    this.emit('select', undefined);
  }
  /** Vista previa de pegado: en la línea de tiempo se ven los rombos donde caerán; clic para pegar, Esc para cancelar. */
  beginPastePreview() {
    if (!this.keyClip) { toast('Primero copia keyframes.'); return; }
    this.pastePreviewOn = true;
    toast('Mueve el puntero por la línea de tiempo y haz clic donde pegar (Esc: cancelar · Intro: en el cabezal)');
    this.emit('select', undefined);
  }
  cancelPastePreview() { if (this.pastePreviewOn) { this.pastePreviewOn = false; this.emit('select', undefined); } }

  deleteKeyframes() {
    if (!this.hasKeySel) return;
    let n = 0;
    this.edit('Borrar keyframes', (_m, comp) => { for (const e of this.keyEntries()) { const c = findClip(comp, e.id); if (c) n += deleteKeysAt(c, e.times, e.path ? [e.path] : null); } return n > 0; });
    this.keySel.clear();
    this.emit('select', undefined);
  }

  easeKeyframes(e: Parameters<typeof easeKeysAt>[2]) {
    if (!this.hasKeySel) return;
    this.edit('Curva de keyframes', (_m, comp) => { for (const x of this.keyEntries()) { const c = findClip(comp, x.id); if (c) easeKeysAt(c, x.times, e, x.path ? [x.path] : null); } });
  }

  copy(cut = false) {
    if (this.hasKeySel) { this.copyKeyframes(); if (cut) this.deleteKeyframes(); return; }
    const s = this.selected;
    if (!s.length) return;
    this.clipboard = clone(s);
    this.lastCopy = 'clips';
    toast(`${s.length} ${s.length === 1 ? 'clip copiado' : 'clips copiados'}`);
    if (cut) this.remove(false);
  }
  paste() {
    if (this.lastCopy === 'keys' && this.keyClip) { this.pasteKeyframes(); return; }
    if (!this.clipboard.length) return;
    const t0 = Math.min(...this.clipboard.map(c => c.start));
    this.edit('Pegar', (m, comp) => {
      const out: Clip[] = [];
      for (const src of this.clipboard) {
        // Un clip de otra composición o con un medio que ya no está: se omite.
        if (src.kind === 'media' && !m.media.some(x => x.id === src.media)) continue;
        if (src.kind === 'comp' && (!m.comps.some(x => x.id === src.comp) || src.comp === comp.id)) continue;
        const c = clone(src);
        c.id = mid('cl');
        c.start = this.time + (src.start - t0);
        const kind = comp.tracks.find(t => t.id === c.track)?.kind ?? (c.kind === 'media' && m.media.find(x => x.id === (c as { media: string }).media)?.kind === 'audio' ? 'audio' : 'visual');
        c.track = this.freeTrack(comp, kind, c.start, c.dur, c.track).id;
        comp.clips.push(c);
        out.push(c);
      }
      this.sel = new Set(out.map(c => c.id));
      return out.length > 0;
    });
    this.emit('select', undefined);
  }
  copyAttributes() { const c = this.one; if (!c) { toast('Elige un clip para copiar sus atributos.'); return; } this.attrs = copyAttrs(c); toast('Atributos copiados (transformación, efectos, máscaras, transiciones)'); }
  pasteAttributes(what?: { tf?: boolean; fx?: boolean; masks?: boolean; trans?: boolean }) {
    const a = this.attrs;
    if (!a || !this.sel.size) { toast(a ? 'Elige los clips donde pegar.' : 'Primero copia los atributos de un clip.'); return; }
    this.edit('Pegar atributos', () => { for (const c of this.selected) pasteAttrs(c, a, what); });
  }
  get hasAttrs() { return !!this.attrs; }
  group() { if (this.sel.size < 2) { toast('Elige dos o más clips para agruparlos.'); return; } let g = false; this.edit('Agrupar', (_m, comp) => { g = toggleGroup(comp, [...this.sel]); }); toast(g ? 'Clips agrupados (se mueven juntos)' : 'Grupo deshecho'); }
  precompose() {
    if (!this.sel.size) return;
    this.edit('Precomponer', (m, comp) => { const cc = precompose(m, comp, [...this.sel], `Precomp ${m.comps.length}`); if (cc) this.sel = new Set([cc.id]); return !!cc; });
    this.emit('select', undefined);
  }
  freeze() {
    const c = this.one;
    if (!c || c.kind !== 'media' || this.m.media.find(x => x.id === c.media)?.kind !== 'video') { toast('Elige un clip de vídeo y pon el cabezal donde congelar.'); return; }
    this.edit('Congelar fotograma', (m, comp) => !!freezeFrame(comp, m, c.id, this.time));
  }
  nudge(frames: number) {
    if (this.hasKeySel) { this.nudgeKeys(frames); return; }
    const ids = [...this.sel];
    if (!ids.length) return;
    this.edit('Mover', (_m, comp) => moveClips(comp, ids, frames / comp.fps));
  }
  trimTo(edge: 'l' | 'r') {
    const t = this.time;
    const sel = this.selected.length ? this.selected : this.comp.clips.filter(c => c.start < t && clipEnd(c) > t);
    if (!sel.length) return;
    this.edit(edge === 'l' ? 'Recortar inicio' : 'Recortar final', (m, comp) => { for (const c of sel) if (c.start < t && clipEnd(c) > t) trimClip(comp, m, c.id, edge, t, this.prefs.ripple); });
  }
  /** Keyframe en el cabezal de posición, escala, giro y opacidad de los clips elegidos. */
  keyTransform() {
    const sel = this.selected.filter(c => this.time >= c.start && this.time <= clipEnd(c));
    if (!sel.length) { toast('Elige un clip bajo el cabezal.'); return; }
    this.edit('Keyframe de transformación', () => {
      for (const c of sel) {
        const lt = this.time - c.start;
        const ps = [c.tf.x, c.tf.y, c.tf.sx, c.tf.sy, c.tf.rot, c.tf.opacity];
        const all = ps.every(p => keyAt(p, lt));
        for (const p of ps) if (all || !keyAt(p, lt)) toggleKey(p, lt);
      }
    });
  }
  /** Saltar al keyframe anterior/siguiente de los clips elegidos. */
  jumpKey(dir: 1 | -1) {
    const ts: number[] = [];
    for (const c of this.selected) forEachProp(c, p => { for (const k of p.k ?? []) ts.push(c.start + k.t); });
    const t = this.time;
    const x = dir > 0 ? ts.filter(v => v > t + 1e-6).sort((a, b) => a - b)[0] : ts.filter(v => v < t - 1e-6).sort((a, b) => b - a)[0];
    if (x !== undefined) this.seek(x);
  }

  /** Cambia una propiedad animable: si ya tiene keyframes, crea o mueve el del cabezal. */
  setProp<T>(c: Clip, p: Prop<T>, v: T, liveOnly = false) {
    const lt = this.localT(c);
    const fn = () => setValue(p, lt, v, this.autoKey);
    if (liveOnly) this.live(fn); else this.edit('Cambiar propiedad', fn);
  }
  valueNow<T>(c: Clip, p: Prop<T>): T { return valueAt(p, this.localT(c)); }
  /** Tiempo del cabezal dentro del clip (s, al fotograma y dentro del clip). */
  localT(c: Clip) { return Math.max(0, Math.min(c.dur, Math.round((this.time - c.start) * this.fps) / this.fps)); }
  get autoKey() { return this.prefs.autoKey; }
  setAutoKey(on: boolean) { this.prefs.autoKey = on; this.deps.persist(); this.emit('select', undefined); toast(on ? 'Auto Keyframe activado: cada cambio crea su keyframe en el cabezal' : 'Auto Keyframe desactivado'); }
  get keySync() { return this.prefs.keySync; }
  setKeySync(on: boolean) { this.prefs.keySync = on; this.deps.persist(); this.emit('select', undefined); toast(on ? 'Sincronizar: los rombos actúan en todos los clips elegidos' : 'Sincronizar desactivado: los rombos actúan sólo en su clip'); }
  isAnimated(p: Prop<unknown>) { return animated(p); }

  // ---------------------------------------------------------------- crear y quitar keyframes (1.11.0)

  /** Clips donde actúa un rombo de `c`: con «Sincronizar», todos los elegidos que tengan esa propiedad. */
  syncTargets(c: Clip, path: string): Clip[] {
    if (!this.keySync || !this.sel.has(c.id) || this.sel.size < 2) return [c];
    return this.selected.filter(x => !!propByPath(x, path) && this.time >= x.start - 1e-6 && this.time <= clipEnd(x) + 1e-6);
  }
  /**
   * Rombo de una propiedad: si hay keyframe en el cabezal lo quita; si no, lo crea con el
   * valor actual. Con «Sincronizar» lo hace en todos los clips elegidos (cada uno con su valor).
   */
  toggleKeyPath(clipId: string, path: string) {
    const c = findClip(this.comp, clipId);
    if (!c) return;
    const p = propByPath(c, path);
    if (!p) return;
    const on = !!keyAt(p, this.localT(c));
    const targets = this.syncTargets(c, path).map(x => x.id);
    const lab = propLabel(c, path);
    this.edit(on ? `Quitar keyframe de ${lab}` : targets.length > 1 ? `Keyframe de ${lab} en ${targets.length} clips` : `Keyframe de ${lab}`, (_m, comp) => {
      for (const id of targets) {
        const x = findClip(comp, id), q = x && propByPath(x, path);
        if (!x || !q) continue;
        const lt = this.localT(x), has = !!keyAt(q, lt);
        if (on === has) toggleKey(q, lt);
      }
    });
  }
  /**
   * Crea keyframes en el cabezal sin duplicar: de `paths` o, si no se indican, de la
   * propiedad elegida (fila de la línea de tiempo) o de las animadas de cada clip
   * (posición, escala, giro y opacidad si no tiene ninguna). En todos los clips elegidos.
   */
  addKeysNow(paths?: string[]) {
    const sel = this.selected.filter(c => this.time >= c.start - 1e-6 && this.time <= clipEnd(c) + 1e-6);
    if (!sel.length) { toast(this.sel.size ? 'El cabezal está fuera de los clips elegidos.' : 'Elige uno o más clips bajo el cabezal.'); return; }
    const focus = !paths && this.focus && this.sel.has(this.focus.clip) ? [this.focus.path] : null;
    let n = 0;
    this.edit(sel.length > 1 ? `Keyframes en ${sel.length} clips` : 'Keyframe', (_m, comp) => {
      for (const c0 of sel) {
        const c = findClip(comp, c0.id)!;
        let ps = paths ?? focus;
        if (!ps) { ps = []; forEachProp(c, (p, path) => { if (p.k?.length) ps!.push(path); }); if (!ps.length) ps = ['tf.x', 'tf.y', 'tf.sx', 'tf.sy', 'tf.rot', 'tf.opacity']; }
        const lt = this.localT(c);
        for (const path of ps) { const p = propByPath(c, path); if (p && !keyAt(p, lt)) { setValue(p, lt, valueAt(p, lt), true); n++; } }
      }
      return n > 0;
    });
    toast(n ? `${n} ${n === 1 ? 'keyframe creado' : 'keyframes creados'}${sel.length > 1 ? ` en ${sel.length} clips` : ''}` : 'Ya hay keyframes en el cabezal.', n ? 'ok' : 'info');
  }
  /** Quita los keyframes del cabezal (de la propiedad elegida o de todas) en los clips elegidos. */
  removeKeysNow() {
    const focus = this.focus && this.sel.has(this.focus.clip) ? this.focus.path : null;
    let n = 0;
    this.edit('Quitar keyframes del cabezal', (_m, comp) => {
      for (const c0 of this.selected) {
        const c = findClip(comp, c0.id)!, lt = this.localT(c);
        forEachProp(c, (p, path) => { if ((!focus || path === focus || this.sel.size > 1) && keyAt(p, lt)) { toggleKey(p, lt); n++; } });
      }
      return n > 0;
    });
    if (!n) toast('No hay keyframes en el cabezal.');
  }
  /** Keyframes de una propiedad en los clips elegidos (fila del inspector con varios clips). */
  keyPathOnSelected(path: string) {
    const sel = this.selected.filter(c => propByPath(c, path) && this.time >= c.start - 1e-6 && this.time <= clipEnd(c) + 1e-6);
    if (!sel.length) return;
    const allOn = sel.every(c => !!keyAt(propByPath(c, path)!, this.localT(c)));
    this.edit(`${allOn ? 'Quitar' : 'Crear'} keyframes de ${propLabel(sel[0], path)}`, (_m, comp) => {
      for (const c0 of sel) { const c = findClip(comp, c0.id)!, p = propByPath(c, path)!, lt = this.localT(c); if (allOn === !!keyAt(p, lt)) toggleKey(p, lt); }
    });
  }

  // ---------------------------------------------------------------- curvas de los keyframes elegidos

  private segEdit(label: string, fn: (k: Parameters<typeof setEase>[0]) => boolean | void, keysOnly = true) {
    if (keysOnly && !this.hasKeySel) { toast('Elige uno o más keyframes (rombos).'); return 0; }
    let n = 0;
    this.edit(label, (_m, comp) => { for (const x of this.keyEntries()) { const c = findClip(comp, x.id); if (c) n += eachSegmentKey(c, x.times, fn, x.path ? [x.path] : null); } return n > 0; });
    if (!n) toast('Elige keyframes que tengan otro después (la curva va hacia el siguiente).');
    return n;
  }
  /** Curva (preset o personalizada) en todos los keyframes elegidos. */
  applyEase(spec: EaseSpec, label = 'Curva') { this.segEdit(label, k => { setEase(k, spec); }); }
  /** Suavizado automático (tangentes continuas) de los keyframes elegidos o, si no hay, de todo el clip elegido. */
  smoothSel() {
    const sel = this.hasKeySel ? this.keyEntries() : this.selected.map(c => ({ id: c.id, times: null, path: null }));
    let n = 0;
    this.edit('Suavizar automáticamente', (_m, comp) => { for (const x of sel) { const c = findClip(comp, x.id); if (c) n += smoothKeys(c, x.times, x.path ? [x.path] : null); } return n > 0; });
    if (!n) toast('No hay tramos numéricos que suavizar.');
  }
  invertCurves() { let bad = 0; this.segEdit('Invertir curvas', k => { if (!invertEase(k)) { bad++; return false; } return true; }); if (bad) toast(`${bad} con rebote, elástico o rebasar no tienen inversa simple y se dejan igual.`); }
  copyEase() {
    for (const x of this.keyEntries()) {
      const c = findClip(this.comp, x.id);
      let found: EaseSpec | null = null;
      if (c) eachSegmentKey(c, x.times, k => { found ??= easeSpecOf(k); }, x.path ? [x.path] : null);
      if (found) { this.easeClip = found; toast('Curva copiada: elige otros keyframes y pégala', 'ok'); return; }
    }
    toast('Elige un keyframe que tenga otro después.');
  }
  get hasEaseClip() { return !!this.easeClip; }
  pasteEase() { if (!this.easeClip) { toast('Primero copia una curva.'); return; } this.applyEase(this.easeClip, 'Pegar curva'); }

  // ---------------------------------------------------------------- repetir, bucle, alinear, congelar

  /** Repite los keyframes elegidos `count` veces (`dir` = hacia delante o atrás), con `gap` s entre repeticiones. */
  repeatSel(count: number | 'fill', gap = 0, o: { dir?: 1 | -1; pingpong?: boolean } = {}) {
    if (!this.hasKeySel) { toast('Elige los keyframes de la animación que quieres repetir.'); return; }
    const next = new Map<string, number[]>();
    let n = 0;
    this.edit(o.pingpong ? 'Bucle ida y vuelta' : count === 'fill' ? 'Bucle hasta el final' : `Repetir ×${count}`, (_m, comp) => {
      for (const x of this.keyEntries()) {
        const c = findClip(comp, x.id);
        if (!c) continue;
        const k = count === 'fill' ? repeatsToFill(c, x.times, gap, comp.fps, o.dir ?? 1) : count;
        const out = repeatKeys(c, x.times, k, gap, comp.fps, { ...o, paths: x.path ? [x.path] : null });
        n += out.length;
        next.set(x.key, [...x.times, ...out]);
      }
      return n > 0;
    });
    if (!n) { toast('No cabe ninguna repetición dentro del clip (alárgalo o reduce el espacio).'); return; }
    this.keySel = next;
    this.emit('select', undefined);
  }
  /** Cada clip: su primer keyframe elegido al cabezal (la animación de todas las capas empieza a la vez). */
  alignKeys() {
    this.retime('Alinear keyframes al cabezal', (c, ts) => { const dt = this.localT(c) - ts[0]; return t => t + dt; });
  }
  /** Escalona las capas: la animación de cada clip empieza `frames` fotogramas después que la anterior. */
  staggerKeys(frames: number) {
    const ids = [...new Set(this.keyEntries().map(e => e.id))].map(id => findClip(this.comp, id)).filter((c): c is Clip => !!c).sort((a, b) => this.comp.tracks.findIndex(t => t.id === a.track) - this.comp.tracks.findIndex(t => t.id === b.track) || a.start - b.start).map(c => c.id);
    const t0 = this.keySelStart();
    this.retime('Escalonar animaciones', (c, ts) => { const i = ids.indexOf(c.id); const dt = t0 + (i * frames) / this.fps - (c.start + ts[0]); return t => t + dt; });
  }
  /** Congela la animación de los clips elegidos en el cabezal (antes se anima; después queda fija). */
  freezeAnim() {
    let n = 0;
    this.edit('Congelar animación', (_m, comp) => { for (const c0 of this.selected) { const c = findClip(comp, c0.id)!; n += freezeAt(c, this.localT(c)); } return n > 0; });
    toast(n ? `Animación congelada en el cabezal (${n} ${n === 1 ? 'propiedad' : 'propiedades'})` : 'Los clips elegidos no tienen animación.');
  }

  // ---------------------------------------------------------------- animación rápida

  /** Aplica una animación rápida a los clips elegidos (con su duración, intensidad, dirección y curva). */
  quick(spec: QuickSpec, label: string) {
    const sel = this.selected;
    if (!sel.length) { toast('Elige uno o más clips.'); return; }
    let n = 0;
    this.edit(`Animación rápida: ${label}`, (_m, comp) => { for (const c0 of sel) { const c = findClip(comp, c0.id)!; n += quickAnimate(c, { ...spec, at: spec.at < 0 ? this.localT(c) : spec.at }, comp.w, comp.h, comp.fps); } return n > 0; });
  }
  /** Movimiento de cámara (acercamiento con deriva) a lo largo de los clips elegidos o de la composición. */
  quickCamera(intensity: number, ease: EaseSpec) {
    const sel = this.selected;
    const a = sel.length ? Math.min(...sel.map(c => c.start)) : 0, b = sel.length ? Math.max(...sel.map(clipEnd)) : this.comp.dur;
    this.edit('Animación rápida: cámara', (_m, comp) => {
      const cam = comp.camera;
      cam.on = true;
      const z0 = valueAt(cam.zoom, a), x0 = valueAt(cam.x, a), y0 = valueAt(cam.y, a);
      for (const [p, v0, v1] of [[cam.zoom, z0, z0 * (1 + 0.2 * intensity)], [cam.x, x0, x0 - comp.w * 0.03 * intensity], [cam.y, y0, y0 - comp.h * 0.02 * intensity]] as const) {
        setValue(p, a, v0, true); setValue(p, b, v1, true);
        const k = keyAt(p, a); if (k) setEase(k, ease);
      }
    });
    toast('Cámara 2D animada (composición → Cámara 2D)', 'ok');
  }
  /** Animación de texto: letras que aparecen a lo largo de `len` segundos desde el cabezal. */
  quickText(kind: 'typewriter' | 'chars-fade' | 'chars-up' | 'words-pop', len: number, ease: EaseSpec) {
    const sel = this.selected.filter(c => c.kind === 'text');
    if (!sel.length) { toast('Elige un clip de texto.'); return; }
    this.edit('Animación de texto', (_m, comp) => {
      for (const c0 of sel) {
        const c = findClip(comp, c0.id) as Extract<Clip, { kind: 'text' }>;
        const a = this.localT(c), b = Math.min(c.dur, a + len);
        c.anim = kind;
        c.reveal = { v: 0, k: [{ t: a, v: 0, e: 'linear' }, { t: b, v: 1, e: 'linear' }] };
        setEase(c.reveal.k![0], ease);
      }
    });
  }

  // ---------------------------------------------------------------- capas: vínculos, guía, ajuste, búsqueda

  /** Vincula propiedades de los clips elegidos a `srcId` (siguen su animación conservando su posición actual). */
  linkTo(srcId: string, paths: string[]) {
    const src = findClip(this.comp, srcId);
    const kids = this.selected.filter(c => c.id !== srcId);
    if (!src || !kids.length) { toast('Elige los clips que van a seguir a otro.'); return; }
    if (kids.some(c => linkLoops(this.comp, c, src))) { toast('Ese vínculo formaría un círculo.', 'error'); return; }
    this.edit('Vincular propiedades', (_m, comp) => { for (const k of kids) { const c = findClip(comp, k.id)!; c.link = makeLink(comp, c, findClip(comp, srcId)!, paths, this.time); } });
    toast(`${kids.length === 1 ? 'El clip sigue' : `${kids.length} clips siguen`} a «${src.name}»`, 'ok');
  }
  unlink() { const ids = this.selected.filter(c => c.link).map(c => c.id); if (!ids.length) return; this.edit('Desvincular', (_m, comp) => { for (const id of ids) findClip(comp, id)!.link = null; }); }
  toggleGuide() { const on = !this.selected.every(c => c.guide); this.edit(on ? 'Capa guía' : 'Quitar capa guía', (_m, comp) => { for (const c of this.selected) findClip(comp, c.id)!.guide = on; }); if (on) toast('Capa guía: se ve al editar pero no se exporta.'); }
  /** Capa de ajuste: un sólido cuyos efectos se aplican a todo lo que hay debajo. */
  addAdjustment() {
    this.edit('Añadir capa de ajuste', (_m, comp) => {
      const tr = this.freeTrack(comp, 'visual', this.time, 5);
      const c = solidClip(comp, tr.id, this.time, '#ffffff');
      c.name = 'Ajuste'; c.adjust = true;
      comp.clips.push(c);
      this.sel = new Set([c.id]);
    });
    this.emit('select', undefined);
    toast('Capa de ajuste: añádele efectos (pestaña Efectos) y afectarán a todo lo de debajo.', 'ok');
  }
  /** Elige los clips cuyo nombre contiene `q`. */
  findClips(q: string): number {
    const t = q.trim().toLowerCase();
    const hits = t ? this.comp.clips.filter(c => c.name.toLowerCase().includes(t) || (c.kind === 'text' && c.text.toLowerCase().includes(t))) : [];
    this.select(hits.map(c => c.id));
    return hits.length;
  }
  /** Duración rápida de los clips elegidos (s). */
  setDuration(d: number) {
    if (!this.sel.size) return;
    this.edit('Duración', (m, comp) => { for (const c0 of this.selected) { const c = findClip(comp, c0.id)!; trimClip(comp, m, c.id, 'r', c.start + Math.max(1 / comp.fps, d), this.prefs.ripple); } });
  }

  // ---------------------------------------------------------------- pistas

  setTrackOpen(ids: string[] | 'all', open: boolean) {
    this.edit(open ? 'Desplegar propiedades' : 'Plegar propiedades', (_m, comp) => { for (const t of comp.tracks) if (ids === 'all' || ids.includes(t.id)) t.open = open; });
  }
  setTrackHeight(ids: string[] | 'all', hgt: number | null) {
    this.edit('Altura de pista', (_m, comp) => { for (const t of comp.tracks) if (ids === 'all' || ids.includes(t.id)) { if (hgt === null) delete t.h; else t.h = Math.max(24, Math.min(200, Math.round(hgt))); } });
  }

  // ---------------------------------------------------------------- marcadores e intervalo

  addMarker(name = '') {
    this.edit('Añadir marcador', (_m, comp) => { comp.markers.push({ id: mid('mk'), t: this.time, name: name || `Marcador ${comp.markers.length + 1}`, color: '#ffb347' }); });
  }
  setRange(edge: 'in' | 'out' | 'clear') {
    this.edit('Intervalo de trabajo', (_m, comp) => {
      if (edge === 'clear') { comp.range = null; return; }
      const r = comp.range ?? [0, comp.dur];
      if (edge === 'in') r[0] = Math.min(this.time, r[1] - 1 / comp.fps); else r[1] = Math.max(this.time, r[0] + 1 / comp.fps);
      comp.range = [r[0], r[1]];
    });
  }

  // ---------------------------------------------------------------- miniatura del proyecto

  /** PNG del fotograma actual (o de 1 s) para la galería. */
  async thumbnail(): Promise<Uint8Array | null> {
    if (!this.hist) return null;
    const comp = compOf(this.m, this.m.main);
    const k = Math.min(1, 640 / Math.max(comp.w, comp.h));
    const c = document.createElement('canvas');
    const t = this.m.open === comp.id && this.time > 0 ? this.time : Math.min(1, comp.dur / 2);
    await this.player.comp.render(this.m, comp, t, c, { scale: k, preview: true, exact: true });
    const b = await new Promise<Blob | null>(r => c.toBlob(r, 'image/png'));
    return b ? new Uint8Array(await b.arrayBuffer()) : null;
  }
}

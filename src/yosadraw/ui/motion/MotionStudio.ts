import type { StrokePainter } from '../../brush/StrokePainter';
import type { Document } from '../../doc/Document';
import type { CanvasEngine } from '../../engine';
import { Emitter } from '../../engine/Emitter';
import { animated, keyAt, setValue, toggleKey, valueAt, type Prop } from '../../motion/keys';
import { MediaManager } from '../../motion/media';
import {
  clipEnd, clone, compClip, compOf, copyAttrs, deleteClips, duplicateClips, findClip, forEachProp, freezeFrame, mediaClip, mid, MotionHistory, moveClips, newTrack,
  pasteAttrs, precompose, copyKeys, pasteKeys, deleteKeysAt, easeKeysAt, type KeyClipboard, shapeClip, solidClip, splitClip, textClip, toggleGroup, trimClip,
  type Attrs, type Clip, type Composition, type MediaItem, type Motion, type ShapeType, type Track,
} from '../../motion/model';
import { Player } from '../../motion/player';
import type { ProjectLibrary } from '../../project/library';
import { toast } from '../dom';
import { MotionKeys } from './shortcuts';
import type { MotionPrefs } from './prefs';

export type { MotionPrefs } from './prefs';
export { normalizeMotionPrefs } from './prefs';

export type MotionTool = 'select' | 'razor' | 'text' | 'shape' | 'mask';

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
  /** Keyframes elegidos en la línea de tiempo: clip → tiempos (s del clip). */
  keySel = new Map<string, number[]>();
  private keyClip: KeyClipboard | null = null;
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
    for (const id of [...this.keySel.keys()]) if (!this.sel.has(id)) this.keySel.delete(id);
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
    const ids = [...this.sel];
    if (!ids.length) return;
    this.edit('Duplicar', (_m, comp) => { const out = duplicateClips(comp, ids); this.sel = new Set(out.map(c => c.id)); });
    this.emit('select', undefined);
  }
  // ---------------------------------------------------------------- keyframes

  /** Elige keyframes (por tiempo) de un clip; `add` suma a la selección. */
  selectKeys(clipId: string, times: number[], add = false) {
    if (!add) this.keySel.clear();
    const cur = this.keySel.get(clipId) ?? [];
    for (const t of times) { const i = cur.findIndex(x => Math.abs(x - t) < 1e-3); if (i >= 0 && add && times.length === 1) cur.splice(i, 1); else if (i < 0) cur.push(t); }
    if (cur.length) this.keySel.set(clipId, cur); else this.keySel.delete(clipId);
    this.emit('select', undefined);
  }
  clearKeys() { if (this.keySel.size) { this.keySel.clear(); this.emit('select', undefined); } }
  get hasKeySel() { return [...this.keySel.values()].some(v => v.length); }
  get hasKeyClip() { return !!this.keyClip; }

  /** Copia keyframes: los elegidos; si no hay, los de `paths` o todos los del clip elegido. */
  copyKeyframes(paths?: string[] | 'all') {
    let kc: KeyClipboard | null = null;
    if (this.hasKeySel && !paths) {
      const [id, times] = [...this.keySel.entries()][0];
      const c = findClip(this.comp, id);
      if (c) kc = copyKeys(c, times);
    } else if (this.one) kc = copyKeys(this.one, null, Array.isArray(paths) ? paths : null);
    if (!kc) { toast('No hay keyframes que copiar.'); return; }
    this.keyClip = kc;
    this.lastCopy = 'keys';
    const n = kc.items.reduce((a, i) => a + i.keys.length, 0);
    toast(`${n} ${n === 1 ? 'keyframe copiado' : 'keyframes copiados'}: pégalos en cualquier clip con el cabezal donde quieras`, 'ok');
  }

  /** Pega los keyframes copiados en el cabezal de los clips elegidos (`onto` = en esa propiedad). */
  pasteKeyframes(onto?: string) {
    const kc = this.keyClip;
    if (!kc) { toast('Primero copia keyframes.'); return; }
    const targets = this.selected;
    if (!targets.length) { toast('Elige el clip donde pegar los keyframes.'); return; }
    let n = 0;
    this.edit('Pegar keyframes', () => { for (const c of targets) n += pasteKeys(c, kc, Math.max(0, this.time - c.start), onto); return n > 0; });
    if (!n) toast(onto ? 'Esa propiedad no admite estos keyframes (otro tipo de valor).' : 'El clip no tiene esas propiedades (p. ej. otro efecto).', 'error');
  }

  deleteKeyframes() {
    if (!this.hasKeySel) return;
    let n = 0;
    this.edit('Borrar keyframes', (_m, comp) => { for (const [id, times] of this.keySel) { const c = findClip(comp, id); if (c) n += deleteKeysAt(c, times); } return n > 0; });
    this.keySel.clear();
    this.emit('select', undefined);
  }

  easeKeyframes(e: Parameters<typeof easeKeysAt>[2]) {
    if (!this.hasKeySel) return;
    this.edit('Curva de keyframes', (_m, comp) => { for (const [id, times] of this.keySel) { const c = findClip(comp, id); if (c) easeKeysAt(c, times, e); } });
  }

  copy(cut = false) {
    if (this.hasKeySel && !cut) { this.copyKeyframes(); return; }
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
    const lt = Math.max(0, Math.min(c.dur, this.time - c.start));
    const fn = () => setValue(p, lt, v, false);
    if (liveOnly) this.live(fn); else this.edit('Cambiar propiedad', fn);
  }
  valueNow<T>(c: Clip, p: Prop<T>): T { return valueAt(p, Math.max(0, Math.min(c.dur, this.time - c.start))); }
  isAnimated(p: Prop<unknown>) { return animated(p); }

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

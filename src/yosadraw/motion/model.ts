import type { LayerBlend } from '../doc/items';
import { applyPreset, cutKeys, prop, valueAt, type Key, type MotionPreset, type Prop } from './keys';

/**
 * YOSADRAW MOTION — modelo del editor de vídeo y motion graphics.
 *
 * Un proyecto de vídeo es un proyecto .yosa normal con `doc.motion`: así usa la
 * galería, el guardado automático, la recuperación y las versiones de siempre.
 * Los medios pesados (vídeo, audio, imágenes) no van dentro del proyecto en cada
 * guardado: se guardan una vez en el almacén (`m/<id>`) y el proyecto los cita.
 *
 * Tiempos en segundos. Todo cambio es un comando con instantánea (JSON pequeño:
 * sin medios), así deshacer/rehacer es exacto y el historial se puede listar.
 */

/** 2 (1.11.0): altura y propiedades desplegadas por pista; capas guía, de ajuste y propiedades vinculadas. */
export const MOTION_VERSION = 2;
export const FPS_PRESETS = [23.976, 24, 25, 30, 50, 60];

export type MediaKind = 'video' | 'audio' | 'image' | 'gif' | 'svg' | 'seq' | 'font' | 'drawing' | 'anim' | 'lut';
export interface MediaItem {
  id: string;
  name: string;
  kind: MediaKind;
  mime: string;
  size: number;
  /** Tamaño en px (visuales), duración (s), fps (vídeo/secuencia/animación), fotogramas (secuencia, GIF). */
  w: number; h: number; dur: number; fps: number; frames: number;
  hasAudio: boolean;
  /** Proyecto de YOSADRAW de origen (dibujo o animación) y capa concreta (null = todas). */
  project?: { id: string; rev: number; layer: string | null; paper: boolean } | null;
  /** Versión reducida para editar con fluidez (escritorio). */
  proxy?: boolean;
  /** Copia compatible (MP4 H.264) creada al importar un formato que el sistema no reproduce. */
  conv?: boolean;
  /** Carpeta de la biblioteca. */
  folder: string;
  added: number;
}

export interface Track {
  id: string; name: string;
  /** Visual (vídeo, imágenes, texto, formas…) o sólo audio. */
  kind: 'visual' | 'audio';
  hidden: boolean; locked: boolean; muted: boolean; solo: boolean;
  /** Paralaje respecto a la cámara 2D (1 = normal, 0 = fija, >1 = más cerca). */
  parallax: number;
  /** Altura de la fila en la línea de tiempo (px; por defecto según el tipo). */
  h?: number;
  /** Propiedades animadas desplegadas debajo de la pista. */
  open?: boolean;
}

export interface Transform { x: Prop; y: Prop; sx: Prop; sy: Prop; rot: Prop; opacity: Prop; ax: Prop; ay: Prop; skx: Prop; sky: Prop }
export interface FxInst { id: string; fx: string; on: boolean; p: Record<string, Prop<number | string | boolean>> }
export interface Mask { id: string; type: 'rect' | 'ellipse'; x: Prop; y: Prop; w: Prop; h: Prop; feather: Prop; invert: boolean; mode: 'add' | 'subtract' }
export type TransitionType = 'none' | 'fade' | 'slide-l' | 'slide-r' | 'slide-u' | 'slide-d' | 'zoom' | 'zoom-out' | 'spin' | 'pop' | 'swing' | 'wipe-l' | 'wipe-r' | 'wipe-u' | 'wipe-d' | 'iris' | 'blinds' | 'flash' | 'glitch' | 'blur';
export interface Transition { type: TransitionType; dur: number }
export const TRANSITIONS: [TransitionType, string][] = [
  ['none', 'Ninguna'], ['fade', 'Fundido'], ['slide-l', 'Deslizar ←'], ['slide-r', 'Deslizar →'], ['slide-u', 'Deslizar ↑'], ['slide-d', 'Deslizar ↓'],
  ['zoom', 'Zoom'], ['zoom-out', 'Zoom desde cerca'], ['spin', 'Giro'], ['pop', 'Rebote (pop)'], ['swing', 'Balanceo'],
  ['wipe-l', 'Barrido ←'], ['wipe-r', 'Barrido →'], ['wipe-u', 'Barrido ↑'], ['wipe-d', 'Barrido ↓'], ['iris', 'Iris (círculo)'],
  ['blinds', 'Persianas'], ['flash', 'Destello'], ['glitch', 'Glitch'], ['blur', 'Desenfoque'],
];

interface ClipBase {
  id: string;
  track: string;
  name: string;
  /** Inicio y duración en la línea de tiempo (s). */
  start: number;
  dur: number;
  enabled: boolean;
  group: string | null;
  blend: LayerBlend;
  tf: Transform;
  fx: FxInst[];
  masks: Mask[];
  tin: Transition;
  tout: Transition;
  /** Recorte del origen (fracciones: izquierda, arriba, derecha, abajo). */
  crop: [number, number, number, number];
  /** Capa guía: se ve al editar pero no se exporta. */
  guide?: boolean;
  /** Capa de ajuste (sólo sólidos): sus efectos y máscaras se aplican a lo que hay debajo. */
  adjust?: boolean;
  /** Propiedades vinculadas a las de otro clip (siguen su animación con un desfase fijo). */
  link?: ClipLink | null;
}
export interface ClipLink { to: string; paths: string[]; off: Record<string, number> }
export interface MediaClip extends ClipBase {
  kind: 'media';
  media: string;
  /** Segundo del origen en que empieza el clip. */
  in: number;
  speed: number;
  reverse: boolean;
  /** Congelado en este segundo del origen (null = no). */
  freeze: number | null;
  volume: Prop;
  pan: Prop;
  fadeIn: number;
  fadeOut: number;
  /** Repetir el origen si el clip es más largo. */
  loop: boolean;
}
export type TextAnim = 'none' | 'typewriter' | 'chars-fade' | 'chars-up' | 'words-pop';
export interface TextClip extends ClipBase {
  kind: 'text';
  text: string; font: string; size: number; weight: number; italic: boolean; align: 'left' | 'center' | 'right'; lineH: number;
  fill: Prop<string>; grad: { on: boolean; c2: Prop<string>; angle: number };
  stroke: { on: boolean; color: Prop<string>; w: Prop };
  shadow: { on: boolean; color: string; blur: number; dx: number; dy: number };
  bg: { on: boolean; color: string; pad: number; radius: number };
  /** Progreso de la animación de texto (0..1). */
  reveal: Prop; anim: TextAnim;
  /** Curvatura (texto en arco: -1..1) y espaciado entre letras (px). */
  bend: Prop; spacing: Prop;
}
export type ShapeType = 'rect' | 'ellipse' | 'polygon' | 'star' | 'line' | 'arrow';
export interface ShapeClip extends ClipBase {
  kind: 'shape';
  shape: ShapeType; w: Prop; h: Prop; sides: number; inner: number; radius: Prop;
  fillOn: boolean; fill: Prop<string>; grad: { on: boolean; c2: Prop<string>; angle: number };
  strokeOn: boolean; stroke: Prop<string>; strokeW: Prop; dash: number;
  /** Trazado progresivo (0..1): dibuja el contorno poco a poco. */
  trim: Prop;
}
export interface SolidClip extends ClipBase { kind: 'solid'; color: Prop<string> }
export interface CompClip extends ClipBase { kind: 'comp'; comp: string; in: number; speed: number }
export type Clip = MediaClip | TextClip | ShapeClip | SolidClip | CompClip;

export interface Marker { id: string; t: number; name: string; color: string }
export interface Camera { on: boolean; x: Prop; y: Prop; zoom: Prop; rot: Prop }
export interface Composition {
  id: string; name: string;
  w: number; h: number; fps: number; dur: number;
  bg: string | null;
  tracks: Track[];
  clips: Clip[];
  markers: Marker[];
  camera: Camera;
  /** Intervalo de trabajo (reproducción y exportación) o null = todo. */
  range: [number, number] | null;
}
export interface Preset { id: string; name: string; kind: 'fx' | 'anim' | 'attrs'; data: unknown }
export interface Motion {
  version: number;
  comps: Composition[];
  main: string;
  /** Composición abierta en el visor. */
  open: string;
  media: MediaItem[];
  folders: string[];
  presets: Preset[];
  /** Tiempo del cabezal (s) en la composición abierta. */
  time: number;
  snap: boolean;
}

let seq = 0;
export const mid = (p: string) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
export const clone = <T>(v: T): T => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));
export const frameOf = (c: Composition, t: number) => Math.round(t * c.fps);
export const snapTime = (c: Composition, t: number) => Math.max(0, Math.round(t * c.fps) / c.fps);
export const clipEnd = (c: Clip) => c.start + c.dur;

export function newTransform(x: number, y: number, s = 1): Transform {
  return { x: prop(x), y: prop(y), sx: prop(s), sy: prop(s), rot: prop(0), opacity: prop(1), ax: prop(0.5), ay: prop(0.5), skx: prop(0), sky: prop(0) };
}
export function newTrack(kind: Track['kind'], name: string): Track {
  return { id: mid('tr'), name, kind, hidden: false, locked: false, muted: false, solo: false, parallax: 1 };
}
export function newComposition(w: number, h: number, fps: number, dur: number, name = 'Principal'): Composition {
  return {
    id: mid('cp'), name, w, h, fps, dur, bg: '#000000',
    // La pista de arriba se dibuja encima (como en cualquier editor de vídeo).
    tracks: [newTrack('visual', 'Vídeo 2'), newTrack('visual', 'Vídeo 1'), newTrack('audio', 'Audio 1')],
    clips: [], markers: [], range: null,
    camera: { on: false, x: prop(0), y: prop(0), zoom: prop(1), rot: prop(0) },
  };
}
export function newMotion(w: number, h: number, fps: number, dur = 30): Motion {
  const c = newComposition(w, h, fps, dur);
  return { version: MOTION_VERSION, comps: [c], main: c.id, open: c.id, media: [], folders: [], presets: [], time: 0, snap: true };
}

const base = (track: string, name: string, start: number, dur: number, x: number, y: number, s = 1): ClipBase => ({
  id: mid('cl'), track, name, start, dur, enabled: true, group: null, blend: 'normal', tf: newTransform(x, y, s), fx: [], masks: [],
  tin: { type: 'none', dur: 0.5 }, tout: { type: 'none', dur: 0.5 }, crop: [0, 0, 0, 0],
});

export function mediaClip(c: Composition, m: MediaItem, track: string, start: number): MediaClip {
  // Se encaja dentro de la composición (sin ampliar las imágenes pequeñas).
  const fit = m.w && m.h ? Math.min(1, c.w / m.w, c.h / m.h) : 1;
  const visual = m.kind !== 'audio' && m.kind !== 'font' && m.kind !== 'lut';
  const dur = m.kind === 'video' || m.kind === 'audio' || m.kind === 'gif' || m.kind === 'seq' || m.kind === 'anim' ? Math.max(1 / c.fps, m.dur) : 5;
  return {
    ...base(track, m.name, start, dur, c.w / 2, c.h / 2, visual ? fit : 1), kind: 'media', media: m.id, in: 0, speed: 1, reverse: false, freeze: null,
    volume: prop(1), pan: prop(0), fadeIn: 0, fadeOut: 0, loop: m.kind === 'gif',
  };
}
export function textClip(c: Composition, track: string, start: number, text = 'Texto'): TextClip {
  return {
    ...base(track, text.slice(0, 30), start, 5, c.w / 2, c.h / 2), kind: 'text', text, font: 'Outfit', size: Math.round(c.h / 9), weight: 800, italic: false,
    align: 'center', lineH: 1.15, fill: prop('#ffffff'), grad: { on: false, c2: prop('#9d6bff'), angle: 90 },
    stroke: { on: false, color: prop('#1b1530'), w: prop(6) }, shadow: { on: true, color: '#000000', blur: 16, dx: 0, dy: 6 },
    bg: { on: false, color: '#9d6bff', pad: 18, radius: 14 }, reveal: prop(1), anim: 'none', bend: prop(0), spacing: prop(0),
  };
}
export function shapeClip(c: Composition, track: string, start: number, shape: ShapeType): ShapeClip {
  const s = Math.round(Math.min(c.w, c.h) / 3);
  return {
    ...base(track, ({ rect: 'Rectángulo', ellipse: 'Elipse', polygon: 'Polígono', star: 'Estrella', line: 'Línea', arrow: 'Flecha' } as const)[shape], start, 5, c.w / 2, c.h / 2),
    kind: 'shape', shape, w: prop(shape === 'line' || shape === 'arrow' ? s * 1.6 : s), h: prop(shape === 'line' || shape === 'arrow' ? Math.max(8, s / 6) : s), sides: 6, inner: 0.45, radius: prop(0),
    fillOn: shape !== 'line', fill: prop('#9d6bff'), grad: { on: false, c2: prop('#5b8cff'), angle: 90 },
    strokeOn: shape === 'line', stroke: prop('#ffffff'), strokeW: prop(8), dash: 0, trim: prop(1),
  };
}
export function solidClip(c: Composition, track: string, start: number, color = '#9d6bff'): SolidClip {
  return { ...base(track, 'Sólido', start, 5, c.w / 2, c.h / 2), kind: 'solid', color: prop(color) };
}
export function compClip(c: Composition, sub: Composition, track: string, start: number): CompClip {
  return { ...base(track, sub.name, start, sub.dur, c.w / 2, c.h / 2, Math.min(1, c.w / sub.w, c.h / sub.h)), kind: 'comp', comp: sub.id, in: 0, speed: 1 };
}

let textMeasurer: ((c: TextClip, t: number) => { w: number; h: number }) | null = null;
/** El compositor registra cómo medir textos (necesita un canvas). */
export function setTextMeasurer(fn: typeof textMeasurer) { textMeasurer = fn; }

/** Tamaño natural del contenido de un clip (px) — lo que mide su «caja» antes de transformar. */
export function clipSize(m: Motion, c: Clip, t = 0): { w: number; h: number } {
  if (c.kind === 'media') { const md = m.media.find(x => x.id === c.media); return { w: md?.w || 1, h: md?.h || 1 }; }
  if (c.kind === 'shape') return { w: Math.max(1, valueAt(c.w, t)), h: Math.max(1, valueAt(c.h, t)) };
  if (c.kind === 'comp') { const s = m.comps.find(x => x.id === c.comp); return { w: s?.w || 1, h: s?.h || 1 }; }
  if (c.kind === 'solid') { const comp = m.comps.find(x => x.clips.includes(c)); return { w: comp?.w || 1, h: comp?.h || 1 }; }
  return textMeasurer?.(c, t) ?? { w: 1, h: 1 };
}

/** Segundo del origen que se ve en el tiempo de clip `lt` (velocidad, invertir, congelar, bucle). */
export function sourceTime(c: MediaClip | CompClip, lt: number, srcDur: number): number {
  if (c.kind === 'media' && c.freeze !== null) return c.freeze;
  const speed = c.speed || 1;
  let s = c.kind === 'media' && c.reverse ? c.in + (c.dur - lt) * speed - 1e-4 : c.in + lt * speed;
  if (c.kind === 'media' && c.loop && srcDur > 0) s = ((s % srcDur) + srcDur) % srcDur;
  return Math.max(0, srcDur > 0 ? Math.min(srcDur - 1e-4, s) : s);
}

export const compOf = (m: Motion, id = m.open) => m.comps.find(c => c.id === id) ?? m.comps[0];
export const isAudioOnly = (m: Motion, c: Clip) => c.kind === 'media' && m.media.find(x => x.id === c.media)?.kind === 'audio';

/** Clips que se ven en `t`, de abajo arriba (pistas de abajo primero; dentro de una pista, por inicio). */
export function activeClips(comp: Composition, t: number): Clip[] {
  const order = new Map(comp.tracks.map((tr, i) => [tr.id, comp.tracks.length - i]));
  return comp.clips.filter(c => c.enabled && t >= c.start - 1e-9 && t < clipEnd(c) - 1e-9)
    .sort((a, b) => (order.get(a.track)! - order.get(b.track)!) || a.start - b.start);
}

// ---------------------------------------------------------------- historial

export interface MCommand { label: string; before: Motion; after: Motion }

/**
 * Historial del editor de vídeo (instantáneas del modelo, sin medios). Los
 * cambios se hacen con `edit(label, fn)`: si `fn` devuelve false no se registra nada.
 */
export class MotionHistory {
  undoStack: MCommand[] = [];
  redoStack: MCommand[] = [];
  constructor(public m: Motion, private onChange: (m: Motion, label: string) => void, public limit = 200) {}

  edit(label: string, fn: (m: Motion) => boolean | void): boolean {
    const before = clone(this.m);
    let ok: boolean | void;
    try { ok = fn(this.m); } catch (e) { this.m = before; throw e; }
    if (ok === false) { this.m = before; return false; }
    tidy(this.m);
    this.undoStack.push({ label, before, after: clone(this.m) });
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
    this.onChange(this.m, label);
    return true;
  }
  private pendingBefore: Motion | null = null;
  /** Empieza un cambio continuo (arrastrar): se modifica `m` en vivo y `commit` lo registra como un solo paso. */
  begin() { if (!this.pendingBefore) this.pendingBefore = clone(this.m); }
  get pending() { return !!this.pendingBefore; }
  commit(label: string): boolean {
    const before = this.pendingBefore;
    this.pendingBefore = null;
    if (!before) return false;
    tidy(this.m);
    const after = clone(this.m);
    if (JSON.stringify(before) === JSON.stringify(after)) return false;
    this.undoStack.push({ label, before, after });
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
    this.onChange(this.m, label);
    return true;
  }
  /** Cancela el cambio continuo y vuelve a como estaba. */
  cancel() { if (this.pendingBefore) { this.m = this.pendingBefore; this.pendingBefore = null; this.onChange(this.m, ''); } }
  undo() { const c = this.undoStack.pop(); if (!c) return null; this.redoStack.push(c); this.m = clone(c.before); this.onChange(this.m, `Deshacer: ${c.label}`); return c; }
  redo() { const c = this.redoStack.pop(); if (!c) return null; this.undoStack.push(c); this.m = clone(c.after); this.onChange(this.m, `Rehacer: ${c.label}`); return c; }
  /** Vuelve al estado tras el paso `i` del historial (-1 = antes de todo). */
  goto(i: number) { while (this.undoStack.length - 1 > i && this.undoStack.length) this.undo(); while (this.undoStack.length - 1 < i && this.redoStack.length) this.redo(); }
}

/** Ordena y ajusta límites tras cada cambio. */
function tidy(m: Motion) {
  for (const c of m.comps) {
    for (const cl of c.clips) { cl.start = Math.max(0, cl.start); cl.dur = Math.max(1 / c.fps, cl.dur); }
    c.clips.sort((a, b) => a.start - b.start);
    c.markers.sort((a, b) => a.t - b.t);
    const end = Math.max(0, ...c.clips.map(clipEnd));
    if (end > c.dur) c.dur = Math.ceil(end * c.fps) / c.fps;
  }
}

// ---------------------------------------------------------------- operaciones (dentro de `edit`)

export const findClip = (comp: Composition, id: string) => comp.clips.find(c => c.id === id);

/** Divide un clip en `t` (absoluto): devuelve el clip de la derecha. */
export function splitClip(comp: Composition, m: Motion, id: string, t: number): Clip | null {
  const c = findClip(comp, id);
  if (!c || t <= c.start + 1 / comp.fps / 2 || t >= clipEnd(c) - 1 / comp.fps / 2) return null;
  const lt = t - c.start;
  const right = clone(c);
  right.id = mid('cl');
  right.start = t;
  right.dur = c.dur - lt;
  c.dur = lt;
  if ((right.kind === 'media' || right.kind === 'comp') && !(right.kind === 'media' && (right.freeze !== null || right.reverse))) right.in += lt * right.speed;
  if (right.kind === 'media' && right.reverse && c.kind === 'media') c.in += right.dur * c.speed;
  // Los keyframes se cortan para que el movimiento siga igual a ambos lados del corte.
  forEachProp(right, p => cutKeys(p, lt, 'right'));
  forEachProp(c, p => cutKeys(p, lt, 'left'));
  if (c.kind === 'media' && right.kind === 'media') { c.fadeOut = 0; right.fadeIn = 0; }
  c.tout = { type: 'none', dur: c.tout.dur };
  right.tin = { type: 'none', dur: right.tin.dur };
  comp.clips.push(right);
  void m;
  return right;
}

/** Recorta el borde izquierdo (`edge` = 'l') o derecho a `t`. Con `ripple`, lo que sigue en la pista se desplaza. */
export function trimClip(comp: Composition, m: Motion, id: string, edge: 'l' | 'r', t: number, ripple = false) {
  const c = findClip(comp, id);
  if (!c) return;
  const minD = 1 / comp.fps;
  const media = c.kind === 'media' ? m.media.find(x => x.id === c.media) : null;
  const srcDur = media && (media.kind === 'video' || media.kind === 'audio' || media.kind === 'anim' || media.kind === 'seq') && !(c.kind === 'media' && c.loop) ? media.dur : Infinity;
  if (edge === 'l') {
    let d = Math.min(t, clipEnd(c) - minD) - c.start;
    if ((c.kind === 'media' || c.kind === 'comp') && !(c.kind === 'media' && c.freeze !== null)) d = Math.max(d, -c.in / (c.speed || 1));
    c.start += d; c.dur -= d;
    if (c.kind === 'media' || c.kind === 'comp') { if (!(c.kind === 'media' && c.reverse)) c.in += d * c.speed; }
    if (d > 0) forEachProp(c, p => cutKeys(p, d, 'right'));
    else forEachProp(c, p => { if (p.k) for (const k of p.k) k.t -= d; });
  } else {
    let nd = Math.max(minD, t - c.start);
    if ((c.kind === 'media' || c.kind === 'comp') && Number.isFinite(srcDur) && !(c.kind === 'media' && c.freeze !== null)) nd = Math.min(nd, (srcDur - c.in) / (c.speed || 1));
    const delta = nd - c.dur;
    c.dur = nd;
    if (ripple) for (const o of comp.clips) if (o !== c && o.track === c.track && o.start >= clipEnd(c) - delta - 1e-6) o.start += delta;
  }
}

/** Borra clips; con `ripple` cierra el hueco en cada pista afectada. */
export function deleteClips(comp: Composition, ids: string[], ripple = false) {
  const del = comp.clips.filter(c => ids.includes(c.id)).sort((a, b) => b.start - a.start);
  comp.clips = comp.clips.filter(c => !ids.includes(c.id));
  if (ripple) for (const d of del) for (const o of comp.clips) if (o.track === d.track && o.start >= clipEnd(d) - 1e-6) o.start -= d.dur;
}

/** Mueve clips `dt` segundos y `dTrack` pistas (de su mismo tipo); los grupos se mueven juntos. */
export function moveClips(comp: Composition, ids: string[], dt: number, dTrack = 0): boolean {
  const set = withGroups(comp, ids);
  const sel = comp.clips.filter(c => set.has(c.id));
  if (!sel.length) return false;
  dt = Math.max(dt, -Math.min(...sel.map(c => c.start)));
  for (const c of sel) {
    c.start += dt;
    if (dTrack) {
      const i = comp.tracks.findIndex(t => t.id === c.track), to = comp.tracks[i + dTrack];
      if (to && to.kind === comp.tracks[i].kind && !to.locked) c.track = to.id;
    }
  }
  return true;
}

export function withGroups(comp: Composition, ids: string[]): Set<string> {
  const groups = new Set(comp.clips.filter(c => ids.includes(c.id) && c.group).map(c => c.group));
  return new Set(comp.clips.filter(c => ids.includes(c.id) || (c.group && groups.has(c.group))).map(c => c.id));
}

export function duplicateClips(comp: Composition, ids: string[]): Clip[] {
  const src = comp.clips.filter(c => ids.includes(c.id));
  if (!src.length) return [];
  const end = Math.max(...src.map(clipEnd)), start = Math.min(...src.map(c => c.start));
  const gmap = new Map<string, string>();
  const out = src.map(c => {
    const d = clone(c);
    d.id = mid('cl');
    d.start += end - start;
    if (d.group) { if (!gmap.has(d.group)) gmap.set(d.group, mid('gr')); d.group = gmap.get(d.group)!; }
    return d;
  });
  comp.clips.push(...out);
  return out;
}

/** Cambia la velocidad conservando el tramo de origen (la duración en la línea de tiempo cambia). */
export function setSpeed(c: MediaClip | CompClip, speed: number) {
  speed = Math.max(0.05, Math.min(16, speed));
  const ratio = (c.speed || 1) / speed;
  c.dur *= ratio;
  forEachProp(c, p => { if (p.k) for (const k of p.k) k.t *= ratio; });
  c.speed = speed;
}

/** Congela el fotograma en `t` (absoluto): parte el clip y deja un tramo congelado de `len` s. */
export function freezeFrame(comp: Composition, m: Motion, id: string, t: number, len = 2): MediaClip | null {
  const c = findClip(comp, id);
  if (!c || c.kind !== 'media') return null;
  const md = m.media.find(x => x.id === c.media);
  const st = sourceTime(c, t - c.start, md?.dur ?? 0);
  const right = splitClip(comp, m, id, t);
  const f = clone(c);
  f.id = mid('cl'); f.start = t; f.dur = len; f.freeze = st; f.name = `${c.name} (congelado)`;
  f.volume = prop(0);
  forEachProp(f, p => { if (p.k) { p.v = valueAt(p, t - c.start); delete p.k; } });
  for (const o of comp.clips) if (o.track === c.track && o.start >= t - 1e-6 && o !== f) o.start += len;
  comp.clips.push(f);
  void right;
  return f;
}

/** Agrupa (o desagrupa si ya comparten grupo) los clips indicados. */
export function toggleGroup(comp: Composition, ids: string[]) {
  const sel = comp.clips.filter(c => ids.includes(c.id));
  if (sel.length && sel.every(c => c.group && c.group === sel[0].group)) { for (const c of sel) c.group = null; return false; }
  const g = mid('gr');
  for (const c of sel) c.group = g;
  return true;
}

/** Mete los clips en una composición nueva (precomponer) y los sustituye por un clip de esa composición. */
export function precompose(m: Motion, comp: Composition, ids: string[], name: string): CompClip | null {
  const sel = comp.clips.filter(c => ids.includes(c.id));
  if (!sel.length) return null;
  const t0 = Math.min(...sel.map(c => c.start)), t1 = Math.max(...sel.map(clipEnd));
  const sub = newComposition(comp.w, comp.h, comp.fps, t1 - t0, name);
  sub.bg = null;
  const used = [...new Set(sel.map(c => c.track))];
  sub.tracks = used.map(id => { const tr = comp.tracks.find(t => t.id === id)!; return { ...clone(tr), id: mid('tr') }; });
  const tmap = new Map(used.map((id, i) => [id, sub.tracks[i].id]));
  sub.clips = sel.map(c => ({ ...clone(c), start: c.start - t0, track: tmap.get(c.track)! }));
  m.comps.push(sub);
  comp.clips = comp.clips.filter(c => !ids.includes(c.id));
  const top = comp.tracks.find(t => t.kind === 'visual' && used.includes(t.id)) ?? comp.tracks.find(t => t.kind === 'visual')!;
  const cc = compClip(comp, sub, top.id, t0);
  cc.tf = newTransform(comp.w / 2, comp.h / 2, 1);
  comp.clips.push(cc);
  return cc;
}

/** Recorre todas las propiedades animables de un clip. */
export function forEachProp(c: Clip, fn: (p: Prop<unknown>, name: string) => void) {
  for (const [k, p] of Object.entries(c.tf)) fn(p as Prop<unknown>, `tf.${k}`);
  for (const f of c.fx) for (const [k, p] of Object.entries(f.p)) fn(p as Prop<unknown>, `fx.${f.id}.${k}`);
  for (const mk of c.masks) for (const k of ['x', 'y', 'w', 'h', 'feather'] as const) fn(mk[k], `mask.${mk.id}.${k}`);
  if (c.kind === 'media') { fn(c.volume, 'volume'); fn(c.pan, 'pan'); }
  if (c.kind === 'text') { fn(c.fill, 'fill'); fn(c.grad.c2, 'grad'); fn(c.stroke.color, 'strokeColor'); fn(c.stroke.w, 'strokeW'); fn(c.reveal, 'reveal'); fn(c.bend, 'bend'); fn(c.spacing, 'spacing'); }
  if (c.kind === 'shape') { fn(c.w, 'w'); fn(c.h, 'h'); fn(c.radius, 'radius'); fn(c.fill, 'fill'); fn(c.grad.c2, 'grad'); fn(c.stroke, 'stroke'); fn(c.strokeW, 'strokeW'); fn(c.trim, 'trim'); }
  if (c.kind === 'solid') fn(c.color, 'color');
}

/** Atributos que se copian y pegan entre clips (transformación, efectos, máscaras, transiciones, fusión). */
export interface Attrs { tf: Transform; fx: FxInst[]; masks: Mask[]; tin: Transition; tout: Transition; blend: LayerBlend }
export const copyAttrs = (c: Clip): Attrs => clone({ tf: c.tf, fx: c.fx, masks: c.masks, tin: c.tin, tout: c.tout, blend: c.blend });
export function pasteAttrs(c: Clip, a: Attrs, what: { tf?: boolean; fx?: boolean; masks?: boolean; trans?: boolean } = { tf: true, fx: true, masks: true, trans: true }) {
  const x = clone(a);
  if (what.tf) { c.tf = x.tf; c.blend = x.blend; }
  if (what.fx) c.fx = x.fx.map(f => ({ ...f, id: mid('fx') }));
  if (what.masks) c.masks = x.masks.map(mk => ({ ...mk, id: mid('mk') }));
  if (what.trans) { c.tin = x.tin; c.tout = x.tout; }
}

export function addPreset(c: Clip, id: MotionPreset, comp: Composition) { applyPreset(c.tf, id, c.dur, Math.min(0.8, c.dur / 2), comp.w, comp.h); }

/** Ajuste magnético: el tiempo más cercano entre bordes de clips, cabezal y marcadores (o el propio). */
export function snapTo(comp: Composition, t: number, tol: number, exclude: Set<string>, playhead: number): number {
  let best = t, bd = tol;
  const cands = [0, playhead, ...comp.markers.map(mk => mk.t)];
  for (const c of comp.clips) if (!exclude.has(c.id)) cands.push(c.start, clipEnd(c));
  for (const x of cands) { const d = Math.abs(x - t); if (d < bd) { bd = d; best = x; } }
  return best;
}

/** Propiedad animable de un clip por su ruta (la misma que usa `forEachProp`). */
export function propByPath(c: Clip, path: string): Prop<unknown> | null {
  let found: Prop<unknown> | null = null;
  forEachProp(c, (p, name) => { if (name === path) found = p; });
  return found;
}

/** Nombre legible de una ruta de propiedad. */
export function propLabel(c: Clip, path: string): string {
  const L: Record<string, string> = {
    'tf.x': 'Posición X', 'tf.y': 'Posición Y', 'tf.sx': 'Escala X', 'tf.sy': 'Escala Y', 'tf.rot': 'Rotación', 'tf.opacity': 'Opacidad',
    'tf.ax': 'Anclaje X', 'tf.ay': 'Anclaje Y', 'tf.skx': 'Inclinación X', 'tf.sky': 'Inclinación Y', volume: 'Volumen', pan: 'Panorámica',
    fill: 'Relleno', grad: 'Degradado', strokeColor: 'Color del trazo', strokeW: 'Grosor del trazo', reveal: 'Progreso del texto', bend: 'Curvatura',
    spacing: 'Espaciado', w: 'Ancho', h: 'Alto', radius: 'Radio', stroke: 'Trazo', trim: 'Trazado', color: 'Color',
  };
  if (L[path]) return L[path];
  const [kind, id, key] = path.split('.');
  if (kind === 'fx') { const f = c.fx.find(x => x.id === id); return `${f?.fx ?? 'Efecto'} · ${key}`; }
  if (kind === 'mask') return `Máscara · ${({ x: 'X', y: 'Y', w: 'ancho', h: 'alto', feather: 'suavizado' } as Record<string, string>)[key] ?? key}`;
  return path;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Valida un proyecto de vídeo leído de un archivo: completa lo que falte con valores
 * por defecto y descarta clips o pistas rotos (un archivo dañado no rompe la app).
 */
export function normalizeMotion(v: unknown): Motion | null {
  if (!isObj(v) || !Array.isArray(v.comps) || !v.comps.length) return null;
  const m = clone(v) as unknown as Motion;
  m.version = MOTION_VERSION;
  m.media = Array.isArray(m.media) ? m.media.filter(x => isObj(x) && typeof x.id === 'string' && typeof x.kind === 'string') : [];
  for (const x of m.media) { x.folder ??= ''; x.name ??= 'Medio'; for (const k of ['w', 'h', 'dur', 'fps', 'frames', 'size', 'added'] as const) if (!isNum(x[k])) x[k] = 0; }
  m.folders = Array.isArray(m.folders) ? m.folders.filter(f => typeof f === 'string') : [];
  m.presets = Array.isArray(m.presets) ? m.presets.filter(isObj) as Preset[] : [];
  const ok: Composition[] = [];
  for (const c of m.comps as unknown[]) {
    if (!isObj(c) || typeof c.id !== 'string') continue;
    const comp = c as unknown as Composition;
    comp.w = Math.max(16, Math.min(8192, Math.round(isNum(comp.w) ? comp.w : 1920)));
    comp.h = Math.max(16, Math.min(8192, Math.round(isNum(comp.h) ? comp.h : 1080)));
    comp.fps = isNum(comp.fps) && comp.fps > 0 ? Math.min(240, comp.fps) : 30;
    comp.dur = isNum(comp.dur) && comp.dur > 0 ? comp.dur : 10;
    comp.name ??= 'Composición';
    if (comp.bg !== null && typeof comp.bg !== 'string') comp.bg = '#000000';
    comp.tracks = Array.isArray(comp.tracks) ? comp.tracks.filter(t => isObj(t) && typeof t.id === 'string') : [];
    for (const t of comp.tracks) {
      t.kind = t.kind === 'audio' ? 'audio' : 'visual'; t.parallax = isNum(t.parallax) ? t.parallax : 1; t.name ??= 'Pista';
      if (t.h !== undefined) { if (isNum(t.h)) t.h = Math.max(24, Math.min(200, t.h)); else delete t.h; }
      if (t.open !== undefined) t.open = t.open === true;
    }
    if (!comp.tracks.length) comp.tracks = newComposition(comp.w, comp.h, comp.fps, comp.dur).tracks;
    const tids = new Set(comp.tracks.map(t => t.id));
    comp.clips = Array.isArray(comp.clips) ? comp.clips.filter(cl => isObj(cl) && typeof cl.id === 'string' && tids.has(cl.track) && isNum(cl.start) && isNum(cl.dur) && isObj(cl.tf)) : [];
    for (const cl of comp.clips) { cl.fx ??= []; cl.masks ??= []; cl.crop ??= [0, 0, 0, 0]; cl.tin ??= { type: 'none', dur: 0.5 }; cl.tout ??= { type: 'none', dur: 0.5 }; cl.blend ??= 'normal'; cl.enabled ??= true; cl.group ??= null;
      if (cl.guide !== undefined) cl.guide = cl.guide === true;
      if (cl.adjust !== undefined) cl.adjust = cl.adjust === true && cl.kind === 'solid';
      if (cl.link !== undefined && cl.link !== null) {
        const l = cl.link as unknown as Record<string, unknown>;
        cl.link = typeof l.to === 'string' && Array.isArray(l.paths) ? { to: l.to, paths: l.paths.filter((x): x is string => typeof x === 'string'), off: isObj(l.off) ? Object.fromEntries(Object.entries(l.off).filter(([, v]) => isNum(v))) as Record<string, number> : {} } : null;
      }
    }
    // Vínculos a clips que ya no están: fuera.
    for (const cl of comp.clips) if (cl.link && !comp.clips.some(o => o.id === cl.link!.to && o.id !== cl.id)) cl.link = null;
    comp.markers = Array.isArray(comp.markers) ? comp.markers.filter(mk => isObj(mk) && isNum(mk.t)) : [];
    comp.camera = isObj(comp.camera) ? comp.camera : { on: false, x: prop(0), y: prop(0), zoom: prop(1), rot: prop(0) };
    if (!Array.isArray(comp.range) || comp.range.length !== 2 || !comp.range.every(isNum)) comp.range = null;
    ok.push(comp);
  }
  if (!ok.length) return null;
  m.comps = ok;
  // Clips de composiciones que ya no existen: fuera.
  const ids = new Set(ok.map(c => c.id));
  for (const c of ok) c.clips = c.clips.filter(cl => cl.kind !== 'comp' || ids.has(cl.comp));
  if (!ids.has(m.main)) m.main = ok[0].id;
  if (!ids.has(m.open)) m.open = m.main;
  m.time = isNum(m.time) ? Math.max(0, m.time) : 0;
  m.snap = m.snap !== false;
  return m;
}

// ---------------------------------------------------------------- portapapeles de keyframes

/** Keyframes copiados: por propiedad, con tiempos relativos al primero copiado. */
export interface KeyClipboard {
  items: { path: string; kind: 'number' | 'color' | 'other'; fx?: string; keys: Key<unknown>[] }[];
  span: number;
}
const kindOfValue = (v: unknown): KeyClipboard['items'][number]['kind'] => (typeof v === 'number' ? 'number' : typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? 'color' : 'other');

/**
 * Copia keyframes de un clip. `times` = sólo los de esos tiempos (s del clip);
 * `paths` = sólo esas propiedades. Sin filtros, todos.
 */
export function copyKeys(c: Clip, times?: number[] | null, paths?: string[] | null): KeyClipboard | null {
  const near = (t: number) => !times || times.some(x => Math.abs(x - t) < 1e-3);
  const items: KeyClipboard['items'] = [];
  forEachProp(c, (p, path) => {
    if (!p.k?.length || (paths && !paths.includes(path))) return;
    const keys = p.k.filter(k => near(k.t));
    if (!keys.length) return;
    const fx = path.startsWith('fx.') ? c.fx.find(f => f.id === path.split('.')[1])?.fx : undefined;
    items.push({ path, kind: kindOfValue(keys[0].v), fx, keys: clone(keys) });
  });
  if (!items.length) return null;
  const t0 = Math.min(...items.flatMap(i => i.keys.map(k => k.t)));
  for (const i of items) for (const k of i.keys) k.t -= t0;
  return { items, span: Math.max(...items.flatMap(i => i.keys.map(k => k.t))) };
}

/** Ruta equivalente en otro clip (efectos y máscaras tienen ids distintos en cada clip). */
function mapPath(c: Clip, item: KeyClipboard['items'][number], src: string[]): string | null {
  if (propByPath(c, item.path)) return item.path;
  const [kind, id, key] = item.path.split('.');
  if (kind === 'fx' && item.fx) {
    // El n-ésimo efecto del mismo tipo (en el orden en que aparecían).
    const idx = src.filter(p => p.startsWith('fx.')).map(p => p.split('.')[1]).filter((x, i, a) => a.indexOf(x) === i).indexOf(id);
    const same = c.fx.filter(f => f.fx === item.fx);
    const f = same[Math.max(0, Math.min(same.length - 1, idx))];
    return f && f.p[key] ? `fx.${f.id}.${key}` : null;
  }
  if (kind === 'mask') {
    const ids = src.filter(p => p.startsWith('mask.')).map(p => p.split('.')[1]).filter((x, i, a) => a.indexOf(x) === i);
    const mk = c.masks[Math.max(0, ids.indexOf(id))];
    return mk ? `mask.${mk.id}.${key}` : null;
  }
  return null;
}

/**
 * Pega keyframes en `c` a partir de `at` (s del clip). Con `onto`, todos van a esa
 * propiedad (sólo si se copió una y es del mismo tipo). Devuelve cuántos se pegaron.
 */
export function pasteKeys(c: Clip, kc: KeyClipboard, at: number, onto?: string): number {
  let n = 0;
  const src = kc.items.map(i => i.path);
  for (const item of kc.items) {
    const path = onto ?? mapPath(c, item, src);
    if (!path) continue;
    const p = propByPath(c, path);
    if (!p || kindOfValue(p.v) !== item.kind) continue;
    p.k ??= [];
    for (const k of item.keys) {
      const t = Math.max(0, Math.min(c.dur, at + k.t));
      p.k = p.k.filter(x => Math.abs(x.t - t) > 1e-4);
      p.k.push({ ...clone(k), t });
      n++;
    }
    p.k.sort((a, b) => a.t - b.t);
    p.v = valueAt(p, 0);
  }
  return n;
}

/** Quita los keyframes de esos tiempos (todas las propiedades). Devuelve cuántos. */
export function deleteKeysAt(c: Clip, times: number[], paths?: string[] | null): number {
  let n = 0;
  forEachProp(c, (p, path) => {
    if (!p.k || (paths && !paths.includes(path))) return;
    const keep = p.k.filter(k => !times.some(t => Math.abs(t - k.t) < 1e-3));
    n += p.k.length - keep.length;
    if (keep.length === p.k.length) return;
    if (!keep.length) { p.v = valueAt(p, times[0]); delete p.k; } else { p.k = keep; p.v = valueAt(p, 0); }
  });
  return n;
}

/** Cambia la curva de los keyframes de esos tiempos (hacia el siguiente). */
export function easeKeysAt(c: Clip, times: number[], e: Key['e'], paths?: string[] | null) {
  forEachProp(c, (p, path) => { if (paths && !paths.includes(path)) return; for (const k of p.k ?? []) if (times.some(t => Math.abs(t - k.t) < 1e-3)) { k.e = e; if (e === 'bezier' && !k.b) k.b = [0.42, 0, 0.58, 1]; } });
}

/** Tiempos (s del clip) de todos los keyframes del clip, sin repetir y ordenados. */
export function keyTimes(c: Clip, paths?: string[] | null): number[] {
  const ts: number[] = [];
  forEachProp(c, (p, path) => {
    if (paths && !paths.includes(path)) return; for (const k of p.k ?? []) if (!ts.some(t => Math.abs(t - k.t) < 1e-3)) ts.push(k.t); });
  return ts.sort((a, b) => a - b);
}

/**
 * Cambia el tiempo de los keyframes de `times` con `map` (t → t', s del clip), en todas
 * las propiedades. Los tiempos se ajustan al fotograma y al clip; un keyframe que no
 * se mueve y queda debajo de uno movido desaparece. Devuelve los tiempos nuevos.
 */
export function retimeKeys(c: Clip, times: number[], map: (t: number) => number, fps: number, paths?: string[] | null): number[] {
  const near = (t: number) => times.some(x => Math.abs(x - t) < 1e-3);
  const fix = (t: number) => Math.max(0, Math.min(c.dur, Math.round(t * fps) / fps));
  const out: number[] = [];
  forEachProp(c, (p, path) => {
    if (!p.k?.length || (paths && !paths.includes(path))) return;
    const moving = p.k.filter(k => near(k.t));
    if (!moving.length) return;
    const to = moving.map(k => fix(map(k.t)));
    const still = p.k.filter(k => !moving.includes(k) && !to.some(t => Math.abs(t - k.t) < 1e-4));
    moving.forEach((k, i) => { k.t = to[i]; });
    // Dos movidos al mismo fotograma: se queda el último.
    const seen = new Map<number, Key<unknown>>();
    for (const k of moving) seen.set(Math.round(k.t * 1e4), k);
    p.k = [...still, ...seen.values()].sort((a, b) => a.t - b.t);
    p.v = valueAt(p, 0);
    for (const k of seen.values()) if (!out.some(t => Math.abs(t - k.t) < 1e-4)) out.push(k.t);
  });
  return out.sort((a, b) => a - b);
}

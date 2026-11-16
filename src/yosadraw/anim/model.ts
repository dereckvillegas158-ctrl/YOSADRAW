import type { Command, Document, Layer } from '../doc/Document';
import type { Item } from '../doc/items';

/**
 * YOSADRAW ANIMATE — modelo de animación fotograma a fotograma.
 *
 * Una animación es un Document normal con `doc.anim`. Cada capa es una pista:
 * - capa estática (`layer.cels` sin definir): se ve igual en todos los fotogramas (fondos);
 * - capa animada: una lista de *cels* (dibujos) con su inicio y su duración en fotogramas.
 *   Entre cels puede haber huecos (fotogramas en blanco).
 *
 * El dibujo se sigue haciendo con el motor de siempre: en el fotograma actual,
 * `layer.items` ES la lista de elementos del cel que se ve (mismo array). Al cambiar
 * de fotograma se guarda lo editado (`capture`) y se cargan los cels del nuevo (`apply`).
 * Los cels se tratan como inmutables salvo su contenido (`content.items`), que se
 * comparte entre copias del mismo cel (mover un cel no copia su dibujo).
 *
 * Todas las operaciones de la línea de tiempo son comandos deshacibles que guardan
 * una instantánea ligera (referencias) del estado antes y después.
 */

export const FPS_OPTIONS = [6, 8, 12, 15, 24, 30, 60] as const;
export const MAX_FRAMES = 20000;
export const MOUTH_SHAPES = ['X', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;
export type MouthShape = (typeof MOUTH_SHAPES)[number];
export const MOUTH_HELP: Record<MouthShape, string> = {
  X: 'Reposo', A: 'Cerrada (M, B, P)', B: 'Entreabierta (consonantes)', C: 'Abierta (E, A corta)', D: 'Muy abierta (A)',
  E: 'Redondeada (O)', F: 'Fruncida (U, W)', G: 'F, V', H: 'L',
};

export interface CelContent { items: Item[] }
export interface Cel {
  id: string;
  /** Primer fotograma (0 = el primero). */
  start: number;
  /** Fotogramas que se mantiene (exposición). */
  length: number;
  content: CelContent;
  /** Fotograma clave (pose principal) frente a intermedio. */
  key: boolean;
  /** Nombre corto (p. ej. forma de boca «A»…«X» para la sincronización labial). */
  label: string;
}

export interface TrackGroup { id: string; name: string; visible: boolean; locked: boolean; opacity: number; collapsed: boolean }
export interface Marker { id: string; frame: number; name: string; color: string }
export interface OnionSettings {
  enabled: boolean;
  /** Dibujos anteriores / posteriores que se muestran. */
  before: number;
  after: number;
  /** Opacidad del más cercano; cada paso siguiente se multiplica por `falloff`. */
  opacity: number;
  falloff: number;
  colorBefore: string;
  colorAfter: string;
  /** Teñir con el color (si no, se ven con sus colores reales). */
  tint: boolean;
  /** En todas las pistas animadas (si no, sólo en la activa). */
  allTracks: boolean;
}
export interface DialogueLine { id: string; start: number; end: number; text: string }
export interface MouthKey { frame: number; shape: MouthShape }
export interface AudioLane { id: string; name: string; volume: number; muted: boolean; solo: boolean }
export interface AudioClip {
  id: string;
  name: string;
  lane: string;
  /** Archivo original (MP3, WAV, OGG, FLAC, AAC…) tal cual: se guarda en el proyecto. */
  data: Uint8Array;
  mime: string;
  /** Duración del archivo (s), conocida al decodificar. */
  duration: number;
  /** Segundo de la línea de tiempo en que empieza el clip. */
  offset: number;
  /** Segundos recortados al principio y al final del archivo. */
  trimStart: number;
  trimEnd: number;
  volume: number;
  muted: boolean;
  dialogue: DialogueLine[];
  mouth: MouthKey[];
}
export interface MotionGuide { id: string; name: string; pts: number[]; visible: boolean }

export interface Animation {
  fps: number;
  /** Duración total en fotogramas. */
  length: number;
  current: number;
  loop: boolean;
  /** Intervalo de reproducción y exportación (inclusive) o null = todo. */
  range: [number, number] | null;
  onion: OnionSettings;
  markers: Marker[];
  groups: TrackGroup[];
  lanes: AudioLane[];
  audio: AudioClip[];
  guides: MotionGuide[];
  /** Columna de acción de la hoja de exposición (notas por fotograma). */
  notes: Record<number, string>;
}

export const DEFAULT_ONION: OnionSettings = { enabled: true, before: 2, after: 1, opacity: 0.45, falloff: 0.6, colorBefore: '#ff4f7b', colorAfter: '#3fc1ff', tint: true, allTracks: false };

let seq = 0;
export const uid = (p: string) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export function newAnimation(fps = 12, length = 48): Animation {
  return {
    fps, length, current: 0, loop: true, range: null, onion: { ...DEFAULT_ONION }, markers: [], groups: [],
    lanes: [{ id: uid('au'), name: 'Audio 1', volume: 1, muted: false, solo: false }], audio: [], guides: [], notes: {},
  };
}

export const isAnimated = (l: Layer): l is Layer & { cels: Cel[] } => Array.isArray(l.cels);
export const celAt = (l: Layer, f: number): Cel | null => (l.cels ? l.cels.find(c => f >= c.start && f < c.start + c.length) ?? null : null);
export const celEnd = (c: Cel) => c.start + c.length;
export const sortCels = (cels: Cel[]) => cels.sort((a, b) => a.start - b.start);
export const newCel = (start: number, length = 1, items: Item[] = [], key = true, label = ''): Cel => ({ id: uid('c'), start, length: Math.max(1, length), content: { items }, key, label });

/** Fotograma visible de la animación (ajustado a la duración). */
export const clampFrame = (a: Animation, f: number) => Math.max(0, Math.min(a.length - 1, Math.round(f)));
export const playRange = (a: Animation): [number, number] => a.range ? [Math.max(0, a.range[0]), Math.min(a.length - 1, a.range[1])] : [0, a.length - 1];
/** Último fotograma ocupado por algún cel. */
export const contentEnd = (doc: Document) => Math.max(0, ...doc.layers.flatMap(l => (l.cels ?? []).map(celEnd)));

/** Grupo de una capa (si existe). */
export const groupOf = (doc: Document, l: Layer) => (l.group && doc.anim ? doc.anim.groups.find(g => g.id === l.group) ?? null : null);
/** Visible teniendo en cuenta el grupo. */
export const effectiveVisible = (doc: Document, l: Layer) => l.visible && (groupOf(doc, l)?.visible ?? true);
export const effectiveLocked = (doc: Document, l: Layer) => l.locked || (groupOf(doc, l)?.locked ?? false);

// ------------------------------------------------------------------ fotograma actual

/** Guarda en los cels del fotograma actual lo que se ha editado en `layer.items`. */
export function capture(doc: Document) {
  const a = doc.anim;
  if (!a) return;
  for (const l of doc.layers) {
    if (!l.cels) continue;
    const c = celAt(l, a.current);
    if (c) c.content.items = l.items;
  }
}

/** Carga en `layer.items` el contenido de los cels del fotograma actual (o vacío). */
export function apply(doc: Document) {
  const a = doc.anim;
  if (!a) return;
  for (const l of doc.layers) {
    if (!l.cels) continue;
    l.items = celAt(l, a.current)?.content.items ?? [];
  }
}

// ------------------------------------------------------------------ comandos

interface LayerSnap { id: string; cels: Cel[] | undefined; items: Item[]; group: string | null; sync: boolean; reference: boolean }
interface Snap { layers: LayerSnap[]; anim: Animation }

function cloneAnim(a: Animation): Animation {
  return {
    ...a, range: a.range ? [a.range[0], a.range[1]] : null, onion: { ...a.onion },
    markers: a.markers.map(m => ({ ...m })), groups: a.groups.map(g => ({ ...g })), lanes: a.lanes.map(l => ({ ...l })),
    audio: a.audio.map(c => ({ ...c, dialogue: c.dialogue.map(d => ({ ...d })), mouth: c.mouth.slice() })),
    guides: a.guides.map(g => ({ ...g, pts: g.pts.slice() })), notes: { ...a.notes },
  };
}

/** `cap` = guardar antes lo editado en el fotograma actual (no tras mutar: el fotograma pudo cambiar). */
function snapshot(doc: Document, cap = true): Snap {
  if (cap) capture(doc);
  return {
    layers: doc.layers.map(l => ({ id: l.id, cels: l.cels?.slice(), items: l.items, group: l.group ?? null, sync: !!l.sync, reference: !!l.reference })),
    anim: cloneAnim(doc.anim!),
  };
}

function restore(doc: Document, s: Snap, cap = true) {
  if (cap) capture(doc);
  for (const ls of s.layers) {
    const l = doc.layer(ls.id);
    if (!l) continue;
    l.cels = ls.cels?.slice();
    if (!ls.cels) l.items = ls.items;
    l.group = ls.group;
    l.sync = ls.sync;
    l.reference = ls.reference;
  }
  doc.anim = cloneAnim(s.anim);
  apply(doc);
}

/**
 * Comando de animación: `mutate` cambia el estado en vivo; se guarda el antes y el
 * después y se deja todo como estaba hasta que el historial lo ejecute.
 * Devuelve null si no cambió nada o `mutate` devolvió false.
 */
export function cmdAnim(doc: Document, label: string, mutate: () => boolean | void): Command | null {
  if (!doc.anim) return null;
  const before = snapshot(doc);
  let ok: boolean | void;
  try { ok = mutate(); } catch (e) { restore(doc, before, false); throw e; }
  if (ok === false) { restore(doc, before, false); return null; }
  for (const l of doc.layers) if (l.cels) sortCels(l.cels);
  const after = snapshot(doc, false);
  restore(doc, before, false);
  return {
    label, layers: doc.layers.map(l => l.id), structure: true, anim: true,
    redo: () => restore(doc, after),
    undo: () => restore(doc, before),
  };
}

// ------------------------------------------------------------------ operaciones

const A = (doc: Document) => doc.anim!;
const overlaps = (cels: Cel[], start: number, len: number, ignore?: Set<string>) => cels.some(c => !ignore?.has(c.id) && c.start < start + len && start < celEnd(c));

/** Pistas a las que se aplica un desplazamiento de tiempo: la editada y, si está sincronizada, todas las sincronizadas. */
export function rippleTracks(doc: Document, layerId: string): Layer[] {
  const l = doc.layer(layerId);
  if (!l?.cels) return [];
  return l.sync ? doc.layers.filter(x => x.cels && (x.sync || x.id === layerId)) : [l];
}

/** Mueve `delta` fotogramas todos los cels que empiezan en `from` o después. */
function shiftFrom(layers: Layer[], from: number, delta: number) {
  for (const l of layers) l.cels = l.cels!.map(c => (c.start >= from ? { ...c, start: Math.max(0, c.start + delta) } : c));
}

const ensureLength = (doc: Document, end: number) => { const a = A(doc); if (end > a.length) a.length = Math.min(MAX_FRAMES, end); };

/** Convierte una capa estática en pista animada (su contenido pasa a un cel que dura toda la animación). */
export function cmdMakeAnimated(doc: Document, layerId: string) {
  return cmdAnim(doc, 'Animar capa', () => {
    const l = doc.layer(layerId);
    if (!l || l.cels) return false;
    l.cels = l.items.length ? [newCel(0, A(doc).length, l.items)] : [];
    return true;
  });
}

/** Vuelve estática una pista: conserva sólo el dibujo del fotograma actual. */
export function cmdMakeStatic(doc: Document, layerId: string) {
  return cmdAnim(doc, 'Capa estática', () => {
    const l = doc.layer(layerId);
    if (!l?.cels) return false;
    const c = celAt(l, A(doc).current);
    l.cels = undefined;
    l.items = c ? c.content.items.slice() : [];
    return true;
  });
}

/**
 * Nuevo dibujo en la pista a continuación del cel actual (o en el fotograma actual si
 * está vacío). Si el hueco está ocupado se desplaza lo que sigue (en las pistas sincronizadas).
 * `copy` = duplicar el cel actual en vez de uno en blanco.
 */
export function cmdNewFrame(doc: Document, layerId: string, copy = false) {
  return cmdAnim(doc, copy ? 'Duplicar fotograma' : 'Nuevo fotograma', () => {
    const a = A(doc), l = doc.layer(layerId);
    if (!l?.cels) return false;
    const cur = celAt(l, a.current);
    if (copy && !cur) return false;
    const at = cur ? celEnd(cur) : a.current;
    const len = copy && cur ? cur.length : 1;
    if (overlaps(l.cels, at, len)) shiftFrom(rippleTracks(doc, layerId), at, len);
    l.cels.push(newCel(at, len, copy && cur ? cur.content.items.slice() : [], cur?.key ?? true, copy && cur ? cur.label : ''));
    ensureLength(doc, Math.max(at + len, contentEnd(doc)));
    a.current = at;
    return true;
  });
}

/** Borra los cels indicados. `ripple` = cerrar el hueco desplazando lo que sigue. */
export function cmdDeleteCels(doc: Document, ids: { layer: string; cel: string }[], ripple = false) {
  return cmdAnim(doc, ids.length > 1 ? 'Eliminar fotogramas' : 'Eliminar fotograma', () => {
    let any = false;
    // De derecha a izquierda para que el desplazamiento no afecte a los siguientes.
    const list = ids.map(i => ({ ...i, l: doc.layer(i.layer), c: doc.layer(i.layer)?.cels?.find(c => c.id === i.cel) })).filter(x => x.l && x.c).sort((x, y) => y.c!.start - x.c!.start);
    for (const { l, c } of list) {
      l!.cels = l!.cels!.filter(x => x.id !== c!.id);
      if (ripple) shiftFrom(rippleTracks(doc, l!.id), celEnd(c!), -c!.length);
      any = true;
    }
    return any;
  });
}

/** Cambia la duración (exposición) de un cel; lo que sigue se desplaza para no solaparse ni dejar huecos nuevos. */
export function cmdSetLength(doc: Document, layerId: string, celId: string, length: number) {
  return cmdAnim(doc, 'Duración del fotograma', () => {
    const l = doc.layer(layerId), c = l?.cels?.find(x => x.id === celId);
    length = Math.max(1, Math.min(MAX_FRAMES, Math.round(length)));
    if (!l || !c || c.length === length) return false;
    shiftFrom(rippleTracks(doc, layerId), celEnd(c), length - c.length);
    l.cels = l.cels!.map(x => (x.id === c.id ? { ...x, length } : x));
    ensureLength(doc, contentEnd(doc));
    return true;
  });
}

/** Inserta (n > 0) o quita (n < 0) fotogramas de tiempo en el fotograma actual de las pistas indicadas. */
export function cmdInsertTime(doc: Document, layerId: string, n: number) {
  return cmdAnim(doc, n > 0 ? 'Insertar fotogramas' : 'Quitar fotogramas', () => {
    const a = A(doc), tracks = rippleTracks(doc, layerId);
    if (!tracks.length || !n) return false;
    const f = a.current;
    for (const l of tracks) {
      const c = celAt(l, f);
      if (n > 0) {
        // Dentro de un cel: se alarga; en un hueco: se desplaza lo que sigue.
        l.cels = l.cels!.map(x => (x === c ? { ...x, length: x.length + n } : x.start > f || (!c && x.start >= f) ? { ...x, start: x.start + n } : x));
      } else {
        const k = -n;
        // Se quitan k fotogramas a partir de f: los cels que caen dentro se acortan o desaparecen.
        l.cels = l.cels!.flatMap(x => {
          const s = x.start, e = celEnd(x);
          if (e <= f) return [x];
          if (s >= f + k) return [{ ...x, start: s - k }];
          const keep = Math.max(0, f - s) + Math.max(0, e - (f + k));
          return keep > 0 ? [{ ...x, start: Math.min(s, f), length: keep }] : [];
        });
      }
    }
    a.length = Math.max(1, Math.min(MAX_FRAMES, a.length + n));
    return true;
  });
}

/**
 * Mueve cels `dFrames` fotogramas y `dTracks` pistas (hacia arriba en la lista de capas = +).
 * Falla (null) si chocaría con otro cel o con una capa no animada. `copy` = duplicar en vez de mover.
 */
export function cmdMoveCels(doc: Document, ids: { layer: string; cel: string }[], dFrames: number, dTracks = 0, copy = false) {
  return cmdAnim(doc, copy ? 'Copiar fotogramas' : 'Mover fotogramas', () => {
    if (!dFrames && !dTracks && !copy) return false;
    const moving = ids.map(i => ({ from: doc.layer(i.layer)!, cel: doc.layer(i.layer)?.cels?.find(c => c.id === i.cel) })).filter(x => x.from && x.cel) as { from: Layer; cel: Cel }[];
    if (!moving.length) return false;
    const targets = moving.map(m => {
      const to = doc.layers[doc.index(m.from.id) + dTracks];
      return { ...m, to, start: m.cel.start + dFrames };
    });
    if (targets.some(t => !t.to?.cels || t.start < 0)) return false;
    const ignore = new Set(copy ? [] : moving.map(m => m.cel.id));
    for (const t of targets) {
      const others = targets.filter(o => o !== t && o.to === t.to);
      if (overlaps(t.to!.cels!, t.start, t.cel.length, ignore) || others.some(o => o.start < t.start + t.cel.length && t.start < o.start + o.cel.length)) return false;
    }
    if (!copy) for (const m of moving) m.from.cels = m.from.cels!.filter(c => c.id !== m.cel.id);
    for (const t of targets) {
      const c = copy ? { ...t.cel, id: uid('c'), content: { items: t.cel.content.items.slice() } } : t.cel;
      t.to!.cels = [...t.to!.cels!, { ...c, start: t.start }];
    }
    ensureLength(doc, contentEnd(doc));
    return true;
  });
}

/** Copia de una secuencia de cels (posiciones relativas al primero y a la primera pista). */
export interface CelClipboard { cels: { track: number; start: number; length: number; items: Item[]; key: boolean; label: string }[]; span: number }

export function copyCels(doc: Document, ids: { layer: string; cel: string }[]): CelClipboard | null {
  const list = ids.map(i => ({ ti: doc.index(i.layer), c: doc.layer(i.layer)?.cels?.find(c => c.id === i.cel) })).filter(x => x.ti >= 0 && x.c) as { ti: number; c: Cel }[];
  if (!list.length) return null;
  capture(doc);
  const s0 = Math.min(...list.map(x => x.c.start)), t0 = Math.max(...list.map(x => x.ti));
  return {
    cels: list.map(x => ({ track: t0 - x.ti, start: x.c.start - s0, length: x.c.length, items: x.c.content.items.slice(), key: x.c.key, label: x.c.label })),
    span: Math.max(...list.map(x => celEnd(x.c))) - s0,
  };
}

/** Pega en el fotograma actual a partir de la pista activa (hacia abajo), haciendo sitio en las pistas afectadas. */
export function cmdPasteCels(doc: Document, clip: CelClipboard, layerId: string) {
  return cmdAnim(doc, 'Pegar fotogramas', () => {
    const a = A(doc), ti = doc.index(layerId);
    const targets = clip.cels.map(c => ({ c, l: doc.layers[ti - c.track] }));
    if (targets.some(t => !t.l?.cels)) return false;
    const at = a.current;
    for (const l of new Set(targets.map(t => t.l))) {
      const busy = l.cels!.some(c => c.start < at + clip.span && at < celEnd(c));
      if (busy) {
        // Si el fotograma actual cae dentro de un cel, se pega detrás de él.
        const inside = celAt(l, at);
        if (inside && inside.start < at) l.cels = l.cels!.map(c => (c === inside ? { ...c, length: at - c.start } : c));
        shiftFrom(rippleTracks(doc, l.id), at, clip.span);
      }
    }
    for (const t of targets) t.l.cels = [...t.l.cels!, newCel(at + t.c.start, t.c.length, t.c.items.slice(), t.c.key, t.c.label)];
    ensureLength(doc, contentEnd(doc));
    return true;
  });
}

export function cmdCelProps(doc: Document, layerId: string, celId: string, patch: Partial<Pick<Cel, 'key' | 'label'>>) {
  return cmdAnim(doc, 'Propiedades del fotograma', () => {
    const l = doc.layer(layerId);
    if (!l?.cels?.some(c => c.id === celId)) return false;
    l.cels = l.cels.map(c => (c.id === celId ? { ...c, ...patch } : c));
    return true;
  });
}

export function cmdAnimSettings(doc: Document, patch: Partial<Pick<Animation, 'fps' | 'length' | 'loop' | 'range'>> & { onion?: Partial<OnionSettings> }, label = 'Ajustes de animación') {
  return cmdAnim(doc, label, () => {
    const a = A(doc);
    if (patch.fps !== undefined) a.fps = Math.max(1, Math.min(120, Math.round(patch.fps)));
    if (patch.length !== undefined) a.length = Math.max(1, Math.min(MAX_FRAMES, Math.round(patch.length)));
    if (patch.loop !== undefined) a.loop = patch.loop;
    if (patch.range !== undefined) a.range = patch.range ? [Math.max(0, Math.min(patch.range[0], patch.range[1])), Math.max(patch.range[0], patch.range[1])] : null;
    if (patch.onion) a.onion = { ...a.onion, ...patch.onion };
    a.current = clampFrame(a, a.current);
  });
}

export function cmdMarker(doc: Document, op: { add: Omit<Marker, 'id'> } | { remove: string } | { update: string; patch: Partial<Omit<Marker, 'id'>> }) {
  return cmdAnim(doc, 'add' in op ? 'Añadir marcador' : 'remove' in op ? 'Quitar marcador' : 'Editar marcador', () => {
    const a = A(doc);
    if ('add' in op) a.markers.push({ id: uid('m'), ...op.add });
    else if ('remove' in op) a.markers = a.markers.filter(m => m.id !== op.remove);
    else { const m = a.markers.find(x => x.id === op.update); if (!m) return false; Object.assign(m, op.patch); }
    a.markers.sort((x, y) => x.frame - y.frame);
    return true;
  });
}

/** Agrupa pistas (quedan contiguas, en la posición de la más alta). */
export function cmdGroupTracks(doc: Document, layerIds: string[], name: string) {
  return cmdAnim(doc, 'Agrupar pistas', () => {
    const ls = layerIds.map(id => doc.layer(id)).filter((l): l is Layer => !!l);
    if (!ls.length) return false;
    const g: TrackGroup = { id: uid('g'), name, visible: true, locked: false, opacity: 1, collapsed: false };
    A(doc).groups.push(g);
    for (const l of ls) l.group = g.id;
    contiguous(doc, g.id);
    return true;
  });
}

export function cmdUngroup(doc: Document, groupId: string) {
  return cmdAnim(doc, 'Desagrupar', () => {
    const a = A(doc);
    if (!a.groups.some(g => g.id === groupId)) return false;
    a.groups = a.groups.filter(g => g.id !== groupId);
    for (const l of doc.layers) if (l.group === groupId) l.group = null;
    return true;
  });
}

export function cmdGroupProps(doc: Document, groupId: string, patch: Partial<Omit<TrackGroup, 'id'>>) {
  return cmdAnim(doc, 'Propiedades del grupo', () => {
    const g = A(doc).groups.find(x => x.id === groupId);
    if (!g) return false;
    Object.assign(g, patch);
    return true;
  });
}

/** Las capas de un grupo quedan seguidas (orden interno conservado), donde está la más alta. */
export function contiguous(doc: Document, groupId: string) {
  const members = doc.layers.filter(l => l.group === groupId);
  if (members.length < 2) return;
  const top = Math.max(...members.map(l => doc.index(l.id)));
  const rest = doc.layers.filter(l => l.group !== groupId);
  const before = rest.filter(l => doc.index(l.id) < top);
  doc.layers = [...before.slice(0, before.length), ...members, ...rest.filter(l => doc.index(l.id) > top)];
}

export function cmdTrackProps(doc: Document, layerId: string, patch: Partial<Pick<Layer, 'sync' | 'reference' | 'group'>>) {
  return cmdAnim(doc, 'Propiedades de la pista', () => {
    const l = doc.layer(layerId);
    if (!l) return false;
    Object.assign(l, patch);
    if (patch.group) contiguous(doc, patch.group);
    return true;
  });
}

export function cmdNote(doc: Document, frame: number, text: string) {
  return cmdAnim(doc, 'Nota de la hoja de exposición', () => {
    const a = A(doc);
    if ((a.notes[frame] ?? '') === text) return false;
    if (text) a.notes[frame] = text; else delete a.notes[frame];
    return true;
  });
}

/** Cambio genérico en audio, guías o pistas de audio (el llamador muta `doc.anim` dentro de `fn`). */
export const cmdAnimEdit = (doc: Document, label: string, fn: (a: Animation) => boolean | void) => cmdAnim(doc, label, () => fn(A(doc)));

/** Reparte los cels de la pista con su exposición actual («en unos», «en doses»…): cada dibujo dura `n` fotogramas, seguidos. */
export function cmdRetime(doc: Document, layerId: string, n: number) {
  return cmdAnim(doc, `Exponer en ${n}`, () => {
    const l = doc.layer(layerId);
    if (!l?.cels?.length) return false;
    let t = l.cels[0].start;
    l.cels = l.cels.map(c => { const x = { ...c, start: t, length: n }; t += n; return x; });
    ensureLength(doc, contentEnd(doc));
    return true;
  });
}

// ------------------------------------------------------------------ interpolación

export type Ease = 'linear' | 'in' | 'out' | 'inout';
export interface TweenOptions {
  /** Fotogramas que dura el movimiento (después del dibujo de origen). */
  frames: number;
  /** Cada cuántos fotogramas hay un dibujo (1 = en unos, 2 = en doses…). */
  step: number;
  dx: number; dy: number;
  /** Grados. */
  rotate: number;
  /** Escala final (1 = igual). */
  scale: number;
  /** Opacidad final (0..1). */
  opacity: number;
  ease: Ease;
  /** Recorrido a seguir (x0, y0, x1, y1…) en vez de dx/dy; `orient` = girar según la tangente. */
  guide?: number[] | null;
  orient?: boolean;
}

export const easeFn = (e: Ease) => (t: number) => e === 'in' ? t * t : e === 'out' ? 1 - (1 - t) * (1 - t) : e === 'inout' ? (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t)) : t;

/** Punto y ángulo a una fracción t (0..1) de la longitud de una polilínea. */
export function alongPath(pts: number[], t: number): { x: number; y: number; angle: number } {
  const n = pts.length / 2;
  if (n < 2) return { x: pts[0] ?? 0, y: pts[1] ?? 0, angle: 0 };
  const seg: number[] = [];
  let total = 0;
  for (let i = 1; i < n; i++) { const d = Math.hypot(pts[2 * i] - pts[2 * i - 2], pts[2 * i + 1] - pts[2 * i - 1]); seg.push(d); total += d; }
  let target = Math.max(0, Math.min(1, t)) * total;
  for (let i = 0; i < seg.length; i++) {
    if (target <= seg[i] || i === seg.length - 1) {
      const k = seg[i] > 0 ? Math.min(1, target / seg[i]) : 0;
      const x0 = pts[2 * i], y0 = pts[2 * i + 1], x1 = pts[2 * i + 2], y1 = pts[2 * i + 3];
      return { x: x0 + (x1 - x0) * k, y: y0 + (y1 - y0) * k, angle: Math.atan2(y1 - y0, x1 - x0) };
    }
    target -= seg[i];
  }
  return { x: pts[2 * n - 2], y: pts[2 * n - 1], angle: 0 };
}

/**
 * Interpolación de movimiento: genera dibujos intermedios a partir de un dibujo
 * (copias transformadas, editables como cualquier otro) desplazándolo, girándolo,
 * escalándolo y cambiando su opacidad con la curva elegida, en línea recta o
 * siguiendo una guía. Lo que había detrás se desplaza para hacer sitio.
 */
export function cmdTween(doc: Document, layerId: string, celId: string, o: TweenOptions, transform: (it: Item, m: [number, number, number, number, number, number]) => Item) {
  return cmdAnim(doc, 'Interpolar movimiento', () => {
    const l = doc.layer(layerId), src = l?.cels?.find(c => c.id === celId);
    if (!l || !src || !src.content.items.length) return false;
    const step = Math.max(1, Math.round(o.step)), n = Math.max(1, Math.floor(Math.max(1, Math.round(o.frames)) / step));
    const items = src.content.items;
    const b = items.reduce((acc, it) => ({ minX: Math.min(acc.minX, it.bounds.minX), minY: Math.min(acc.minY, it.bounds.minY), maxX: Math.max(acc.maxX, it.bounds.maxX), maxY: Math.max(acc.maxY, it.bounds.maxY) }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
    const px = (b.minX + b.maxX) / 2, py = (b.minY + b.maxY) / 2;
    const ease = easeFn(o.ease);
    const g0 = o.guide && o.guide.length >= 4 ? alongPath(o.guide, 0) : null;
    const at = celEnd(src);
    shiftFrom(rippleTracks(doc, layerId), at, n * step);
    for (let k = 1; k <= n; k++) {
      const t = ease(k / n);
      let ox = o.dx * t, oy = o.dy * t, ang = (o.rotate * t * Math.PI) / 180;
      if (g0) { const p = alongPath(o.guide!, t); ox = p.x - g0.x; oy = p.y - g0.y; if (o.orient) ang += p.angle - g0.angle; }
      const sc = 1 + (o.scale - 1) * t, cos = Math.cos(ang) * sc, sin = Math.sin(ang) * sc;
      // T = traslación(pivote + desplazamiento) · giro · escala · traslación(−pivote)
      const m: [number, number, number, number, number, number] = [cos, sin, -sin, cos, px + ox - (cos * px - sin * py), py + oy - (sin * px + cos * py)];
      let out = items.map(it => transform(it, m));
      const op = 1 + (o.opacity - 1) * t;
      if (op < 0.999) out = [doc.item({ kind: 'group', items: out, opacity: Math.max(0, op), blend: 'normal' })];
      l.cels!.push(newCel(at + (k - 1) * step, step, out, k === n, ''));
    }
    ensureLength(doc, contentEnd(doc));
    return true;
  });
}

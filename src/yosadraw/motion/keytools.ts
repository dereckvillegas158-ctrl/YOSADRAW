/**
 * YOSADRAW MOTION — herramientas de animación sobre keyframes (1.11.0).
 *
 * Funciones puras sobre el modelo (se usan dentro de `edit`, así que todas se
 * pueden deshacer): suavizado automático, invertir curvas, repetir y hacer bucles,
 * congelar, portapapeles de varias capas, animaciones rápidas editables y
 * propiedades vinculadas entre clips.
 */
import { applyPreset, keyAt, MOTION_PRESETS, valueAt, type Bez, type EaseType, type Key, type MotionPreset, type Prop } from './keys';
import { clone, forEachProp, pasteKeys, type Clip, type ClipLink, type Composition, type KeyClipboard, type Transform } from './model';

const EPS = 1e-3;
const near = (times: number[] | null, t: number) => !times || times.some(x => Math.abs(x - t) < EPS);
const fix = (t: number, fps: number, dur: number) => Math.max(0, Math.min(dur, Math.round(t * fps) / fps));

// ---------------------------------------------------------------- curvas

/** Presets de interpolación (barra rápida y menús). */
export const EASE_PRESETS: { id: string; label: string; e: EaseType; b?: Bez }[] = [
  { id: 'linear', label: 'Lineal', e: 'linear' },
  { id: 'in', label: 'Ease In', e: 'in' },
  { id: 'out', label: 'Ease Out', e: 'out' },
  { id: 'inout', label: 'Ease In-Out', e: 'inout' },
  { id: 'smooth', label: 'Smooth', e: 'bezier', b: [0.25, 0.1, 0.25, 1] },
  { id: 'hold', label: 'Constante', e: 'hold' },
];

export interface EaseSpec { e: EaseType; b?: Bez }
export const easeSpecOf = (k: Pick<Key<unknown>, 'e' | 'b'>): EaseSpec => (k.b ? { e: k.e, b: [...k.b] as Bez } : { e: k.e });

/** Pone una curva en un keyframe. */
export function setEase(k: Key<unknown>, s: EaseSpec) {
  k.e = s.e;
  if (s.b) k.b = [...s.b] as Bez; else if (s.e === 'bezier') k.b ??= [0.42, 0, 0.58, 1]; else delete k.b;
}

/** La misma curva recorrida al revés (lo que acelera pasa a frenar). Devuelve false si no tiene inversa simple. */
export function invertEase(k: Key<unknown>): boolean {
  if (k.e === 'in') { k.e = 'out'; return true; }
  if (k.e === 'out') { k.e = 'in'; return true; }
  if (k.e === 'bezier') { const [x1, y1, x2, y2] = k.b ?? [0.42, 0, 0.58, 1]; k.b = [1 - x2, 1 - y2, 1 - x1, 1 - y1]; return true; }
  return k.e === 'linear' || k.e === 'inout' || k.e === 'hold';
}

/** Aplica `fn` a cada keyframe (con siguiente) de los tiempos elegidos. Devuelve cuántos. */
export function eachSegmentKey(c: Clip, times: number[] | null, fn: (k: Key<unknown>, p: Prop<unknown>) => boolean | void, paths?: string[] | null): number {
  let n = 0;
  forEachProp(c, (p, path) => {
    const ks = p.k;
    if (!ks || (paths && !paths.includes(path))) return;
    for (let i = 0; i < ks.length - 1; i++) if (near(times, ks[i].t) && fn(ks[i], p) !== false) n++;
  });
  return n;
}

/**
 * Suavizado automático: en cada tramo numérico pone una Bézier cuya velocidad
 * de salida y llegada coincide con la pendiente media en cada keyframe (como las
 * tangentes «auto» de los editores de curvas), sin pasarse en los máximos y mínimos.
 */
export function smoothProp(p: Prop<unknown>, times: number[] | null = null): number {
  const k = p.k as Key<number>[] | undefined;
  if (!k || k.length < 2 || typeof k[0].v !== 'number') return 0;
  const slope = (j: number) => {
    if (j <= 0 || j >= k.length - 1) return 0;
    const a = k[j - 1], b = k[j], c = k[j + 1];
    if ((b.v - a.v) * (c.v - b.v) <= 0) return 0;
    return (c.v - a.v) / Math.max(1e-9, c.t - a.t);
  };
  let n = 0;
  for (let i = 0; i < k.length - 1; i++) {
    if (!near(times, k[i].t) || k[i].e === 'hold') continue;
    const a = k[i], b = k[i + 1], dv = b.v - a.v, dt = Math.max(1e-9, b.t - a.t);
    if (Math.abs(dv) < 1e-9) { a.e = 'linear'; delete a.b; n++; continue; }
    const clamp = (v: number) => Math.max(-2, Math.min(3, v));
    const y1 = clamp((slope(i) * dt) / dv / 3), y2 = clamp(1 - (slope(i + 1) * dt) / dv / 3);
    a.e = 'bezier';
    a.b = [1 / 3, +y1.toFixed(4), 2 / 3, +y2.toFixed(4)];
    n++;
  }
  return n;
}
export function smoothKeys(c: Clip, times: number[] | null, paths?: string[] | null): number { let n = 0; forEachProp(c, (p, path) => { if (!paths || paths.includes(path)) n += smoothProp(p, times); }); return n; }

// ---------------------------------------------------------------- repetir, bucle, congelar

/**
 * Repite los keyframes de `times` (todas las propiedades) `count` veces hacia
 * delante (`dir` = 1) o hacia atrás (-1), cada `gap` segundos después del final
 * del grupo. `pingpong` = las repeticiones impares van al revés (bucle sin salto).
 * Lo que caiga fuera del clip se descarta. Devuelve los tiempos nuevos (s del clip).
 */
export function repeatKeys(c: Clip, times: number[], count: number, gap: number, fps: number, o: { dir?: 1 | -1; pingpong?: boolean; paths?: string[] | null } = {}): number[] {
  const dir = o.dir ?? 1;
  const ts = [...times].sort((a, b) => a - b);
  if (!ts.length || count < 1) return [];
  const t0 = ts[0], t1 = ts[ts.length - 1], period = Math.max(1 / fps, t1 - t0 + gap);
  const out: number[] = [];
  forEachProp(c, (p, path) => {
    if (!p.k?.length || (o.paths && !o.paths.includes(path))) return;
    const sel = p.k.filter(k => near(ts, k.t)).sort((a, b) => a.t - b.t);
    if (!sel.length) return;
    const add: Key<unknown>[] = [];
    for (let r = 1; r <= count; r++) {
      const rev = !!o.pingpong && r % 2 === 1;
      const base = dir > 0 ? r * period : -r * period;
      const cyc = rev
        ? sel.map((k, i) => { const nk = { ...clone(k), t: t0 + t1 - k.t + base }; const prev = sel[i - 1]; if (prev) { setEase(nk, easeSpecOf(prev)); invertEase(nk); } else setEase(nk, easeSpecOf(sel[sel.length - 1])); return nk; }).reverse()
        : sel.map(k => ({ ...clone(k), t: k.t + base }));
      for (const k of cyc) {
        const t = Math.round(k.t * fps) / fps;
        if (t < -1e-6 || t > c.dur + 1e-6) continue;
        k.t = Math.max(0, Math.min(c.dur, t));
        add.push(k);
      }
    }
    if (!add.length) return;
    p.k = [...p.k.filter(x => !add.some(a => Math.abs(a.t - x.t) < 1e-4)), ...add].sort((a, b) => a.t - b.t);
    // Dos con el mismo tiempo (el final de un ciclo y el inicio del siguiente): queda el del ciclo nuevo.
    p.k = p.k.filter((k, i, a) => !(a[i + 1] && Math.abs(a[i + 1].t - k.t) < 1e-4));
    p.v = valueAt(p, 0);
    for (const k of add) if (!out.some(t => Math.abs(t - k.t) < 1e-4)) out.push(k.t);
  });
  return out.sort((a, b) => a - b);
}

/** Cuántas repeticiones caben hasta el final (o el principio) del clip. */
export function repeatsToFill(c: Clip, times: number[], gap: number, fps: number, dir: 1 | -1 = 1): number {
  const t0 = Math.min(...times), t1 = Math.max(...times), period = Math.max(1 / fps, t1 - t0 + gap);
  return Math.max(0, Math.min(500, Math.floor(((dir > 0 ? c.dur - t1 : t0) + 1e-6) / period)));
}

/**
 * Congela la animación en `lt` (s del clip): conserva lo de antes, pone un keyframe
 * con el valor exacto de ese instante y quita lo de después (el valor se queda fijo).
 * Devuelve cuántas propiedades cambió.
 */
export function freezeAt(c: Clip, lt: number): number {
  let n = 0;
  forEachProp(c, p => {
    if (!p.k?.length) return;
    const v = valueAt(p, lt);
    const before = p.k.filter(k => k.t < lt - 1e-4);
    if (!before.length) { delete p.k; p.v = v; n++; return; }
    p.k = [...before, { t: lt, v, e: 'hold' }];
    p.v = valueAt(p, 0);
    n++;
  });
  return n;
}

// ---------------------------------------------------------------- portapapeles de varias capas

/** Keyframes copiados de uno o varios clips (con su distancia en el tiempo). */
export interface MultiKeyClipboard {
  items: { src: string; name: string; order: number; off: number; abs: number; kc: KeyClipboard }[];
  span: number;
}

/** Orden de un clip en la línea de tiempo (pista de arriba primero, luego por inicio). */
export const clipOrder = (comp: Composition, c: Clip) => comp.tracks.findIndex(t => t.id === c.track) * 1e6 + c.start;

/** Qué se copia de un clip: tiempos (null = todos) y propiedades (null = todas). Varias partes se suman. */
export interface KeyPick { times: number[] | null; paths: string[] | null }

/**
 * Copia keyframes de varios clips (`sel`: clip → partes elegidas). Cada clip guarda
 * su desfase respecto al primero, para pegarlos con la misma distancia entre capas.
 */
export function copyMultiKeys(comp: Composition, sel: Map<string, KeyPick[]>): MultiKeyClipboard | null {
  const items: MultiKeyClipboard['items'] = [];
  for (const [id, picks] of sel) {
    const c = comp.clips.find(x => x.id === id);
    if (!c || !picks.length) continue;
    const want = (path: string, t: number) => picks.some(pk => (!pk.paths || pk.paths.includes(path)) && near(pk.times, t));
    const list: KeyClipboard['items'] = [];
    forEachProp(c, (p, path) => {
      const keys = (p.k ?? []).filter(k => want(path, k.t));
      if (!keys.length) return;
      const v = keys[0].v;
      const fx = path.startsWith('fx.') ? c.fx.find(f => f.id === path.split('.')[1])?.fx : undefined;
      list.push({ path, kind: typeof v === 'number' ? 'number' : typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? 'color' : 'other', fx, keys: clone(keys) });
    });
    if (!list.length) continue;
    const t0 = Math.min(...list.flatMap(i => i.keys.map(k => k.t)));
    for (const i of list) for (const k of i.keys) k.t -= t0;
    const kc: KeyClipboard = { items: list, span: Math.max(...list.flatMap(i => i.keys.map(k => k.t))) };
    items.push({ src: c.id, name: c.name, order: clipOrder(comp, c), off: 0, abs: c.start + t0, kc });
  }
  if (!items.length) return null;
  items.sort((a, b) => a.order - b.order);
  const g0 = Math.min(...items.map(i => i.abs));
  for (const i of items) i.off = i.abs - g0;
  return { items, span: Math.max(...items.map(i => i.off + i.kc.span)) };
}

/**
 * Pega un portapapeles de varias capas en `targets` (ordenados como en la línea de
 * tiempo: la capa n recibe la animación n, y si hay más destinos que capas
 * copiadas se repite). `at` = tiempo de la composición donde empieza (el cabezal)
 * o 'orig' = en los mismos instantes en que se copió. Devuelve cuántos keyframes
 * pegó y los tiempos nuevos de cada clip (para elegirlos).
 */
export function pasteMultiKeys(comp: Composition, mc: MultiKeyClipboard, targets: Clip[], at: number | 'orig', onto?: string): { n: number; sel: Map<string, number[]> } {
  const sorted = [...targets].sort((a, b) => clipOrder(comp, a) - clipOrder(comp, b));
  const sel = new Map<string, number[]>();
  let n = 0;
  sorted.forEach((c, j) => {
    const it = mc.items[j % mc.items.length];
    const local = (at === 'orig' ? it.abs : at + it.off) - c.start;
    const got = pasteKeys(c, it.kc, local, onto);
    if (!got) return;
    n += got;
    const ts: number[] = [];
    for (const i of it.kc.items) for (const k of i.keys) { const t = Math.max(0, Math.min(c.dur, local + k.t)); if (!ts.some(x => Math.abs(x - t) < 1e-4)) ts.push(t); }
    sel.set(c.id, ts.sort((a, b) => a - b));
  });
  return { n, sel };
}

/** Dónde quedarían los keyframes pegados (tiempos de la composición), para la vista previa. */
export function pastePreview(comp: Composition, mc: MultiKeyClipboard, targets: Clip[], at: number | 'orig'): { clip: string; t: number }[] {
  const sorted = [...targets].sort((a, b) => clipOrder(comp, a) - clipOrder(comp, b));
  const out: { clip: string; t: number }[] = [];
  sorted.forEach((c, j) => {
    const it = mc.items[j % mc.items.length];
    const local = (at === 'orig' ? it.abs : at + it.off) - c.start;
    const seen = new Set<number>();
    for (const i of it.kc.items) for (const k of i.keys) { const t = local + k.t; const key = Math.round(t * 1000); if (seen.has(key) || t < -1e-6 || t > c.dur + 1e-6) continue; seen.add(key); out.push({ clip: c.id, t: c.start + t }); }
  });
  return out;
}

// ---------------------------------------------------------------- animación rápida (Quick Animation)

export type QuickKind = 'enter' | 'fade-in' | 'fade-out' | 'zoom-in' | 'zoom-out' | 'bounce' | 'shake' | 'spin' | 'pulse' | 'float' | 'exit';
export type QuickDir = 'left' | 'right' | 'up' | 'down';
export interface QuickSpec {
  kind: QuickKind;
  /** Dirección (entradas y salidas deslizando): de dónde viene o hacia dónde va. */
  dir: QuickDir;
  /** Duración del movimiento (s). */
  len: number;
  /** Intensidad (1 = la del preset; 0.5 = la mitad de recorrido). */
  intensity: number;
  /** Curva de todos los tramos ('preset' = la del preset). */
  ease: EaseType | 'preset' | 'smooth';
  /** Inicio (s del clip): las entradas y bucles empiezan aquí; las salidas terminan al final del clip. */
  at: number;
}
export const QUICK_ANIMS: { kind: QuickKind; label: string; dir?: boolean }[] = [
  { kind: 'enter', label: 'Entrada deslizando', dir: true }, { kind: 'exit', label: 'Salida deslizando', dir: true },
  { kind: 'fade-in', label: 'Fade In' }, { kind: 'fade-out', label: 'Fade Out' },
  { kind: 'zoom-in', label: 'Zoom In' }, { kind: 'zoom-out', label: 'Zoom Out' },
  { kind: 'bounce', label: 'Rebote' }, { kind: 'shake', label: 'Sacudida' }, { kind: 'spin', label: 'Rotación' },
  { kind: 'pulse', label: 'Pulso' }, { kind: 'float', label: 'Flotar' },
];

/** Preset de movimiento que corresponde a una animación rápida. */
export function quickPreset(s: Pick<QuickSpec, 'kind' | 'dir'>): MotionPreset {
  const enter: Record<QuickDir, MotionPreset> = { left: 'slide-left-in', right: 'slide-right-in', up: 'slide-down-in', down: 'slide-up-in' };
  const exit: Record<QuickDir, MotionPreset> = { left: 'slide-left-out', right: 'slide-right-out', up: 'slide-up-out', down: 'slide-down-out' };
  switch (s.kind) {
    case 'enter': return enter[s.dir];
    case 'exit': return exit[s.dir];
    case 'bounce': return 'bounce-in';
    case 'spin': return 'spin-in';
    case 'pulse': return 'pulse';
    case 'float': return 'float';
    default: return s.kind;
  }
}

/**
 * Aplica una animación rápida a la transformación de un clip con duración,
 * intensidad, dirección, curva e inicio editables. Sólo reemplaza los keyframes
 * de las propiedades que anima dentro del tramo que ocupa (el resto se conserva).
 * Devuelve cuántas propiedades animó.
 */
export function quickAnimate(c: Clip, s: QuickSpec, W: number, H: number, fps: number): number {
  const id = quickPreset(s);
  const group = MOTION_PRESETS.find(p => p.id === id)?.group ?? 'Entrada';
  const len = Math.max(1 / fps, Math.min(s.len, c.dur));
  const loop = group === 'Bucle';
  const start = group === 'Salida' ? Math.max(0, c.dur - len) : Math.max(0, Math.min(c.dur - (loop ? 0 : len), s.at));
  const span = loop ? Math.max(len, c.dur - start) : len;
  const ref = group === 'Salida' ? start : group === 'Entrada' ? Math.min(c.dur, start + len) : start;
  // Copia sin animar con los valores de reposo, para que el preset parta de ellos.
  const tmp = clone(c.tf) as Transform;
  const rest: Record<string, number> = {};
  for (const [k, p] of Object.entries(tmp) as [keyof Transform, Prop][]) { p.v = valueAt(c.tf[k], ref); delete p.k; rest[k] = p.v; }
  applyPreset(tmp, id, span, len, W, H);
  let n = 0;
  for (const [k, p] of Object.entries(tmp) as [keyof Transform, Prop][]) {
    if (!p.k?.length) continue;
    const keys = p.k.map(key => {
      const v = rest[k] + (key.v - rest[k]) * s.intensity;
      return { ...key, t: fix(key.t + start, fps, c.dur), v: k === 'opacity' ? Math.max(0, Math.min(1, v)) : v };
    });
    if (s.ease !== 'preset') for (const key of keys.slice(0, -1)) setEase(key, s.ease === 'smooth' ? { e: 'bezier', b: [0.25, 0.1, 0.25, 1] } : { e: s.ease });
    const dst = c.tf[k];
    const a = keys[0].t - 1e-4, b = keys[keys.length - 1].t + 1e-4;
    const kept = (dst.k ?? []).filter(x => x.t < a || x.t > b);
    // Sin otros keyframes, la propiedad vuelve a su valor de reposo al terminar (no se queda en el del preset).
    dst.k = [...kept, ...keys].sort((x, y) => x.t - y.t).filter((key, i, arr) => !(arr[i + 1] && Math.abs(arr[i + 1].t - key.t) < 1e-4));
    dst.v = valueAt(dst, 0);
    n++;
  }
  return n;
}

// ---------------------------------------------------------------- propiedades vinculadas

/** Propiedades de transformación que se pueden vincular. */
export const LINKABLE: { id: string; label: string; paths: string[] }[] = [
  { id: 'pos', label: 'Posición', paths: ['tf.x', 'tf.y'] },
  { id: 'scale', label: 'Escala', paths: ['tf.sx', 'tf.sy'] },
  { id: 'rot', label: 'Rotación', paths: ['tf.rot'] },
  { id: 'opacity', label: 'Opacidad', paths: ['tf.opacity'] },
];

/** Prop de transformación de un clip ya con sus vínculos resueltos. */
function linkedTf(comp: Composition, c: Clip, depth: number): Transform {
  const l = c.link;
  if (!l || depth > 6) return c.tf;
  const src = comp.clips.find(x => x.id === l.to && x.id !== c.id);
  if (!src) return c.tf;
  const stf = linkedTf(comp, src, depth + 1);
  const tf = { ...c.tf };
  const shift = src.start - c.start;
  for (const path of l.paths) {
    const key = path.slice(3) as keyof Transform;
    const sp = stf[key];
    if (!path.startsWith('tf.') || !sp) continue;
    const off = l.off[path] ?? 0;
    tf[key] = { v: sp.v + off, ...(sp.k?.length ? { k: sp.k.map(k => ({ ...k, t: k.t + shift, v: k.v + off })) } : {}) };
  }
  return tf;
}

/** El clip tal como se ve: con las propiedades vinculadas tomadas del clip de origen. */
export function resolveLinks(comp: Composition, c: Clip): Clip {
  return c.link ? ({ ...c, tf: linkedTf(comp, c, 0) } as Clip) : c;
}

/** Vincula `paths` de `c` a `src` conservando la posición actual (desfase en `t`, s de la composición). */
export function makeLink(comp: Composition, c: Clip, src: Clip, paths: string[], t: number): ClipLink {
  const stf = linkedTf(comp, src, 0);
  const own = linkedTf(comp, c, 0);
  const off: Record<string, number> = {};
  for (const path of paths) {
    const key = path.slice(3) as keyof Transform;
    off[path] = +(valueAt(own[key], t - c.start) - valueAt(stf[key], t - src.start)).toFixed(4);
  }
  const prev = c.link && c.link.to === src.id ? c.link : null;
  return { to: src.id, paths: [...new Set([...(prev?.paths ?? []), ...paths])], off: { ...(prev?.off ?? {}), ...off } };
}

/** ¿Vincular `c` a `src` formaría un círculo? */
export function linkLoops(comp: Composition, c: Clip, src: Clip): boolean {
  let cur: Clip | undefined = src;
  for (let i = 0; cur && i < 50; i++) { if (cur.id === c.id) return true; const to: string | undefined = cur.link?.to; cur = to ? comp.clips.find(x => x.id === to) : undefined; }
  return false;
}

/** Hay keyframe en `lt` (s del clip) en esa propiedad. */
export const hasKeyAt = (p: Prop<unknown>, lt: number) => !!keyAt(p, lt);

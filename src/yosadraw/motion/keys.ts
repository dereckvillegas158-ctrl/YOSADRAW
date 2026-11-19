/**
 * YOSADRAW MOTION — propiedades animables, curvas de interpolación y presets.
 *
 * Una propiedad es `{ v, k? }`: un valor fijo o, si tiene keyframes, la curva que
 * pasa por ellos. Cada keyframe guarda la curva con la que se va al siguiente
 * (lineal, mantener, suave, Bézier cúbica editable, rebasar, rebote, elástico).
 * Los tiempos son segundos relativos al inicio del clip.
 */

export type EaseType = 'linear' | 'hold' | 'in' | 'out' | 'inout' | 'bezier' | 'overshoot' | 'bounce' | 'elastic';
export type Bez = [number, number, number, number];
export interface Key<T = number> { t: number; v: T; e: EaseType; b?: Bez }
export interface Prop<T = number> { v: T; k?: Key<T>[] }

export const EASES: { id: EaseType; label: string }[] = [
  { id: 'linear', label: 'Lineal' }, { id: 'inout', label: 'Suave (entrada y salida)' }, { id: 'in', label: 'Acelerar (ease in)' },
  { id: 'out', label: 'Frenar (ease out)' }, { id: 'bezier', label: 'Bézier personalizada' }, { id: 'overshoot', label: 'Rebasar (overshoot)' },
  { id: 'bounce', label: 'Rebote' }, { id: 'elastic', label: 'Elástico' }, { id: 'hold', label: 'Mantener (salto)' },
];

export const BEZ: Record<'in' | 'out' | 'inout', Bez> = { in: [0.42, 0, 1, 1], out: [0, 0, 0.58, 1], inout: [0.42, 0, 0.58, 1] };

/** Cubic-bezier(x1, y1, x2, y2) como en CSS: y en función de x (Newton + bisección). */
export function cubicBezier([x1, y1, x2, y2]: Bez) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = (t: number) => ((ax * t + bx) * t + cx) * t, Y = (t: number) => ((ay * t + by) * t + cy) * t;
  const dX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) { const e = X(t) - x, d = dX(t); if (Math.abs(e) < 1e-6) return Y(t); if (Math.abs(d) < 1e-6) break; t -= e / d; }
    let lo = 0, hi = 1; t = x;
    for (let i = 0; i < 40; i++) { const v = X(t); if (Math.abs(v - x) < 1e-6) break; if (v < x) lo = t; else hi = t; t = (lo + hi) / 2; }
    return Y(t);
  };
}

const bounceOut = (u: number) => {
  const n = 7.5625, d = 2.75;
  if (u < 1 / d) return n * u * u;
  if (u < 2 / d) return n * (u -= 1.5 / d) * u + 0.75;
  if (u < 2.5 / d) return n * (u -= 2.25 / d) * u + 0.9375;
  return n * (u -= 2.625 / d) * u + 0.984375;
};

/** Función de progreso (0..1 → 0..1, puede salirse en rebasar/elástico) de un keyframe. */
export function easeOf(k: Pick<Key<unknown>, 'e' | 'b'>): (u: number) => number {
  switch (k.e) {
    case 'hold': return () => 0;
    case 'in': case 'out': case 'inout': return cubicBezier(BEZ[k.e]);
    case 'bezier': return cubicBezier(k.b ?? BEZ.inout);
    case 'overshoot': { const c1 = 1.70158, c3 = c1 + 1; return u => 1 + c3 * (u - 1) ** 3 + c1 * (u - 1) ** 2; }
    case 'bounce': return bounceOut;
    case 'elastic': return u => (u <= 0 ? 0 : u >= 1 ? 1 : 2 ** (-10 * u) * Math.sin((u * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1);
    default: return u => u;
  }
}

// ---------------------------------------------------------------- valores

const isColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const rgb = (h: string) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const hex = (c: number[]) => `#${c.map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('')}`;

export function lerp<T>(a: T, b: T, u: number): T {
  if (typeof a === 'number' && typeof b === 'number') return (a + (b - a) * u) as T;
  if (isColor(a) && isColor(b)) { const A = rgb(a), B = rgb(b); return hex(A.map((x, i) => x + (B[i] - x) * Math.max(0, Math.min(1, u)))) as T; }
  return (u < 1 ? a : b);
}

/** Valor de una propiedad en el tiempo `t` (s, relativo al clip). */
export function valueAt<T>(p: Prop<T>, t: number): T {
  const k = p.k;
  if (!k?.length) return p.v;
  if (t <= k[0].t) return k[0].v;
  const last = k[k.length - 1];
  if (t >= last.t) return last.v;
  let i = 0;
  while (i < k.length - 2 && t >= k[i + 1].t) i++;
  const a = k[i], b = k[i + 1];
  const u = (t - a.t) / Math.max(1e-9, b.t - a.t);
  return a.e === 'hold' ? a.v : lerp(a.v, b.v, easeOf(a)(u));
}

export const animated = (p: Prop<unknown>) => !!p.k?.length;
export const prop = <T>(v: T): Prop<T> => ({ v });
const EPS = 1e-4;
export const keyAt = <T>(p: Prop<T>, t: number) => p.k?.find(k => Math.abs(k.t - t) < EPS) ?? null;

/**
 * Pone un valor en `t`: si la propiedad está animada crea o actualiza el keyframe;
 * si no, cambia el valor fijo. `forceKey` = crear keyframe aunque no esté animada.
 */
export function setValue<T>(p: Prop<T>, t: number, v: T, forceKey = false) {
  if (!p.k?.length && !forceKey) { p.v = v; return; }
  p.k ??= [];
  const k = keyAt(p, t);
  if (k) k.v = v;
  else { p.k.push({ t, v, e: 'inout' }); p.k.sort((x, y) => x.t - y.t); }
  p.v = valueAt(p, 0);
}

/** Activa la animación (keyframe con el valor actual en t) o, si ya hay uno en t, lo quita. */
export function toggleKey<T>(p: Prop<T>, t: number) {
  const k = keyAt(p, t);
  if (k) {
    p.v = valueAt(p, t);
    p.k = p.k!.filter(x => x !== k);
    if (!p.k.length) delete p.k;
    return false;
  }
  setValue(p, t, valueAt(p, t), true);
  return true;
}

/** Desplaza los keyframes `dt` segundos. */
export function shiftKeys(p: Prop<unknown>, dt: number) { if (p.k) for (const k of p.k) k.t += dt; }

/**
 * Corta la animación en `t`: `side` = 'left' conserva lo de antes (y un keyframe con el valor
 * exacto en `t`); 'right' conserva lo de después, empezando en 0. El movimiento no salta en el corte.
 */
export function cutKeys(p: Prop<unknown>, t: number, side: 'left' | 'right') {
  if (!p.k?.length) return;
  const v = valueAt(p, t);
  const seg = [...p.k].reverse().find(k => k.t <= t) ?? p.k[0];
  const edge: Key<unknown> = { t, v, e: seg.e, b: seg.b };
  let keys = side === 'left' ? p.k.filter(k => k.t < t - EPS) : p.k.filter(k => k.t > t + EPS);
  keys = side === 'left' ? [...keys, { ...edge, e: 'linear' as EaseType }] : [edge, ...keys];
  if (side === 'right') for (const k of keys) k.t -= t;
  p.k = keys;
  p.v = keys[0].v;
}

// ---------------------------------------------------------------- presets de movimiento

export interface TfLike { x: Prop; y: Prop; sx: Prop; sy: Prop; rot: Prop; opacity: Prop }
export type MotionPreset = 'fade-in' | 'slide-left-in' | 'slide-right-in' | 'slide-up-in' | 'slide-down-in' | 'zoom-in' | 'pop-in' | 'spin-in'
  | 'fade-out' | 'slide-left-out' | 'slide-right-out' | 'zoom-out' | 'pulse' | 'shake' | 'float';
export const MOTION_PRESETS: { id: MotionPreset; label: string; group: 'Entrada' | 'Salida' | 'Énfasis' }[] = [
  { id: 'fade-in', label: 'Aparecer', group: 'Entrada' }, { id: 'slide-left-in', label: 'Deslizar desde la izquierda', group: 'Entrada' },
  { id: 'slide-right-in', label: 'Deslizar desde la derecha', group: 'Entrada' }, { id: 'slide-up-in', label: 'Subir', group: 'Entrada' },
  { id: 'slide-down-in', label: 'Bajar', group: 'Entrada' }, { id: 'zoom-in', label: 'Acercar', group: 'Entrada' },
  { id: 'pop-in', label: 'Aparecer con rebote', group: 'Entrada' }, { id: 'spin-in', label: 'Girar al entrar', group: 'Entrada' },
  { id: 'fade-out', label: 'Desvanecer', group: 'Salida' }, { id: 'slide-left-out', label: 'Salir por la izquierda', group: 'Salida' },
  { id: 'slide-right-out', label: 'Salir por la derecha', group: 'Salida' }, { id: 'zoom-out', label: 'Alejar', group: 'Salida' },
  { id: 'pulse', label: 'Pulso', group: 'Énfasis' }, { id: 'shake', label: 'Sacudida', group: 'Énfasis' }, { id: 'float', label: 'Flotar', group: 'Énfasis' },
];

/**
 * Aplica un preset añadiendo keyframes a la transformación (respeta el resto).
 * `dur` = duración del clip, `len` = duración del movimiento, `W` = ancho de la composición.
 */
export function applyPreset(tf: TfLike, id: MotionPreset, dur: number, len: number, W: number, H: number) {
  len = Math.max(0.05, Math.min(len, dur));
  const key = <T>(p: Prop<T>, t: number, v: T, e: EaseType = 'out') => { setValue(p, t, v, true); const k = keyAt(p, t); if (k) k.e = e; };
  const x = valueAt(tf.x, 0), y = valueAt(tf.y, 0), sx = valueAt(tf.sx, 0), sy = valueAt(tf.sy, 0), r = valueAt(tf.rot, 0), o = valueAt(tf.opacity, 0) || 1;
  const s0 = 0, e0 = dur - len;
  switch (id) {
    case 'fade-in': key(tf.opacity, s0, 0, 'linear'); key(tf.opacity, len, o); break;
    case 'slide-left-in': key(tf.x, s0, x - W, 'out'); key(tf.x, len, x); break;
    case 'slide-right-in': key(tf.x, s0, x + W, 'out'); key(tf.x, len, x); break;
    case 'slide-up-in': key(tf.y, s0, y + H, 'out'); key(tf.y, len, y); break;
    case 'slide-down-in': key(tf.y, s0, y - H, 'out'); key(tf.y, len, y); break;
    case 'zoom-in': key(tf.sx, s0, sx * 0.2, 'out'); key(tf.sx, len, sx); key(tf.sy, s0, sy * 0.2, 'out'); key(tf.sy, len, sy); key(tf.opacity, s0, 0, 'out'); key(tf.opacity, len, o); break;
    case 'pop-in': key(tf.sx, s0, 0, 'overshoot'); key(tf.sx, len, sx); key(tf.sy, s0, 0, 'overshoot'); key(tf.sy, len, sy); break;
    case 'spin-in': key(tf.rot, s0, r - 360, 'out'); key(tf.rot, len, r); key(tf.opacity, s0, 0, 'out'); key(tf.opacity, len, o); break;
    case 'fade-out': key(tf.opacity, e0, o, 'linear'); key(tf.opacity, dur, 0); break;
    case 'slide-left-out': key(tf.x, e0, x, 'in'); key(tf.x, dur, x - W); break;
    case 'slide-right-out': key(tf.x, e0, x, 'in'); key(tf.x, dur, x + W); break;
    case 'zoom-out': key(tf.sx, e0, sx, 'in'); key(tf.sx, dur, sx * 0.2); key(tf.sy, e0, sy, 'in'); key(tf.sy, dur, sy * 0.2); key(tf.opacity, e0, o, 'in'); key(tf.opacity, dur, 0); break;
    case 'pulse': for (let t = 0, i = 0; t <= dur + 1e-6; t += len / 2, i++) { key(tf.sx, t, i % 2 ? sx * 1.12 : sx, 'inout'); key(tf.sy, t, i % 2 ? sy * 1.12 : sy, 'inout'); } break;
    case 'shake': { const n = Math.max(4, Math.round(len * 24)); for (let i = 0; i <= n; i++) key(tf.x, (i / n) * len, x + (i === n ? 0 : (i % 2 ? 1 : -1) * W * 0.012 * (1 - i / n)), 'linear'); break; }
    case 'float': for (let t = 0, i = 0; t <= dur + 1e-6; t += len, i++) key(tf.y, t, i % 2 ? y - H * 0.02 : y, 'inout'); break;
  }
}

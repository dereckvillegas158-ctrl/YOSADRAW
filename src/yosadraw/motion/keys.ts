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

export interface TfLike { x: Prop; y: Prop; sx: Prop; sy: Prop; rot: Prop; opacity: Prop; skx?: Prop; sky?: Prop }
export type PresetGroup = 'Entrada' | 'Salida' | 'Bucle';
export type MotionPreset =
  | 'fade-in' | 'slide-left-in' | 'slide-right-in' | 'slide-up-in' | 'slide-down-in' | 'zoom-in' | 'pop-in' | 'spin-in' | 'bounce-in' | 'drop-in'
  | 'rise-in' | 'flip-x-in' | 'flip-y-in' | 'elastic-in' | 'stretch-in' | 'skew-in' | 'whip-in' | 'swing-in' | 'grow-in'
  | 'fade-out' | 'slide-left-out' | 'slide-right-out' | 'slide-up-out' | 'slide-down-out' | 'zoom-out' | 'pop-out' | 'spin-out' | 'drop-out'
  | 'flip-x-out' | 'shrink-out' | 'fly-out' | 'skew-out'
  | 'pulse' | 'shake' | 'float' | 'heartbeat' | 'wiggle' | 'swing' | 'blink' | 'rubber' | 'jello' | 'tada' | 'spin-loop' | 'bounce-loop' | 'orbit' | 'breathe';
export const MOTION_PRESETS: { id: MotionPreset; label: string; group: PresetGroup }[] = [
  { id: 'fade-in', label: 'Aparecer', group: 'Entrada' }, { id: 'slide-left-in', label: 'Desde la izquierda', group: 'Entrada' },
  { id: 'slide-right-in', label: 'Desde la derecha', group: 'Entrada' }, { id: 'slide-up-in', label: 'Desde abajo', group: 'Entrada' },
  { id: 'slide-down-in', label: 'Desde arriba', group: 'Entrada' }, { id: 'zoom-in', label: 'Acercar', group: 'Entrada' },
  { id: 'pop-in', label: 'Pop', group: 'Entrada' }, { id: 'spin-in', label: 'Girar', group: 'Entrada' },
  { id: 'bounce-in', label: 'Rebotar', group: 'Entrada' }, { id: 'drop-in', label: 'Caer', group: 'Entrada' },
  { id: 'rise-in', label: 'Elevarse suave', group: 'Entrada' }, { id: 'flip-x-in', label: 'Voltear horizontal', group: 'Entrada' },
  { id: 'flip-y-in', label: 'Voltear vertical', group: 'Entrada' }, { id: 'elastic-in', label: 'Elástico', group: 'Entrada' },
  { id: 'stretch-in', label: 'Estirar', group: 'Entrada' }, { id: 'skew-in', label: 'Inclinado', group: 'Entrada' },
  { id: 'whip-in', label: 'Latigazo', group: 'Entrada' }, { id: 'swing-in', label: 'Péndulo', group: 'Entrada' },
  { id: 'grow-in', label: 'Crecer', group: 'Entrada' },
  { id: 'fade-out', label: 'Desvanecer', group: 'Salida' }, { id: 'slide-left-out', label: 'Hacia la izquierda', group: 'Salida' },
  { id: 'slide-right-out', label: 'Hacia la derecha', group: 'Salida' }, { id: 'slide-up-out', label: 'Hacia arriba', group: 'Salida' },
  { id: 'slide-down-out', label: 'Hacia abajo', group: 'Salida' }, { id: 'zoom-out', label: 'Alejar', group: 'Salida' },
  { id: 'pop-out', label: 'Pop', group: 'Salida' }, { id: 'spin-out', label: 'Girar', group: 'Salida' },
  { id: 'drop-out', label: 'Caer', group: 'Salida' }, { id: 'flip-x-out', label: 'Voltear', group: 'Salida' },
  { id: 'shrink-out', label: 'Encoger', group: 'Salida' }, { id: 'fly-out', label: 'Salir volando', group: 'Salida' },
  { id: 'skew-out', label: 'Inclinado', group: 'Salida' },
  { id: 'pulse', label: 'Pulso', group: 'Bucle' }, { id: 'heartbeat', label: 'Latido', group: 'Bucle' },
  { id: 'shake', label: 'Sacudida', group: 'Bucle' }, { id: 'wiggle', label: 'Temblor', group: 'Bucle' },
  { id: 'float', label: 'Flotar', group: 'Bucle' }, { id: 'swing', label: 'Balanceo', group: 'Bucle' },
  { id: 'blink', label: 'Parpadeo', group: 'Bucle' }, { id: 'rubber', label: 'Goma', group: 'Bucle' },
  { id: 'jello', label: 'Gelatina', group: 'Bucle' }, { id: 'tada', label: 'Tadá', group: 'Bucle' },
  { id: 'spin-loop', label: 'Girar sin parar', group: 'Bucle' }, { id: 'bounce-loop', label: 'Saltar', group: 'Bucle' },
  { id: 'orbit', label: 'Órbita', group: 'Bucle' }, { id: 'breathe', label: 'Respirar', group: 'Bucle' },
];

/**
 * Aplica un preset añadiendo keyframes a la transformación (respeta el resto).
 * `dur` = duración del clip, `len` = duración del movimiento (en los de bucle, la de
 * un ciclo), `W` y `H` = tamaño de la composición. Entradas al principio del clip,
 * salidas al final y bucles durante todo el clip.
 */
export function applyPreset(tf: TfLike, id: MotionPreset, dur: number, len: number, W: number, H: number) {
  len = Math.max(0.05, Math.min(len, dur));
  const key = <T>(p: Prop<T> | undefined, t: number, v: T, e: EaseType = 'out') => { if (!p) return; t = Math.max(0, Math.min(dur, t)); setValue(p, t, v, true); const k = keyAt(p, t); if (k) k.e = e; };
  const x = valueAt(tf.x, 0), y = valueAt(tf.y, 0), sx = valueAt(tf.sx, 0), sy = valueAt(tf.sy, 0), r = valueAt(tf.rot, 0), o = valueAt(tf.opacity, 0) || 1;
  const skx = tf.skx ? valueAt(tf.skx, 0) : 0;
  const s0 = 0, e0 = dur - len, L = len;
  const both = (t: number, kx: number, ky: number, e: EaseType = 'out') => { key(tf.sx, t, sx * kx, e); key(tf.sy, t, sy * ky, e); };
  /** Repite `fn(t, i)` cada `step` segundos a lo largo del clip. */
  const loop = (step: number, fn: (t: number, i: number) => void) => { for (let t = 0, i = 0; t <= dur + 1e-6 && i < 2000; t += step, i++) fn(t, i); };
  switch (id) {
    // ---- entradas
    case 'fade-in': key(tf.opacity, s0, 0, 'linear'); key(tf.opacity, L, o); break;
    case 'slide-left-in': key(tf.x, s0, x - W, 'out'); key(tf.x, L, x); break;
    case 'slide-right-in': key(tf.x, s0, x + W, 'out'); key(tf.x, L, x); break;
    case 'slide-up-in': key(tf.y, s0, y + H, 'out'); key(tf.y, L, y); break;
    case 'slide-down-in': key(tf.y, s0, y - H, 'out'); key(tf.y, L, y); break;
    case 'zoom-in': both(s0, 0.2, 0.2); both(L, 1, 1); key(tf.opacity, s0, 0, 'out'); key(tf.opacity, L, o); break;
    case 'pop-in': both(s0, 0, 0, 'overshoot'); both(L, 1, 1); break;
    case 'spin-in': key(tf.rot, s0, r - 360, 'out'); key(tf.rot, L, r); key(tf.opacity, s0, 0, 'out'); key(tf.opacity, L, o); break;
    case 'bounce-in': key(tf.y, s0, y - H * 0.6, 'bounce'); key(tf.y, L, y); key(tf.opacity, s0, 0, 'out'); key(tf.opacity, L * 0.3, o); break;
    case 'drop-in': key(tf.y, s0, y - H, 'overshoot'); key(tf.y, L, y); break;
    case 'rise-in': key(tf.y, s0, y + H * 0.06, 'out'); key(tf.y, L, y); key(tf.opacity, s0, 0, 'out'); key(tf.opacity, L, o); break;
    case 'flip-x-in': key(tf.sx, s0, 0, 'overshoot'); key(tf.sx, L, sx); break;
    case 'flip-y-in': key(tf.sy, s0, 0, 'overshoot'); key(tf.sy, L, sy); break;
    case 'elastic-in': both(s0, 0, 0, 'elastic'); both(L, 1, 1); break;
    case 'stretch-in': both(s0, 2.4, 0.1, 'overshoot'); both(L, 1, 1); key(tf.opacity, s0, 0, 'out'); key(tf.opacity, L * 0.4, o); break;
    case 'skew-in': key(tf.x, s0, x - W * 0.3, 'out'); key(tf.x, L, x); key(tf.skx, s0, skx + 40, 'out'); key(tf.skx, L, skx); key(tf.opacity, s0, 0, 'out'); key(tf.opacity, L * 0.6, o); break;
    case 'whip-in': key(tf.x, s0, x + W, 'overshoot'); key(tf.x, L, x); key(tf.skx, s0, skx - 30, 'overshoot'); key(tf.skx, L, skx); break;
    case 'swing-in': key(tf.rot, s0, r - 70, 'elastic'); key(tf.rot, L, r); key(tf.opacity, s0, 0, 'out'); key(tf.opacity, L * 0.3, o); break;
    case 'grow-in': key(tf.sy, s0, 0, 'out'); key(tf.sy, L, sy); break;
    // ---- salidas
    case 'fade-out': key(tf.opacity, e0, o, 'linear'); key(tf.opacity, dur, 0); break;
    case 'slide-left-out': key(tf.x, e0, x, 'in'); key(tf.x, dur, x - W); break;
    case 'slide-right-out': key(tf.x, e0, x, 'in'); key(tf.x, dur, x + W); break;
    case 'slide-up-out': key(tf.y, e0, y, 'in'); key(tf.y, dur, y - H); break;
    case 'slide-down-out': key(tf.y, e0, y, 'in'); key(tf.y, dur, y + H); break;
    case 'zoom-out': both(e0, 1, 1, 'in'); both(dur, 0.2, 0.2); key(tf.opacity, e0, o, 'in'); key(tf.opacity, dur, 0); break;
    case 'pop-out': both(e0, 1, 1, 'out'); both(e0 + L * 0.35, 1.15, 1.15, 'in'); both(dur, 0, 0); break;
    case 'spin-out': key(tf.rot, e0, r, 'in'); key(tf.rot, dur, r + 360); key(tf.opacity, e0, o, 'in'); key(tf.opacity, dur, 0); both(e0, 1, 1, 'in'); both(dur, 0.3, 0.3); break;
    case 'drop-out': key(tf.y, e0, y, 'in'); key(tf.y, dur, y + H); key(tf.rot, e0, r, 'in'); key(tf.rot, dur, r + 25); break;
    case 'flip-x-out': key(tf.sx, e0, sx, 'in'); key(tf.sx, dur, 0); break;
    case 'shrink-out': both(e0, 1, 1, 'in'); both(dur, 0, 0); break;
    case 'fly-out': key(tf.y, e0, y, 'in'); key(tf.y, dur, y - H); both(e0, 1, 1, 'in'); both(dur, 0.6, 1.4); key(tf.opacity, e0, o, 'in'); key(tf.opacity, dur, 0); break;
    case 'skew-out': key(tf.x, e0, x, 'in'); key(tf.x, dur, x + W * 0.3); key(tf.skx, e0, skx, 'in'); key(tf.skx, dur, skx - 40); key(tf.opacity, e0 + L * 0.4, o, 'in'); key(tf.opacity, dur, 0); break;
    // ---- bucles (todo el clip)
    case 'pulse': loop(L / 2, (t, i) => both(t, i % 2 ? 1.12 : 1, i % 2 ? 1.12 : 1, 'inout')); break;
    case 'heartbeat': loop(L, t => { both(t, 1, 1, 'out'); both(t + L * 0.14, 1.18, 1.18, 'in'); both(t + L * 0.28, 1, 1, 'out'); both(t + L * 0.42, 1.12, 1.12, 'in'); both(t + L * 0.56, 1, 1, 'linear'); }); break;
    case 'shake': { const n = Math.max(4, Math.round(L * 24)); for (let i = 0; i <= n; i++) key(tf.x, (i / n) * L, x + (i === n ? 0 : (i % 2 ? 1 : -1) * W * 0.012 * (1 - i / n)), 'linear'); break; }
    case 'wiggle': { let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5; loop(L / 6, t => { key(tf.x, t, x + rnd() * W * 0.01, 'inout'); key(tf.y, t, y + rnd() * H * 0.01, 'inout'); key(tf.rot, t, r + rnd() * 6, 'inout'); }); break; }
    case 'float': loop(L, (t, i) => key(tf.y, t, i % 2 ? y - H * 0.02 : y, 'inout')); break;
    case 'swing': loop(L / 2, (t, i) => key(tf.rot, t, r + (i % 2 ? 12 : -12), 'inout')); break;
    case 'blink': loop(L / 2, (t, i) => key(tf.opacity, t, i % 2 ? 0 : o, 'hold')); break;
    case 'rubber': loop(L, t => { both(t, 1, 1, 'inout'); both(t + L * 0.3, 1.25, 0.75, 'inout'); both(t + L * 0.45, 0.75, 1.25, 'inout'); both(t + L * 0.6, 1.15, 0.85, 'inout'); both(t + L * 0.75, 0.95, 1.05, 'inout'); }); break;
    case 'jello': loop(L, t => { const a = [12.5, -6.25, 3.125, -1.56, 0.78, 0]; a.forEach((v, j) => key(tf.skx, t + (L * (j + 1)) / (a.length + 1), skx + v, 'inout')); key(tf.skx, t, skx, 'inout'); }); break;
    case 'tada': loop(L, t => { both(t, 1, 1, 'inout'); both(t + L * 0.1, 0.9, 0.9, 'inout'); [3, -3, 3, -3, 3, -3].forEach((v, j) => { key(tf.rot, t + L * (0.2 + j * 0.1), r + v, 'inout'); both(t + L * (0.2 + j * 0.1), 1.1, 1.1, 'inout'); }); key(tf.rot, t + L * 0.85, r, 'inout'); both(t + L * 0.85, 1, 1, 'inout'); key(tf.rot, t, r, 'inout'); }); break;
    case 'spin-loop': loop(L, (t, i) => key(tf.rot, t, r + 360 * i, 'linear')); break;
    case 'bounce-loop': loop(L, t => { key(tf.y, t, y, 'out'); key(tf.y, t + L / 2, y - H * 0.08, 'in'); }); break;
    case 'orbit': loop(L / 8, (t, i) => { const a = (i / 8) * Math.PI * 2, rad = Math.min(W, H) * 0.04; key(tf.x, t, x + Math.cos(a) * rad, 'linear'); key(tf.y, t, y + Math.sin(a) * rad, 'linear'); }); break;
    case 'breathe': loop(L, (t, i) => { both(t, i % 2 ? 1.05 : 1, i % 2 ? 1.05 : 1, 'inout'); key(tf.opacity, t, i % 2 ? o : o * 0.8, 'inout'); }); break;
  }
}

/**
 * YOSADRAW 3D — geometría editable (malla poligonal).
 *
 * Una malla es una lista de vértices (x, y, z) y de caras: cada cara es un ciclo de
 * índices de vértice en sentido antihorario visto desde fuera (la normal apunta
 * hacia fuera), con su ranura de material y, opcionalmente, coordenadas UV por
 * esquina. Las operaciones de modelado (extruir, inset, biselar, subdividir,
 * fusionar, borrar, agujeros, puentes) son funciones puras que devuelven una malla
 * nueva y la selección resultante: el historial sólo guarda instantáneas.
 */

export type V3 = [number, number, number];
export interface Mesh {
  /** Posiciones: x0, y0, z0, x1, y1, z1… */
  v: number[];
  /** Caras: índices de vértice (≥ 3) en sentido antihorario visto desde fuera. */
  f: number[][];
  /** Ranura de material de cada cara. */
  m: number[];
  /** UV por esquina de cada cara (u0, v0, u1, v1…) o null = proyección automática. */
  uv?: (number[] | null)[];
}

// ---------------------------------------------------------------- vectores

export const vget = (m: Mesh, i: number): V3 => [m.v[i * 3], m.v[i * 3 + 1], m.v[i * 3 + 2]];
export const vset = (m: Mesh, i: number, p: V3) => { m.v[i * 3] = p[0]; m.v[i * 3 + 1] = p[1]; m.v[i * 3 + 2] = p[2]; };
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mulS = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export const vcount = (m: Mesh) => m.v.length / 3;
export const cloneMesh = (m: Mesh): Mesh => ({ v: [...m.v], f: m.f.map(x => [...x]), m: [...m.m], ...(m.uv ? { uv: m.uv.map(x => (x ? [...x] : null)) } : {}) });

/** Normal (Newell: también vale para caras no planas) y centro de una cara. */
export function faceNormal(m: Mesh, f: number[]): V3 {
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < f.length; i++) {
    const a = vget(m, f[i]), b = vget(m, f[(i + 1) % f.length]);
    x += (a[1] - b[1]) * (a[2] + b[2]); y += (a[2] - b[2]) * (a[0] + b[0]); z += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return norm([x, y, z]);
}
export function faceCenter(m: Mesh, f: number[]): V3 {
  let c: V3 = [0, 0, 0];
  for (const i of f) c = add(c, vget(m, i));
  return mulS(c, 1 / f.length);
}
export const ekey = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);

/** Aristas únicas con las caras que las usan. */
export function edgeMap(m: Mesh): Map<string, { a: number; b: number; faces: number[] }> {
  const out = new Map<string, { a: number; b: number; faces: number[] }>();
  m.f.forEach((f, fi) => {
    for (let i = 0; i < f.length; i++) {
      const a = f[i], b = f[(i + 1) % f.length], k = ekey(a, b);
      const e = out.get(k);
      if (e) e.faces.push(fi); else out.set(k, { a: Math.min(a, b), b: Math.max(a, b), faces: [fi] });
    }
  });
  return out;
}
export const edgeList = (m: Mesh): [number, number][] => [...edgeMap(m).values()].map(e => [e.a, e.b]);

/** Caja que envuelve la malla. */
export function bounds(m: Mesh): { min: V3; max: V3 } {
  const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.v.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], m.v[i + k]); max[k] = Math.max(max[k], m.v[i + k]); }
  if (!m.v.length) return { min: [0, 0, 0], max: [0, 0, 0] };
  return { min, max };
}

/** Quita vértices sin usar y caras degeneradas (renumera). */
export function compact(m: Mesh): Mesh {
  const faces: number[][] = [], mats: number[] = [], uvs: (number[] | null)[] = [];
  m.f.forEach((f, i) => {
    // Vértices repetidos seguidos (tras fusionar) fuera.
    const g: number[] = [], gu: number[] = [];
    const u = m.uv?.[i];
    f.forEach((x, k) => { if (g[g.length - 1] !== x) { g.push(x); if (u) gu.push(u[k * 2], u[k * 2 + 1]); } });
    while (g.length > 1 && g[0] === g[g.length - 1]) { g.pop(); if (u) gu.splice(-2); }
    if (new Set(g).size < 3) return;
    faces.push(g); mats.push(m.m[i] ?? 0); uvs.push(u ? gu : null);
  });
  const used = new Map<number, number>();
  const v: number[] = [];
  for (const f of faces) for (let k = 0; k < f.length; k++) {
    let n = used.get(f[k]);
    if (n === undefined) { n = v.length / 3; used.set(f[k], n); v.push(m.v[f[k] * 3], m.v[f[k] * 3 + 1], m.v[f[k] * 3 + 2]); }
    f[k] = n;
  }
  return { v, f: faces, m: mats, ...(uvs.some(Boolean) ? { uv: uvs } : {}) };
}

// ---------------------------------------------------------------- primitivas (centradas en el origen, Y hacia arriba)

class Builder {
  v: number[] = []; f: number[][] = []; m: number[] = []; uv: (number[] | null)[] = [];
  p(x: number, y: number, z: number) { this.v.push(x, y, z); return this.v.length / 3 - 1; }
  face(idx: number[], uv: number[] | null = null, mat = 0) { this.f.push(idx); this.m.push(mat); this.uv.push(uv); }
  done(): Mesh { return { v: this.v, f: this.f, m: this.m, ...(this.uv.some(Boolean) ? { uv: this.uv } : {}) }; }
}

export function box(w = 1, h = 1, d = 1): Mesh {
  const b = new Builder(), x = w / 2, y = h / 2, z = d / 2;
  const P = [b.p(-x, -y, -z), b.p(x, -y, -z), b.p(x, y, -z), b.p(-x, y, -z), b.p(-x, -y, z), b.p(x, -y, z), b.p(x, y, z), b.p(-x, y, z)];
  const q = [0, 0, 1, 0, 1, 1, 0, 1];
  b.face([P[4], P[5], P[6], P[7]], q); // +z
  b.face([P[1], P[0], P[3], P[2]], q); // -z
  b.face([P[5], P[1], P[2], P[6]], q); // +x
  b.face([P[0], P[4], P[7], P[3]], q); // -x
  b.face([P[7], P[6], P[2], P[3]], q); // +y
  b.face([P[0], P[1], P[5], P[4]], q); // -y
  return b.done();
}

export function plane(w = 2, d = 2, sx = 1, sz = 1): Mesh {
  const b = new Builder();
  const id = (i: number, j: number) => i * (sz + 1) + j;
  for (let i = 0; i <= sx; i++) for (let j = 0; j <= sz; j++) b.p(-w / 2 + (w * i) / sx, 0, -d / 2 + (d * j) / sz);
  for (let i = 0; i < sx; i++) for (let j = 0; j < sz; j++) {
    const u0 = i / sx, u1 = (i + 1) / sx, v0 = 1 - j / sz, v1 = 1 - (j + 1) / sz;
    b.face([id(i, j), id(i, j + 1), id(i + 1, j + 1), id(i + 1, j)], [u0, v0, u0, v1, u1, v1, u1, v0]);
  }
  return b.done();
}

/** Superficie de revolución: perfil (radio, altura) de abajo arriba; radios 0 en los extremos = polo. */
function lathe(profile: [number, number][], seg: number, uvRows?: number[]): Mesh {
  const b = new Builder();
  const rows: number[][] = profile.map(([r, y]) => (r < 1e-9 ? [b.p(0, y, 0)] : Array.from({ length: seg }, (_, i) => { const a = (i / seg) * Math.PI * 2; return b.p(Math.cos(a) * r, y, -Math.sin(a) * r); })));
  const vr = (k: number) => uvRows?.[k] ?? k / (profile.length - 1);
  for (let k = 0; k < rows.length - 1; k++) {
    const A = rows[k], B = rows[k + 1];
    for (let i = 0; i < seg; i++) {
      const u0 = i / seg, u1 = (i + 1) / seg, i1 = (i + 1) % seg;
      if (A.length === 1 && B.length > 1) b.face([A[0], B[i], B[i1]], [(u0 + u1) / 2, vr(k), u0, vr(k + 1), u1, vr(k + 1)]);
      else if (B.length === 1 && A.length > 1) b.face([A[i], B[0], A[i1]], [u0, vr(k), (u0 + u1) / 2, vr(k + 1), u1, vr(k)]);
      else if (A.length > 1) b.face([A[i], B[i], B[i1], A[i1]], [u0, vr(k), u0, vr(k + 1), u1, vr(k + 1), u1, vr(k)]);
    }
  }
  // Se generan girando hacia -z: se da la vuelta para que las normales miren hacia fuera.
  return flip(b.done());
}
/** Tapa plana (ngon) en la fila `row` de un lathe: normal hacia abajo (`down`) o arriba. */
function cap(m: Mesh, ids: number[], down: boolean, mat = 0) {
  const f = down ? [...ids].reverse() : [...ids];
  m.f.push(f); m.m.push(mat);
  if (m.uv) m.uv.push(null);
}

export function sphere(r = 0.5, seg = 24, rings = 12): Mesh {
  const prof: [number, number][] = [];
  for (let k = 0; k <= rings; k++) { const a = -Math.PI / 2 + (k / rings) * Math.PI; prof.push([k === 0 || k === rings ? 0 : Math.cos(a) * r, Math.sin(a) * r]); }
  return lathe(prof, seg);
}

export function cylinder(r = 0.5, h = 1, seg = 24, rTop = r): Mesh {
  const m = lathe([[r, -h / 2], [rTop, h / 2]], seg);
  cap(m, Array.from({ length: seg }, (_, i) => i), true);
  if (rTop > 1e-9) cap(m, Array.from({ length: seg }, (_, i) => seg + i), false);
  return m;
}

export function cone(r = 0.5, h = 1, seg = 24): Mesh {
  const m = lathe([[r, -h / 2], [0, h / 2]], seg);
  cap(m, Array.from({ length: seg }, (_, i) => i), true);
  return m;
}

export function capsule(r = 0.35, h = 1.4, seg = 20, rings = 6): Mesh {
  const prof: [number, number][] = [];
  const body = Math.max(0, h - 2 * r);
  for (let k = 0; k <= rings; k++) { const a = -Math.PI / 2 + (k / rings) * (Math.PI / 2); prof.push([k === 0 ? 0 : Math.cos(a) * r, -body / 2 + Math.sin(a) * r]); }
  for (let k = 0; k <= rings; k++) { const a = (k / rings) * (Math.PI / 2); prof.push([k === rings ? 0 : Math.cos(a) * r, body / 2 + Math.sin(a) * r]); }
  return lathe(prof, seg);
}

export function torus(R = 0.5, r = 0.18, seg = 32, tube = 14): Mesh {
  const b = new Builder();
  const id = (i: number, j: number) => (i % seg) * tube + (j % tube);
  for (let i = 0; i < seg; i++) for (let j = 0; j < tube; j++) {
    const u = (i / seg) * Math.PI * 2, t = (j / tube) * Math.PI * 2;
    const c = R + r * Math.cos(t);
    b.p(Math.cos(u) * c, r * Math.sin(t), -Math.sin(u) * c);
  }
  for (let i = 0; i < seg; i++) for (let j = 0; j < tube; j++) {
    const u0 = i / seg, u1 = (i + 1) / seg, v0 = j / tube, v1 = (j + 1) / tube;
    b.face([id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)], [u0, v0, u1, v0, u1, v1, u0, v1]);
  }
  return b.done();
}

export function pyramid(w = 1, h = 1, d = 1, sides = 4): Mesh {
  const b = new Builder();
  const base = Array.from({ length: sides }, (_, i) => { const a = (i / sides) * Math.PI * 2 + Math.PI / sides; return b.p((Math.cos(a) * w) / Math.SQRT2, -h / 2, (-Math.sin(a) * d) / Math.SQRT2); });
  const top = b.p(0, h / 2, 0);
  for (let i = 0; i < sides; i++) b.face([base[i], top, base[(i + 1) % sides]].reverse());
  b.face([...base].reverse());
  return b.done();
}

/** Malla desde triángulos (importar), uniendo vértices en la misma posición. */
export function fromTriangles(pos: ArrayLike<number>, index: ArrayLike<number> | null, uv?: ArrayLike<number> | null, groups?: { start: number; count: number; mat: number }[]): Mesh {
  const v: number[] = [], f: number[][] = [], mats: number[] = [], uvs: (number[] | null)[] = [];
  const map = new Map<string, number>();
  const key = (i: number) => `${Math.round(pos[i * 3] * 1e5)},${Math.round(pos[i * 3 + 1] * 1e5)},${Math.round(pos[i * 3 + 2] * 1e5)}`;
  const vid = (i: number) => { const k = key(i); let n = map.get(k); if (n === undefined) { n = v.length / 3; map.set(k, n); v.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]); } return n; };
  const n = index ? index.length : pos.length / 3;
  const matOf = (t: number) => groups?.find(g => t >= g.start && t < g.start + g.count)?.mat ?? 0;
  for (let t = 0; t + 2 < n; t += 3) {
    const ids = [0, 1, 2].map(k => (index ? index[t + k] : t + k));
    const face = ids.map(vid);
    if (new Set(face).size < 3) continue;
    f.push(face); mats.push(matOf(t));
    uvs.push(uv ? ids.flatMap(i => [uv[i * 2], uv[i * 2 + 1]]) : null);
  }
  return { v, f, m: mats, ...(uv ? { uv: uvs } : {}) };
}

// ---------------------------------------------------------------- operaciones de modelado

/** UV de una cara nueva que hereda (null = automática). */
const noUv = (m: Mesh, n: number) => { if (m.uv) for (let i = 0; i < n; i++) m.uv.push(null); };
const dropUv = (m: Mesh, fi: number) => { if (m.uv) m.uv[fi] = null; };

/**
 * Extruye caras. `region` = las caras vecinas elegidas se extruyen juntas (sólo se
 * crean paredes en el borde de la región); si no, cada cara por separado. Se mueven
 * `dist` a lo largo de la normal media (de la región o de cada cara).
 */
export function extrude(src: Mesh, faces: number[], dist: number, region = true): { mesh: Mesh; faces: number[] } {
  const m = cloneMesh(src);
  const sel = [...new Set(faces)].filter(i => i >= 0 && i < m.f.length);
  if (!sel.length) return { mesh: m, faces: [] };
  const groups = region ? [sel] : sel.map(x => [x]);
  for (const grp of groups) {
    const inGrp = new Set(grp);
    // Aristas dirigidas de las caras elegidas: borde = la inversa no está en el grupo.
    const dir = new Set<string>();
    for (const fi of grp) { const f = m.f[fi]; for (let i = 0; i < f.length; i++) dir.add(`${f[i]}>${f[(i + 1) % f.length]}`); }
    let n: V3 = [0, 0, 0];
    for (const fi of grp) n = add(n, faceNormal(m, m.f[fi]));
    n = norm(n);
    const dup = new Map<number, number>();
    const nv = (i: number) => { let x = dup.get(i); if (x === undefined) { x = vcount(m); m.v.push(...add(vget(m, i), mulS(region ? n : faceNormal(m, m.f[grp[0]]), dist))); dup.set(i, x); } return x; };
    for (const fi of grp) {
      const f = m.f[fi];
      for (let i = 0; i < f.length; i++) {
        const a = f[i], b = f[(i + 1) % f.length];
        if (!dir.has(`${b}>${a}`)) { m.f.push([a, b, nv(b), nv(a)]); m.m.push(m.m[fi]); noUv(m, 1); }
      }
    }
    for (const fi of grp) { m.f[fi] = m.f[fi].map(nv); dropUv(m, fi); }
    void inGrp;
  }
  return { mesh: m, faces: sel };
}

/** Inset: cada cara elegida se encoge hacia su centro (`t` = 0..1) dejando un anillo de caras. */
export function inset(src: Mesh, faces: number[], t: number): { mesh: Mesh; faces: number[] } {
  const m = cloneMesh(src);
  t = Math.max(0.001, Math.min(0.98, t));
  const sel = [...new Set(faces)].filter(i => i >= 0 && i < m.f.length);
  for (const fi of sel) {
    const f = m.f[fi], c = faceCenter(m, f);
    const inn = f.map(i => { const x = vcount(m); m.v.push(...lerp3(vget(m, i), c, t)); return x; });
    for (let i = 0; i < f.length; i++) { const j = (i + 1) % f.length; m.f.push([f[i], f[j], inn[j], inn[i]]); m.m.push(m.m[fi]); noUv(m, 1); }
    m.f[fi] = inn;
    if (m.uv?.[fi]) { const u = m.uv[fi]!; let cu = 0, cv = 0; for (let k = 0; k < f.length; k++) { cu += u[k * 2]; cv += u[k * 2 + 1]; } cu /= f.length; cv /= f.length; m.uv[fi] = u.map((x, k) => x + ((k % 2 ? cv : cu) - x) * t); }
  }
  return { mesh: m, faces: sel };
}

/** Agujero: inset y se quitan las caras interiores (queda el hueco abierto). */
export function hole(src: Mesh, faces: number[], t: number): Mesh {
  const r = inset(src, faces, t);
  return deleteFaces(r.mesh, r.faces);
}

/**
 * Puente entre dos caras con el mismo número de vértices: se quitan y se unen sus
 * bordes con un tubo de caras (agujero que atraviesa, asas, túneles).
 */
export function bridge(src: Mesh, fa: number, fb: number): Mesh | null {
  const A = src.f[fa], B = src.f[fb];
  if (!A || !B || fa === fb || A.length !== B.length) return null;
  const n = A.length;
  // Giro del borde B que mejor se alinea con A (recorrido inverso).
  let best = 0, bd = Infinity;
  for (let off = 0; off < n; off++) {
    let d = 0;
    for (let i = 0; i < n; i++) d += len(sub(vget(src, A[i]), vget(src, B[(off - i + n * 2) % n])));
    if (d < bd) { bd = d; best = off; }
  }
  const m = cloneMesh(src);
  const j = (i: number) => B[(best - i + n * 2) % n];
  for (let i = 0; i < n; i++) { const i1 = (i + 1) % n; m.f.push([A[i], A[i1], j(i1), j(i)]); m.m.push(m.m[fa]); noUv(m, 1); }
  return deleteFaces(m, [fa, fb]);
}

/**
 * Bisel de aristas: cada arista elegida se sustituye por una cara estrecha de ancho
 * `w`; los extremos se cierran con triángulos (la malla sigue cerrada).
 */
export function bevel(src: Mesh, edges: [number, number][], w: number): Mesh {
  let m = cloneMesh(src);
  for (const [ea, eb] of edges) {
    // Caras con la arista en cada sentido.
    const fi1 = m.f.findIndex(f => f.some((x, i) => x === ea && f[(i + 1) % f.length] === eb));
    const fi2 = m.f.findIndex(f => f.some((x, i) => x === eb && f[(i + 1) % f.length] === ea));
    const [a, b, F1, F2] = fi1 >= 0 && fi2 >= 0 ? [ea, eb, fi1, fi2] : [ea, eb, -1, -1];
    if (F1 < 0) continue;
    const f1 = m.f[F1], f2 = m.f[F2];
    // Vecinos en cada cara: F1 = … p → a → b → r …; F2 = … s → b → a → q …
    const i1 = f1.indexOf(a), p = f1[(i1 - 1 + f1.length) % f1.length], r = f1[(i1 + 2) % f1.length];
    const i2 = f2.indexOf(b), s = f2[(i2 - 1 + f2.length) % f2.length], q = f2[(i2 + 2) % f2.length];
    const room = (x: number, y: number) => len(sub(vget(m, x), vget(m, y))) * 0.45;
    const k = Math.min(w, room(a, p), room(b, r), room(b, s), room(a, q));
    if (!(k > 1e-6)) continue;
    const along = (from: number, to: number) => { const x = vcount(m); m.v.push(...add(vget(m, from), mulS(norm(sub(vget(m, to), vget(m, from))), k))); return x; };
    const a1 = along(a, p), b1 = along(b, r), b2 = along(b, s), a2 = along(a, q);
    // Inserta el vértice nuevo en la cara vecina de la arista (x → y pasa a x → n → y).
    const split = (x: number, y: number, nn: number) => { for (const f of m.f) for (let i = 0; i < f.length; i++) if (f[i] === x && f[(i + 1) % f.length] === y) { f.splice(i + 1, 0, nn); return; } };
    split(a, p, a1); split(r, b, b1); split(b, s, b2); split(q, a, a2);
    m.f[F1] = f1.map(x => (x === a ? a1 : x === b ? b1 : x));
    m.f[F2] = f2.map(x => (x === b ? b2 : x === a ? a2 : x));
    dropUv(m, F1); dropUv(m, F2);
    // Las caras vecinas cambiaron de número de vértices: sus UV dejan de valer.
    if (m.uv) m.f.forEach((f, i) => { if (m.uv![i] && m.uv![i]!.length !== f.length * 2) m.uv![i] = null; });
    m.f.push([b1, a1, a2, b2], [a1, a, a2], [b2, b, b1]); m.m.push(m.m[F1], m.m[F1], m.m[F1]); noUv(m, 3);
  }
  m = compact(m);
  return m;
}

/** Subdivisión: Catmull-Clark (`smooth`) o sólo dividir cada cara en cuadriláteros. */
export function subdivide(src: Mesh, levels = 1, smooth = true): Mesh {
  let m = cloneMesh(src);
  for (let l = 0; l < Math.max(1, Math.min(4, levels)); l++) m = subdivOnce(m, smooth);
  return m;
}
function subdivOnce(m: Mesh, smooth: boolean): Mesh {
  const nv = vcount(m);
  const em = edgeMap(m);
  const fc = m.f.map(f => faceCenter(m, f));
  const out: number[] = [];
  // Puntos de cara, de arista y vértices originales (desplazados en Catmull-Clark).
  const facePt = fc.map(c => { out.push(...c); return out.length / 3 - 1; });
  const edgeIdx = new Map<string, number>();
  for (const [k, e] of em) {
    const a = vget(m, e.a), b = vget(m, e.b);
    let p = lerp3(a, b, 0.5);
    if (smooth && e.faces.length === 2) p = mulS(add(add(a, b), add(fc[e.faces[0]], fc[e.faces[1]])), 0.25);
    out.push(...p); edgeIdx.set(k, out.length / 3 - 1);
  }
  const vFaces: number[][] = Array.from({ length: nv }, () => []);
  m.f.forEach((f, fi) => { for (const i of f) vFaces[i].push(fi); });
  const vEdges: { a: number; b: number; faces: number[] }[][] = Array.from({ length: nv }, () => []);
  for (const e of em.values()) { vEdges[e.a].push(e); vEdges[e.b].push(e); }
  const vertPt = Array.from({ length: nv }, (_, i) => {
    let p = vget(m, i);
    if (smooth && vFaces[i].length) {
      const es = vEdges[i];
      const border = es.filter(e => e.faces.length < 2);
      if (border.length) {
        // Borde: media con los vecinos del borde.
        if (border.length === 2) { const o = border.map(e => vget(m, e.a === i ? e.b : e.a)); p = add(mulS(p, 0.75), mulS(add(o[0], o[1]), 0.125)); }
      } else {
        const n = vFaces[i].length;
        let F: V3 = [0, 0, 0]; for (const fi of vFaces[i]) F = add(F, fc[fi]); F = mulS(F, 1 / n);
        let R: V3 = [0, 0, 0]; for (const e of es) R = add(R, lerp3(vget(m, e.a), vget(m, e.b), 0.5)); R = mulS(R, 1 / es.length);
        p = mulS(add(add(F, mulS(R, 2)), mulS(p, n - 3)), 1 / n);
      }
    }
    out.push(...p); return out.length / 3 - 1;
  });
  const faces: number[][] = [], mats: number[] = [];
  m.f.forEach((f, fi) => {
    for (let i = 0; i < f.length; i++) {
      const prev = f[(i - 1 + f.length) % f.length], cur = f[i], next = f[(i + 1) % f.length];
      faces.push([vertPt[cur], edgeIdx.get(ekey(cur, next))!, facePt[fi], edgeIdx.get(ekey(prev, cur))!]);
      mats.push(m.m[fi]);
    }
  });
  return { v: out, f: faces, m: mats };
}

/** Fusiona vértices: todos en su centro (`center`) o los que estén a menos de `dist` entre sí. */
export function mergeVerts(src: Mesh, verts: number[], mode: 'center' | 'distance' = 'center', dist = 0.001): Mesh {
  const m = cloneMesh(src);
  const sel = [...new Set(verts)];
  if (sel.length < 2) return m;
  const map = new Map<number, number>();
  if (mode === 'center') {
    let c: V3 = [0, 0, 0]; for (const i of sel) c = add(c, vget(m, i)); c = mulS(c, 1 / sel.length);
    vset(m, sel[0], c);
    for (const i of sel.slice(1)) map.set(i, sel[0]);
  } else {
    for (let i = 0; i < sel.length; i++) {
      if (map.has(sel[i])) continue;
      for (let j = i + 1; j < sel.length; j++) if (!map.has(sel[j]) && len(sub(vget(m, sel[i]), vget(m, sel[j]))) <= dist) map.set(sel[j], sel[i]);
    }
  }
  m.f = m.f.map(f => f.map(i => map.get(i) ?? i));
  return compact(m);
}

export function deleteFaces(src: Mesh, faces: number[]): Mesh {
  const del = new Set(faces);
  const m = cloneMesh(src);
  const keep = m.f.map((_, i) => !del.has(i));
  m.f = m.f.filter((_, i) => keep[i]); m.m = m.m.filter((_, i) => keep[i]);
  if (m.uv) m.uv = m.uv.filter((_, i) => keep[i]);
  return compact(m);
}
/** Borra vértices (y las caras que los usan). */
export function deleteVerts(src: Mesh, verts: number[]): Mesh {
  const del = new Set(verts);
  return deleteFaces(src, src.f.map((f, i) => (f.some(x => del.has(x)) ? i : -1)).filter(i => i >= 0));
}
/** Borra aristas (las caras que las contienen). */
export function deleteEdges(src: Mesh, edges: [number, number][]): Mesh {
  const ks = new Set(edges.map(([a, b]) => ekey(a, b)));
  return deleteFaces(src, src.f.map((f, i) => (f.some((x, k) => ks.has(ekey(x, f[(k + 1) % f.length]))) ? i : -1)).filter(i => i >= 0));
}

/** Da la vuelta a las caras (normales al revés). */
export function flip(src: Mesh, faces?: number[]): Mesh {
  const m = cloneMesh(src);
  const sel = faces ? new Set(faces) : null;
  m.f.forEach((f, i) => { if (!sel || sel.has(i)) { m.f[i] = [...f].reverse(); if (m.uv?.[i]) { const u = m.uv[i]!; const r: number[] = []; for (let k = f.length - 1; k >= 0; k--) r.push(u[k * 2], u[k * 2 + 1]); m.uv[i] = r; } } });
  return m;
}

/** Desplaza vértices `d` a lo largo de su normal (media de sus caras). */
export function pushVerts(src: Mesh, verts: number[], d: number): Mesh {
  const m = cloneMesh(src);
  const ns = new Map<number, V3>();
  m.f.forEach(f => { const n = faceNormal(m, f); for (const i of f) ns.set(i, add(ns.get(i) ?? [0, 0, 0], n)); });
  for (const i of new Set(verts)) vset(m, i, add(vget(m, i), mulS(norm(ns.get(i) ?? [0, 1, 0]), d)));
  return m;
}

/** Une varias mallas (con su matriz aplicada) en una. */
export function merge(parts: { mesh: Mesh; mat?: (p: V3) => V3; slot?: number }[]): Mesh {
  const out: Mesh = { v: [], f: [], m: [], uv: [] };
  for (const { mesh, mat, slot } of parts) {
    const base = vcount(out);
    for (let i = 0; i < mesh.v.length; i += 3) { const p: V3 = [mesh.v[i], mesh.v[i + 1], mesh.v[i + 2]]; out.v.push(...(mat ? mat(p) : p)); }
    mesh.f.forEach((f, i) => { out.f.push(f.map(x => x + base)); out.m.push(slot ?? mesh.m[i] ?? 0); out.uv!.push(mesh.uv?.[i] ?? null); });
  }
  if (!out.uv!.some(Boolean)) delete out.uv;
  return out;
}

/** Traslación y escala sencillas para montar piezas. */
export const at = (x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, ry = 0) => (p: V3): V3 => {
  const c = Math.cos(ry), s = Math.sin(ry);
  const X = p[0] * sx, Z = p[2] * sz;
  return [x + X * c + Z * s, y + p[1] * sy, z - X * s + Z * c];
};

// ---------------------------------------------------------------- triángulos para dibujar

export interface Tris {
  pos: Float32Array; normal: Float32Array; uv: Float32Array;
  /** Grupos por ranura de material. */
  groups: { start: number; count: number; mat: number }[];
  /** Cara de cada triángulo (para elegir caras con el ratón). */
  faceOf: Uint32Array;
}

/**
 * Triangula la malla (abanico desde el primer vértice; para polígonos cóncavos, oreja
 * a oreja en su plano), con normales planas o suaves y UV (las de la cara o caja).
 */
export function triangulate(m: Mesh, smooth = false, uvScale = 1): Tris {
  const tris: { f: number; i: number[] }[] = [];
  m.f.forEach((f, fi) => { for (const t of triFace(m, f)) tris.push({ f: fi, i: t }); });
  // Agrupar por material.
  tris.sort((a, b) => (m.m[a.f] ?? 0) - (m.m[b.f] ?? 0));
  const n = tris.length;
  const pos = new Float32Array(n * 9), normal = new Float32Array(n * 9), uv = new Float32Array(n * 6), faceOf = new Uint32Array(n);
  const fn = m.f.map(f => faceNormal(m, f));
  let vn: V3[] = [];
  if (smooth) {
    vn = Array.from({ length: vcount(m) }, () => [0, 0, 0] as V3);
    m.f.forEach((f, fi) => { for (const i of f) vn[i] = add(vn[i], fn[fi]); });
    vn = vn.map(norm);
  }
  const groups: Tris['groups'] = [];
  tris.forEach((t, k) => {
    const mat = m.m[t.f] ?? 0;
    const g = groups[groups.length - 1];
    if (g && g.mat === mat) g.count += 3; else groups.push({ start: k * 3, count: 3, mat });
    faceOf[k] = t.f;
    const face = m.f[t.f], fuv = m.uv?.[t.f];
    const N = fn[t.f];
    // Proyección de caja: el eje dominante de la normal decide el plano.
    const ax = Math.abs(N[0]), ay = Math.abs(N[1]), az = Math.abs(N[2]);
    t.i.forEach((vi, c) => {
      const p = vget(m, vi);
      pos.set(p, k * 9 + c * 3);
      normal.set(smooth ? vn[vi] : N, k * 9 + c * 3);
      const corner = face.indexOf(vi);
      if (fuv && corner >= 0) { uv[k * 6 + c * 2] = fuv[corner * 2]; uv[k * 6 + c * 2 + 1] = fuv[corner * 2 + 1]; }
      else {
        const [u, v] = ax >= ay && ax >= az ? [N[0] > 0 ? -p[2] : p[2], p[1]] : ay >= az ? [p[0], N[1] > 0 ? -p[2] : p[2]] : [N[2] > 0 ? p[0] : -p[0], p[1]];
        uv[k * 6 + c * 2] = u * uvScale + 0.5; uv[k * 6 + c * 2 + 1] = v * uvScale + 0.5;
      }
    });
  });
  return { pos, normal, uv, groups, faceOf };
}

/** Triángulos de una cara (índices de vértice). */
export function triFace(m: Mesh, f: number[]): number[][] {
  if (f.length === 3) return [f];
  const n = faceNormal(m, f);
  // Convexa: abanico. Si no, recorte de orejas en el plano de la cara.
  const conv = f.every((_, i) => { const a = vget(m, f[i]), b = vget(m, f[(i + 1) % f.length]), c = vget(m, f[(i + 2) % f.length]); return dot(cross(sub(b, a), sub(c, b)), n) >= -1e-9; });
  if (conv) return f.slice(1, -1).map((_, i) => [f[0], f[i + 1], f[i + 2]]);
  const idx = [...f], out: number[][] = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 1000) {
    let cut = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i - 1 + idx.length) % idx.length], ib = idx[i], ic = idx[(i + 1) % idx.length];
      const a = vget(m, ia), b = vget(m, ib), c = vget(m, ic);
      if (dot(cross(sub(b, a), sub(c, b)), n) <= 1e-12) continue;
      const inside = idx.some(j => { if (j === ia || j === ib || j === ic) return false; const p = vget(m, j); return dot(cross(sub(b, a), sub(p, a)), n) > 0 && dot(cross(sub(c, b), sub(p, b)), n) > 0 && dot(cross(sub(a, c), sub(p, c)), n) > 0; });
      if (inside) continue;
      out.push([ia, ib, ic]); idx.splice(i, 1); cut = true; break;
    }
    if (!cut) break;
  }
  if (idx.length >= 3) for (let i = 1; i < idx.length - 1; i++) out.push([idx[0], idx[i], idx[i + 1]]);
  return out;
}

/** ¿Cerrada? (cada arista en dos caras): sirve para comprobar operaciones. */
export function isClosed(m: Mesh): boolean { return [...edgeMap(m).values()].every(e => e.faces.length === 2); }

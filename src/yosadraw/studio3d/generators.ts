/**
 * YOSADRAW 3D — generadores para principiantes: escaleras, paredes (con puerta y
 * ventanas), puertas, ventanas, tejados, columnas, muebles, terrenos y árboles.
 * Cada uno devuelve una malla con ranuras de material y los materiales sugeridos.
 * Los parámetros se guardan en el objeto: se pueden cambiar hasta convertirlo en
 * geometría editable.
 */
import { at, box, cone, cylinder, merge, plane, sphere, type Mesh, type V3 } from './mesh';

export type GenType = 'stairs' | 'wall' | 'door' | 'window' | 'roof' | 'column' | 'furniture' | 'terrain' | 'tree';
export interface GenParam { key: string; label: string; min: number; max: number; step: number; def: number; opts?: [number, string][] }
export interface GenDef { type: GenType; label: string; params: GenParam[]; mats: string[] }

const P = (key: string, label: string, def: number, min: number, max: number, step = 0.05, opts?: [number, string][]): GenParam => ({ key, label, def, min, max, step, opts });

export const GENERATORS: GenDef[] = [
  { type: 'stairs', label: 'Escalera', mats: ['Madera'], params: [P('steps', 'Peldaños', 8, 1, 60, 1), P('width', 'Ancho', 1.2, 0.2, 20), P('height', 'Altura total', 2, 0.1, 30), P('depth', 'Fondo total', 2.4, 0.1, 40), P('rail', 'Barandilla', 1, 0, 1, 1, [[0, 'No'], [1, 'Sí']])] },
  { type: 'wall', label: 'Pared', mats: ['Ladrillo', 'Yeso blanco'], params: [P('length', 'Largo', 4, 0.2, 60), P('height', 'Alto', 2.6, 0.2, 30), P('thick', 'Grosor', 0.2, 0.02, 3, 0.01), P('door', 'Hueco de puerta', 1, 0, 1, 1, [[0, 'No'], [1, 'Sí']]), P('doorW', 'Ancho de puerta', 0.9, 0.3, 5), P('doorH', 'Alto de puerta', 2.05, 0.5, 10), P('windows', 'Ventanas', 1, 0, 12, 1), P('winW', 'Ancho de ventana', 1, 0.2, 6), P('winH', 'Alto de ventana', 1, 0.2, 6), P('winY', 'Altura del alféizar', 0.9, 0, 10)] },
  { type: 'door', label: 'Puerta', mats: ['Madera', 'Metal'], params: [P('w', 'Ancho', 0.9, 0.3, 4), P('h', 'Alto', 2.05, 0.5, 6), P('thick', 'Grosor', 0.05, 0.01, 0.5, 0.01), P('frame', 'Marco', 0.08, 0, 0.4, 0.01), P('panels', 'Cuarterones', 2, 0, 6, 1)] },
  { type: 'window', label: 'Ventana', mats: ['Madera clara', 'Vidrio'], params: [P('w', 'Ancho', 1.2, 0.2, 8), P('h', 'Alto', 1.2, 0.2, 8), P('frame', 'Marco', 0.07, 0.01, 0.4, 0.01), P('cols', 'Hojas horizontales', 2, 1, 8, 1), P('rows', 'Hojas verticales', 2, 1, 8, 1), P('depth', 'Fondo', 0.1, 0.02, 1, 0.01)] },
  { type: 'roof', label: 'Tejado', mats: ['Tejas'], params: [P('w', 'Ancho', 4.4, 0.5, 60), P('d', 'Fondo', 4.4, 0.5, 60), P('h', 'Altura', 1.6, 0.1, 20), P('overhang', 'Alero', 0.3, 0, 3), P('thick', 'Grosor', 0.12, 0.02, 1, 0.01), P('kind', 'Tipo', 0, 0, 1, 1, [[0, 'A dos aguas'], [1, 'Piramidal']])] },
  { type: 'column', label: 'Columna', mats: ['Piedra'], params: [P('r', 'Radio', 0.2, 0.02, 5, 0.01), P('h', 'Altura', 3, 0.2, 40), P('sides', 'Lados', 16, 3, 48, 1), P('base', 'Basa y capitel', 1, 0, 1, 1, [[0, 'No'], [1, 'Sí']])] },
  { type: 'furniture', label: 'Mueble', mats: ['Madera', 'Tela'], params: [P('kind', 'Tipo', 0, 0, 4, 1, [[0, 'Mesa'], [1, 'Silla'], [2, 'Estantería'], [3, 'Cama'], [4, 'Sofá']]), P('w', 'Ancho', 1.4, 0.2, 6), P('d', 'Fondo', 0.8, 0.2, 6), P('h', 'Alto', 0.75, 0.2, 4), P('n', 'Baldas / patas', 4, 1, 12, 1)] },
  { type: 'terrain', label: 'Terreno', mats: ['Hierba'], params: [P('size', 'Tamaño', 20, 1, 400, 1), P('res', 'Detalle', 48, 4, 160, 1), P('height', 'Relieve', 2, 0, 50, 0.1), P('rough', 'Rugosidad', 0.5, 0.1, 0.9, 0.05), P('seed', 'Semilla', 1, 1, 999, 1)] },
  { type: 'tree', label: 'Árbol', mats: ['Corteza', 'Hojas'], params: [P('kind', 'Tipo', 0, 0, 2, 1, [[0, 'Frondoso'], [1, 'Pino'], [2, 'Arbusto']]), P('height', 'Altura', 4, 0.3, 40, 0.1), P('trunk', 'Grosor del tronco', 0.18, 0.02, 3, 0.01), P('crown', 'Tamaño de la copa', 1.6, 0.2, 20, 0.1), P('seed', 'Semilla', 1, 1, 999, 1)] },
];

export const genDef = (t: GenType) => GENERATORS.find(g => g.type === t)!;
export const genDefaults = (t: GenType): Record<string, number> => Object.fromEntries(genDef(t).params.map(p => [p.key, p.def]));

/** Pieza: una caja con su esquina inferior en (x, y, z) de tamaño (w, h, d), ranura `s`. */
const blk = (x: number, y: number, z: number, w: number, h: number, d: number, s = 0) => ({ mesh: box(w, h, d), mat: at(x + w / 2, y + h / 2, z + d / 2), slot: s });

/** Ruido de valor 2D suave (semilla) para el terreno y los árboles. */
function noise2(seed: number) {
  const hash = (x: number, y: number) => { let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };
  const sm = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = sm(x - xi), yf = sm(y - yi);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
}
const rng = (seed: number) => { let s = (seed * 9301 + 49297) % 233280 || 1; return () => (s = (s * 9301 + 49297) % 233280) / 233280; };

/** Genera la malla (con el origen en el suelo, centrada) de un generador. */
export function generate(t: GenType, p: Record<string, number>): Mesh {
  const g = { ...genDefaults(t), ...p };
  switch (t) {
    case 'stairs': {
      const n = Math.round(g.steps), sh = g.height / n, sd = g.depth / n, parts = [];
      for (let i = 0; i < n; i++) parts.push(blk(-g.width / 2, 0, -g.depth / 2 + i * sd, g.width, sh * (i + 1), sd));
      if (g.rail) for (const sx of [-1, 1]) {
        const x = (sx * g.width) / 2 - (sx > 0 ? 0.04 : 0);
        for (let i = 0; i <= n; i += Math.max(1, Math.round(n / 4))) parts.push(blk(x, sh * Math.min(n, i + 1), -g.depth / 2 + Math.min(n - 1, i) * sd + sd / 2 - 0.02, 0.04, 0.9, 0.04));
        // Pasamanos inclinado (caja girada en el plano YZ).
        const L = Math.hypot(g.height, g.depth), ang = Math.atan2(g.height, g.depth);
        const hand = box(0.05, 0.05, L);
        const rot = (q: V3): V3 => { const y = q[1], z = q[2]; return [q[0] + x + 0.02, 0.9 + sh + g.height / 2 + y * Math.cos(ang) + z * Math.sin(ang), z * Math.cos(ang) - y * Math.sin(ang)]; };
        parts.push({ mesh: hand, mat: rot, slot: 0 });
      }
      return merge(parts);
    }
    case 'wall': {
      const L = g.length, H = g.height, T = g.thick;
      const open: [number, number, number, number][] = [];
      const nw = Math.round(g.windows);
      // Huecos: la puerta en el centro (o un poco a un lado si hay ventanas) y las ventanas repartidas.
      const slots = nw + (g.door ? 1 : 0);
      for (let i = 0; i < slots; i++) {
        const cx = -L / 2 + (L * (i + 0.5)) / slots;
        const isDoor = g.door && i === Math.floor(slots / 2);
        const w = isDoor ? g.doorW : g.winW;
        const y0 = isDoor ? 0 : g.winY, y1 = isDoor ? Math.min(H - 0.05, g.doorH) : Math.min(H - 0.05, g.winY + g.winH);
        open.push([Math.max(-L / 2 + 0.05, cx - w / 2), Math.min(L / 2 - 0.05, cx + w / 2), y0, y1]);
      }
      open.sort((a, b) => a[0] - b[0]);
      const parts = [];
      let x = -L / 2;
      for (const [x0, x1, y0, y1] of open) {
        if (x0 > x + 1e-4) parts.push(blk(x, 0, -T / 2, x0 - x, H, T));
        if (y0 > 1e-4) parts.push(blk(x0, 0, -T / 2, x1 - x0, y0, T));
        if (y1 < H - 1e-4) parts.push(blk(x0, y1, -T / 2, x1 - x0, H - y1, T));
        x = Math.max(x, x1);
      }
      if (x < L / 2 - 1e-4) parts.push(blk(x, 0, -T / 2, L / 2 - x, H, T));
      return merge(parts);
    }
    case 'door': {
      const { w, h, thick: t, frame: f } = g, parts = [];
      if (f > 0) parts.push(blk(-w / 2 - f, 0, -t, f, h + f, t * 2, 0), blk(w / 2, 0, -t, f, h + f, t * 2, 0), blk(-w / 2, h, -t, w, f, t * 2, 0));
      parts.push(blk(-w / 2, 0, -t / 2, w, h, t, 0));
      // Cuarterones: rectángulos en relieve.
      const n = Math.round(g.panels);
      for (let i = 0; i < n; i++) { const ph = (h * 0.8) / n, py = h * 0.1 + i * ph; parts.push(blk(-w * 0.35, py + ph * 0.08, -t / 2 - 0.012, w * 0.7, ph * 0.84, 0.012, 0), blk(-w * 0.35, py + ph * 0.08, t / 2, w * 0.7, ph * 0.84, 0.012, 0)); }
      parts.push({ mesh: sphere(0.035, 12, 6), mat: at(w / 2 - 0.09, h * 0.48, -t / 2 - 0.035), slot: 1 }, { mesh: sphere(0.035, 12, 6), mat: at(w / 2 - 0.09, h * 0.48, t / 2 + 0.035), slot: 1 });
      return merge(parts);
    }
    case 'window': {
      const { w, h, frame: f, depth: d } = g, cols = Math.round(g.cols), rows = Math.round(g.rows), parts = [];
      parts.push(blk(-w / 2, 0, -d / 2, w, f, d), blk(-w / 2, h - f, -d / 2, w, f, d), blk(-w / 2, f, -d / 2, f, h - 2 * f, d), blk(w / 2 - f, f, -d / 2, f, h - 2 * f, d));
      for (let i = 1; i < cols; i++) parts.push(blk(-w / 2 + (w * i) / cols - f / 4, f, -d / 4, f / 2, h - 2 * f, d / 2));
      for (let j = 1; j < rows; j++) parts.push(blk(-w / 2 + f, (h * j) / rows - f / 4, -d / 4, w - 2 * f, f / 2, d / 2));
      parts.push(blk(-w / 2 + f, f, -0.005, w - 2 * f, h - 2 * f, 0.01, 1));
      return merge(parts);
    }
    case 'roof': {
      const W = g.w + 2 * g.overhang, D = g.d + 2 * g.overhang, H = g.h, T = g.thick;
      if (g.kind >= 1) {
        // Piramidal: cuatro faldones (pirámide hueca con grosor como pirámide maciza).
        const m: Mesh = { v: [-W / 2, 0, -D / 2, W / 2, 0, -D / 2, W / 2, 0, D / 2, -W / 2, 0, D / 2, 0, H, 0], f: [[0, 1, 2, 3], [3, 2, 4], [2, 1, 4], [1, 0, 4], [0, 3, 4]], m: [0, 0, 0, 0, 0] };
        return m;
      }
      // A dos aguas: prisma triangular con grosor (caja exterior menos la interior no hace falta: macizo).
      const m: Mesh = {
        v: [-W / 2, 0, -D / 2, W / 2, 0, -D / 2, W / 2, 0, D / 2, -W / 2, 0, D / 2, -W / 2, H, 0, W / 2, H, 0, -W / 2, -T, -D / 2, W / 2, -T, -D / 2, W / 2, -T, D / 2, -W / 2, -T, D / 2],
        f: [[3, 2, 5, 4], [1, 0, 4, 5], [0, 3, 4], [2, 1, 5], [9, 8, 2, 3], [7, 6, 0, 1], [6, 9, 3, 0], [8, 7, 1, 2], [6, 7, 8, 9]],
        m: [0, 0, 0, 0, 0, 0, 0, 0, 0],
      };
      return m;
    }
    case 'column': {
      const parts: { mesh: Mesh; mat: (p: V3) => V3; slot: number }[] = [];
      const cap = g.base ? Math.min(g.h * 0.08, g.r * 1.2) : 0;
      parts.push({ mesh: cylinder(g.r, g.h - 2 * cap, Math.round(g.sides)), mat: at(0, cap + (g.h - 2 * cap) / 2, 0), slot: 0 });
      if (cap) parts.push(blk(-g.r * 1.4, 0, -g.r * 1.4, g.r * 2.8, cap, g.r * 2.8), blk(-g.r * 1.4, g.h - cap, -g.r * 1.4, g.r * 2.8, cap, g.r * 2.8));
      return merge(parts);
    }
    case 'furniture': {
      const { w, d, h } = g, k = Math.round(g.kind), n = Math.max(1, Math.round(g.n)), parts = [];
      const legs = (lw: number, lh: number) => [blk(-w / 2, 0, -d / 2, lw, lh, lw), blk(w / 2 - lw, 0, -d / 2, lw, lh, lw), blk(-w / 2, 0, d / 2 - lw, lw, lh, lw), blk(w / 2 - lw, 0, d / 2 - lw, lw, lh, lw)];
      if (k === 0) { parts.push(...legs(0.06, h - 0.04), blk(-w / 2, h - 0.04, -d / 2, w, 0.04, d)); }
      else if (k === 1) { const s = h * 0.6; parts.push(...legs(0.04, s), blk(-w / 2, s, -d / 2, w, 0.05, d, 1), blk(-w / 2, s, d / 2 - 0.04, w, h - s, 0.04)); }
      else if (k === 2) { parts.push(blk(-w / 2, 0, -d / 2, 0.03, h, d), blk(w / 2 - 0.03, 0, -d / 2, 0.03, h, d), blk(-w / 2, 0, d / 2 - 0.01, w, h, 0.01)); for (let i = 0; i <= n; i++) parts.push(blk(-w / 2 + 0.03, Math.min(h - 0.025, (h * i) / n), -d / 2, w - 0.06, 0.025, d)); }
      else if (k === 3) { parts.push(...legs(0.06, 0.25), blk(-w / 2, 0.2, -d / 2, w, 0.1, d), blk(-w / 2 + 0.02, 0.3, -d / 2 + 0.02, w - 0.04, 0.18, d - 0.04, 1), blk(-w / 2, 0, d / 2 - 0.06, w, h, 0.06)); }
      else { parts.push(blk(-w / 2, 0, -d / 2, w, h * 0.45, d, 1), blk(-w / 2, 0, d / 2 - d * 0.25, w, h, d * 0.25, 1), blk(-w / 2, 0, -d / 2, w * 0.12, h * 0.7, d, 1), blk(w / 2 - w * 0.12, 0, -d / 2, w * 0.12, h * 0.7, d, 1)); }
      return merge(parts);
    }
    case 'terrain': {
      const res = Math.round(g.res), m = plane(g.size, g.size, res, res);
      const nz = noise2(Math.round(g.seed));
      for (let i = 0; i < m.v.length; i += 3) {
        const x = m.v[i] / g.size * 4, z = m.v[i + 2] / g.size * 4;
        let a = 1, f = 1, s = 0, tot = 0;
        for (let o = 0; o < 5; o++) { s += (nz(x * f + 13 * o, z * f + 7 * o) - 0.5) * a; tot += a; a *= g.rough; f *= 2; }
        m.v[i + 1] = (s / tot) * g.height * 2;
      }
      // UV del terreno: repetir la textura (cada unidad del plano).
      if (m.uv) m.uv = m.uv.map(u => (u ? u.map(x => x * g.size / 4) : null));
      return m;
    }
    case 'tree': {
      const k = Math.round(g.kind), r = rng(Math.round(g.seed)), parts: { mesh: Mesh; mat: (p: V3) => V3; slot: number }[] = [];
      if (k === 2) {
        for (let i = 0; i < 5; i++) { const s = g.crown * (0.35 + r() * 0.25); parts.push({ mesh: sphere(s, 10, 6), mat: at((r() - 0.5) * g.crown * 0.7, s * 0.8, (r() - 0.5) * g.crown * 0.7, 1, 0.8 + r() * 0.3, 1), slot: 1 }); }
        return merge(parts);
      }
      const trunkH = k === 1 ? g.height * 0.35 : g.height * 0.55;
      parts.push({ mesh: cylinder(g.trunk, trunkH + g.trunk * 2, 10, g.trunk * 0.7), mat: at(0, (trunkH + g.trunk * 2) / 2, 0), slot: 0 });
      if (k === 1) {
        const tiers = 3;
        for (let i = 0; i < tiers; i++) { const ch = (g.height - trunkH) * 0.55, cr = g.crown * (1 - i * 0.25) * 0.6; parts.push({ mesh: cone(cr, ch, 12), mat: at(0, trunkH + i * (g.height - trunkH - ch) / (tiers - 1) + ch / 2, 0), slot: 1 }); }
      } else {
        const n = 4;
        parts.push({ mesh: sphere(g.crown * 0.55, 14, 8), mat: at(0, trunkH + g.crown * 0.35, 0), slot: 1 });
        for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + r(), s = g.crown * (0.3 + r() * 0.15); parts.push({ mesh: sphere(s, 10, 6), mat: at(Math.cos(a) * g.crown * 0.4, trunkH + g.crown * (0.2 + r() * 0.3), Math.sin(a) * g.crown * 0.4), slot: 1 }); }
      }
      return merge(parts);
    }
  }
}

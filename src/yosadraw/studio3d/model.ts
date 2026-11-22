/**
 * YOSADRAW 3D — modelo del proyecto 3D (independiente del dibujo y del vídeo).
 *
 * Un proyecto tiene escenas (cada una con su jerarquía de objetos, cámara activa,
 * entorno y duración de animación), materiales compartidos y texturas. Los objetos
 * son mallas editables, grupos/carpetas, luces y cámaras; todas sus propiedades
 * animables son `Prop` (el mismo sistema de keyframes y curvas de YOSADRAW MOTION,
 * pero con sus propios datos: animar en 3D no toca las animaciones 2D).
 */
import { setValue, valueAt, type Prop } from '../motion/keys';
import { generate, genDefaults, type GenType } from './generators';
import { box, capsule, cone, cylinder, plane, pyramid, sphere, torus, type Mesh } from './mesh';

export const S3D_VERSION = 1;
export type PrimType = 'box' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'plane' | 'capsule' | 'pyramid';
export type ObjKind = 'mesh' | 'group' | 'light' | 'camera';
export type LightType = 'dir' | 'point' | 'spot' | 'amb' | 'hemi';

export interface Tf3 { px: Prop; py: Prop; pz: Prop; rx: Prop; ry: Prop; rz: Prop; sx: Prop; sy: Prop; sz: Prop }
export interface Obj3 {
  id: string; name: string; kind: ObjKind; parent: string | null;
  visible: boolean; locked: boolean;
  /** Carpeta (sólo organiza: no transforma). */
  folder?: boolean;
  tf: Tf3;
  opacity: Prop;
  /** Malla editable y materiales por ranura. */
  mesh?: Mesh; mats?: string[]; smooth?: boolean;
  /** Primitiva con medidas editables (hasta editar sus vértices). */
  prim?: { type: PrimType; p: Record<string, number> };
  /** Generador con parámetros editables (hasta convertirlo en editable). */
  gen?: { type: GenType; p: Record<string, number> };
  light?: { type: LightType; color: Prop<string>; intensity: Prop; dist: number; angle: Prop; shadow: boolean; ground: string };
  cam?: { fov: Prop; near: number; far: number };
  castShadow?: boolean;
}
export interface Mat3 {
  id: string; name: string;
  color: Prop<string>; rough: Prop; metal: Prop; opacity: Prop; emissive: Prop<string>; emissiveI: Prop;
  /** Textura (imagen) y textura procedimental (madera, piedra…). */
  tex: string | null; proc: string | null; texScale: number;
  /** Estilizado (sombreado de dibujo animado). */
  toon: boolean; fav: boolean;
}
export interface Tex3 { id: string; name: string; src: string; project?: { id: string; rev: number } | null }
export interface Scene3 {
  id: string; name: string; objects: Obj3[];
  camera: string | null;
  env: { bg: string; transparent: boolean; envLight: number; exposure: number; fog: number };
  fps: number; dur: number;
}
export interface RenderSet { w: number; h: number; quality: 1 | 2 | 3; shadows: 0 | 1 | 2 | 3; transparent: boolean }
export interface Studio3 {
  version: number;
  scenes: Scene3[];
  open: string;
  materials: Mat3[];
  textures: Tex3[];
  render: RenderSet;
  time: number;
  grid: { size: number; snap: boolean; show: boolean; axes: boolean };
}

let seq = 0;
export const sid = (p: string) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
export const prop = <T>(v: T): Prop<T> => ({ v });
export const clone = <T>(v: T): T => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));
export const newTf = (x = 0, y = 0, z = 0): Tf3 => ({ px: prop(x), py: prop(y), pz: prop(z), rx: prop(0), ry: prop(0), rz: prop(0), sx: prop(1), sy: prop(1), sz: prop(1) });

// ---------------------------------------------------------------- materiales

export function newMaterial(name: string, o: Partial<{ color: string; rough: number; metal: number; opacity: number; emissive: string; emissiveI: number; proc: string | null; toon: boolean; texScale: number }> = {}): Mat3 {
  return {
    id: sid('mt'), name, color: prop(o.color ?? '#c9c4d6'), rough: prop(o.rough ?? 0.55), metal: prop(o.metal ?? 0), opacity: prop(o.opacity ?? 1),
    emissive: prop(o.emissive ?? '#000000'), emissiveI: prop(o.emissiveI ?? 0), tex: null, proc: o.proc ?? null, texScale: o.texScale ?? 1, toon: !!o.toon, fav: false,
  };
}
/** Biblioteca de materiales prediseñados. */
export const MATERIAL_PRESETS: { name: string; group: string; o: Parameters<typeof newMaterial>[1] }[] = [
  { name: 'Madera', group: 'Madera', o: { color: '#a8743f', rough: 0.7, proc: 'wood' } },
  { name: 'Madera clara', group: 'Madera', o: { color: '#d9b98a', rough: 0.65, proc: 'wood' } },
  { name: 'Madera oscura', group: 'Madera', o: { color: '#5e3b22', rough: 0.6, proc: 'wood' } },
  { name: 'Corteza', group: 'Madera', o: { color: '#5a4330', rough: 0.95, proc: 'bark' } },
  { name: 'Metal', group: 'Metal', o: { color: '#c3c7cc', rough: 0.28, metal: 1 } },
  { name: 'Acero cepillado', group: 'Metal', o: { color: '#9aa1a8', rough: 0.45, metal: 1 } },
  { name: 'Oro', group: 'Metal', o: { color: '#e5b94a', rough: 0.25, metal: 1 } },
  { name: 'Cobre', group: 'Metal', o: { color: '#c77a4a', rough: 0.3, metal: 1 } },
  { name: 'Plástico rojo', group: 'Plástico', o: { color: '#d8404a', rough: 0.35 } },
  { name: 'Plástico azul', group: 'Plástico', o: { color: '#3d6fd8', rough: 0.35 } },
  { name: 'Plástico blanco', group: 'Plástico', o: { color: '#f2f2f2', rough: 0.4 } },
  { name: 'Goma negra', group: 'Plástico', o: { color: '#222226', rough: 0.9 } },
  { name: 'Vidrio', group: 'Vidrio', o: { color: '#d6ecff', rough: 0.05, opacity: 0.25 } },
  { name: 'Vidrio esmerilado', group: 'Vidrio', o: { color: '#e9f2f8', rough: 0.5, opacity: 0.55 } },
  { name: 'Piedra', group: 'Piedra', o: { color: '#8c8780', rough: 0.95, proc: 'stone' } },
  { name: 'Ladrillo', group: 'Piedra', o: { color: '#a5533b', rough: 0.9, proc: 'brick' } },
  { name: 'Hormigón', group: 'Piedra', o: { color: '#9a9a96', rough: 0.92, proc: 'stone' } },
  { name: 'Mármol', group: 'Piedra', o: { color: '#ecebe6', rough: 0.25, proc: 'marble' } },
  { name: 'Yeso blanco', group: 'Piedra', o: { color: '#f1eee8', rough: 0.85 } },
  { name: 'Tejas', group: 'Piedra', o: { color: '#9c3a28', rough: 0.8, proc: 'tiles' } },
  { name: 'Hierba', group: 'Naturaleza', o: { color: '#5e9a3e', rough: 0.95, proc: 'grass' } },
  { name: 'Hojas', group: 'Naturaleza', o: { color: '#3f8a3a', rough: 0.8 } },
  { name: 'Tierra', group: 'Naturaleza', o: { color: '#7a5a3c', rough: 1, proc: 'stone' } },
  { name: 'Agua', group: 'Naturaleza', o: { color: '#3a8fd0', rough: 0.05, opacity: 0.6 } },
  { name: 'Tela', group: 'Tela', o: { color: '#5b6fa8', rough: 1, proc: 'fabric' } },
  { name: 'Tela roja', group: 'Tela', o: { color: '#a83b4a', rough: 1, proc: 'fabric' } },
  { name: 'Dibujo animado', group: 'Estilizado', o: { color: '#ffb347', rough: 1, toon: true } },
  { name: 'Dibujo animado azul', group: 'Estilizado', o: { color: '#5ab4ff', rough: 1, toon: true } },
  { name: 'Neón rosa', group: 'Estilizado', o: { color: '#ff4fb8', rough: 0.4, emissive: '#ff2fa8', emissiveI: 2 } },
  { name: 'Neón cian', group: 'Estilizado', o: { color: '#4ff0ff', rough: 0.4, emissive: '#2fe8ff', emissiveI: 2 } },
  { name: 'Arcilla', group: 'Estilizado', o: { color: '#d7a98c', rough: 0.9 } },
];
export const presetMaterial = (name: string) => { const p = MATERIAL_PRESETS.find(x => x.name === name); return newMaterial(name, p?.o ?? {}); };

// ---------------------------------------------------------------- objetos

export const PRIMS: { type: PrimType; label: string; p: Record<string, number> }[] = [
  { type: 'box', label: 'Cubo', p: { w: 1, h: 1, d: 1 } },
  { type: 'sphere', label: 'Esfera', p: { r: 0.5, seg: 32, rings: 16 } },
  { type: 'cylinder', label: 'Cilindro', p: { r: 0.5, h: 1, seg: 32 } },
  { type: 'cone', label: 'Cono', p: { r: 0.5, h: 1, seg: 32 } },
  { type: 'torus', label: 'Toroide', p: { R: 0.5, r: 0.18, seg: 36, tube: 16 } },
  { type: 'plane', label: 'Plano', p: { w: 2, d: 2, div: 1 } },
  { type: 'capsule', label: 'Cápsula', p: { r: 0.35, h: 1.4, seg: 24 } },
  { type: 'pyramid', label: 'Pirámide', p: { w: 1, h: 1, d: 1, sides: 4 } },
];
/** Medidas de cada primitiva (para el panel). */
export const PRIM_PARAMS: Record<PrimType, { key: string; label: string; min: number; step: number; int?: boolean }[]> = {
  box: [{ key: 'w', label: 'Ancho', min: 0.001, step: 0.1 }, { key: 'h', label: 'Alto', min: 0.001, step: 0.1 }, { key: 'd', label: 'Fondo', min: 0.001, step: 0.1 }],
  sphere: [{ key: 'r', label: 'Radio', min: 0.001, step: 0.05 }, { key: 'seg', label: 'Segmentos', min: 3, step: 1, int: true }, { key: 'rings', label: 'Anillos', min: 2, step: 1, int: true }],
  cylinder: [{ key: 'r', label: 'Radio', min: 0.001, step: 0.05 }, { key: 'h', label: 'Alto', min: 0.001, step: 0.1 }, { key: 'seg', label: 'Lados', min: 3, step: 1, int: true }],
  cone: [{ key: 'r', label: 'Radio', min: 0.001, step: 0.05 }, { key: 'h', label: 'Alto', min: 0.001, step: 0.1 }, { key: 'seg', label: 'Lados', min: 3, step: 1, int: true }],
  torus: [{ key: 'R', label: 'Radio', min: 0.01, step: 0.05 }, { key: 'r', label: 'Grosor', min: 0.001, step: 0.02 }, { key: 'seg', label: 'Segmentos', min: 3, step: 1, int: true }, { key: 'tube', label: 'Lados del tubo', min: 3, step: 1, int: true }],
  plane: [{ key: 'w', label: 'Ancho', min: 0.001, step: 0.1 }, { key: 'd', label: 'Fondo', min: 0.001, step: 0.1 }, { key: 'div', label: 'Divisiones', min: 1, step: 1, int: true }],
  capsule: [{ key: 'r', label: 'Radio', min: 0.001, step: 0.05 }, { key: 'h', label: 'Alto', min: 0.01, step: 0.1 }, { key: 'seg', label: 'Lados', min: 3, step: 1, int: true }],
  pyramid: [{ key: 'w', label: 'Ancho', min: 0.001, step: 0.1 }, { key: 'h', label: 'Alto', min: 0.001, step: 0.1 }, { key: 'd', label: 'Fondo', min: 0.001, step: 0.1 }, { key: 'sides', label: 'Lados', min: 3, step: 1, int: true }],
};

/** Malla de una primitiva (centrada; `base` = con el origen en la base). */
export function primMesh(t: PrimType, p: Record<string, number>): Mesh {
  const i = (x: number, lo: number, hi = 256) => Math.max(lo, Math.min(hi, Math.round(x)));
  switch (t) {
    case 'box': return box(p.w, p.h, p.d);
    case 'sphere': return sphere(p.r, i(p.seg, 3), i(p.rings, 2));
    case 'cylinder': return cylinder(p.r, p.h, i(p.seg, 3));
    case 'cone': return cone(p.r, p.h, i(p.seg, 3));
    case 'torus': return torus(p.R, p.r, i(p.seg, 3), i(p.tube, 3));
    case 'plane': return plane(p.w, p.d, i(p.div, 1, 128), i(p.div, 1, 128));
    case 'capsule': return capsule(p.r, Math.max(p.h, p.r * 2), i(p.seg, 3));
    case 'pyramid': return pyramid(p.w, p.h, p.d, i(p.sides, 3, 64));
  }
}
/** Altura de una primitiva (para apoyarla en el suelo). */
export function primHeight(t: PrimType, p: Record<string, number>) {
  return t === 'sphere' ? p.r * 2 : t === 'torus' ? p.r * 2 : t === 'plane' ? 0 : t === 'capsule' ? Math.max(p.h, p.r * 2) : p.h;
}

export function newObject(kind: ObjKind, name: string, at: [number, number, number] = [0, 0, 0]): Obj3 {
  return { id: sid('ob'), name, kind, parent: null, visible: true, locked: false, tf: newTf(...at), opacity: prop(1), castShadow: true };
}
export function primObject(t: PrimType, mat: string, at: [number, number, number] = [0, 0, 0], p?: Record<string, number>): Obj3 {
  const def = PRIMS.find(x => x.type === t)!;
  const pp = { ...def.p, ...(p ?? {}) };
  const o = newObject('mesh', def.label, at);
  o.prim = { type: t, p: pp };
  o.mesh = primMesh(t, pp);
  o.mats = [mat];
  o.smooth = t === 'sphere' || t === 'capsule' || t === 'torus';
  return o;
}
export function genObject(t: GenType, mats: string[], at: [number, number, number] = [0, 0, 0], p?: Record<string, number>): Obj3 {
  const o = newObject('mesh', { stairs: 'Escalera', wall: 'Pared', door: 'Puerta', window: 'Ventana', roof: 'Tejado', column: 'Columna', furniture: 'Mueble', terrain: 'Terreno', tree: 'Árbol' }[t], at);
  o.gen = { type: t, p: { ...genDefaults(t), ...(p ?? {}) } };
  o.mesh = generate(t, o.gen.p);
  o.mats = mats;
  o.smooth = t === 'tree' || t === 'terrain';
  return o;
}
export function lightObject(type: LightType, at: [number, number, number] = [3, 5, 3]): Obj3 {
  const o = newObject('light', { dir: 'Luz direccional', point: 'Luz puntual', spot: 'Foco', amb: 'Luz ambiental', hemi: 'Luz de entorno' }[type], at);
  o.light = { type, color: prop('#ffffff'), intensity: prop(type === 'dir' ? 2.5 : type === 'amb' ? 0.4 : type === 'hemi' ? 0.8 : type === 'spot' ? 30 : 20), dist: 0, angle: prop(35), shadow: type === 'dir' || type === 'spot', ground: '#6b5a48' };
  if (type === 'dir' || type === 'spot') { o.tf.rx.v = -50; o.tf.ry.v = 40; }
  return o;
}
export function cameraObject(at: [number, number, number] = [6, 4, 8]): Obj3 {
  const o = newObject('camera', 'Cámara', at);
  o.cam = { fov: prop(45), near: 0.05, far: 2000 };
  o.tf.rx.v = -20; o.tf.ry.v = 36;
  return o;
}

/** Vuelve a generar la malla de una primitiva o un generador tras cambiar sus parámetros. */
export function rebuild(o: Obj3) {
  if (o.prim) o.mesh = primMesh(o.prim.type, o.prim.p);
  else if (o.gen) o.mesh = generate(o.gen.type, o.gen.p);
}

// ---------------------------------------------------------------- escenas y proyecto

export function newScene(name: string, mats: Mat3[]): Scene3 {
  const sc: Scene3 = { id: sid('sc'), name, objects: [], camera: null, env: { bg: '#2b2838', transparent: false, envLight: 1, exposure: 1, fog: 0 }, fps: 30, dur: 5 };
  const sun = lightObject('dir', [4, 8, 5]);
  sun.name = 'Sol';
  const amb = lightObject('hemi', [0, 6, 0]);
  const cam = cameraObject();
  const floor = primObject('plane', mats.find(m => m.name === 'Suelo')?.id ?? mats[0].id, [0, 0, 0], { w: 20, d: 20, div: 1 });
  floor.name = 'Suelo';
  floor.castShadow = false;
  const cube = primObject('box', mats.find(m => m.name === 'Material')?.id ?? mats[0].id, [0, 0.5, 0]);
  sc.objects.push(floor, cube, sun, amb, cam);
  sc.camera = cam.id;
  return sc;
}

export function newStudio(): Studio3 {
  const base = newMaterial('Material', { color: '#9d8cff', rough: 0.45 });
  const floor = newMaterial('Suelo', { color: '#8a8597', rough: 0.9 });
  const st: Studio3 = {
    version: S3D_VERSION, scenes: [], open: '', materials: [base, floor], textures: [],
    render: { w: 1920, h: 1080, quality: 2, shadows: 2, transparent: false }, time: 0,
    grid: { size: 0.25, snap: true, show: true, axes: true },
  };
  const sc = newScene('Escena 1', st.materials);
  st.scenes.push(sc);
  st.open = sc.id;
  return st;
}

export const sceneOf = (s: Studio3, id = s.open) => s.scenes.find(x => x.id === id) ?? s.scenes[0];
export const objOf = (sc: Scene3, id: string) => sc.objects.find(o => o.id === id);
export const children = (sc: Scene3, id: string | null) => sc.objects.filter(o => o.parent === id);
/** El objeto y todos sus descendientes. */
export function subtree(sc: Scene3, id: string): Obj3[] {
  const out: Obj3[] = [];
  const walk = (x: string) => { const o = objOf(sc, x); if (!o) return; out.push(o); for (const c of children(sc, x)) walk(c.id); };
  walk(id);
  return out;
}
/** ¿Visible y desbloqueado contando con sus padres? */
export function effVisible(sc: Scene3, o: Obj3): boolean { let c: Obj3 | undefined = o; while (c) { if (!c.visible) return false; c = c.parent ? objOf(sc, c.parent) : undefined; } return true; }
export function effLocked(sc: Scene3, o: Obj3): boolean { let c: Obj3 | undefined = o; while (c) { if (c.locked) return true; c = c.parent ? objOf(sc, c.parent) : undefined; } return false; }

/** Recorre todas las propiedades animables de un objeto (y de sus materiales si se pide). */
export function forEachProp3(o: Obj3, fn: (p: Prop<unknown>, path: string) => void) {
  for (const [k, p] of Object.entries(o.tf)) fn(p as Prop<unknown>, `tf.${k}`);
  fn(o.opacity as Prop<unknown>, 'opacity');
  if (o.light) { fn(o.light.color as Prop<unknown>, 'light.color'); fn(o.light.intensity as Prop<unknown>, 'light.intensity'); fn(o.light.angle as Prop<unknown>, 'light.angle'); }
  if (o.cam) fn(o.cam.fov as Prop<unknown>, 'cam.fov');
}
export function forEachMatProp(m: Mat3, fn: (p: Prop<unknown>, path: string) => void) {
  fn(m.color as Prop<unknown>, 'color'); fn(m.rough as Prop<unknown>, 'rough'); fn(m.metal as Prop<unknown>, 'metal'); fn(m.opacity as Prop<unknown>, 'opacity');
  fn(m.emissive as Prop<unknown>, 'emissive'); fn(m.emissiveI as Prop<unknown>, 'emissiveI');
}
export const PROP_LABELS: Record<string, string> = {
  'tf.px': 'Posición X', 'tf.py': 'Posición Y', 'tf.pz': 'Posición Z', 'tf.rx': 'Rotación X', 'tf.ry': 'Rotación Y', 'tf.rz': 'Rotación Z',
  'tf.sx': 'Escala X', 'tf.sy': 'Escala Y', 'tf.sz': 'Escala Z', opacity: 'Opacidad', 'light.color': 'Color de la luz', 'light.intensity': 'Intensidad',
  'light.angle': 'Apertura del foco', 'cam.fov': 'Campo de visión', color: 'Color', rough: 'Rugosidad', metal: 'Metálico', emissive: 'Emisión', emissiveI: 'Intensidad de emisión',
};
export function propByPath3(o: Obj3, path: string): Prop<unknown> | null { let r: Prop<unknown> | null = null; forEachProp3(o, (p, k) => { if (k === path) r = p; }); return r; }

/** Valor de una propiedad en el tiempo `t` y cambio (con keyframe si está animada o se fuerza). */
export const at3 = <T>(p: Prop<T>, t: number) => valueAt(p, t);
export const set3 = <T>(p: Prop<T>, t: number, v: T, key = false) => setValue(p, t, v, key);

/** Instantánea para el historial (las texturas no cambian nunca: se comparten). */
export function snapshot(s: Studio3): Studio3 { const { textures, ...rest } = s; return { ...clone(rest), textures: [...textures] }; }

// ---------------------------------------------------------------- historial

export class History3 {
  undoStack: { label: string; before: Studio3; after: Studio3 }[] = [];
  redoStack: { label: string; before: Studio3; after: Studio3 }[] = [];
  private pendingBefore: Studio3 | null = null;
  constructor(public s: Studio3, private onChange: (s: Studio3, label: string) => void, public limit = 120) {}
  edit(label: string, fn: (s: Studio3) => boolean | void): boolean {
    const before = snapshot(this.s);
    let ok: boolean | void;
    try { ok = fn(this.s); } catch (e) { this.s = before; throw e; }
    if (ok === false) { this.s = before; return false; }
    this.push(label, before);
    return true;
  }
  begin() { if (!this.pendingBefore) this.pendingBefore = snapshot(this.s); }
  get pending() { return !!this.pendingBefore; }
  commit(label: string) {
    const b = this.pendingBefore;
    this.pendingBefore = null;
    if (!b) return false;
    if (JSON.stringify({ ...b, textures: 0 }) === JSON.stringify({ ...this.s, textures: 0 })) return false;
    this.push(label, b);
    return true;
  }
  cancel() { if (this.pendingBefore) { this.s = this.pendingBefore; this.pendingBefore = null; this.onChange(this.s, ''); } }
  private push(label: string, before: Studio3) {
    this.undoStack.push({ label, before, after: snapshot(this.s) });
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
    this.onChange(this.s, label);
  }
  undo() { const c = this.undoStack.pop(); if (!c) return null; this.redoStack.push(c); this.s = keepTex(snapshot(c.before), this.s); this.onChange(this.s, `Deshacer: ${c.label}`); return c; }
  redo() { const c = this.redoStack.pop(); if (!c) return null; this.undoStack.push(c); this.s = keepTex(snapshot(c.after), this.s); this.onChange(this.s, `Rehacer: ${c.label}`); return c; }
}
/** Al deshacer se conservan todas las texturas conocidas (pueden volver a usarse). */
function keepTex(s: Studio3, cur: Studio3): Studio3 { const ids = new Set(s.textures.map(t => t.id)); s.textures = [...s.textures, ...cur.textures.filter(t => !ids.has(t.id))]; return s; }

// ---------------------------------------------------------------- validar al abrir

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const okProp = (p: unknown, def: unknown): Prop<never> => (isObj(p) && 'v' in p ? (p as unknown as Prop<never>) : prop(def as never));

/** Valida un proyecto 3D leído de un archivo (completa lo que falte; descarta lo roto). */
export function normalizeStudio(v: unknown): Studio3 | null {
  if (!isObj(v) || !Array.isArray(v.scenes)) return null;
  const s = clone(v) as unknown as Studio3;
  const base = newStudio();
  s.version = S3D_VERSION;
  s.materials = Array.isArray(s.materials) ? s.materials.filter(m => isObj(m) && typeof m.id === 'string') : [];
  for (const m of s.materials) {
    const d = newMaterial(m.name ?? 'Material');
    for (const k of ['color', 'rough', 'metal', 'opacity', 'emissive', 'emissiveI'] as const) (m as unknown as Record<string, unknown>)[k] = okProp(m[k], d[k].v);
    m.tex ??= null; m.proc ??= null; m.texScale = isNum(m.texScale) ? m.texScale : 1; m.toon = !!m.toon; m.fav = !!m.fav; m.name ??= 'Material';
  }
  if (!s.materials.length) s.materials = base.materials;
  s.textures = Array.isArray(s.textures) ? s.textures.filter(t => isObj(t) && typeof t.id === 'string' && typeof t.src === 'string') : [];
  const mids = new Set(s.materials.map(m => m.id));
  s.scenes = s.scenes.filter(sc => isObj(sc) && typeof sc.id === 'string' && Array.isArray(sc.objects));
  for (const sc of s.scenes) {
    sc.name ??= 'Escena';
    sc.env = isObj(sc.env) ? { ...base.scenes[0].env, ...sc.env } : base.scenes[0].env;
    sc.fps = isNum(sc.fps) && sc.fps > 0 ? Math.min(120, sc.fps) : 30;
    sc.dur = isNum(sc.dur) && sc.dur > 0 ? sc.dur : 5;
    sc.objects = sc.objects.filter(o => isObj(o) && typeof o.id === 'string' && ['mesh', 'group', 'light', 'camera'].includes(o.kind as string));
    const ids = new Set(sc.objects.map(o => o.id));
    for (const o of sc.objects) {
      o.name ??= 'Objeto'; o.visible = o.visible !== false; o.locked = !!o.locked;
      if (!o.parent || !ids.has(o.parent) || o.parent === o.id) o.parent = null;
      const t = isObj(o.tf) ? o.tf : {};
      o.tf = Object.fromEntries((['px', 'py', 'pz', 'rx', 'ry', 'rz', 'sx', 'sy', 'sz'] as const).map(k => [k, okProp((t as Record<string, unknown>)[k], k.startsWith('s') ? 1 : 0)])) as unknown as Tf3;
      o.opacity = okProp(o.opacity, 1);
      if (o.kind === 'mesh') {
        const m = o.mesh;
        if (!isObj(m) || !Array.isArray(m.v) || !Array.isArray(m.f)) { o.mesh = box(); o.mats = [s.materials[0].id]; }
        else { const n = m.v.length / 3; m.f = m.f.filter(f => Array.isArray(f) && f.length >= 3 && f.every(i => isNum(i) && i >= 0 && i < n)); m.m = Array.isArray(m.m) ? m.m : []; while (m.m.length < m.f.length) m.m.push(0); if (m.uv && (!Array.isArray(m.uv) || m.uv.length !== m.f.length)) delete m.uv; }
        o.mats = Array.isArray(o.mats) ? o.mats.map(x => (mids.has(x) ? x : s.materials[0].id)) : [s.materials[0].id];
        if (!o.mats.length) o.mats = [s.materials[0].id];
      }
      if (o.kind === 'light') { const d = lightObject(isObj(o.light) && typeof o.light.type === 'string' ? o.light.type as LightType : 'point').light!; o.light = isObj(o.light) ? { ...d, ...o.light, color: okProp(o.light.color, d.color.v), intensity: okProp(o.light.intensity, d.intensity.v), angle: okProp(o.light.angle, d.angle.v) } : d; }
      if (o.kind === 'camera') o.cam = isObj(o.cam) ? { near: isNum(o.cam.near) ? o.cam.near : 0.05, far: isNum(o.cam.far) ? o.cam.far : 2000, fov: okProp(o.cam.fov, 45) } : { fov: prop(45), near: 0.05, far: 2000 };
    }
    // Ciclos en la jerarquía: se rompen.
    for (const o of sc.objects) { let c = o.parent, k = 0; while (c && k++ < 200) { if (c === o.id) { o.parent = null; break; } c = sc.objects.find(x => x.id === c)?.parent ?? null; } }
    if (sc.camera && !sc.objects.some(o => o.id === sc.camera && o.kind === 'camera')) sc.camera = sc.objects.find(o => o.kind === 'camera')?.id ?? null;
  }
  if (!s.scenes.length) return null;
  if (!s.scenes.some(x => x.id === s.open)) s.open = s.scenes[0].id;
  s.render = isObj(s.render) ? { ...base.render, ...s.render } : base.render;
  s.grid = isObj(s.grid) ? { ...base.grid, ...s.grid } : base.grid;
  s.time = isNum(s.time) ? Math.max(0, s.time) : 0;
  return s;
}

/** Resumen para la galería. */
export const studioMeta = (s: Studio3) => ({ scenes: s.scenes.length, objects: s.scenes.reduce((a, sc) => a + sc.objects.filter(o => o.kind === 'mesh').length, 0) });

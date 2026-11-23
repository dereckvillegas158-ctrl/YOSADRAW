import { Box3, Euler, Matrix4, Quaternion, Vector3 } from 'three';
import type { Document } from '../doc/Document';
import type { CanvasEngine } from '../engine';
import { Emitter } from '../engine/Emitter';
import { keyAt, setValue, toggleKey, valueAt, type EaseType, type Key, type Prop } from '../motion/keys';
import { setEase, smoothProp, type EaseSpec } from '../motion/keytools';
import type { ProjectLibrary } from '../project/library';
import { toast } from '../ui/dom';
import { genDef, type GenType } from './generators';
import * as M from './mesh';
import {
  History3, PRIMS, cameraObject, cardPhys, defaultObjStyle, type ObjStyle, defaultCtrl, defaultFx, defaultPhys, type Ctrl3, type Fx3, type Phys3, type Rule3, clone, effLocked, forEachMatProp, forEachProp3, genObject, lightObject, newMaterial, newObject, newScene, objOf, presetMaterial,
  primHeight, primObject, rebuild, sceneOf, sid, subtree, type LightType, type Mat3, type Obj3, type PrimType, type Scene3, type Studio3,
} from './model';

export type Mode3 = 'object' | 'edit';
export type SelMode = 'vert' | 'edge' | 'face';
export type Tool3 = 'select' | 'move' | 'rotate' | 'scale' | 'create' | 'block' | 'paint' | 'aim';
import type { Shading } from './prefs';

export type { Prefs3, Shading } from './prefs';
export { normalizePrefs3 } from './prefs';
import type { Prefs3 } from './prefs';

export interface Studio3Deps { engine: CanvasEngine; projects: ProjectLibrary; prefs: Prefs3; persist: () => void }

const TF_KEYS = ['px', 'py', 'pz', 'rx', 'ry', 'rz', 'sx', 'sy', 'sz'] as const;
type TfKey = typeof TF_KEYS[number];
const D2R = Math.PI / 180;

/** Portapapeles de keyframes 3D: por propiedad, con tiempos relativos. */
interface KeyClip3 { items: { path: string; keys: Key<unknown>[] }[] }

/**
 * Estado y acciones de YOSADRAW 3D Studio (sin interfaz): proyecto, historial,
 * selección de objetos y de vértices/aristas/caras, modo objeto/edición, herramienta,
 * tiempo y reproducción. El visor y los paneles escuchan sus eventos.
 */
export class Studio3D extends Emitter<{ change: string; select: void; time: number; mode: void; tool: void; open: boolean; play: boolean; view: void }> {
  hist: History3 | null = null;
  doc: Document | null = null;
  /** Objetos elegidos (el último es el activo). */
  sel: string[] = [];
  mode: Mode3 = 'object';
  selMode: SelMode = 'face';
  ev = new Set<number>(); ee = new Set<string>(); ef = new Set<number>();
  tool: Tool3 = 'move';
  createPrim: PrimType | { gen: GenType } = 'box';
  block = { size: 1, prim: 'box' as PrimType, mat: '' };
  paint = { color: '#ff4d6d', size: 24, opacity: 1 };
  snap = true;
  /** Restricción de eje del gizmo (null = libre). */
  axis: 'x' | 'y' | 'z' | null = null;
  playing = false;
  private raf = 0;
  private keyClip: KeyClip3 | null = null;
  private objClip: { objs: Obj3[]; mats: Mat3[] } | null = null;

  constructor(readonly deps: Studio3Deps) { super(); }

  get prefs() { return this.deps.prefs; }
  get active() { return !!this.hist; }
  get s(): Studio3 { return this.hist!.s; }
  get scene(): Scene3 { return sceneOf(this.s); }
  get time() { return this.s.time; }
  get fps() { return this.scene.fps; }
  get selected(): Obj3[] { return this.hist ? this.sel.map(id => objOf(this.scene, id)).filter((o): o is Obj3 => !!o) : []; }
  get one(): Obj3 | null { const s = this.selected; return s.length ? s[s.length - 1] : null; }
  obj(id: string) { return objOf(this.scene, id); }
  mat(id: string) { return this.s.materials.find(m => m.id === id); }

  // ---------------------------------------------------------------- abrir

  open(doc: Document) {
    this.close();
    this.doc = doc;
    this.hist = new History3(doc.s3d!, (s, label) => this.changed(s, label));
    this.sel = []; this.mode = 'object'; this.clearEdit();
    this.emit('open', true);
    this.emit('change', '');
  }
  close() {
    if (!this.hist) return;
    this.pause();
    this.hist = null; this.doc = null; this.sel = [];
    this.emit('open', false);
  }
  private changed(s: Studio3, label: string) {
    if (this.doc) this.doc.s3d = s;
    this.sel = this.sel.filter(id => !!objOf(sceneOf(s), id));
    const o = this.one;
    if (this.mode === 'edit' && (!o || !o.mesh)) { this.mode = 'object'; this.emit('mode', undefined); }
    if (label) this.deps.engine.markChanged();
    this.emit('change', label);
  }

  edit(label: string, fn: (s: Studio3, sc: Scene3) => boolean | void): boolean {
    if (!this.hist) return false;
    if (this.hist.pending) this.hist.commit('Cambio');
    try { return this.hist.edit(label, s => fn(s, sceneOf(s))); }
    catch (e) { toast(e instanceof Error ? e.message : String(e), 'error'); return false; }
  }
  /** Cambio continuo (arrastrar): en vivo y `commit` lo registra como un paso. */
  live(fn: (s: Studio3, sc: Scene3) => void) { if (!this.hist) return; this.hist.begin(); fn(this.s, this.scene); this.emit('change', ''); }
  commit(label: string) { this.hist?.commit(label); }
  cancel() { this.hist?.cancel(); }
  undo() { this.hist?.undo(); }
  redo() { this.hist?.redo(); }

  // ---------------------------------------------------------------- selección

  select(ids: string[], add = false) {
    const ok = ids.filter(id => { const o = this.obj(id); return o && !effLocked(this.scene, o); });
    if (!add) this.sel = [];
    for (const id of ok) { const i = this.sel.indexOf(id); if (add && i >= 0 && ok.length === 1) this.sel.splice(i, 1); else { if (i >= 0) this.sel.splice(i, 1); this.sel.push(id); } }
    if (this.mode === 'edit') this.exitEdit();
    this.emit('select', undefined);
  }
  selectAll() {
    if (this.mode === 'edit') { this.editSelectAll(); return; }
    this.select(this.scene.objects.filter(o => o.visible && !o.folder && o.kind !== 'group').map(o => o.id));
  }
  /** Avisa de cambios de vista o de selección de geometría (visor y paneles se actualizan). */
  emitView() { this.emit('view', undefined); }
  keysChanged() { this.emit('select', undefined); }
  setTool(t: Tool3) { this.tool = t; this.emit('tool', undefined); }
  setAxis(a: 'x' | 'y' | 'z' | null) { this.axis = this.axis === a ? null : a; this.emit('tool', undefined); }
  setShading(m: Shading) { this.prefs.shading = m; this.deps.persist(); this.emit('view', undefined); }

  // ---------------------------------------------------------------- matrices (mundo)

  /** Transformación local de un objeto en el tiempo actual. */
  localMatrix(o: Obj3, t = this.time): Matrix4 {
    const v = (k: TfKey) => valueAt(o.tf[k], t);
    return new Matrix4().compose(new Vector3(v('px'), v('py'), v('pz')), new Quaternion().setFromEuler(new Euler(v('rx') * D2R, v('ry') * D2R, v('rz') * D2R)), new Vector3(v('sx'), v('sy'), v('sz')));
  }
  worldMatrix(o: Obj3, t = this.time): Matrix4 {
    const m = this.localMatrix(o, t);
    let p = o.parent ? this.obj(o.parent) : undefined;
    let guard = 0;
    while (p && guard++ < 100) { m.premultiply(this.localMatrix(p, t)); p = p.parent ? this.obj(p.parent) : undefined; }
    return m;
  }
  /** Caja del objeto (y sus hijos) en el mundo. */
  worldBox(o: Obj3): Box3 {
    const b = new Box3();
    for (const x of subtree(this.scene, o.id)) {
      const W = this.worldMatrix(x);
      if (x.mesh?.v.length) { const v = x.mesh.v; for (let i = 0; i < v.length; i += 3) b.expandByPoint(new Vector3(v[i], v[i + 1], v[i + 2]).applyMatrix4(W)); }
      else b.expandByPoint(new Vector3().setFromMatrixPosition(W));
    }
    return b;
  }
  /** Pone la matriz del mundo `W` a un objeto (calcula su transformación local). */
  setWorld(o: Obj3, W: Matrix4, key = false) {
    const parent = o.parent ? this.obj(o.parent) : undefined;
    const L = parent ? new Matrix4().copy(this.worldMatrix(parent)).invert().multiply(W) : W.clone();
    const p = new Vector3(), q = new Quaternion(), s = new Vector3();
    L.decompose(p, q, s);
    const e = new Euler().setFromQuaternion(q);
    const vals: Record<TfKey, number> = { px: p.x, py: p.y, pz: p.z, rx: e.x / D2R, ry: e.y / D2R, rz: e.z / D2R, sx: s.x, sy: s.y, sz: s.z };
    for (const k of TF_KEYS) this.setP(o.tf[k], round(vals[k]), key);
  }
  /** Cambia una propiedad en el tiempo actual (crea keyframe si está animada, con Auto Keyframe o `key`). */
  setP<T>(p: Prop<T>, v: T, key = false) { setValue(p, this.localTime(), v, key || this.prefs.autoKey); }
  localTime() { return Math.round(this.time * this.fps) / this.fps; }

  // ---------------------------------------------------------------- crear objetos

  private uniqueName(sc: Scene3, base: string) {
    const names = new Set(sc.objects.map(o => o.name));
    if (!names.has(base)) return base;
    for (let i = 2; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
  }
  /** Material por nombre de preset (lo crea si no existe en el proyecto). */
  matByName(s: Studio3, name: string): string {
    let m = s.materials.find(x => x.name === name);
    if (!m) { m = presetMaterial(name); s.materials.push(m); }
    return m.id;
  }
  private place(o: Obj3, label: string) {
    this.edit(label, (_s, sc) => { o.name = this.uniqueName(sc, o.name); sc.objects.push(o); });
    this.sel = [o.id];
    if (this.mode === 'edit') this.exitEdit();
    this.emit('select', undefined);
    return o;
  }
  /** Primitiva apoyada en el suelo en `at` (x, z) con sus medidas por defecto o las dadas. */
  addPrim(t: PrimType, at: [number, number, number] | null = null, p?: Record<string, number>) {
    const def = PRIMS.find(x => x.type === t)!;
    const pp = { ...def.p, ...(p ?? {}) };
    const y = (at?.[1] ?? 0) + (t === 'torus' ? pp.r : primHeight(t, pp) / 2);
    const mat = this.s.materials.find(m => m.name === 'Material')?.id ?? this.s.materials[0].id;
    return this.place(primObject(t, mat, [at?.[0] ?? 0, y, at?.[2] ?? 0], pp), `Añadir ${def.label.toLowerCase()}`);
  }
  addGen(t: GenType, at: [number, number, number] | null = null, p?: Record<string, number>) {
    let o: Obj3 | null = null;
    this.edit(`Añadir ${genDef(t).label.toLowerCase()}`, (s, sc) => {
      o = genObject(t, genDef(t).mats.map(n => this.matByName(s, n)), at ?? [0, 0, 0], p);
      o.name = this.uniqueName(sc, o.name);
      sc.objects.push(o);
    });
    if (o) { this.sel = [(o as Obj3).id]; this.emit('select', undefined); }
    return o as Obj3 | null;
  }
  addLight(t: LightType) { return this.place(lightObject(t), 'Añadir luz'); }
  addCamera() {
    const c = cameraObject();
    this.place(c, 'Añadir cámara');
    if (!this.scene.camera) this.edit('Cámara activa', (_s, sc) => { sc.camera = c.id; });
    return c;
  }
  setCamera(id: string) { this.edit('Cámara activa', (_s, sc) => { sc.camera = id; }); }

  // ---------------------------------------------------------------- organizar

  duplicate(offset = true) {
    const roots = this.roots();
    if (!roots.length) return;
    const out: string[] = [];
    this.edit('Duplicar', (_s, sc) => {
      for (const r of roots) {
        const map = new Map<string, string>();
        const all = subtree(sc, r.id);
        for (const o of all) map.set(o.id, sid('ob'));
        for (const o of all) {
          const c = clone(o);
          c.id = map.get(o.id)!;
          c.parent = o.id === r.id ? o.parent : map.get(o.parent!) ?? o.parent;
          if (o.id === r.id) { c.name = this.uniqueName(sc, o.name.replace(/ \d+$/, '')); if (offset) c.tf.px.v += 1; }
          sc.objects.push(c);
          if (o.id === r.id) out.push(c.id);
        }
      }
    });
    this.sel = out;
    this.emit('select', undefined);
  }
  /** Los elegidos sin los que ya están dentro de otro elegido. */
  roots(): Obj3[] {
    const set = new Set(this.sel);
    return this.selected.filter(o => { let p = o.parent; while (p) { if (set.has(p)) return false; p = this.obj(p)?.parent ?? null; } return true; });
  }
  remove() {
    if (this.mode === 'edit') { this.deleteGeom(); return; }
    const roots = this.roots();
    if (!roots.length) return;
    const ids = new Set(roots.flatMap(r => subtree(this.scene, r.id).map(o => o.id)));
    this.edit(ids.size === 1 ? 'Eliminar' : `Eliminar ${ids.size} objetos`, (_s, sc) => {
      sc.objects = sc.objects.filter(o => !ids.has(o.id));
      if (sc.camera && ids.has(sc.camera)) sc.camera = sc.objects.find(o => o.kind === 'camera')?.id ?? null;
    });
    this.sel = [];
    this.emit('select', undefined);
  }
  /** Agrupa los elegidos en un grupo nuevo (en su centro) o en una carpeta. */
  group(folder = false) {
    const roots = this.roots();
    if (!roots.length) { if (folder) this.newFolder(); return; }
    const g = newObject('group', folder ? 'Carpeta' : 'Grupo');
    g.folder = folder;
    const box = new Box3(); for (const r of roots) box.union(this.worldBox(r));
    const c = box.isEmpty() ? new Vector3() : box.getCenter(new Vector3());
    if (!folder) { g.tf.px.v = round(c.x); g.tf.py.v = round(box.isEmpty() ? 0 : box.min.y); g.tf.pz.v = round(c.z); }
    this.edit(folder ? 'Nueva carpeta' : 'Agrupar', (_s, sc) => {
      g.name = this.uniqueName(sc, g.name);
      g.parent = roots[0].parent;
      sc.objects.push(g);
      for (const r of roots) { const W = this.worldMatrix(r); r.parent = g.id; if (!folder) this.setWorld(r, W); }
    });
    this.sel = [g.id];
    this.emit('select', undefined);
  }
  newFolder() { const g = newObject('group', 'Carpeta'); g.folder = true; this.place(g, 'Nueva carpeta'); }
  ungroup() {
    const gs = this.selected.filter(o => o.kind === 'group');
    if (!gs.length) { toast('Elige un grupo o una carpeta.'); return; }
    const kids: string[] = [];
    this.edit('Desagrupar', (_s, sc) => {
      for (const g of gs) {
        for (const c of sc.objects.filter(o => o.parent === g.id)) { const W = this.worldMatrix(c); c.parent = g.parent; this.setWorld(c, W); kids.push(c.id); }
        sc.objects = sc.objects.filter(o => o.id !== g.id);
      }
    });
    this.sel = kids;
    this.emit('select', undefined);
  }
  /** Mueve `id` dentro de `parent` (o a la raíz) conservando su posición en el mundo; `before` = orden en la lista. */
  reparent(id: string, parent: string | null, before?: string) {
    const o = this.obj(id);
    if (!o || id === parent) return;
    if (parent && subtree(this.scene, id).some(x => x.id === parent)) { toast('No se puede meter un objeto dentro de sí mismo.'); return; }
    this.edit('Organizar', (_s, sc) => {
      const W = this.worldMatrix(o);
      const folderish = parent ? sc.objects.find(x => x.id === parent)?.folder : false;
      o.parent = parent;
      if (!folderish) this.setWorld(o, W);
      if (before) { const i = sc.objects.indexOf(o); sc.objects.splice(i, 1); const j = sc.objects.findIndex(x => x.id === before); sc.objects.splice(j < 0 ? sc.objects.length : j, 0, o); }
    });
  }
  rename(id: string, name: string) { const n = name.trim().slice(0, 60); if (n) this.edit('Renombrar', (_s, sc) => { const o = objOf(sc, id); if (o) o.name = n; }); }
  toggleVis(id: string) { this.edit('Mostrar / ocultar', (_s, sc) => { const o = objOf(sc, id); if (o) o.visible = !o.visible; }); }
  toggleLock(id: string) { this.edit('Bloquear', (_s, sc) => { const o = objOf(sc, id); if (o) o.locked = !o.locked; }); if (this.obj(id)?.locked) { this.sel = this.sel.filter(x => x !== id); this.emit('select', undefined); } }

  /** Alinea los elegidos en un eje: mínimo, centro o máximo (respecto al activo), o los apoya en el suelo. */
  align(axis: 0 | 1 | 2, how: 'min' | 'center' | 'max' | 'floor') {
    const objs = this.roots();
    if (!objs.length) return;
    const ref = how === 'floor' ? null : this.worldBox(this.one!);
    this.edit(how === 'floor' ? 'Apoyar en el suelo' : 'Alinear', () => {
      for (const o of objs) {
        if (ref && o.id === this.one!.id) continue;
        const b = this.worldBox(o);
        if (b.isEmpty()) continue;
        const k = ['x', 'y', 'z'][axis] as 'x' | 'y' | 'z';
        const target = how === 'floor' ? 0 : how === 'min' ? ref!.min[k] : how === 'max' ? ref!.max[k] : (ref!.min[k] + ref!.max[k]) / 2;
        const cur = how === 'floor' || how === 'min' ? b.min[k] : how === 'max' ? b.max[k] : (b.min[k] + b.max[k]) / 2;
        const W = this.worldMatrix(o);
        W.premultiply(new Matrix4().makeTranslation(axis === 0 ? target - cur : 0, how === 'floor' || axis === 1 ? target - cur : 0, axis === 2 ? target - cur : 0));
        this.setWorld(o, W);
      }
    });
  }
  /** Distribuye los elegidos a la misma distancia en un eje. */
  distribute(axis: 0 | 1 | 2) {
    const objs = this.roots();
    if (objs.length < 3) { toast('Elige tres objetos o más.'); return; }
    const k = ['x', 'y', 'z'][axis] as 'x' | 'y' | 'z';
    const cs = objs.map(o => ({ o, c: this.worldBox(o).getCenter(new Vector3())[k] })).sort((a, b) => a.c - b.c);
    const a = cs[0].c, b = cs[cs.length - 1].c;
    this.edit('Distribuir', () => { cs.forEach(({ o, c }, i) => { const t = a + ((b - a) * i) / (cs.length - 1); const W = this.worldMatrix(o); W.premultiply(new Matrix4().makeTranslation(axis === 0 ? t - c : 0, axis === 1 ? t - c : 0, axis === 2 ? t - c : 0)); this.setWorld(o, W); }); });
  }

  /** Valor numérico exacto de una propiedad de transformación. */
  setTf(id: string, k: TfKey, v: number, live = false) {
    const fn = (_s: Studio3, sc: Scene3) => { const o = objOf(sc, id); if (o) this.setP(o.tf[k], v); };
    if (live) this.live(fn); else this.edit('Transformar', fn);
  }
  /** Copia y pega objetos (Ctrl+C / Ctrl+V). */
  copyObjects() { const r = this.roots(); if (!r.length) return; this.objClip = { objs: clone(r.flatMap(x => subtree(this.scene, x.id))), mats: clone(this.s.materials) }; toast(`${r.length} ${r.length === 1 ? 'objeto copiado' : 'objetos copiados'}`); }
  pasteObjects() {
    const c = this.objClip;
    if (!c) return;
    const map = new Map(c.objs.map(o => [o.id, sid('ob')]));
    const out: string[] = [];
    this.edit('Pegar', (s, sc) => {
      for (const o of clone(c.objs)) {
        const root = !o.parent || !map.has(o.parent);
        o.id = map.get(o.id)!; o.parent = root ? null : map.get(o.parent!)!;
        if (root) { o.name = this.uniqueName(sc, o.name); out.push(o.id); }
        // Materiales de otro proyecto o escena: se traen.
        for (const m of o.mats ?? []) if (!s.materials.some(x => x.id === m)) { const src = c.mats.find(x => x.id === m); if (src) s.materials.push(clone(src)); }
        sc.objects.push(o);
      }
    });
    this.sel = out; this.emit('select', undefined);
  }

  // ---------------------------------------------------------------- primitivas y generadores

  setPrimParam(id: string, key: string, v: number, live = false) {
    const fn = (_s: Studio3, sc: Scene3) => { const o = objOf(sc, id); if (!o) return; const g = o.prim ?? o.gen; if (!g) return; g.p[key] = v; rebuild(o); };
    if (live) this.live(fn); else this.edit('Cambiar medidas', fn);
  }
  /** Convierte una primitiva o un generador en geometría editable (vértices, aristas y caras). */
  makeEditable(id: string) { this.edit('Convertir en editable', (_s, sc) => { const o = objOf(sc, id); if (o) { delete o.prim; delete o.gen; } }); }

  // ---------------------------------------------------------------- modo edición

  clearEdit() { this.ev.clear(); this.ee.clear(); this.ef.clear(); }
  enterEdit() {
    const o = this.one;
    if (!o || !o.mesh) { toast('Elige un objeto con geometría (no una luz ni una cámara).'); return; }
    if (effLocked(this.scene, o)) return;
    if (o.prim || o.gen) { this.makeEditable(o.id); toast('Ahora es geometría editable: elige vértices, aristas o caras.'); }
    this.sel = [o.id];
    this.mode = 'edit';
    this.clearEdit();
    this.emit('mode', undefined);
    this.emit('select', undefined);
  }
  exitEdit() { if (this.mode !== 'edit') return; this.mode = 'object'; this.clearEdit(); this.emit('mode', undefined); this.emit('select', undefined); }
  toggleEdit() { if (this.mode === 'edit') this.exitEdit(); else this.enterEdit(); }
  setSelMode(m: SelMode) {
    const o = this.one;
    if (o?.mesh) {
      // Convertir la selección al cambiar de modo (vértices ↔ aristas ↔ caras).
      const verts = this.editVerts(o.mesh);
      this.clearEdit();
      if (m === 'vert') for (const v of verts) this.ev.add(v);
      else if (m === 'edge') for (const [a, b] of M.edgeList(o.mesh)) { if (verts.has(a) && verts.has(b)) this.ee.add(M.ekey(a, b)); }
      else o.mesh.f.forEach((f, i) => { if (f.every(x => verts.has(x))) this.ef.add(i); });
    }
    this.selMode = m;
    this.emit('select', undefined);
  }
  /** Vértices afectados por la selección actual (sea del modo que sea). */
  editVerts(m: M.Mesh): Set<number> {
    const s = new Set<number>(this.ev);
    for (const k of this.ee) for (const x of k.split('_')) s.add(Number(x));
    for (const fi of this.ef) for (const x of m.f[fi] ?? []) s.add(x);
    return s;
  }
  editSelectAll() {
    const o = this.one; if (!o?.mesh) return;
    const any = this.ev.size + this.ee.size + this.ef.size > 0;
    this.clearEdit();
    if (!any) {
      if (this.selMode === 'vert') for (let i = 0; i < M.vcount(o.mesh); i++) this.ev.add(i);
      else if (this.selMode === 'edge') for (const [a, b] of M.edgeList(o.mesh)) this.ee.add(M.ekey(a, b));
      else o.mesh.f.forEach((_, i) => this.ef.add(i));
    }
    this.emit('select', undefined);
  }
  get editCount() { return this.ev.size + this.ee.size + this.ef.size; }
  /** Caras afectadas (en modo vértices/aristas: las que tienen todos sus vértices elegidos). */
  private editFaces(m: M.Mesh): number[] {
    if (this.selMode === 'face') return [...this.ef];
    const vs = this.editVerts(m);
    return m.f.map((f, i) => (f.every(x => vs.has(x)) ? i : -1)).filter(i => i >= 0);
  }
  /** Operación de modelado sobre la malla del objeto activo. */
  private meshOp(label: string, fn: (m: M.Mesh) => { mesh: M.Mesh; faces?: number[] } | M.Mesh | null) {
    const o = this.one;
    if (!o?.mesh) return;
    let res: { mesh: M.Mesh; faces?: number[] } | null = null;
    const ok = this.edit(label, (_s, sc) => {
      const x = objOf(sc, o.id)!;
      const r = fn(x.mesh!);
      if (!r) return false;
      res = 'mesh' in r ? r : { mesh: r };
      x.mesh = res.mesh;
      delete x.prim; delete x.gen;
      return true;
    });
    if (!ok) return;
    this.clearEdit();
    const r = res as { mesh: M.Mesh; faces?: number[] } | null;
    if (r?.faces) { this.selMode = 'face'; for (const f of r.faces) this.ef.add(f); }
    this.emit('select', undefined);
  }
  extrude(dist = 0.5, region = true) {
    const o = this.one; if (!o?.mesh) return;
    const faces = this.editFaces(o.mesh);
    if (!faces.length) { toast('Elige una o más caras para extruir.'); return; }
    this.meshOp(region ? 'Extruir región' : 'Extruir caras', m => M.extrude(m, faces, dist, region));
  }
  inset(t = 0.25) { const o = this.one; if (!o?.mesh) return; const f = this.editFaces(o.mesh); if (!f.length) { toast('Elige caras.'); return; } this.meshOp('Inset', m => M.inset(m, f, t)); }
  hole(t = 0.3) { const o = this.one; if (!o?.mesh) return; const f = this.editFaces(o.mesh); if (!f.length) { toast('Elige las caras donde abrir el agujero.'); return; } this.meshOp('Agujero', m => M.hole(m, f, t)); }
  bridge() {
    const o = this.one; if (!o?.mesh) return;
    const f = this.editFaces(o.mesh);
    if (f.length !== 2) { toast('Elige exactamente dos caras (con el mismo número de vértices) para unirlas con un túnel.'); return; }
    this.meshOp('Puente (agujero pasante)', m => { const r = M.bridge(m, f[0], f[1]); if (!r) toast('Las dos caras deben tener el mismo número de vértices.', 'error'); return r; });
  }
  bevel(w = 0.1) {
    const o = this.one; if (!o?.mesh) return;
    let edges: [number, number][] = [...this.ee].map(k => k.split('_').map(Number) as [number, number]);
    if (!edges.length) { const vs = this.editVerts(o.mesh); edges = M.edgeList(o.mesh).filter(([a, b]) => vs.has(a) && vs.has(b)); }
    if (!edges.length) { toast('Elige aristas (o caras) para biselar.'); return; }
    this.meshOp('Biselar', m => M.bevel(m, edges, w));
  }
  subdivide(levels = 1, smooth = true) {
    const o = this.one; if (!o?.mesh) return;
    if (o.mesh.f.length * 4 ** levels > 200000) { toast('Demasiadas caras: baja los niveles.', 'error'); return; }
    this.meshOp(smooth ? 'Suavizar (subdivisión)' : 'Subdividir', m => M.subdivide(m, levels, smooth));
    this.edit('Sombreado suave', (_s, sc) => { const x = objOf(sc, o.id); if (x && smooth) x.smooth = true; });
  }
  mergeSel(mode: 'center' | 'distance' = 'center') {
    const o = this.one; if (!o?.mesh) return;
    const vs = [...this.editVerts(o.mesh)];
    if (vs.length < 2) { toast('Elige dos vértices o más.'); return; }
    this.meshOp('Fusionar vértices', m => M.mergeVerts(m, vs, mode, 0.01));
  }
  deleteGeom() {
    const o = this.one; if (!o?.mesh || !this.editCount) return;
    if (this.selMode === 'face') { const f = [...this.ef]; this.meshOp('Borrar caras', m => M.deleteFaces(m, f)); }
    else if (this.selMode === 'edge') { const e = [...this.ee].map(k => k.split('_').map(Number) as [number, number]); this.meshOp('Borrar aristas', m => M.deleteEdges(m, e)); }
    else { const v = [...this.ev]; this.meshOp('Borrar vértices', m => M.deleteVerts(m, v)); }
  }
  flipNormals() { const o = this.one; if (!o?.mesh) return; const f = this.editCount ? this.editFaces(o.mesh) : undefined; this.meshOp('Invertir normales', m => M.flip(m, f)); }
  pushVerts(d: number) { const o = this.one; if (!o?.mesh) return; const v = [...this.editVerts(o.mesh)]; if (!v.length) return; this.meshOp('Desplazar vértices', m => M.pushVerts(m, v, d)); }
  /** Mueve los vértices elegidos con una matriz local (gizmo del modo edición): en vivo. */
  moveVerts(orig: number[], ids: number[], T: Matrix4) {
    const o = this.one; if (!o?.mesh) return;
    this.live((_s, sc) => {
      const x = objOf(sc, o.id)!;
      const v = new Vector3();
      for (let k = 0; k < ids.length; k++) { v.set(orig[k * 3], orig[k * 3 + 1], orig[k * 3 + 2]).applyMatrix4(T); M.vset(x.mesh!, ids[k], [round(v.x), round(v.y), round(v.z)]); }
      delete x.prim; delete x.gen;
    });
  }

  // ---------------------------------------------------------------- materiales

  newMat(base?: Mat3) {
    const m = base ? { ...clone(base), id: sid('mt'), name: `${base.name} copia`, fav: false } : newMaterial(`Material ${this.s.materials.length + 1}`);
    this.edit('Nuevo material', s => { s.materials.push(m); });
    return m;
  }
  addPresetMat(name: string) { const m = presetMaterial(name); this.edit(`Material ${name}`, s => { s.materials.push(m); }); return m; }
  /** Asigna un material: a las caras elegidas (modo edición), a una ranura o a todo el objeto. */
  assignMat(matId: string, slot: number | 'all' = 'all') {
    const objs = this.mode === 'edit' ? [this.one!].filter(Boolean) : this.selected.filter(o => o.mesh);
    if (!objs.length) { toast('Elige un objeto.'); return; }
    this.edit('Asignar material', (_s, sc) => {
      for (const o0 of objs) {
        const o = objOf(sc, o0.id)!;
        if (!o.mesh || !o.mats) continue;
        if (this.mode === 'edit' && this.editCount) {
          let k = o.mats.indexOf(matId);
          if (k < 0) { o.mats.push(matId); k = o.mats.length - 1; }
          for (const f of this.editFaces(o.mesh)) o.mesh.m[f] = k;
        } else if (slot === 'all') o.mats = o.mats.map(() => matId);
        else o.mats[slot] = matId;
      }
    });
  }
  setMat(id: string, fn: (m: Mat3) => void, label = 'Material', live = false) {
    const f = (s: Studio3) => { const m = s.materials.find(x => x.id === id); if (m) fn(m); };
    if (live) this.live(f); else this.edit(label, f);
  }
  /** Propiedad animable de un material en el tiempo actual. */
  setMatProp(id: string, key: 'color' | 'rough' | 'metal' | 'opacity' | 'emissive' | 'emissiveI', v: number | string, live = false) {
    this.setMat(id, m => { setValue(m[key] as Prop<number | string>, this.localTime(), v, this.prefs.autoKey); }, 'Material', live);
  }
  removeMat(id: string) {
    const used = this.s.scenes.some(sc => sc.objects.some(o => o.mats?.includes(id)));
    if (used) { toast('El material está en uso: asigna otro a esos objetos antes de borrarlo.'); return; }
    if (this.s.materials.length < 2) return;
    this.edit('Borrar material', s => { s.materials = s.materials.filter(m => m.id !== id); });
  }
  toggleFav(id: string) {
    const m = this.mat(id); if (!m) return;
    const favs = this.prefs.favMats;
    const i = favs.findIndex(f => f.name === m.name);
    if (i >= 0) favs.splice(i, 1); else favs.push({ ...clone(m), tex: null });
    this.deps.persist();
    this.setMat(id, x => { x.fav = i < 0; }, i < 0 ? 'Material favorito' : 'Quitar de favoritos');
    toast(i < 0 ? `«${m.name}» guardado en favoritos (disponible en todos tus proyectos)` : 'Quitado de favoritos');
  }
  addFavMat(i: number) { const f = this.prefs.favMats[i]; if (!f) return null; const m = { ...clone(f), id: sid('mt'), fav: true }; this.edit(`Material ${m.name}`, s => { s.materials.push(m); }); return m; }

  /** Añade una textura (imagen como data URL) y la pone en el material. */
  setTexture(matId: string, src: string, name: string, project: { id: string; rev: number } | null = null) {
    const id = sid('tx');
    this.edit('Textura', s => {
      s.textures.push({ id, name, src, project });
      const m = s.materials.find(x => x.id === matId);
      if (m) { m.tex = id; m.proc = null; if (m.color.v === '#c9c4d6' || !m.color.k) m.color.v = '#ffffff'; }
    });
    return id;
  }
  /** Nueva versión de una textura (tras pintar o actualizar desde el dibujo): deshacer vuelve a la anterior. */
  replaceTexture(matId: string, src: string, label: string) {
    const m = this.mat(matId); if (!m) return null;
    const old = this.s.textures.find(t => t.id === m.tex);
    const id = sid('tx');
    this.edit(label, s => { s.textures.push({ id, name: old?.name ?? 'Textura', src, project: old?.project ?? null }); const x = s.materials.find(y => y.id === matId); if (x) x.tex = id; });
    return id;
  }

  // ---------------------------------------------------------------- escenas y plantillas

  openScene(id: string) { if (!this.s.scenes.some(x => x.id === id)) return; this.pause(); this.s.open = id; this.sel = []; this.exitEdit(); this.emit('change', ''); this.emit('select', undefined); }
  addScene(copy = false) {
    const id = sid('sc');
    this.edit(copy ? 'Duplicar escena' : 'Nueva escena', s => {
      const sc = copy ? { ...clone(this.scene), id, name: `${this.scene.name} copia` } : { ...newScene(`Escena ${s.scenes.length + 1}`, s.materials), id };
      s.scenes.push(sc); s.open = id;
    });
    this.sel = []; this.emit('select', undefined);
  }
  removeScene(id: string) {
    if (this.s.scenes.length < 2) { toast('El proyecto necesita al menos una escena.'); return; }
    this.edit('Eliminar escena', s => { s.scenes = s.scenes.filter(x => x.id !== id); if (s.open === id) s.open = s.scenes[0].id; });
  }
  renameScene(id: string, name: string) { const n = name.trim().slice(0, 60); if (n) this.edit('Renombrar escena', s => { const sc = s.scenes.find(x => x.id === id); if (sc) sc.name = n; }); }
  saveTemplate(name: string) {
    const sc = clone(this.scene);
    const used = new Set(sc.objects.flatMap(o => o.mats ?? []));
    const mats = clone(this.s.materials.filter(m => used.has(m.id)));
    const tex = new Set(mats.map(m => m.tex).filter(Boolean));
    this.prefs.templates.push({ id: sid('tp'), name: name.slice(0, 60), scene: sc, materials: mats, textures: this.s.textures.filter(t => tex.has(t.id)) });
    this.deps.persist();
    toast(`Plantilla «${name}» guardada: la tienes en todos tus proyectos 3D`, 'ok');
  }
  useTemplate(id: string) {
    const tp = this.prefs.templates.find(t => t.id === id);
    if (!tp) return;
    const sid2 = sid('sc');
    this.edit(`Plantilla ${tp.name}`, s => {
      for (const m of tp.materials) if (!s.materials.some(x => x.id === m.id)) s.materials.push(clone(m));
      for (const t of tp.textures) if (!s.textures.some(x => x.id === t.id)) s.textures.push(t);
      s.scenes.push({ ...clone(tp.scene), id: sid2, name: tp.name });
      s.open = sid2;
    });
    this.sel = []; this.emit('select', undefined);
  }

  // ---------------------------------------------------------------- modo En vivo: física, personajes, reglas, efectos

  /** Física de los objetos elegidos (crea la configuración si no tenían). */
  setPhys(ids: string[], patch: Partial<Phys3>, label = 'Física') {
    this.edit(label, (_s, sc) => { for (const id of ids) { const o = objOf(sc, id); if (o && o.kind === 'mesh') o.phys = { ...(o.phys ?? (o.card ? cardPhys() : defaultPhys())), ...patch }; } });
  }
  /** Convierte los elegidos en personajes (o lo quita con `on` = false). */
  setCharacter(ids: string[], on: boolean) {
    this.edit(on ? 'Personaje' : 'Quitar personaje', (_s, sc) => {
      for (const id of ids) { const o = objOf(sc, id); if (!o || o.kind !== 'mesh') continue; if (on) { o.ctrl ??= defaultCtrl(); o.phys ??= defaultPhys('dynamic'); if (o.phys.body === 'none') o.phys.body = 'dynamic'; } else delete o.ctrl; }
    });
  }
  setCtrl(ids: string[], patch: Partial<Ctrl3>, live = false) {
    const fn = (_s: Studio3, sc: Scene3) => { for (const id of ids) { const o = objOf(sc, id); if (o?.ctrl) o.ctrl = { ...o.ctrl, ...patch, lock: { ...o.ctrl.lock, ...(patch.lock ?? {}) } }; } };
    if (live) this.live(fn); else this.edit('Personaje', fn);
  }
  /** Estilo propio (shaders) de los objetos elegidos; `null` lo quita. */
  setStyle(ids: string[], patch: Partial<ObjStyle> | null, live = false) {
    const fn = (_s: Studio3, sc: Scene3) => { for (const id of ids) { const o = objOf(sc, id); if (!o || o.kind !== 'mesh') continue; if (patch === null) delete o.style; else o.style = { ...defaultObjStyle(), ...(o.style ?? {}), ...patch }; } };
    if (live) this.live(fn); else this.edit('Estilo del objeto', fn);
  }
  /** Pose nueva para un dibujo (otro dibujo o imagen que se cambia en vivo con una tecla). */
  addPose(id: string, src: string, name: string, project: { id: string; rev: number } | null = null) {
    const tex = sid('tx');
    this.edit(`Pose: ${name}`, (st, sc) => {
      const o = objOf(sc, id); if (!o?.card) return;
      st.textures.push({ id: tex, name, src, ...(project ? { project } : {}) });
      const poses = (o.card.poses ??= []);
      poses.push({ id: sid('ps'), name, tex, key: String(Math.min(9, poses.length + 1)) });
    });
  }
  /** Cambia algo del dibujo (poses, teclas, transición). */
  setCard(id: string, fn: (c: NonNullable<Obj3['card']>) => void, label = 'Poses', live = false) {
    const f = (_s: Studio3, sc: Scene3) => { const o = objOf(sc, id); if (o?.card) fn(o.card); };
    if (live) this.live(f); else this.edit(label, f);
  }
  /** Grosor (volumen) de los dibujos elegidos. */
  setCardDepth(ids: string[], depth: number, live = false) {
    const fn = (_s: Studio3, sc: Scene3) => { for (const id of ids) { const o = objOf(sc, id); if (o?.card) o.card = { ...o.card, depth: Math.max(0, Math.min(2, depth)) }; } };
    if (live) this.live(fn); else this.edit('Grosor del dibujo', fn);
  }
  get fx(): Fx3 { return { ...defaultFx(), ...(this.scene.fx ?? {}) }; }
  /** Efectos de la escena (`live` = mientras se arrastra; se registra al soltar). */
  setFx(patch: Partial<Fx3>, live = false) {
    const fn = (_s: Studio3, sc: Scene3) => { sc.fx = { ...defaultFx(), ...(sc.fx ?? {}), ...patch }; };
    if (live) this.live(fn); else this.edit('Efectos', fn);
  }
  addRule(r: Rule3) { this.edit('Nueva regla', (_s, sc) => { (sc.rules ??= []).push(r); }); }
  updateRule(id: string, fn: (r: Rule3) => void, label = 'Regla') { this.edit(label, (_s, sc) => { const r = sc.rules?.find(x => x.id === id); if (r) fn(r); }); }
  removeRule(id: string) { this.edit('Borrar regla', (_s, sc) => { sc.rules = (sc.rules ?? []).filter(r => r.id !== id); }); }
  setScript(code: string) { if ((this.scene.script ?? '') !== code) this.edit('Programa', (_s, sc) => { sc.script = code; }); }
  /**
   * Dibujo en 3D: un cartel vertical con el dibujo de textura (lo transparente se
   * recorta), que recibe las luces, las sombras y los efectos de la escena y proyecta
   * la sombra de su silueta.
   */
  addCard(src: string, name: string, aspect: number, project: { id: string; rev: number } | null = null, height = 2) {
    const w = round(height * aspect), hh = height;
    const tex = sid('tx');
    const mat = newMaterial(name, { color: '#ffffff', rough: 0.85 });
    mat.tex = tex; mat.cut = true;
    const o = newObject('mesh', name, [0, 0, 0]);
    o.mesh = { v: [-w / 2, 0, 0, w / 2, 0, 0, w / 2, hh, 0, -w / 2, hh, 0], f: [[0, 1, 2, 3]], m: [0], uv: [[0, 0, 1, 0, 1, 1, 0, 1]] };
    o.mats = [mat.id];
    o.card = { billboard: false };
    o.phys = cardPhys();
    this.edit(`Dibujo en 3D: ${name}`, (st, sc) => { st.textures.push({ id: tex, name, src, project }); st.materials.push(mat); o.name = this.uniqueName(sc, o.name); sc.objects.push(o); });
    this.sel = [o.id];
    this.emit('select', undefined);
    return o;
  }

  // ---------------------------------------------------------------- tiempo y keyframes

  seek(t: number) {
    if (!this.hist) return;
    const sc = this.scene;
    this.s.time = Math.max(0, Math.min(sc.dur, Math.round(t * sc.fps) / sc.fps));
    this.emit('time', this.s.time);
  }
  step(frames: number) { this.pause(); this.seek(this.time + frames / this.fps); }
  play() {
    if (this.playing || !this.hist) return;
    this.playing = true; this.emit('play', true);
    let last = performance.now();
    if (this.time >= this.scene.dur - 1e-6) this.seek(0);
    const tick = (now: number) => {
      if (!this.playing) return;
      const dt = (now - last) / 1000; last = now;
      let t = this.time + dt;
      if (t > this.scene.dur) t = 0;
      this.s.time = t;
      this.emit('time', t);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }
  pause() { if (!this.playing) return; this.playing = false; cancelAnimationFrame(this.raf); this.seek(this.time); this.emit('play', false); }
  toggle() { if (this.playing) this.pause(); else this.play(); }

  /** Propiedades animables del objeto (y de su primer material). */
  propsOf(o: Obj3): { path: string; p: Prop<unknown>; mat?: string }[] {
    const out: { path: string; p: Prop<unknown>; mat?: string }[] = [];
    forEachProp3(o, (p, path) => out.push({ path, p }));
    const m = o.mats?.[0] ? this.mat(o.mats[0]) : undefined;
    if (m) forEachMatProp(m, (p, path) => out.push({ path: `mat.${path}`, p, mat: m.id }));
    return out;
  }
  /** Keyframe de transformación (posición, rotación y escala) en los elegidos, sin duplicar. */
  keyTransform() {
    const objs = this.selected;
    if (!objs.length) { toast('Elige uno o más objetos.'); return; }
    let n = 0;
    this.edit('Keyframe de transformación', (_s, sc) => {
      for (const o0 of objs) { const o = objOf(sc, o0.id)!; const t = this.localTime(); for (const k of TF_KEYS) if (!keyAt(o.tf[k], t)) { setValue(o.tf[k], t, valueAt(o.tf[k], t), true); n++; } }
      return n > 0;
    });
    toast(n ? `Keyframe en ${objs.length} ${objs.length === 1 ? 'objeto' : 'objetos'}` : 'Ya hay keyframe en este instante.');
  }
  /** Rombo de una propiedad (objeto o material): crea o quita el keyframe del cabezal. */
  toggleKeyPath(objId: string, path: string) {
    const t = this.localTime();
    this.edit('Keyframe', (s, sc) => {
      const o = objOf(sc, objId); if (!o) return false;
      if (path.startsWith('mat.')) { const m = s.materials.find(x => x.id === o.mats?.[0]); let pp: Prop<unknown> | null = null; if (m) forEachMatProp(m, (p, k) => { if (`mat.${k}` === path) pp = p; }); if (!pp) return false; toggleKey(pp, t); return true; }
      let pp: Prop<unknown> | null = null;
      forEachProp3(o, (p, k) => { if (k === path) pp = p; });
      if (!pp) return false;
      toggleKey(pp, t);
      return true;
    });
  }
  /** Todas las propiedades con keyframes de los objetos elegidos, con el clip de keyframes. */
  copyKeys() {
    const o = this.one;
    if (!o) return;
    const items: KeyClip3['items'] = [];
    let t0 = Infinity;
    for (const { p } of this.propsOf(o)) for (const k of p.k ?? []) t0 = Math.min(t0, k.t);
    for (const { path, p } of this.propsOf(o)) if (p.k?.length) items.push({ path, keys: clone(p.k).map(k => ({ ...k, t: k.t - t0 })) });
    if (!items.length) { toast('Este objeto no tiene keyframes.'); return; }
    this.keyClip = { items };
    toast(`Keyframes de «${o.name}» copiados: elige otros objetos y pégalos en el cabezal`, 'ok');
  }
  get hasKeyClip() { return !!this.keyClip; }
  pasteKeys() {
    const kc = this.keyClip;
    if (!kc) { toast('Primero copia keyframes.'); return; }
    const objs = this.selected;
    if (!objs.length) { toast('Elige dónde pegar.'); return; }
    const t0 = this.localTime();
    this.edit('Pegar keyframes', (s, sc) => {
      for (const o0 of objs) {
        const o = objOf(sc, o0.id)!;
        for (const it of kc.items) {
          let pp: Prop<unknown> | null = null;
          if (it.path.startsWith('mat.')) { const m = s.materials.find(x => x.id === o.mats?.[0]); if (m) forEachMatProp(m, (p, k) => { if (`mat.${k}` === it.path) pp = p; }); }
          else forEachProp3(o, (p, k) => { if (k === it.path) pp = p; });
          if (!pp) continue;
          const p: Prop<unknown> = pp;
          p.k ??= [];
          for (const k of it.keys) { const t = Math.min(sc.dur, t0 + k.t); p.k = p.k.filter(x => Math.abs(x.t - t) > 1e-4); p.k.push({ ...clone(k), t }); }
          p.k.sort((a, b) => a.t - b.t);
          p.v = valueAt(p, 0);
        }
      }
    });
  }
  /** Quita los keyframes del cabezal en los elegidos. */
  removeKeysNow() {
    const t = this.localTime();
    let n = 0;
    this.edit('Quitar keyframes', (s, sc) => {
      for (const o0 of this.selected) {
        const o = objOf(sc, o0.id)!;
        forEachProp3(o, p => { if (keyAt(p, t)) { toggleKey(p, t); n++; } });
        const m = s.materials.find(x => x.id === o.mats?.[0]);
        if (m) forEachMatProp(m, p => { if (keyAt(p, t)) { toggleKey(p, t); n++; } });
      }
      return n > 0;
    });
  }
  /** Curva de los keyframes del cabezal (o de todos con `all`) en los elegidos. */
  easeKeys(spec: EaseSpec | 'smooth', all = false) {
    const t = this.localTime();
    this.edit('Curva de keyframes', () => {
      for (const o of this.selected) for (const { p } of this.propsOf(o)) {
        if (spec === 'smooth') { smoothProp(p, all ? null : [t]); continue; }
        for (const k of p.k ?? []) if (all || Math.abs(k.t - t) < 1e-3) setEase(k, spec);
      }
    });
  }
  /** Tiempos con keyframe de los elegidos (para saltar). */
  keyTimes(): number[] {
    const ts = new Set<number>();
    for (const o of this.selected) for (const { p } of this.propsOf(o)) for (const k of p.k ?? []) ts.add(Math.round(k.t * 1000) / 1000);
    return [...ts].sort((a, b) => a - b);
  }
  jumpKey(dir: 1 | -1) { const t = this.time, ts = this.keyTimes(); const x = dir > 0 ? ts.find(v => v > t + 1e-6) : [...ts].reverse().find(v => v < t - 1e-6); if (x !== undefined) this.seek(x); }
  setDuration(d: number) { this.edit('Duración', (_s, sc) => { sc.dur = Math.max(1 / sc.fps, d); }); }
  setFps(f: number) { this.edit('FPS', (_s, sc) => { sc.fps = Math.max(1, Math.min(120, f)); }); }
  get easeTypes(): EaseType[] { return ['linear', 'in', 'out', 'inout', 'bezier', 'hold']; }
}

export const round = (x: number) => Math.round(x * 10000) / 10000;

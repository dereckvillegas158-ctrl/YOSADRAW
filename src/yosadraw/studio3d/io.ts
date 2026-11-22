import * as T from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { desktopBridge } from '../brush/storage';
import { valueAt } from '../motion/keys';
import { encodeGif, encodeMp4, mp4Codec } from '../anim/webexport';
import { IS_ARTIFACT } from '../ui/dom';
import { fromTriangles, triangulate } from './mesh';
import { effVisible, newMaterial, newObject, sid, type Mat3, type Obj3 } from './model';
import { round, type Studio3D } from './Studio3D';
import { canvasToUrl } from './textures';
import type { View3D } from './View3D';

/**
 * Importar y exportar en YOSADRAW 3D Studio: modelos (GLB, glTF, OBJ, STL), render
 * (PNG) y animaciones (MP4 con el codificador del sistema, GIF). Todo funciona sin
 * servidor: en escritorio se guarda en la carpeta de exportación; en el navegador,
 * como descarga; en Android, en Descargas.
 */

/** Guarda bytes como archivo. Devuelve la ruta (escritorio/Android) o el nombre. */
export async function saveFile(name: string, data: Uint8Array): Promise<string | null> {
  const b = desktopBridge();
  if (b?.writeExport) return b.writeExport(b.exportFolder ? await b.exportFolder() : '', name, data, false);
  if (IS_ARTIFACT) return null;
  const url = URL.createObjectURL(new Blob([data as Uint8Array<ArrayBuffer>]));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return name;
}
export const canvasPng = async (c: HTMLCanvasElement) => new Uint8Array(await (await new Promise<Blob>((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('PNG'))), 'image/png'))).arrayBuffer());

// ---------------------------------------------------------------- exportar modelos

/** Escena de Three para exportar: los objetos visibles con su transformación y materiales reales. */
function exportScene(s: Studio3D, view: View3D, onlySel: boolean): { scene: T.Scene; anims: T.AnimationClip[] } {
  const scene = new T.Scene();
  const sc = s.scene;
  const mats = new Map<string, T.MeshStandardMaterial>();
  const matOf = (m: Mat3) => { let x = mats.get(m.id); if (!x) { x = view.exportMaterial(m); mats.set(m.id, x); } return x; };
  const want = onlySel ? new Set(s.roots().flatMap(r => [r.id, ...sc.objects.filter(o => isDesc(sc.objects, o, r.id)).map(o => o.id)])) : null;
  const nodes = new Map<string, T.Object3D>();
  const tracks: T.KeyframeTrack[] = [];
  for (const o of sc.objects) {
    if (o.kind !== 'mesh' || !o.mesh || !effVisible(sc, o) || (want && !want.has(o.id))) continue;
    const tr = triangulate(o.mesh, !!o.smooth);
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(tr.pos, 3));
    g.setAttribute('normal', new T.BufferAttribute(tr.normal, 3));
    g.setAttribute('uv', new T.BufferAttribute(tr.uv, 2));
    for (const gr of tr.groups) g.addGroup(gr.start, gr.count, gr.mat);
    const slots = Math.max(1, ...o.mesh.m.map(x => x + 1));
    const ms = Array.from({ length: slots }, (_, i) => { const m = s.mat(o.mats?.[i] ?? o.mats?.[0] ?? ''); return m ? matOf(m) : new T.MeshStandardMaterial(); });
    const mesh = new T.Mesh(g, ms.length === 1 ? ms[0] : ms);
    mesh.name = o.name;
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(s.worldMatrix(o));
    mesh.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
    mesh.matrixAutoUpdate = true;
    scene.add(mesh);
    nodes.set(o.id, mesh);
    // Animación: se muestrea cada fotograma (así se exportan también curvas y jerarquías).
    if (hasKeys(s, o)) {
      const n = Math.max(2, Math.round(sc.dur * sc.fps) + 1), times: number[] = [], P: number[] = [], Q: number[] = [], S: number[] = [];
      const p = new T.Vector3(), q = new T.Quaternion(), sv = new T.Vector3();
      for (let i = 0; i < n; i++) { const t = (i / (n - 1)) * sc.dur; times.push(t); s.worldMatrix(o, t).decompose(p, q, sv); P.push(p.x, p.y, p.z); Q.push(q.x, q.y, q.z, q.w); S.push(sv.x, sv.y, sv.z); }
      mesh.name = mesh.name || o.id;
      tracks.push(new T.VectorKeyframeTrack(`${mesh.uuid}.position`, times, P), new T.QuaternionKeyframeTrack(`${mesh.uuid}.quaternion`, times, Q), new T.VectorKeyframeTrack(`${mesh.uuid}.scale`, times, S));
    }
  }
  return { scene, anims: tracks.length ? [new T.AnimationClip(sc.name, sc.dur, tracks)] : [] };
}
function isDesc(all: Obj3[], o: Obj3, root: string): boolean { let p = o.parent; let k = 0; while (p && k++ < 200) { if (p === root) return true; p = all.find(x => x.id === p)?.parent ?? null; } return false; }
function hasKeys(s: Studio3D, o: Obj3): boolean {
  const chain: Obj3[] = [];
  let c: Obj3 | undefined = o;
  while (c) { chain.push(c); c = c.parent ? s.obj(c.parent) : undefined; }
  return chain.some(x => Object.values(x.tf).some(p => p.k?.length));
}

export type ModelFormat = 'glb' | 'gltf' | 'obj' | 'stl';
export async function exportModel(s: Studio3D, view: View3D, fmt: ModelFormat, onlySel: boolean, base: string): Promise<{ name: string; size: number; path: string | null }> {
  const { scene, anims } = exportScene(s, view, onlySel);
  if (!scene.children.length) throw new Error(onlySel ? 'Elige objetos con geometría.' : 'La escena no tiene objetos visibles.');
  let data: Uint8Array, name = `${base}.${fmt}`;
  if (fmt === 'glb' || fmt === 'gltf') {
    const out = await new GLTFExporter().parseAsync(scene, { binary: fmt === 'glb', animations: anims, onlyVisible: true });
    data = out instanceof ArrayBuffer ? new Uint8Array(out) : new TextEncoder().encode(JSON.stringify(out));
  } else if (fmt === 'obj') {
    const mtl = objMtl(scene);
    const obj = `# YOSADRAW 3D Studio\nmtllib ${base}.mtl\n${new OBJExporter().parse(scene)}`;
    data = new TextEncoder().encode(obj);
    await saveFile(`${base}.mtl`, new TextEncoder().encode(mtl));
  } else {
    const r = new STLExporter().parse(scene, { binary: true }) as unknown as DataView;
    data = new Uint8Array(r.buffer, r.byteOffset, r.byteLength);
    name = `${base}.stl`;
  }
  const path = await saveFile(name, data);
  scene.traverse(o => { if (o instanceof T.Mesh) o.geometry.dispose(); });
  return { name, size: data.length, path };
}
/** Biblioteca de materiales .mtl para el .obj (colores, brillo y transparencia). */
function objMtl(scene: T.Scene): string {
  const seen = new Set<string>(), out: string[] = ['# YOSADRAW 3D Studio'];
  scene.traverse(o => {
    if (!(o instanceof T.Mesh)) return;
    for (const m of (Array.isArray(o.material) ? o.material : [o.material]) as T.MeshStandardMaterial[]) {
      if (!m.name || seen.has(m.name)) continue;
      seen.add(m.name);
      const c = m.color;
      out.push(`newmtl ${m.name}`, `Kd ${c.r.toFixed(4)} ${c.g.toFixed(4)} ${c.b.toFixed(4)}`, `Ns ${Math.round((1 - m.roughness) * 900)}`, `d ${m.opacity.toFixed(3)}`, `illum 2`, '');
    }
  });
  return out.join('\n');
}

// ---------------------------------------------------------------- importar modelos

export const MODEL_ACCEPT = '.glb,.gltf,.obj,.stl';

/** Importa un modelo como objetos editables (una malla por pieza, con sus materiales y texturas). */
export async function importModel(s: Studio3D, f: File): Promise<number> {
  const ext = f.name.split('.').pop()!.toLowerCase();
  const buf = await f.arrayBuffer();
  let root: T.Object3D;
  if (ext === 'glb' || ext === 'gltf') root = (await new GLTFLoader().parseAsync(ext === 'glb' ? buf : new TextDecoder().decode(buf), '')).scene;
  else if (ext === 'obj') root = new OBJLoader().parse(new TextDecoder().decode(buf));
  else if (ext === 'stl') { const g = new STLLoader().parse(buf); root = new T.Mesh(g, new T.MeshStandardMaterial({ color: '#b8b2c8' })); }
  else throw new Error('Formato no admitido (GLB, glTF, OBJ o STL).');
  root.updateMatrixWorld(true);
  const meshes: T.Mesh[] = [];
  root.traverse(o => { if (o instanceof T.Mesh && o.geometry?.attributes.position) meshes.push(o); });
  if (!meshes.length) throw new Error('El archivo no tiene mallas.');
  // Escala: que el modelo quepa en unos 4 m si viene en otra unidad.
  const box = new T.Box3().setFromObject(root);
  const size = box.getSize(new T.Vector3()).length();
  const k = size > 40 ? 4 / size : size < 0.05 && size > 0 ? 1 / size : 1;
  const mats: Mat3[] = [], texs: { id: string; name: string; src: string }[] = [];
  const matMap = new Map<T.Material, string>();
  const toMat = (m: T.Material): string => {
    let id = matMap.get(m);
    if (id) return id;
    const sm = m as T.MeshStandardMaterial;
    const mt = newMaterial(m.name || `Material ${mats.length + 1}`, { color: sm.color ? `#${sm.color.getHexString()}` : '#cccccc', rough: sm.roughness ?? 0.6, metal: sm.metalness ?? 0, opacity: sm.transparent ? sm.opacity : 1 });
    const img = sm.map?.image as CanvasImageSource & { width: number; height: number } | undefined;
    if (img && img.width) {
      const c = document.createElement('canvas'); const kk = Math.min(1, 2048 / Math.max(img.width, img.height));
      c.width = Math.max(1, Math.round(img.width * kk)); c.height = Math.max(1, Math.round(img.height * kk));
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      const tid = sid('tx'); texs.push({ id: tid, name: mt.name, src: canvasToUrl(c) }); mt.tex = tid;
    }
    mats.push(mt); matMap.set(m, mt.id);
    return mt.id;
  };
  const objs: Obj3[] = [];
  const group = newObject('group', f.name.replace(/\.[^.]+$/, '') || 'Modelo');
  for (const mesh of meshes) {
    let g = mesh.geometry as T.BufferGeometry;
    if (g.index && g.index.count > 600000) throw new Error('Modelo demasiado grande (más de 200 000 triángulos).');
    const W = mesh.matrixWorld.clone().premultiply(new T.Matrix4().makeScale(k, k, k));
    g = g.clone().applyMatrix4(W);
    const pos = g.attributes.position.array as ArrayLike<number>;
    const uv = g.attributes.uv?.array as ArrayLike<number> | undefined;
    const ms = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const groups = g.groups.length ? g.groups.map(x => ({ start: x.start, count: x.count, mat: x.materialIndex ?? 0 })) : undefined;
    const m = fromTriangles(pos, g.index ? g.index.array : null, uv ?? null, groups);
    g.dispose();
    if (!m.f.length) continue;
    const o = newObject('mesh', mesh.name || `Pieza ${objs.length + 1}`);
    o.mesh = m; o.mats = ms.map(toMat); o.smooth = true; o.parent = group.id;
    objs.push(o);
  }
  // El grupo, apoyado en el suelo y centrado.
  const b = new T.Box3();
  for (const o of objs) for (let i = 0; i < o.mesh!.v.length; i += 3) b.expandByPoint(new T.Vector3(o.mesh!.v[i], o.mesh!.v[i + 1], o.mesh!.v[i + 2]));
  const c = b.getCenter(new T.Vector3());
  for (const o of objs) for (let i = 0; i < o.mesh!.v.length; i += 3) { o.mesh!.v[i] = round(o.mesh!.v[i] - c.x); o.mesh!.v[i + 1] = round(o.mesh!.v[i + 1] - b.min.y); o.mesh!.v[i + 2] = round(o.mesh!.v[i + 2] - c.z); }
  s.edit(`Importar ${f.name}`, (st, sc) => { st.materials.push(...mats); st.textures.push(...texs); sc.objects.push(group, ...objs); });
  s.select([group.id]);
  return objs.length;
}

// ---------------------------------------------------------------- render de animaciones

export async function renderVideo(s: Studio3D, view: View3D, o: { format: 'mp4' | 'gif'; w: number; h: number; quality: 1 | 2 | 3; shadows: 0 | 1 | 2 | 3; transparent: boolean; progress: (k: number, n: number) => void; cancelled: () => boolean }): Promise<Uint8Array | null> {
  const sc = s.scene, fps = sc.fps, n = Math.max(1, Math.round(sc.dur * fps));
  // H.264 necesita medidas pares.
  const w = o.w - (o.w % 2), h = o.h - (o.h % 2);
  const frame = (k: number) => view.renderImage(w, h, { quality: o.quality, shadows: o.shadows, transparent: o.format === 'gif' && o.transparent, time: k / fps });
  if (o.format === 'gif') return encodeGif({ width: w, height: h, fps, frames: n, frame, progress: o.progress, cancelled: o.cancelled, loop: true, alpha: o.transparent });
  if (!(await mp4Codec(w, h, fps))) throw new Error('Este equipo no puede codificar MP4 (H.264): prueba GIF o una resolución menor.');
  const r = await encodeMp4({ width: w, height: h, fps, frames: n, frame, progress: o.progress, cancelled: o.cancelled, bitrate: Math.round(w * h * fps * 0.12), audio: null });
  return r?.data ?? null;
}

/** ¿Tiene keyframes la escena? (para ofrecer exportar vídeo). */
export function sceneAnimated(s: Studio3D): boolean {
  return s.scene.objects.some(o => Object.values(o.tf).some(p => p.k?.length) || !!o.opacity.k?.length || !!o.light?.intensity.k?.length || !!o.cam?.fov.k?.length)
    || s.s.materials.some(m => [m.color, m.rough, m.metal, m.opacity, m.emissiveI].some(p => p.k?.length));
}
export { valueAt };

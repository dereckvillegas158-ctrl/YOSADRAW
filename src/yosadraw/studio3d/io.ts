import * as T from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import dracoWrapper from 'three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js?url';
import dracoWasm from 'three/examples/jsm/libs/draco/gltf/draco_decoder.wasm?url';
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

export const MODEL_ACCEPT = '.glb,.gltf,.fbx,.obj,.mtl,.dae,.ply,.3mf,.stl,.bin,.png,.jpg,.jpeg,.webp,.tga,.bmp,.blend';
const MODEL_EXTS = ['glb', 'gltf', 'fbx', 'obj', 'dae', 'ply', '3mf', 'stl'];
/** Máximo de triángulos de un modelo importado (todas sus piezas e instancias). */
const MAX_TRIS = 400000;

/** Lee el modelo de cualquier formato admitido con sus archivos de apoyo (.bin, texturas, .mtl). */
async function loadModel(main: File, side: Map<string, string>): Promise<{ root: T.Object3D; anims: number }> {
  const ext = main.name.split('.').pop()!.toLowerCase();
  const buf = await main.arrayBuffer();
  const text = () => new TextDecoder().decode(buf);
  // Los archivos que el modelo nombra (texturas, .bin) se buscan entre los elegidos por su nombre.
  const mgr = new T.LoadingManager();
  const blobs = new Set(side.values());
  mgr.setURLModifier(url => {
    if (url.startsWith('data:') || blobs.has(url)) return url;
    const base = decodeURIComponent(url.split(/[\\/]/).pop()!.split('?')[0]).toLowerCase();
    return side.get(base) ?? DECODERS[base] ?? url;
  });
  // Las texturas de FBX y OBJ se cargan después de leer el modelo: se esperan (como mucho 10 s).
  let pend = 0;
  mgr.onStart = (_u, l, t) => { pend = t - l; };
  mgr.onProgress = (_u, l, t) => { pend = t - l; };
  mgr.onError = () => { pend = Math.max(0, pend - 1); };
  const settle = async <R>(r: R): Promise<R> => { for (let i = 0; i < 200 && pend > 0; i++) await new Promise(res => setTimeout(res, 50)); return r; };
  switch (ext) {
    case 'glb': case 'gltf': {
      const gl = new (await import('three/examples/jsm/loaders/GLTFLoader.js')).GLTFLoader(mgr);
      const draco = new (await import('three/examples/jsm/loaders/DRACOLoader.js')).DRACOLoader(mgr); draco.setDecoderPath('draco/'); gl.setDRACOLoader(draco);
      gl.setMeshoptDecoder((await import('three/examples/jsm/libs/meshopt_decoder.module.js')).MeshoptDecoder);
      try { const r = await gl.parseAsync(ext === 'glb' ? buf : text(), ''); return { root: r.scene, anims: r.animations.length }; }
      finally { draco.dispose(); }
    }
    case 'fbx': { const r = new (await import('three/examples/jsm/loaders/FBXLoader.js')).FBXLoader(mgr).parse(buf, ''); return settle({ root: r, anims: r.animations?.length ?? 0 }); }
    case 'obj': {
      const ol = new (await import('three/examples/jsm/loaders/OBJLoader.js')).OBJLoader(mgr);
      const mtl = [...side.keys()].find(k => k.endsWith('.mtl'));
      if (mtl) { const mt = await new (await import('three/examples/jsm/loaders/MTLLoader.js')).MTLLoader(mgr).loadAsync(side.get(mtl)!); mt.preload(); ol.setMaterials(mt); }
      return settle({ root: ol.parse(text()), anims: 0 });
    }
    case 'dae': { const r = new (await import('three/examples/jsm/loaders/ColladaLoader.js')).ColladaLoader(mgr).parse(text(), ''); return settle({ root: r.scene, anims: r.scene.animations?.length ?? 0 }); }
    case 'ply': { const g = new (await import('three/examples/jsm/loaders/PLYLoader.js')).PLYLoader(mgr).parse(buf); return { root: g.index ? new T.Mesh(g, new T.MeshStandardMaterial({ color: '#b8b2c8' })) : new T.Points(g), anims: 0 }; }
    case '3mf': return { root: new (await import('three/examples/jsm/loaders/3MFLoader.js')).ThreeMFLoader(mgr).parse(buf), anims: 0 };
    case 'stl': { const g = new (await import('three/examples/jsm/loaders/STLLoader.js')).STLLoader().parse(buf); return { root: new T.Mesh(g, new T.MeshStandardMaterial({ color: '#b8b2c8' })), anims: 0 }; }
    case 'blend': throw new Error('Los archivos .blend no se pueden leer directamente. En Blender: Archivo → Exportar → glTF 2.0 (.glb). Para las partículas, activa «Instancias de GPU» (Mesh → GPU Instances) o conviértelas antes con Objeto → Aplicar → Hacer reales las instancias.');
    default: throw new Error('Formato no admitido (GLB, glTF, FBX, OBJ, DAE, PLY, 3MF o STL).');
  }
}
/** Decodificadores de Draco (los glTF comprimidos de Blender), servidos con la app. */
const DECODERS: Record<string, string> = { 'draco_wasm_wrapper.js': dracoWrapper, 'draco_decoder.wasm': dracoWasm };

/**
 * Importa un modelo (Blender y otros programas) como objetos editables: una pieza
 * por malla con sus materiales y texturas. Las instancias (partículas de Blender
 * exportadas como «Instancias de GPU», o un objeto repetido) se juntan en una
 * pieza por malla; las nubes de puntos (cachés de partículas) se vuelven pequeñas
 * gotas. Se pueden elegir a la vez el modelo y sus archivos (.bin, texturas, .mtl).
 */
export async function importModel(s: Studio3D, files: File | File[]): Promise<{ pieces: number; instances: number; points: number; anims: number; name: string }> {
  const list = Array.isArray(files) ? files : [files];
  const main = list.find(f => MODEL_EXTS.includes(f.name.split('.').pop()!.toLowerCase())) ?? list.find(f => f.name.toLowerCase().endsWith('.blend'));
  if (!main) throw new Error('Elige el archivo del modelo (GLB, glTF, FBX, OBJ, DAE, PLY, 3MF o STL), y si hace falta sus texturas y .bin.');
  const side = new Map<string, string>();
  for (const f of list) if (f !== main) side.set(f.name.toLowerCase(), URL.createObjectURL(f));
  let loaded: { root: T.Object3D; anims: number };
  try { loaded = await loadModel(main, side); }
  finally { setTimeout(() => { for (const u of side.values()) URL.revokeObjectURL(u); }, 30000); }
  const root = loaded.root;
  root.updateMatrixWorld(true);
  const meshes: T.Mesh[] = [], points: T.Points[] = [];
  root.traverse(o => { if (o instanceof T.Mesh && o.geometry?.attributes.position) meshes.push(o); else if (o instanceof T.Points && o.geometry?.attributes.position) points.push(o); });
  if (!meshes.length && !points.length) throw new Error('El archivo no tiene mallas.');
  // Escala: que el modelo quepa en unos 4 m si viene en otra unidad (cm de FBX, km…).
  const box = new T.Box3().setFromObject(root);
  const size = box.getSize(new T.Vector3()).length();
  const k = size > 40 ? 4 / size : size < 0.05 && size > 0 ? 1 / size : 1;
  const mats: Mat3[] = [], texs: { id: string; name: string; src: string }[] = [];
  const matMap = new Map<T.Material, string>();
  const toMat = (m: T.Material): string => {
    let id = matMap.get(m);
    if (id) return id;
    const sm = m as T.MeshStandardMaterial & T.MeshPhongMaterial;
    // Phong / Lambert (FBX, OBJ): el brillo se vuelve rugosidad.
    const rough = sm.roughness ?? (sm.shininess !== undefined ? Math.max(0.05, 1 - Math.sqrt(sm.shininess / 100)) : 0.6);
    const em = sm.emissive && (sm.emissive.r + sm.emissive.g + sm.emissive.b) > 0.01 ? `#${sm.emissive.getHexString()}` : '#000000';
    const mt = newMaterial(m.name || `Material ${mats.length + 1}`, { color: sm.color ? `#${sm.color.getHexString()}` : '#cccccc', rough, metal: sm.metalness ?? 0, opacity: sm.transparent ? sm.opacity : 1, emissive: em, emissiveI: em === '#000000' ? 0 : sm.emissiveIntensity ?? 1 });
    const img = (sm.map?.image ?? sm.emissiveMap?.image) as CanvasImageSource & { width: number; height: number } | undefined;
    if (img && img.width) {
      const c = document.createElement('canvas'); const kk = Math.min(1, 2048 / Math.max(img.width, img.height));
      c.width = Math.max(1, Math.round(img.width * kk)); c.height = Math.max(1, Math.round(img.height * kk));
      const g = c.getContext('2d')!;
      g.drawImage(img, 0, 0, c.width, c.height);
      const tid = sid('tx'); texs.push({ id: tid, name: mt.name, src: canvasToUrl(c) }); mt.tex = tid;
      if (sm.alphaTest > 0 || (sm.transparent && sm.map)) mt.cut = true;
    }
    mats.push(mt); matMap.set(m, mt.id);
    return mt.id;
  };
  const objs: Obj3[] = [];
  const group = newObject('group', main.name.replace(/\.[^.]+$/, '') || 'Modelo');
  const S = new T.Matrix4().makeScale(k, k, k);
  let tris = 0, instances = 0, nPoints = 0;
  const triCount = (g: T.BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3;
  const addPiece = (g: T.BufferGeometry, ms: T.Material[], name: string) => {
    const pos = g.attributes.position.array as ArrayLike<number>;
    const uv = g.attributes.uv?.array as ArrayLike<number> | undefined;
    const groups = g.groups.length ? g.groups.map(x => ({ start: x.start, count: x.count, mat: x.materialIndex ?? 0 })) : undefined;
    const m = fromTriangles(pos, g.index ? g.index.array : null, uv ?? null, groups);
    g.dispose();
    if (!m.f.length) return;
    const o = newObject('mesh', name || `Pieza ${objs.length + 1}`);
    o.mesh = m; o.mats = ms.map(toMat); o.smooth = true; o.parent = group.id;
    objs.push(o);
  };
  for (const mesh of meshes) {
    const ms = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const base = mesh.geometry as T.BufferGeometry;
    if (mesh instanceof T.InstancedMesh) {
      // Instancias (partículas de Blender, hierba, rocas repetidas): se juntan en una pieza.
      const per = triCount(base), n = Math.max(0, Math.min(mesh.count, Math.floor((MAX_TRIS - tris) / Math.max(1, per))));
      if (!n) continue;
      const parts: T.BufferGeometry[] = [], IM = new T.Matrix4();
      const src = base.index ? base.toNonIndexed() : base.clone();
      for (const key of Object.keys(src.attributes)) if (key !== 'position' && key !== 'uv' && key !== 'normal') src.deleteAttribute(key);
      for (let i = 0; i < n; i++) { mesh.getMatrixAt(i, IM); parts.push(src.clone().applyMatrix4(IM.clone().premultiply(mesh.matrixWorld).premultiply(S))); }
      const merged = mergeGeometries(parts, false);
      for (const p of parts) p.dispose(); src.dispose();
      if (!merged) continue;
      tris += per * n; instances += n;
      addPiece(merged, ms, `${mesh.name || 'Instancias'} (${n})`);
      continue;
    }
    if (tris + triCount(base) > MAX_TRIS) throw new Error(`Modelo demasiado grande (más de ${MAX_TRIS / 1000} 000 triángulos). Redúcelo en Blender con el modificador «Diezmar» (Decimate).`);
    tris += triCount(base);
    addPiece(base.clone().applyMatrix4(mesh.matrixWorld.clone().premultiply(S)), ms, mesh.name);
  }
  // Nubes de puntos (caché de partículas exportada como puntos): una gota pequeña por punto.
  for (const pts of points) {
    const pos = pts.geometry.attributes.position, n = Math.min(pos.count, 6000);
    const r = Math.max(0.004, (size * k) / 400);
    const dot = new T.OctahedronGeometry(r, 0).toNonIndexed(); dot.deleteAttribute('normal');
    const parts: T.BufferGeometry[] = [], v = new T.Vector3(), W = pts.matrixWorld.clone().premultiply(S);
    for (let i = 0; i < n; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(W); parts.push(dot.clone().translate(v.x, v.y, v.z)); }
    const merged = parts.length ? mergeGeometries(parts, false) : null;
    for (const p of parts) p.dispose();
    if (!merged) continue;
    nPoints += n;
    const pm = pts.material as T.PointsMaterial;
    addPiece(merged, [new T.MeshStandardMaterial({ color: pm.color ?? new T.Color('#ffffff'), name: 'Partículas' })], `${pts.name || 'Partículas'} (${n} puntos)`);
  }
  if (!objs.length) throw new Error('El modelo no tiene caras que se puedan importar.');
  // El grupo, apoyado en el suelo y centrado.
  const b = new T.Box3();
  for (const o of objs) for (let i = 0; i < o.mesh!.v.length; i += 3) b.expandByPoint(new T.Vector3(o.mesh!.v[i], o.mesh!.v[i + 1], o.mesh!.v[i + 2]));
  const c = b.getCenter(new T.Vector3());
  for (const o of objs) for (let i = 0; i < o.mesh!.v.length; i += 3) { o.mesh!.v[i] = round(o.mesh!.v[i] - c.x); o.mesh!.v[i + 1] = round(o.mesh!.v[i + 1] - b.min.y); o.mesh!.v[i + 2] = round(o.mesh!.v[i + 2] - c.z); }
  s.edit(`Importar ${main.name}`, (st, sc) => { st.materials.push(...mats); st.textures.push(...texs); group.name = s.uniqueName(sc, group.name); sc.objects.push(group, ...objs); });
  s.select([group.id]);
  return { pieces: objs.length, instances, points: nPoints, anims: loaded.anims, name: group.name };
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

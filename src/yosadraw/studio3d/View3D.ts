import * as T from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { valueAt } from '../motion/keys';
import { toast } from '../ui/dom';
import * as M from './mesh';
import { effLocked, effVisible, objOf, sceneOf, type Mat3, type Obj3, type PrimType, type Scene3 } from './model';
import { round, type Studio3D } from './Studio3D';
import { canvasToUrl, TexCache } from './textures';
import { FxPipeline, volumeCone } from './live/fx';
import type { Fx3 } from './model';

/** Lo que el modo En vivo cambia al dibujar (sin tocar el proyecto). */
export interface LiveHooks {
  world: Map<string, T.Matrix4>; hidden: Set<string>;
  lightK: Map<string, number>; lightColor: Map<string, string>; matColor: Map<string, string>;
  shake: T.Vector3; fx: Fx3; time: number;
}

const D2R = Math.PI / 180;
const ORANGE = new T.Color('#ffa63d'), ACTIVE = new T.Color('#ffd27a');

interface Node3 {
  node: T.Group;
  mesh?: T.Mesh; sig?: string;
  outline?: T.LineSegments; outlineSig?: string;
  light?: T.Light; target?: T.Object3D;
  cam?: T.PerspectiveCamera; camHelper?: T.CameraHelper;
  pick?: T.Mesh;
  /** Intensidad de la luz según el proyecto (el modo En vivo la multiplica). */
  baseI?: number; baseColor?: string;
  cone?: T.Mesh; arrow?: T.ArrowHelper;
}

/** Firma rápida de una malla (para no reconstruir la geometría si no cambió). */
function meshSig(m: M.Mesh, smooth: boolean): string {
  let h = 2166136261 >>> 0;
  const mix = (x: number) => { h ^= Math.round(x * 1e4) | 0; h = Math.imul(h, 16777619) >>> 0; };
  for (const x of m.v) mix(x);
  for (const f of m.f) { mix(f.length); for (const i of f) mix(i); }
  for (const x of m.m) mix(x);
  if (m.uv) for (const u of m.uv) if (u) for (const x of u) mix(x);
  return `${h}:${m.v.length}:${m.f.length}:${smooth ? 1 : 0}`;
}

export type ViewName = 'persp' | 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'camera';

/**
 * Visor 3D de YOSADRAW 3D Studio (Three.js / WebGL2). Dibuja la escena del modelo
 * en el tiempo actual, navega (órbita, desplazar, zoom, vistas, encuadrar), elige
 * objetos y vértices/aristas/caras (clic y rectángulo), los transforma con gizmos
 * (mover, rotar, escalar, con ajuste a la cuadrícula y por eje), crea objetos
 * arrastrando, construye con bloques y pinta texturas sobre el modelo. También
 * hace los render finales (imagen o fotogramas) con la cámara de la escena.
 */
export class View3D {
  readonly el: HTMLElement;
  readonly renderer: T.WebGLRenderer;
  readonly scene = new T.Scene();
  private root = new T.Group();
  readonly persp = new T.PerspectiveCamera(45, 1, 0.05, 5000);
  readonly ortho = new T.OrthographicCamera(-5, 5, 5, -5, -2000, 2000);
  camera: T.Camera = this.persp;
  readonly controls: OrbitControls;
  readonly tc: TransformControls;
  private proxy = new T.Object3D();
  private nodes = new Map<string, Node3>();
  private mats = new Map<string, T.Material>();
  readonly tex = new TexCache();
  private grid: T.GridHelper;
  private axes = new T.Group();
  private rig = new T.Group();
  private headlight = new T.DirectionalLight('#ffffff', 1.6);
  private envTex: T.Texture | null = null;
  private overlay = new T.Group();
  private ghost: T.Mesh;
  private rectEl: HTMLElement;
  private hud: HTMLElement;
  private raf = 0;
  /** Vista por la cámara de la escena. */
  throughCamera = false;
  showGrid = true; showAxes = true; showHelpers = true;
  /** Navegar con el botón izquierdo (modo principiante). */
  navigate = false;
  private drag: null | { kind: 'rect'; x0: number; y0: number; add: boolean } | { kind: 'move'; plane: T.Plane; start: T.Vector3; base: Map<string, T.Matrix4> } | { kind: 'create'; p0: T.Vector3; p1: T.Vector3; phase: 'base' | 'height'; y0: number; h: number; y: number } | { kind: 'paint'; mat: string; texId: string; canvas: HTMLCanvasElement; last: T.Vector2 | null } | null = null;
  private gizmoStart: { P0: T.Matrix4; W: Map<string, T.Matrix4>; verts?: { ids: number[]; orig: number[]; N: T.Matrix4 } } | null = null;
  private downAt: { x: number; y: number; button: number; moved: boolean } | null = null;
  /** Modo En vivo (lo pone el motor mientras se ejecuta). */
  live: LiveHooks | null = null;
  private fxp: FxPipeline | null = null;
  /** Antes de cada dibujo en vivo (el motor avanza la simulación). */
  onLiveFrame: ((dt: number) => void) | null = null;
  /** Clics del modo En vivo (los gestiona el motor). */
  liveInput: { down(e: PointerEvent): boolean; move(e: PointerEvent): void; up(e: PointerEvent): void; wheel(e: WheelEvent): boolean } | null = null;
  /** Menú contextual (lo pone la interfaz). */
  onContext: (x: number, y: number) => void = () => {};
  onPick: () => void = () => {};

  constructor(private s: Studio3D) {
    this.renderer = new T.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    const cv = this.renderer.domElement;
    cv.className = 's3-canvas';
    cv.tabIndex = 0;
    cv.setAttribute('aria-label', 'Visor 3D');
    this.rectEl = document.createElement('div'); this.rectEl.className = 's3-rect'; this.rectEl.hidden = true;
    this.hud = document.createElement('div'); this.hud.className = 's3-hud';
    this.el = document.createElement('div'); this.el.className = 's3-view';
    this.el.append(cv, this.rectEl, this.hud);
    this.scene.add(this.root, this.overlay, this.rig, this.axes);
    this.persp.position.set(7, 5, 9);
    this.ortho.position.set(7, 5, 9);
    this.controls = new OrbitControls(this.persp, cv);
    this.controls.enableDamping = false;
    this.controls.zoomToCursor = true;
    this.controls.mouseButtons = { LEFT: -1 as T.MOUSE, MIDDLE: T.MOUSE.ROTATE, RIGHT: T.MOUSE.PAN };
    this.controls.addEventListener('change', () => this.request());
    this.tc = new TransformControls(this.persp, cv);
    this.tc.setSize(0.9);
    this.scene.add(this.tc.getHelper());
    this.scene.add(this.proxy);
    this.tc.attach(this.proxy);
    this.tc.addEventListener('dragging-changed', e => this.gizmoDrag(!!(e as unknown as { value: boolean }).value));
    this.tc.addEventListener('objectChange', () => this.gizmoMove());
    this.tc.addEventListener('change', () => this.request());
    // Cuadrícula, ejes y luces de trabajo (modo sólido).
    this.grid = new T.GridHelper(40, 160, '#5a5470', '#2f2b3d');
    (this.grid.material as T.Material).transparent = true; (this.grid.material as T.Material).opacity = 0.75;
    this.scene.add(this.grid);
    const axis = (a: T.Vector3, c: string) => { const g = new T.BufferGeometry().setFromPoints([a.clone().multiplyScalar(-200), a.clone().multiplyScalar(200)]); return new T.Line(g, new T.LineBasicMaterial({ color: c })); };
    this.axes.add(axis(new T.Vector3(1, 0, 0), '#e2475a'), axis(new T.Vector3(0, 0, 1), '#4a7bea'), axis(new T.Vector3(0, 1, 0), '#4cc36a'));
    this.rig.add(new T.HemisphereLight('#ffffff', '#4a4458', 1.2), this.headlight);
    this.scene.add(this.persp, this.ortho);
    this.persp.add(this.headlight); this.headlight.position.set(2, 3, 1);
    this.ghost = new T.Mesh(new T.BoxGeometry(1, 1, 1), new T.MeshBasicMaterial({ color: '#9d8cff', transparent: true, opacity: 0.35, depthWrite: false }));
    this.ghost.visible = false;
    this.scene.add(this.ghost);
    const pm = new T.PMREMGenerator(this.renderer);
    this.envTex = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.tex.onLoad = () => { this.mats.clear(); this.sync(); };
    // Eventos.
    this.el.addEventListener('pointerdown', e => this.navMode(e), { capture: true });
    cv.addEventListener('pointerdown', e => { if (this.liveInput?.down(e)) return; this.down(e); });
    cv.addEventListener('pointermove', e => { if (this.liveInput) { this.liveInput.move(e); return; } this.move(e); });
    cv.addEventListener('pointerup', e => { if (this.liveInput) { this.liveInput.up(e); return; } this.up(e); });
    cv.addEventListener('wheel', e => { if (this.liveInput?.wheel(e)) { e.preventDefault(); e.stopImmediatePropagation(); } }, { capture: true, passive: false });
    cv.addEventListener('pointerleave', () => { this.ghost.visible = false; this.request(); });
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('dblclick', e => this.dbl(e));
    new ResizeObserver(() => this.resize()).observe(this.el);
    s.on('change', () => this.sync());
    // Al reproducir sólo cambian transformaciones y valores: no se rehace la geometría.
    s.on('time', () => this.sync(false));
    s.on('select', () => this.sync());
    s.on('mode', () => this.sync());
    s.on('tool', () => this.syncGizmo());
    s.on('view', () => { this.mats.clear(); this.sync(); });
    s.on('open', on => { if (on) { this.clear(); this.sync(); this.frameAll(); } else this.clear(); });
  }

  // ---------------------------------------------------------------- cámara y vista

  private resize() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (w < 2 || h < 2) return;
    this.renderer.setSize(w, h, false);
    this.fxp?.setSize(w, h);
    this.renderer.domElement.style.width = `${w}px`; this.renderer.domElement.style.height = `${h}px`;
    this.persp.aspect = w / h; this.persp.updateProjectionMatrix();
    this.updateOrtho();
    this.request();
  }
  private updateOrtho() {
    const w = this.el.clientWidth || 1, h = this.el.clientHeight || 1;
    const d = this.persp.position.distanceTo(this.controls.target) * Math.tan((this.persp.fov * D2R) / 2);
    this.ortho.left = -d * (w / h); this.ortho.right = d * (w / h); this.ortho.top = d; this.ortho.bottom = -d;
    this.ortho.position.copy(this.persp.position); this.ortho.quaternion.copy(this.persp.quaternion);
    this.ortho.updateProjectionMatrix();
  }
  get isOrtho() { return this.camera === this.ortho; }
  setOrtho(on: boolean) {
    this.throughCamera = false;
    this.camera = on ? this.ortho : this.persp;
    this.updateOrtho();
    this.tc.camera = this.camera;
    this.request();
    this.s.emitView();
  }
  /** Vistas: frente, lados, arriba (ortográficas) o perspectiva; «camera» = por la cámara de la escena. */
  setView(v: ViewName) {
    if (v === 'camera') { this.lookThrough(); return; }
    this.throughCamera = false;
    const t = this.controls.target, d = Math.max(2, this.persp.position.distanceTo(t));
    const dir: Record<Exclude<ViewName, 'camera'>, [number, number, number]> = { persp: [0.6, 0.45, 0.66], front: [0, 0, 1], back: [0, 0, -1], left: [-1, 0, 0], right: [1, 0, 0], top: [0, 1, 0.0001], bottom: [0, -1, 0.0001] };
    const n = new T.Vector3(...dir[v]).normalize();
    this.persp.position.copy(t).addScaledVector(n, d);
    this.persp.lookAt(t);
    this.controls.update();
    this.setOrtho(v !== 'persp');
  }
  /** Encuadra la caja `b` (o todo). */
  private frameBox(b: T.Box3) {
    if (b.isEmpty()) b = new T.Box3(new T.Vector3(-2, 0, -2), new T.Vector3(2, 2, 2));
    const c = b.getCenter(new T.Vector3()), r = Math.max(0.3, b.getSize(new T.Vector3()).length() / 2);
    const dist = r / Math.sin((this.persp.fov * D2R) / 2) * 1.1;
    const dir = this.persp.position.clone().sub(this.controls.target).normalize();
    if (!Number.isFinite(dir.x) || dir.lengthSq() < 0.5) dir.set(0.6, 0.45, 0.66).normalize();
    this.controls.target.copy(c);
    this.persp.position.copy(c).addScaledVector(dir, dist);
    this.persp.near = Math.max(0.01, dist / 1000); this.persp.updateProjectionMatrix();
    this.controls.update();
    this.updateOrtho();
    this.request();
  }
  frameSelected() {
    const s = this.s;
    if (s.mode === 'edit' && s.one?.mesh && s.editCount) {
      const n = this.nodes.get(s.one.id)!.node, b = new T.Box3();
      for (const i of s.editVerts(s.one.mesh)) b.expandByPoint(new T.Vector3(...M.vget(s.one.mesh, i)).applyMatrix4(n.matrixWorld));
      b.expandByScalar(0.3);
      this.frameBox(b);
      return;
    }
    const b = new T.Box3();
    for (const o of s.selected) b.union(s.worldBox(o));
    if (b.isEmpty()) { this.frameAll(); return; }
    this.frameBox(b);
  }
  frameAll() {
    const s = this.s;
    if (!s.active) return;
    const b = new T.Box3();
    for (const o of s.scene.objects) if (o.kind === 'mesh' && o.visible && !(o.name === 'Suelo' && o.prim?.type === 'plane')) b.union(s.worldBox(o));
    this.frameBox(b);
  }
  /** Mira por la cámara activa de la escena (encuadre final). */
  lookThrough() {
    const id = this.s.scene.camera;
    if (!id) { toast('La escena no tiene cámara: añade una.'); return; }
    this.throughCamera = true;
    this.request();
    this.s.emitView();
  }
  /** Coloca la cámara activa de la escena donde está la vista. */
  cameraToView() {
    const s = this.s, id = s.scene.camera, o = id ? s.obj(id) : null;
    if (!o) { toast('La escena no tiene cámara.'); return; }
    const W = new T.Matrix4().compose(this.persp.position, this.persp.quaternion, new T.Vector3(1, 1, 1));
    s.edit('Cámara a la vista', (_st, sc) => { const x = objOf(sc, o.id)!; s.setWorld(x, W); });
    toast('La cámara de la escena encuadra lo que ves', 'ok');
  }

  // ---------------------------------------------------------------- dibujar

  request() { if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.render(); }); }
  private render() {
    if (!this.s.active) return;
    const cam = this.throughCamera ? this.sceneCam() ?? this.camera : this.camera;
    if (this.camera === this.ortho && !this.throughCamera) this.updateOrtho();
    this.tc.getHelper().visible = !this.throughCamera && this.tc.enabled && !this.live;
    const live = this.live;
    if (live) this.applyLive(live);
    this.billboards(cam);
    const fx = live?.fx ?? (this.s.scene.fx?.preview && this.mode !== 'solid' && this.mode !== 'wire' ? this.s.scene.fx : null);
    // Temblor de cámara (sólo al dibujar).
    const sh = live?.shake;
    if (sh && sh.lengthSq() > 0) cam.position.add(sh);
    if (fx && FxPipeline.active(fx)) {
      if (!this.fxp) { this.fxp = new FxPipeline(this.renderer, this.scene, cam); this.fxp.setSize(this.el.clientWidth || 1, this.el.clientHeight || 1); }
      if (this.fxp.currentQuality !== fx.quality && !fx.adaptive) this.fxp.setQuality(fx.quality);
      this.fxp.render(this.scene, cam, fx, live?.time ?? performance.now() / 1000, this.sunDir());
    } else {
      this.renderer.render(this.scene, cam);
      if (fx && this.fxp) this.fxp.tick(fx);
    }
    if (sh && sh.lengthSq() > 0) cam.position.sub(sh);
    this.hud.textContent = this.hudText();
  }
  /** FPS medidos con efectos (o 0 sin medir). */
  get fps() { return this.fxp?.fps ?? 0; }
  /** Dibuja ya (el bucle del modo En vivo llama a esto en cada fotograma). */
  renderNow() { if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; } this.render(); }
  /** Modo de vista real: en vivo siempre con luces y sombras. */
  get mode() { return this.live ? 'render' : this.s.prefs.shading; }
  /** Dirección hacia el sol (primera luz direccional visible) para los rayos volumétricos. */
  private sunDir(): T.Vector3 | null {
    for (const n of this.nodes.values()) {
      const l = n.light;
      if (!(l instanceof T.DirectionalLight) || !n.node.visible || !l.visible) continue;
      const a = new T.Vector3().setFromMatrixPosition(l.matrixWorld), b = new T.Vector3().setFromMatrixPosition(l.target.matrixWorld);
      return a.sub(b).normalize();
    }
    for (const n of this.nodes.values()) if (n.light instanceof T.SpotLight && n.node.visible) { const a = new T.Vector3().setFromMatrixPosition(n.light.matrixWorld); return a.sub(this.controls.target).normalize(); }
    return null;
  }
  /** Aplica lo del modo En vivo: posiciones de la física, luces, colores y visibilidad. */
  private applyLive(L: LiveHooks) {
    for (const [id, W] of L.world) {
      const n = this.nodes.get(id);
      if (!n) continue;
      const P = n.node.parent?.matrixWorld;
      n.node.matrix.copy(P ? new T.Matrix4().copy(P).invert().multiply(W) : W);
    }
    for (const [id, n] of this.nodes) {
      if (L.hidden.has(id)) n.node.visible = false;
      if (n.light) {
        const k = L.lightK.get(id);
        n.light.intensity = (n.baseI ?? n.light.intensity) * (k ?? 1);
        const c = L.lightColor.get(id);
        n.light.color.set(c ?? n.baseColor ?? '#ffffff');
        if (n.cone) { const u = (n.cone.material as T.ShaderMaterial).uniforms; u.color.value.copy(n.light.color); u.time.value = L.time; u.strength.value = L.fx.cones * Math.min(2, (n.baseI ?? 1) * (k ?? 1) / 30); }
      }
    }
    if (L.matColor.size) for (const [key, m] of this.mats) { const id = key.split('|')[1]; const c = L.matColor.get(id); if (c) (m as T.MeshStandardMaterial).color?.set(c); }
    this.root.updateMatrixWorld(true);
  }
  /** Carteles (dibujos) que miran a la cámara girando sólo en Y. */
  private billboards(cam: T.Camera) {
    const s = this.s;
    for (const o of s.scene.objects) {
      if (!o.card?.billboard) continue;
      const n = this.nodes.get(o.id);
      if (!n) continue;
      const p = new T.Vector3(), q = new T.Quaternion(), sc = new T.Vector3();
      n.node.matrixWorld.decompose(p, q, sc);
      const yaw = Math.atan2(cam.position.x - p.x, cam.position.z - p.z);
      const W = new T.Matrix4().compose(p, new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), yaw), sc);
      const P = n.node.parent?.matrixWorld;
      n.node.matrix.copy(P ? new T.Matrix4().copy(P).invert().multiply(W) : W);
      n.node.updateMatrixWorld(true);
    }
  }
  private sceneCam(): T.PerspectiveCamera | null {
    const id = this.s.scene.camera, n = id ? this.nodes.get(id) : null;
    if (!n?.cam) return null;
    const w = this.el.clientWidth || 1, h = this.el.clientHeight || 1;
    n.cam.aspect = w / h; n.cam.updateProjectionMatrix();
    return n.cam;
  }
  private hudText() {
    const s = this.s;
    const v = this.throughCamera ? 'Cámara de la escena' : this.isOrtho ? 'Ortográfica' : 'Perspectiva';
    const mode = s.mode === 'edit' ? `Edición · ${s.selMode === 'vert' ? 'vértices' : s.selMode === 'edge' ? 'aristas' : 'caras'}${s.editCount ? ` (${s.editCount})` : ''}` : 'Objeto';
    return `${v} · ${mode}${s.prefs.autoKey ? ' · ● Auto Keyframe' : ''}`;
  }

  private clear() {
    for (const n of this.nodes.values()) this.disposeNode(n);
    this.nodes.clear();
    this.mats.forEach(m => m.dispose()); this.mats.clear();
    this.overlay.clear();
  }
  private disposeNode(n: Node3) {
    n.node.removeFromParent();
    n.mesh?.geometry.dispose();
    n.outline?.geometry.dispose();
    n.camHelper?.removeFromParent(); n.camHelper?.dispose();
    n.pick?.geometry.dispose();
  }

  /** Material de Three para un material del proyecto en el tiempo actual (según el modo de vista). */
  private material(id: string, op: number): T.Material {
    const s = this.s, mode = this.mode, t = s.time;
    const m = s.mat(id);
    const key = `${mode}|${id}|${op < 1 ? op.toFixed(3) : 1}`;
    let out = this.mats.get(key);
    const col = m ? valueAt(m.color, t) : '#cccccc';
    if (mode === 'wire') {
      if (!out) { out = new T.MeshBasicMaterial({ wireframe: true }); this.mats.set(key, out); }
      (out as T.MeshBasicMaterial).color.set(col);
      return out;
    }
    if (mode === 'solid') {
      if (!out) { out = new T.MeshStandardMaterial({ roughness: 0.75, metalness: 0 }); this.mats.set(key, out); }
      const mm = out as T.MeshStandardMaterial;
      mm.color.set('#c8c3d4'); mm.opacity = op * (m ? valueAt(m.opacity, t) : 1); mm.transparent = mm.opacity < 1;
      return out;
    }
    const toon = !!m?.toon;
    if (!out || (toon !== (out instanceof T.MeshToonMaterial))) { out?.dispose(); out = toon ? new T.MeshToonMaterial() : new T.MeshStandardMaterial(); this.mats.set(key, out); }
    const mm = out as T.MeshStandardMaterial;
    mm.color.set(col);
    if (!toon) { mm.roughness = m ? valueAt(m.rough, t) : 0.5; mm.metalness = m ? valueAt(m.metal, t) : 0; mm.envMapIntensity = 1; }
    const o = op * (m ? valueAt(m.opacity, t) : 1);
    mm.opacity = o; mm.transparent = o < 0.999; mm.depthWrite = o > 0.6;
    if (m) { mm.emissive.set(valueAt(m.emissive, t)); mm.emissiveIntensity = valueAt(m.emissiveI, t); }
    let map: T.Texture | null = null;
    if (m?.tex) { const tx = s.s.textures.find(x => x.id === m.tex); if (tx) map = this.tex.image(tx.id, tx.src); }
    else if (m?.proc) map = this.tex.procedural(m.proc);
    if (map) map.repeat.set(m!.texScale, m!.texScale);
    if (mm.map !== map) { mm.map = map; mm.needsUpdate = true; }
    // Dibujos: lo transparente se recorta (no se ve ni hace sombra) y se ven por las dos caras.
    const cut = !!m?.cut;
    if (mm.alphaTest !== (cut ? 0.5 : 0)) { mm.alphaTest = cut ? 0.5 : 0; mm.needsUpdate = true; }
    mm.side = cut ? T.DoubleSide : T.FrontSide;
    if (cut) { mm.transparent = o < 0.999; mm.depthWrite = true; }
    return out;
  }

  /** Actualiza la escena de Three a partir del modelo (sólo reconstruye lo que cambió). */
  sync(full = true) {
    const s = this.s;
    if (!s.active) return;
    const sc = s.scene, t = s.time, mode = this.mode;
    const fx = this.live?.fx ?? sc.fx;
    const fxOn = !!this.live || !!sc.fx?.preview;
    const seen = new Set<string>();
    const lit = mode === 'material' || mode === 'render';
    this.rig.visible = !lit;
    this.scene.environment = lit ? this.envTex : null;
    this.scene.environmentIntensity = sc.env.envLight;
    this.scene.background = sc.env.transparent ? null : new T.Color(sc.env.bg);
    this.scene.fog = sc.env.fog > 0 ? new T.FogExp2(sc.env.bg, sc.env.fog * 0.05) : null;
    this.renderer.toneMappingExposure = sc.env.exposure;
    this.renderer.shadowMap.enabled = mode === 'render' && (fx?.shadows ?? 2) > 0;
    const sel = new Set(s.sel);
    for (const o of sc.objects) {
      seen.add(o.id);
      let n = this.nodes.get(o.id);
      if (!n) { n = { node: new T.Group() }; n.node.matrixAutoUpdate = false; n.node.userData.oid = o.id; this.nodes.set(o.id, n); }
      const L = s.localMatrix(o, t);
      n.node.matrix.copy(L);
      n.node.visible = o.visible;
      const parent = o.parent ? this.nodes.get(o.parent)?.node : this.root;
      if (n.node.parent !== (parent ?? this.root)) (parent ?? this.root).add(n.node);
      const op = valueAt(o.opacity, t);
      if (o.kind === 'mesh' && o.mesh) {
        const sig = full || !n.sig ? meshSig(o.mesh, !!o.smooth) : n.sig;
        if (sig !== n.sig) {
          const tr = M.triangulate(o.mesh, !!o.smooth);
          const g = new T.BufferGeometry();
          g.setAttribute('position', new T.BufferAttribute(tr.pos, 3));
          g.setAttribute('normal', new T.BufferAttribute(tr.normal, 3));
          g.setAttribute('uv', new T.BufferAttribute(tr.uv, 2));
          for (const gr of tr.groups) g.addGroup(gr.start, gr.count, gr.mat);
          g.computeBoundingSphere(); g.computeBoundingBox();
          g.userData.faceOf = tr.faceOf;
          if (n.mesh) { n.mesh.geometry.dispose(); n.mesh.geometry = g; }
          else { n.mesh = new T.Mesh(g); n.mesh.userData.oid = o.id; n.node.add(n.mesh); }
          n.sig = sig;
          n.outlineSig = '';
        }
        const slots = Math.max(1, ...o.mesh.m.map(x => x + 1));
        const ms = Array.from({ length: slots }, (_, i) => this.material(o.mats?.[i] ?? o.mats?.[0] ?? '', op));
        n.mesh!.material = ms;
        // Sombra con la silueta del dibujo (no un rectángulo).
        const cutMap = (ms.find(x => (x as T.MeshStandardMaterial).alphaTest > 0 && (x as T.MeshStandardMaterial).map) as T.MeshStandardMaterial | undefined)?.map ?? null;
        if (cutMap) { const dm = n.mesh!.customDepthMaterial as T.MeshDepthMaterial | undefined; if (!dm || dm.map !== cutMap) n.mesh!.customDepthMaterial = new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking, map: cutMap, alphaTest: 0.5 }); }
        else if (n.mesh!.customDepthMaterial) n.mesh!.customDepthMaterial = undefined;
        // Zonas: se ven al editar (semitransparentes), no en vivo.
        if (o.phys?.zone) n.mesh!.visible = !this.live;
        else n.mesh!.visible = true;
        n.mesh!.castShadow = o.castShadow !== false && mode === 'render';
        n.mesh!.receiveShadow = mode === 'render';
        // Contorno de selección (aristas marcadas).
        const on = sel.has(o.id) && s.mode === 'object';
        if (on && n.outlineSig !== n.sig) {
          n.outline?.geometry.dispose(); n.outline?.removeFromParent();
          n.outline = new T.LineSegments(new T.EdgesGeometry(n.mesh!.geometry, 25), new T.LineBasicMaterial({ color: ORANGE, depthTest: false, transparent: true, opacity: 0.9 }));
          n.outline.renderOrder = 10;
          n.node.add(n.outline); n.outlineSig = n.sig;
        }
        if (n.outline) { n.outline.visible = on; (n.outline.material as T.LineBasicMaterial).color.copy(s.one?.id === o.id ? ACTIVE : ORANGE); }
      }
      if (o.kind === 'light' && o.light) this.syncLight(n, o, t, sel.has(o.id), lit, fxOn ? fx : null);
      // Flecha de dirección de los personajes (al editar).
      if (o.ctrl && this.showHelpers && !this.live) {
        if (!n.arrow) { n.arrow = new T.ArrowHelper(new T.Vector3(1, 0, 0), new T.Vector3(), 1, '#5ad1ff', 0.3, 0.2); n.arrow.userData.helper = true; n.arrow.traverse(x => { x.raycast = () => undefined; }); this.overlay.add(n.arrow); }
        const a = (o.ctrl.dir * Math.PI) / 180;
        n.arrow.setDirection(new T.Vector3(Math.cos(a), 0, -Math.sin(a)));
        n.arrow.setLength(0.8 + o.ctrl.speed * 0.35, 0.3, 0.2);
        n.arrow.visible = o.visible;
      } else if (n.arrow) { n.arrow.removeFromParent(); n.arrow.dispose(); n.arrow = undefined; }
      if (o.kind === 'camera' && o.cam) this.syncCam(n, o, t, sel.has(o.id), sc);
    }
    for (const [id, n] of this.nodes) if (!seen.has(id) && !(this.live && id.includes('~'))) { if (id.includes('~')) n.node.removeFromParent(); else this.disposeNode(n); this.nodes.delete(id); }
    this.root.updateMatrixWorld(true);
    for (const o of sc.objects) { const n = this.nodes.get(o.id); if (n?.arrow) n.arrow.position.setFromMatrixPosition(n.node.matrixWorld).setY(new T.Vector3().setFromMatrixPosition(n.node.matrixWorld).y + 0.05); }
    if (!full) { this.request(); return; }
    for (const n of this.nodes.values()) n.camHelper?.update();
    this.grid.visible = this.showGrid && s.s.grid.show && !this.throughCamera && !this.live;
    this.axes.visible = this.showAxes && s.s.grid.axes && !this.throughCamera && !this.live;
    this.syncEditOverlay();
    this.syncGizmo();
    this.request();
  }

  private pickMesh(n: Node3, geo: () => T.BufferGeometry, color: string, on: boolean) {
    if (!n.pick) { n.pick = new T.Mesh(geo(), new T.MeshBasicMaterial({ color, wireframe: false })); n.pick.userData.oid = n.node.userData.oid; n.pick.userData.helper = true; n.node.add(n.pick); }
    (n.pick.material as T.MeshBasicMaterial).color.set(on ? ORANGE : color);
    n.pick.visible = this.showHelpers && !this.throughCamera && !this.live;
  }
  private syncLight(n: Node3, o: Obj3, t: number, on: boolean, lit: boolean, fx: Fx3 | null = null) {
    const L = o.light!;
    const kind = { dir: T.DirectionalLight, point: T.PointLight, spot: T.SpotLight, amb: T.AmbientLight, hemi: T.HemisphereLight }[L.type];
    if (!(n.light instanceof kind)) {
      n.light?.removeFromParent(); n.light?.dispose();
      n.light = new kind();
      n.node.add(n.light);
      if (n.light instanceof T.DirectionalLight || n.light instanceof T.SpotLight) {
        n.target = new T.Object3D(); n.target.position.set(0, 0, -5); n.node.add(n.target); n.light.target = n.target;
        n.light.shadow.bias = -0.0004; n.light.shadow.normalBias = 0.02;
      }
      if (n.light instanceof T.DirectionalLight) { const c = n.light.shadow.camera; c.left = -15; c.right = 15; c.top = 15; c.bottom = -15; c.near = 0.1; c.far = 80; }
    }
    const l = n.light;
    l.color.set(valueAt(L.color, t));
    l.intensity = valueAt(L.intensity, t) * (lit ? 1 : 0);
    l.visible = lit;
    if (l instanceof T.HemisphereLight) l.groundColor.set(L.ground);
    if (l instanceof T.SpotLight) { l.angle = Math.max(1, Math.min(89, valueAt(L.angle, t))) * D2R; l.penumbra = 0.35; l.distance = L.dist; l.decay = 2; }
    if (l instanceof T.PointLight) { l.distance = L.dist; l.decay = 2; }
    l.castShadow = L.shadow && (fx?.shadows ?? 2) > 0 && (l instanceof T.DirectionalLight || l instanceof T.SpotLight || l instanceof T.PointLight);
    if (l.castShadow && 'shadow' in l) { const size = [512, 1024, 2048, 4096][fx?.shadows ?? 2]; const sh = (l as T.DirectionalLight).shadow; if (sh.mapSize.x !== size) { sh.mapSize.set(size, size); sh.map?.dispose(); sh.map = null as never; } }
    n.baseI = l.intensity; n.baseColor = `#${l.color.getHexString()}`;
    // Cono de luz volumétrica en los focos (efectos activos).
    const wantCone = l instanceof T.SpotLight && !!fx && fx.cones > 0 && lit;
    const len = L.dist > 0 ? L.dist : 9;
    if (wantCone && (!n.cone || n.cone.userData.len !== len || n.cone.userData.angle !== l.angle)) { n.cone?.removeFromParent(); n.cone?.geometry.dispose(); n.cone = volumeCone((l as T.SpotLight).angle / D2R, len); n.cone.userData.len = len; n.cone.userData.angle = l.angle; n.node.add(n.cone); }
    if (n.cone) { n.cone.visible = wantCone; if (wantCone) { const u = (n.cone.material as T.ShaderMaterial).uniforms; u.color.value.copy(l.color); u.strength.value = fx!.cones * Math.min(2, l.intensity / 30); } }
    this.pickMesh(n, () => new T.OctahedronGeometry(0.18), '#ffe27a', on);
    if (n.pick) n.pick.visible = n.pick.visible && !this.live;
  }
  private syncCam(n: Node3, o: Obj3, t: number, on: boolean, sc: Scene3) {
    if (!n.cam) {
      n.cam = new T.PerspectiveCamera(45, 16 / 9, 0.05, 2000);
      n.node.add(n.cam);
      n.camHelper = new T.CameraHelper(n.cam);
      this.overlay.add(n.camHelper);
    }
    const r = this.s.s.render;
    n.cam.fov = Math.max(1, Math.min(170, valueAt(o.cam!.fov, t)));
    n.cam.near = o.cam!.near; n.cam.far = Math.min(o.cam!.far, 6);
    n.cam.aspect = r.w / r.h;
    n.cam.updateProjectionMatrix();
    n.cam.far = o.cam!.far;
    n.camHelper!.visible = this.showHelpers && !this.throughCamera && effVisible(sc, o) && !this.live;
    this.pickMesh(n, () => new T.ConeGeometry(0.22, 0.4, 4).rotateX(-Math.PI / 2).rotateZ(Math.PI / 4), sc.camera === o.id ? '#8fd3ff' : '#9a9aa8', on);
  }

  // ---------------------------------------------------------------- modo edición: puntos, aristas, caras

  private syncEditOverlay() {
    const s = this.s;
    for (const c of [...this.overlay.children]) if (c.userData.edit) { c.removeFromParent(); (c as T.Mesh).geometry?.dispose(); }
    const o = s.one;
    if (s.mode !== 'edit' || !o?.mesh) return;
    const n = this.nodes.get(o.id);
    if (!n) return;
    const m = o.mesh, W = n.node.matrixWorld;
    const vs = s.editVerts(m);
    const pos = new Float32Array(m.v.length);
    for (let i = 0; i < m.v.length; i += 3) { const p = new T.Vector3(m.v[i], m.v[i + 1], m.v[i + 2]).applyMatrix4(W); pos.set([p.x, p.y, p.z], i); }
    const add = (obj: T.Object3D) => { obj.userData.edit = true; obj.renderOrder = 20; this.overlay.add(obj); };
    // Caras elegidas.
    const faces = s.selMode === 'face' ? [...s.ef] : m.f.map((f, i) => (f.every(x => vs.has(x)) ? i : -1)).filter(i => i >= 0);
    if (faces.length) {
      const tri: number[] = [];
      for (const fi of faces) for (const t of M.triFace(m, m.f[fi])) for (const i of t) tri.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(tri, 3));
      add(new T.Mesh(g, new T.MeshBasicMaterial({ color: ORANGE, transparent: true, opacity: 0.35, side: T.DoubleSide, depthTest: true, polygonOffset: true, polygonOffsetFactor: -1 })));
    }
    // Aristas.
    const edges = M.edgeList(m);
    const ep: number[] = [], ec: number[] = [];
    const sel = new T.Color(ORANGE), base = new T.Color('#1a1626');
    for (const [a, b] of edges) {
      const on = s.selMode === 'edge' ? s.ee.has(M.ekey(a, b)) : vs.has(a) && vs.has(b);
      ep.push(pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2], pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]);
      const c = on ? sel : base; ec.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    const eg = new T.BufferGeometry(); eg.setAttribute('position', new T.Float32BufferAttribute(ep, 3)); eg.setAttribute('color', new T.Float32BufferAttribute(ec, 3));
    add(new T.LineSegments(eg, new T.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.9 })));
    // Vértices (en modo vértices).
    if (s.selMode === 'vert') {
      const cols: number[] = [];
      for (let i = 0; i < m.v.length / 3; i++) { const c = vs.has(i) ? sel : new T.Color('#f4f1ff'); cols.push(c.r, c.g, c.b); }
      const pg = new T.BufferGeometry(); pg.setAttribute('position', new T.BufferAttribute(pos, 3)); pg.setAttribute('color', new T.Float32BufferAttribute(cols, 3));
      add(new T.Points(pg, new T.PointsMaterial({ size: 7, sizeAttenuation: false, vertexColors: true, depthTest: false })));
    }
  }

  // ---------------------------------------------------------------- gizmo

  private syncGizmo() {
    const s = this.s;
    const tool = s.tool;
    const gizmoTool = tool === 'move' || tool === 'rotate' || tool === 'scale';
    let show = gizmoTool && !this.throughCamera;
    this.tc.setMode(tool === 'rotate' ? 'rotate' : tool === 'scale' ? 'scale' : 'translate');
    const g = s.s.grid;
    this.tc.setTranslationSnap(s.snap && g.snap ? g.size : null);
    this.tc.setRotationSnap(s.snap && g.snap ? 15 * D2R : null);
    this.tc.setScaleSnap(s.snap && g.snap ? 0.1 : null);
    this.tc.showX = !s.axis || s.axis === 'x'; this.tc.showY = !s.axis || s.axis === 'y'; this.tc.showZ = !s.axis || s.axis === 'z';
    if (!this.gizmoStart) {
      if (s.mode === 'edit') {
        const o = s.one, n = o && this.nodes.get(o.id);
        const vs = o?.mesh ? s.editVerts(o.mesh) : new Set<number>();
        if (!n || !vs.size) show = false;
        else {
          const c = new T.Vector3();
          for (const i of vs) c.add(new T.Vector3(...M.vget(o!.mesh!, i)));
          c.multiplyScalar(1 / vs.size).applyMatrix4(n.node.matrixWorld);
          this.proxy.position.copy(c); this.proxy.quaternion.identity(); this.proxy.scale.set(1, 1, 1);
        }
        this.tc.setSpace('world');
      } else {
        const objs = s.roots().filter(o => !effLocked(s.scene, o));
        const one = s.one;
        if (!objs.length || !one) show = false;
        else {
          const n = this.nodes.get(one.id);
          const W = n ? n.node.matrixWorld : new T.Matrix4();
          const p = new T.Vector3(), q = new T.Quaternion(), sc = new T.Vector3();
          W.decompose(p, q, sc);
          this.proxy.position.copy(p);
          this.proxy.quaternion.copy(tool === 'translate' as never ? new T.Quaternion() : q);
          this.proxy.scale.set(1, 1, 1);
          this.tc.setSpace(tool === 'move' ? 'world' : 'local');
        }
      }
      this.proxy.updateMatrixWorld(true);
    }
    this.tc.enabled = show;
    this.tc.getHelper().visible = show;
    this.request();
  }
  private gizmoDrag(on: boolean) {
    const s = this.s;
    this.controls.enabled = !on;
    if (on) {
      this.proxy.updateMatrixWorld(true);
      const st = { P0: this.proxy.matrixWorld.clone(), W: new Map<string, T.Matrix4>() } as NonNullable<View3D['gizmoStart']>;
      if (s.mode === 'edit' && s.one?.mesh) {
        const o = s.one, n = this.nodes.get(o.id)!;
        const ids = [...s.editVerts(o.mesh!)];
        st.verts = { ids, orig: ids.flatMap(i => M.vget(o.mesh!, i)), N: n.node.matrixWorld.clone() };
      } else for (const o of s.roots()) if (!effLocked(s.scene, o)) st.W.set(o.id, s.worldMatrix(o));
      this.gizmoStart = st;
    } else if (this.gizmoStart) {
      this.gizmoStart = null;
      s.commit(s.mode === 'edit' ? 'Mover vértices' : this.tc.mode === 'rotate' ? 'Rotar' : this.tc.mode === 'scale' ? 'Escalar' : 'Mover');
      this.syncGizmo();
    }
  }
  private gizmoMove() {
    const st = this.gizmoStart, s = this.s;
    if (!st) return;
    this.proxy.updateMatrixWorld(true);
    const D = this.proxy.matrixWorld.clone().multiply(st.P0.clone().invert());
    if (st.verts) {
      const N = st.verts.N, Ni = N.clone().invert();
      s.moveVerts(st.verts.orig, st.verts.ids, Ni.multiply(D).multiply(N));
      return;
    }
    s.live((_st, sc) => { for (const [id, W0] of st.W) { const o = objOf(sc, id); if (o) s.setWorld(o, D.clone().multiply(W0)); } });
  }

  // ---------------------------------------------------------------- elegir con el ratón

  private ndc(e: { clientX: number; clientY: number }) { const r = this.renderer.domElement.getBoundingClientRect(); return new T.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); }
  /** Cámara con la que se ve ahora, con sus matrices al día (elegir con el ratón no espera al dibujo). */
  private viewCam(): T.Camera {
    if (this.throughCamera) { const c = this.sceneCam(); if (c) { c.updateMatrixWorld(true); return c; } }
    if (this.camera === this.ortho) this.updateOrtho();
    this.camera.updateMatrixWorld(true);
    return this.camera;
  }
  private ray(e: { clientX: number; clientY: number }) { const rc = new T.Raycaster(); rc.setFromCamera(this.ndc(e), this.viewCam()); rc.params.Line = { threshold: 0.05 }; return rc; }
  private toScreen(p: T.Vector3) { const r = this.renderer.domElement.getBoundingClientRect(); const v = p.clone().project(this.viewCam()); return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height, z: v.z }; }
  /** Objeto bajo el puntero (mallas y marcadores de luces y cámaras). */
  hitObject(e: { clientX: number; clientY: number }): { o: Obj3; hit: T.Intersection } | null {
    const s = this.s, sc = s.scene;
    const targets: T.Object3D[] = [];
    for (const n of this.nodes.values()) { if (n.mesh && n.node.visible) targets.push(n.mesh); if (n.pick?.visible) targets.push(n.pick); }
    for (const h of this.ray(e).intersectObjects(targets, false)) {
      const id = h.object.userData.oid as string, o = objOf(sc, id);
      if (!o || !effVisible(sc, o) || effLocked(sc, o)) continue;
      return { o, hit: h };
    }
    return null;
  }
  /** Raíz elegible: si el objeto está en un grupo (no carpeta), se elige el grupo. */
  private pickRoot(o: Obj3): Obj3 {
    const sc = this.s.scene;
    let top = o;
    let p = o.parent ? objOf(sc, o.parent) : undefined;
    while (p) { if (!p.folder) top = p; p = p.parent ? objOf(sc, p.parent) : undefined; }
    return top;
  }
  private pickEdit(e: PointerEvent, add: boolean) {
    const s = this.s, o = s.one;
    if (!o?.mesh) return;
    const n = this.nodes.get(o.id)!, m = o.mesh, W = n.node.matrixWorld;
    const scr = (i: number) => this.toScreen(new T.Vector3(...M.vget(m, i)).applyMatrix4(W));
    if (!add) s.clearEdit();
    const toggle = <K>(set: Set<K>, k: K) => { if (add && set.has(k)) set.delete(k); else set.add(k); };
    if (s.selMode === 'face') {
      const h = n.mesh ? this.ray(e).intersectObject(n.mesh, false)[0] : undefined;
      const fo = (n.mesh?.geometry.userData.faceOf as Uint32Array | undefined);
      if (h && h.faceIndex !== undefined && h.faceIndex !== null && fo) toggle(s.ef, fo[h.faceIndex]);
    } else if (s.selMode === 'vert') {
      let best = -1, bd = 14, bz = Infinity;
      for (let i = 0; i < m.v.length / 3; i++) { const p = scr(i); const d = Math.hypot(p.x - e.clientX, p.y - e.clientY); if (d < bd - 2 || (d < bd + 2 && p.z < bz && d < 14)) { bd = Math.min(bd, d); best = i; bz = p.z; } }
      if (best >= 0) toggle(s.ev, best);
    } else {
      let best = '', bd = 10;
      for (const [a, b] of M.edgeList(m)) {
        const A = scr(a), B = scr(b);
        const dx = B.x - A.x, dy = B.y - A.y, L2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((e.clientX - A.x) * dx + (e.clientY - A.y) * dy) / L2));
        const d = Math.hypot(A.x + dx * t - e.clientX, A.y + dy * t - e.clientY);
        if (d < bd) { bd = d; best = M.ekey(a, b); }
      }
      if (best) toggle(s.ee, best);
    }
    s.keysChanged();
  }
  private rectSelect(x0: number, y0: number, x1: number, y1: number, add: boolean) {
    const s = this.s;
    const [ax, bx, ay, by] = [Math.min(x0, x1), Math.max(x0, x1), Math.min(y0, y1), Math.max(y0, y1)];
    const inside = (p: { x: number; y: number; z: number }) => p.x >= ax && p.x <= bx && p.y >= ay && p.y <= by && p.z < 1;
    if (s.mode === 'edit' && s.one?.mesh) {
      const o = s.one, m = o.mesh!, W = this.nodes.get(o.id)!.node.matrixWorld;
      const ins = Array.from({ length: m.v.length / 3 }, (_, i) => inside(this.toScreen(new T.Vector3(...M.vget(m, i)).applyMatrix4(W))));
      if (!add) s.clearEdit();
      if (s.selMode === 'vert') ins.forEach((v, i) => { if (v) s.ev.add(i); });
      else if (s.selMode === 'edge') for (const [a, b] of M.edgeList(m)) { if (ins[a] && ins[b]) s.ee.add(M.ekey(a, b)); }
      else m.f.forEach((f, i) => { if (inside(this.toScreen(new T.Vector3(...M.faceCenter(m, f)).applyMatrix4(W)))) s.ef.add(i); });
      s.keysChanged();
      return;
    }
    const ids = s.scene.objects.filter(o => !o.folder && o.kind !== 'group' && effVisible(s.scene, o) && !effLocked(s.scene, o)).filter(o => {
      const b = s.worldBox(o);
      return !b.isEmpty() && inside(this.toScreen(b.getCenter(new T.Vector3())));
    }).map(o => this.pickRoot(o).id);
    s.select([...new Set(ids)], add);
  }

  // ---------------------------------------------------------------- interacción

  /** Antes que la órbita: decide qué hace el botón izquierdo (navegar, desplazar o herramienta). */
  private navMode(e: PointerEvent) {
    const nav = this.navigate || e.altKey;
    this.controls.mouseButtons.LEFT = nav ? (e.shiftKey ? T.MOUSE.PAN : T.MOUSE.ROTATE) : (-1 as T.MOUSE);
    this.controls.mouseButtons.MIDDLE = e.shiftKey ? T.MOUSE.PAN : T.MOUSE.ROTATE;
    this.controls.enabled = !this.throughCamera || false;
    // Táctil: con Crear, Bloques o Pintar un dedo actúa; si no, gira la vista.
    const t = this.s.tool;
    this.controls.touches.ONE = t === 'create' || t === 'block' || t === 'paint' ? (-1 as T.TOUCH) : T.TOUCH.ROTATE;
    if (this.throughCamera && e.button !== 0) { this.throughCamera = false; this.s.emitView(); this.request(); }
  }
  /** Punto del suelo (y = `y`) bajo el puntero. */
  private ground(e: { clientX: number; clientY: number }, y = 0) { const p = new T.Vector3(); return this.ray(e).ray.intersectPlane(new T.Plane(new T.Vector3(0, 1, 0), -y), p) ? p : null; }
  private snapV(x: number) { const g = this.s.s.grid; return this.s.snap && g.snap ? Math.round(x / g.size) * g.size : x; }

  private down(e: PointerEvent) {
    const s = this.s;
    if (!s.active) return;
    this.renderer.domElement.focus();
    this.downAt = { x: e.clientX, y: e.clientY, button: e.button, moved: false };
    if (e.button !== 0 || this.navigate || e.altKey) return;
    // El gizmo tiene prioridad (TransformControls ya está arrastrando).
    if (this.tc.dragging || (this.tc.enabled && this.tc.axis)) return;
    const cv = this.renderer.domElement;
    cv.setPointerCapture(e.pointerId);
    const add = e.shiftKey || e.ctrlKey || e.metaKey;
    // Crear: el clic que fija la altura termina la forma (lo hace `up`).
    if (s.tool === 'create') { if (this.drag?.kind !== 'create' || this.drag.phase !== 'height') this.createDown(e); return; }
    if (s.tool === 'block') { this.blockClick(e); return; }
    if (s.tool === 'aim') { this.aimAt(e); return; }
    if (s.tool === 'paint') { this.paintDown(e); return; }
    if (s.mode === 'edit') { this.drag = { kind: 'rect', x0: e.clientX, y0: e.clientY, add }; return; }
    const hit = this.hitObject(e);
    // Táctil en vacío: el dedo gira la vista (sin rectángulo); un toque sin mover quita la selección.
    if (!hit) { this.drag = e.pointerType === 'touch' ? { kind: 'rect', x0: -1e6, y0: -1e6, add } : { kind: 'rect', x0: e.clientX, y0: e.clientY, add }; return; }
    const o = this.pickRoot(hit.o);
    if (!s.sel.includes(o.id) || add) s.select([o.id], add);
    this.onPick();
    // Mover arrastrando el objeto (sobre un plano horizontal), con la herramienta Mover.
    if (s.tool === 'move' && !add && s.sel.includes(o.id)) {
      const start = hit.hit.point.clone();
      const base = new Map<string, T.Matrix4>();
      for (const r of s.roots()) if (!effLocked(s.scene, r)) base.set(r.id, s.worldMatrix(r));
      this.drag = { kind: 'move', plane: new T.Plane(new T.Vector3(0, 1, 0), -start.y), start, base };
    }
  }
  private move(e: PointerEvent) {
    const s = this.s, d = this.drag;
    if (this.downAt && Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) > 4) this.downAt.moved = true;
    if (!d) { if (s.tool === 'block') this.blockHover(e); else if (s.tool === 'create') this.createHover(e); return; }
    if (d.kind === 'rect') {
      if (!this.downAt?.moved || d.x0 < -1e5) return;
      const r = this.el.getBoundingClientRect();
      Object.assign(this.rectEl.style, { left: `${Math.min(d.x0, e.clientX) - r.left}px`, top: `${Math.min(d.y0, e.clientY) - r.top}px`, width: `${Math.abs(e.clientX - d.x0)}px`, height: `${Math.abs(e.clientY - d.y0)}px` });
      this.rectEl.hidden = false;
      return;
    }
    if (d.kind === 'move') {
      if (!this.downAt?.moved) return;
      const p = new T.Vector3();
      if (!this.ray(e).ray.intersectPlane(d.plane, p)) return;
      let dx = p.x - d.start.x, dz = p.z - d.start.z;
      if (s.axis === 'x') dz = 0; if (s.axis === 'z') dx = 0;
      if (s.axis === 'y') return;
      dx = this.snapV(dx); dz = this.snapV(dz);
      s.live((_st, sc) => { for (const [id, W0] of d.base) { const o = objOf(sc, id); if (o) s.setWorld(o, new T.Matrix4().makeTranslation(dx, 0, dz).multiply(W0)); } });
      return;
    }
    if (d.kind === 'create') { this.createMove(e, d); return; }
    if (d.kind === 'paint') { this.paintMove(e, d); return; }
  }
  private up(e: PointerEvent) {
    const s = this.s, d = this.drag;
    const da = this.downAt;
    this.downAt = null;
    // Clic derecho sin arrastrar: menú contextual.
    if (da && da.button === 2 && !da.moved) { this.onContext(e.clientX, e.clientY); return; }
    if (!d) return;
    if (d.kind === 'create') { this.createUp(e, d); return; }
    this.drag = null;
    if (d.kind === 'rect') {
      this.rectEl.hidden = true;
      if (da?.moved) { if (d.x0 > -1e5) this.rectSelect(d.x0, d.y0, e.clientX, e.clientY, d.add); }
      else if (s.mode === 'edit') this.pickEdit(e, d.add);
      else if (!d.add) s.select([]);
    } else if (d.kind === 'move') { if (da?.moved) s.commit('Mover'); }
    else if (d.kind === 'paint') this.paintUp(d);
  }
  private dbl(e: MouseEvent) {
    const s = this.s;
    if (s.tool !== 'select' && s.tool !== 'move' && s.tool !== 'rotate' && s.tool !== 'scale') return;
    const hit = this.hitObject(e);
    // Doble clic: entrar en el grupo (elegir la pieza) o pasar a modo edición.
    if (hit && s.mode === 'object') { if (hit.o.id !== this.pickRoot(hit.o).id) s.select([hit.o.id]); else if (hit.o.mesh) s.enterEdit(); }
    else if (!hit && s.mode === 'edit') s.exitEdit();
  }

  // ---------------------------------------------------------------- crear arrastrando

  private createHover(e: PointerEvent) {
    const p = this.surface(e);
    this.ghost.visible = !!p;
    if (p) { this.ghost.scale.set(0.2, 0.2, 0.2); this.ghost.position.set(this.snapV(p.x), p.y + 0.1, this.snapV(p.z)); }
    this.request();
  }
  /** Punto donde crear: encima de lo que haya bajo el puntero o en el suelo. */
  private surface(e: { clientX: number; clientY: number }): T.Vector3 | null {
    const h = this.hitObject(e);
    if (h && h.hit.face) { const n = h.hit.face.normal.clone().transformDirection(h.hit.object.matrixWorld); if (n.y > 0.7) return h.hit.point.clone(); }
    return this.ground(e);
  }
  private createDown(e: PointerEvent) {
    const p = this.surface(e);
    if (!p) return;
    const v = new T.Vector3(this.snapV(p.x), p.y, this.snapV(p.z));
    this.drag = { kind: 'create', p0: v, p1: v.clone(), phase: 'base', y0: e.clientY, h: 0, y: p.y };
  }
  private createMove(e: PointerEvent, d: Extract<View3D['drag'], { kind: 'create' }>) {
    if (d.phase === 'base') {
      const p = this.ground(e, d.y);
      if (!p) return;
      d.p1.set(this.snapV(p.x), d.y, this.snapV(p.z));
    } else {
      // Altura: el desplazamiento vertical del puntero (en unidades de la escena a esa distancia).
      const dist = this.camera.position.distanceTo(d.p0);
      d.h = Math.max(0.05, this.snapV(((d.y0 - e.clientY) / this.el.clientHeight) * dist * 1.2));
    }
    const w = Math.max(0.05, Math.abs(d.p1.x - d.p0.x)), dd = Math.max(0.05, Math.abs(d.p1.z - d.p0.z));
    const h = d.phase === 'height' ? d.h : 0.05;
    this.ghost.visible = true;
    this.ghost.scale.set(w, h, dd);
    this.ghost.position.set((d.p0.x + d.p1.x) / 2, d.y + h / 2, (d.p0.z + d.p1.z) / 2);
    this.request();
  }
  private createUp(e: PointerEvent, d: Extract<View3D['drag'], { kind: 'create' }>) {
    const s = this.s, cp = s.createPrim;
    const w = Math.abs(d.p1.x - d.p0.x), dd = Math.abs(d.p1.z - d.p0.z);
    const small = w < 0.1 && dd < 0.1;
    const cx = (d.p0.x + d.p1.x) / 2, cz = (d.p0.z + d.p1.z) / 2;
    if (typeof cp === 'object') {
      // Generadores: la pared se dibuja arrastrando (largo y dirección); el resto se coloca con un clic.
      this.drag = null; this.ghost.visible = false;
      if (cp.gen === 'wall' && !small) {
        const len = Math.hypot(d.p1.x - d.p0.x, d.p1.z - d.p0.z);
        const o = s.addGen('wall', [cx, d.y, cz], { length: round(len) });
        if (o) s.edit('Orientar pared', (_st, sc) => { const x = objOf(sc, o.id)!; x.tf.ry.v = round(-Math.atan2(d.p1.z - d.p0.z, d.p1.x - d.p0.x) / D2R); });
      } else s.addGen(cp.gen, [small ? d.p0.x : cx, d.y, small ? d.p0.z : cz], small ? undefined : genSize(cp.gen, w, dd));
      s.setTool('move');
      return;
    }
    if (small && d.phase === 'base') {
      // Un clic: medidas por defecto (se cambian después en el panel).
      this.drag = null; this.ghost.visible = false;
      s.addPrim(cp, [d.p0.x, d.y, d.p0.z]);
      s.setTool('move');
      return;
    }
    if (d.phase === 'base' && cp !== 'plane') { d.phase = 'height'; d.y0 = e.clientY; d.h = Math.max(w, dd) * 0.5; this.renderer.domElement.setPointerCapture(e.pointerId); toast('Mueve el puntero arriba o abajo para la altura y haz clic'); return; }
    this.drag = null; this.ghost.visible = false;
    s.addPrim(cp, [cx, d.y, cz], primFromBox(cp, Math.max(0.05, w), Math.max(0.05, d.h), Math.max(0.05, dd)));
    s.setTool('move');
  }

  /** Apuntar: la dirección de los personajes elegidos hacia el punto del suelo que se pulsa. */
  private aimAt(e: PointerEvent) {
    const s = this.s, g = this.ground(e);
    const chars = s.selected.filter(o => o.ctrl);
    if (!g) return;
    if (!chars.length) { toast('Elige un personaje (con «Personaje» activado en Objeto → Física y control).'); return; }
    s.edit('Dirección del personaje', (_st, sc) => {
      for (const c of chars) {
        const o = objOf(sc, c.id)!;
        const p = new T.Vector3().setFromMatrixPosition(s.worldMatrix(o));
        o.ctrl!.dir = round((Math.atan2(-(g.z - p.z), g.x - p.x) * 180) / Math.PI);
      }
    });
  }

  // ---------------------------------------------------------------- construir con bloques

  private blockTarget(e: { clientX: number; clientY: number }): { pos: T.Vector3; hit: Obj3 | null } | null {
    const s = this.s, size = s.block.size;
    const h = this.hitObject(e);
    const snap = (x: number) => Math.round(x / size) * size;
    if (h && h.hit.face) {
      const n = h.hit.face.normal.clone().transformDirection(h.hit.object.matrixWorld).round();
      const p = h.hit.point.clone().addScaledVector(n, size / 2);
      return { pos: new T.Vector3(snap(p.x - size / 2) + size / 2 * 0 + (Math.abs(n.x) ? 0 : 0), 0, 0).set(snap((p.x) - size / 2) + size / 2, snap(p.y - size / 2) + size / 2, snap(p.z - size / 2) + size / 2), hit: h.o };
    }
    const g = this.ground(e);
    return g ? { pos: new T.Vector3(snap(g.x - size / 2) + size / 2, size / 2, snap(g.z - size / 2) + size / 2), hit: null } : null;
  }
  private blockHover(e: PointerEvent) {
    const t = this.blockTarget(e), size = this.s.block.size;
    this.ghost.visible = !!t;
    if (t) { this.ghost.scale.set(size, size, size); this.ghost.position.copy(t.pos); (this.ghost.material as T.MeshBasicMaterial).color.set(e.shiftKey ? '#ff4d6d' : '#9d8cff'); }
    this.request();
  }
  /** Clic: pone un bloque pegado a la cara de debajo; Mayús + clic: quita el bloque. */
  private blockClick(e: PointerEvent) {
    const s = this.s;
    if (e.shiftKey) {
      const h = this.hitObject(e);
      if (h && h.o.name.startsWith('Bloque')) { s.select([h.o.id]); s.remove(); }
      return;
    }
    const t = this.blockTarget(e);
    if (!t) return;
    const size = s.block.size, prim: PrimType = s.block.prim;
    const p: Record<string, number> = prim === 'sphere' ? { r: size / 2, seg: 20, rings: 10 } : prim === 'cylinder' || prim === 'cone' ? { r: size / 2, h: size, seg: 20 } : prim === 'pyramid' ? { w: size * Math.SQRT2 * 0.71, h: size, d: size * Math.SQRT2 * 0.71, sides: 4 } : { w: size, h: size, d: size };
    const o = s.addPrim(prim, [t.pos.x, t.pos.y - size / 2, t.pos.z], p);
    if (o) {
      s.edit('Bloque', (st, sc) => { const x = objOf(sc, o.id)!; x.name = x.name.replace(/^[^\d]+/, 'Bloque ').replace(/^Bloque $/, 'Bloque'); if (s.block.mat) x.mats = [s.block.mat]; void st; });
      s.select([]);
    }
  }

  // ---------------------------------------------------------------- pintar sobre el modelo

  private paintHit(e: { clientX: number; clientY: number }) {
    const h = this.hitObject(e);
    if (!h || !h.hit.uv || h.o.kind !== 'mesh') return null;
    const mesh = h.hit.object as T.Mesh;
    const g = mesh.geometry, fi = h.hit.faceIndex ?? 0;
    const grp = g.groups.find(x => fi * 3 >= x.start && fi * 3 < x.start + x.count);
    const slot = grp?.materialIndex ?? 0;
    const matId = h.o.mats?.[slot] ?? h.o.mats?.[0];
    return matId ? { o: h.o, matId, uv: h.hit.uv } : null;
  }
  private paintDown(e: PointerEvent) {
    const s = this.s, hit = this.paintHit(e);
    if (!hit) { toast('Pinta sobre un objeto.'); return; }
    const m = s.mat(hit.matId)!;
    let texId = m.tex, canvas = texId ? this.tex.canvas(texId) : null;
    if (texId && !canvas) { toast('La textura aún se está cargando.'); return; }
    if (!texId) {
      // Sin textura: un lienzo del color del material (o el dibujo procedimental) para pintar encima.
      canvas = document.createElement('canvas'); canvas.width = canvas.height = 1024;
      const g = canvas.getContext('2d')!;
      g.fillStyle = valueAt(m.color, s.time); g.fillRect(0, 0, 1024, 1024);
      if (m.proc) { const img = this.tex.procedural(m.proc).image as HTMLCanvasElement; g.globalCompositeOperation = 'multiply'; g.drawImage(img, 0, 0, 1024, 1024); g.globalCompositeOperation = 'source-over'; }
      texId = `paint-${hit.matId}`;
      this.tex.put(texId, canvas);
      // Mientras se pinta se usa el lienzo nuevo como textura (en todos los objetos con ese material).
      const tx = this.tex.put(texId, canvas);
      for (const [k, mt] of this.mats) if (k.includes(`|${hit.matId}|`)) { const mm = mt as T.MeshStandardMaterial; mm.map = tx; mm.color.set('#ffffff'); mm.needsUpdate = true; }
    }
    this.drag = { kind: 'paint', mat: hit.matId, texId, canvas: canvas!, last: null };
    this.paintAt(hit.uv, this.drag);
  }
  private paintMove(e: PointerEvent, d: Extract<View3D['drag'], { kind: 'paint' }>) { const hit = this.paintHit(e); if (hit && hit.matId === d.mat) this.paintAt(hit.uv, d); }
  private paintAt(uv: T.Vector2, d: Extract<View3D['drag'], { kind: 'paint' }>) {
    const c = d.canvas, g = c.getContext('2d')!, s = this.s;
    const m = s.mat(d.mat);
    const k = m?.texScale ?? 1;
    const fr = (x: number) => x - Math.floor(x);
    const p = new T.Vector2(fr(uv.x * k) * c.width, (1 - fr(uv.y * k)) * c.height);
    g.globalAlpha = s.paint.opacity;
    g.strokeStyle = g.fillStyle = s.paint.color;
    g.lineCap = 'round'; g.lineWidth = s.paint.size;
    if (d.last && d.last.distanceTo(p) < c.width / 3) { g.beginPath(); g.moveTo(d.last.x, d.last.y); g.lineTo(p.x, p.y); g.stroke(); }
    else { g.beginPath(); g.arc(p.x, p.y, s.paint.size / 2, 0, Math.PI * 2); g.fill(); }
    g.globalAlpha = 1;
    d.last = p;
    for (const mt of this.mats.values()) { const mm = mt as T.MeshStandardMaterial; if (mm.map && (mm.map as T.CanvasTexture).image === c) mm.map.needsUpdate = true; }
    this.request();
  }
  private paintUp(d: Extract<View3D['drag'], { kind: 'paint' }>) {
    const s = this.s, m = s.mat(d.mat);
    if (!m) return;
    const src = canvasToUrl(d.canvas);
    const id = m.tex ? s.replaceTexture(d.mat, src, 'Pintar') : s.setTexture(d.mat, src, 'Pintura');
    if (id) this.tex.alias(d.texId, id);
  }

  // ---------------------------------------------------------------- render final

  /**
   * Render de la escena con su cámara activa (o la vista si no tiene) a `w` × `h`:
   * sombras y antialiasing según la calidad; fondo transparente opcional.
   */
  renderImage(w: number, h: number, o: { quality?: 1 | 2 | 3; shadows?: 0 | 1 | 2 | 3; transparent?: boolean; time?: number; useView?: boolean } = {}): HTMLCanvasElement {
    const s = this.s, prev = s.prefs.shading;
    const q = o.quality ?? 2, sh = o.shadows ?? 2;
    const max = Math.min(this.renderer.capabilities.maxTextureSize, 8192);
    const k = Math.min(q === 3 ? 2 : q === 2 ? 1.5 : 1, max / Math.max(w, h));
    const W = Math.max(1, Math.round(w * k)), H = Math.max(1, Math.round(h * k));
    const t0 = s.time;
    if (o.time !== undefined) s.s.time = o.time;
    s.prefs.shading = 'render';
    const hide: T.Object3D[] = [this.grid, this.axes, this.overlay, this.tc.getHelper(), this.ghost];
    const vis = hide.map(x => x.visible);
    this.mats.clear();
    this.sync();
    for (const x of hide) x.visible = false;
    for (const n of this.nodes.values()) { if (n.pick) n.pick.visible = false; if (n.outline) n.outline.visible = false; }
    const size = [512, 1024, 2048, 4096][sh];
    for (const n of this.nodes.values()) if (n.light && 'shadow' in n.light && (n.light as T.DirectionalLight).shadow) { const l = n.light as T.DirectionalLight; l.castShadow = l.castShadow && sh > 0; l.shadow.mapSize.set(size, size); l.shadow.map?.dispose(); l.shadow.map = null as never; }
    if (o.transparent) this.scene.background = null;
    let cam: T.Camera | null = o.useView ? null : this.sceneCamFor(W / H);
    if (!cam) { const c = this.persp.clone(); c.aspect = W / H; c.updateProjectionMatrix(); cam = c; }
    const rt = new T.WebGLRenderTarget(W, H, { samples: 4, colorSpace: T.SRGBColorSpace, type: T.UnsignedByteType });
    this.renderer.setRenderTarget(rt);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear();
    this.renderer.render(this.scene, cam);
    const px = new Uint8Array(W * H * 4);
    this.renderer.readRenderTargetPixels(rt, 0, 0, W, H, px);
    this.renderer.setRenderTarget(null);
    rt.dispose();
    // Volver como estaba.
    s.prefs.shading = prev;
    s.s.time = t0;
    hide.forEach((x, i) => { x.visible = vis[i]; });
    this.mats.clear();
    this.sync();
    // Píxeles (de abajo arriba) → lienzo; reducir si se renderizó más grande (antialiasing).
    const big = document.createElement('canvas'); big.width = W; big.height = H;
    const img = new ImageData(W, H);
    for (let y = 0; y < H; y++) img.data.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
    big.getContext('2d')!.putImageData(img, 0, 0);
    if (W === w && H === h) return big;
    const out = document.createElement('canvas'); out.width = w; out.height = h;
    const g = out.getContext('2d')!; g.imageSmoothingQuality = 'high'; g.drawImage(big, 0, 0, w, h);
    return out;
  }
  private sceneCamFor(aspect: number): T.PerspectiveCamera | null {
    const id = this.s.scene.camera, n = id ? this.nodes.get(id) : null;
    if (!n?.cam) return null;
    n.cam.aspect = aspect; n.cam.updateProjectionMatrix();
    n.node.updateMatrixWorld(true);
    return n.cam;
  }
  /** Para el modo En vivo: rayo desde el puntero y punto del suelo. */
  rayAt(e: { clientX: number; clientY: number }) { return this.ray(e); }
  groundAt(e: { clientX: number; clientY: number }, y = 0) { return this.ground(e, y); }
  get liveCamera(): T.Camera { return this.viewCam(); }
  nodeOf(id: string) { return this.nodes.get(id) ?? null; }
  /** Copia creada en vivo (se mueve con la física y desaparece al parar). */
  registerExtra(id: string, node: T.Object3D) { const mesh = node.children.find(c => (c as T.Mesh).isMesh) as T.Mesh | undefined; this.nodes.set(id, { node: node as T.Group, mesh }); }
  /** Vuelve a dibujar todo como dice el proyecto (al salir del modo En vivo). */
  resetLive() { this.live = null; this.liveInput = null; this.mats.clear(); this.sync(); }
  /** Objeto de Three de un objeto del modelo (exportar). */
  threeOf(id: string) { return this.nodes.get(id)?.node ?? null; }
  get rootNode() { return this.root; }
  /** Material de Three ya preparado (exportar a glTF/OBJ con sus colores y texturas). */
  exportMaterial(m: Mat3): T.MeshStandardMaterial {
    const prev = this.s.prefs.shading;
    this.s.prefs.shading = 'material';
    const mm = (this.material(m.id, 1) as T.MeshStandardMaterial).clone();
    this.s.prefs.shading = prev;
    mm.name = m.name;
    return mm;
  }
  dispose() { this.clear(); this.tex.dispose(); this.renderer.dispose(); }
}

/** Medidas de una primitiva a partir de la caja dibujada (ancho, alto, fondo). */
function primFromBox(t: PrimType, w: number, h: number, d: number): Record<string, number> {
  const r = Math.max(w, d) / 2;
  switch (t) {
    case 'box': return { w: round(w), h: round(h), d: round(d) };
    case 'sphere': return { r: round(Math.max(r, h / 2)), seg: 32, rings: 16 };
    case 'cylinder': case 'cone': return { r: round(r), h: round(h), seg: 32 };
    case 'torus': return { R: round(r * 0.72), r: round(Math.max(0.02, r * 0.28)), seg: 36, tube: 16 };
    case 'plane': return { w: round(w), d: round(d), div: 1 };
    case 'capsule': return { r: round(r), h: round(Math.max(h, r * 2)), seg: 24 };
    case 'pyramid': return { w: round(w * Math.SQRT2 * 0.71), h: round(h), d: round(d * Math.SQRT2 * 0.71), sides: 4 };
  }
}
/** Tamaño de un generador a partir del rectángulo dibujado. */
function genSize(t: string, w: number, d: number): Record<string, number> | undefined {
  switch (t) {
    case 'stairs': return { width: round(Math.max(0.3, w)), depth: round(Math.max(0.3, d)) };
    case 'furniture': return { w: round(Math.max(0.3, w)), d: round(Math.max(0.3, d)) };
    case 'terrain': return { size: round(Math.max(1, w, d)) };
    case 'roof': return { w: round(Math.max(0.5, w)), d: round(Math.max(0.5, d)) };
    default: return undefined;
  }
}
export { sceneOf };

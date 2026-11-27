import * as T from 'three';
import type { Particles3, PartStyle, PartType } from '../model';
import { celRamp } from '../toon';
import type { FluidCollider } from './fluid';
import { partShapes, partSprite } from './partShapes';

/**
 * Partículas del modo En vivo: chispas, fogonazo de arma, explosión, brasas,
 * fuego, humo, órganos, huesos, trozos de carne, escombros, confeti, monedas,
 * estrellas, hojas, burbujas y magia.
 *
 * Cada tipo es una o varias capas (el fogonazo es un destello, chispas y una
 * bocanada de humo). Cada capa se dibuja con mallas instanciadas (una por forma
 * variante), así cientos de partículas cuestan unas pocas llamadas de dibujo. La
 * forma de serie se puede cambiar por cualquier objeto o modelo importado de la
 * escena o por una imagen. Los emisores con luz llevan una luz dinámica que sigue
 * a sus partículas (el fogonazo ilumina la escena un instante).
 */

type Blend = 'add' | 'alpha' | 'solid';
interface LayerSpec {
  shape: PartType | 'flash' | 'quad'; sprite?: 'soft' | 'flash' | 'twinkle' | 'smoke';
  bill?: boolean; stretch?: number; blend: Blend;
  /** Por disparo (tipos de ráfaga fija, como el fogonazo) o fracción del caudal. */
  fixed?: number; share?: number;
  sizeK?: number; lifeK?: number; speedK?: number; spreadK?: number; grav?: number; drag?: number;
  /** Tamaño al morir (× el inicial). */
  grow?: number;
  colors?: [string, string]; palette?: string[];
  flicker?: boolean; orient?: 'dir';
  /** Choca aunque el emisor no choque (escombros de una explosión). */
  collide?: boolean;
  /** Atenúa lo aditivo (fuego y explosión: que no se quemen a blanco al juntarse). */
  dim?: number;
  /** La capa principal: la que cambia por el objeto o la imagen elegidos. */
  main?: boolean;
}
const SMOKE: LayerSpec = { shape: 'quad', sprite: 'smoke', bill: true, blend: 'alpha', sizeK: 0.9, lifeK: 15, speedK: 0.12, grow: 3, colors: ['#b4aeac', '#4a4648'], grav: -0.05, drag: 2 };
const SPEC: Record<PartType, LayerSpec[]> = {
  sparks: [{ shape: 'sparks', stretch: 0.09, blend: 'add', main: true }],
  muzzle: [
    { shape: 'flash', sprite: 'flash', blend: 'add', fixed: 1, orient: 'dir', speedK: 0, grow: 1.35, main: true },
    { shape: 'sparks', stretch: 0.06, blend: 'add', fixed: 9, sizeK: 0.1, lifeK: 4, speedK: 1, spreadK: 2.8, grav: 1, drag: 0.4, colors: ['#fff3b0', '#ff4a00'] },
    { ...SMOKE, fixed: 3 },
  ],
  explosion: [
    { shape: 'quad', sprite: 'soft', bill: true, blend: 'add', share: 0.45, grow: 2, flicker: true, main: true, dim: 0.3 },
    { shape: 'sparks', stretch: 0.07, blend: 'add', share: 0.3, sizeK: 0.12, lifeK: 1.3, speedK: 1.7, grav: 1, drag: 0.3, colors: ['#fff3b0', '#ff5a00'] },
    { ...SMOKE, share: 0.17, sizeK: 0.8, lifeK: 3, speedK: 0.45, grow: 2.2 },
    { shape: 'debris', blend: 'solid', share: 0.08, sizeK: 0.3, lifeK: 8, speedK: 1.1, grav: 1, drag: 0.05, collide: true, colors: ['#ffffff', '#ffffff'] },
  ],
  embers: [{ shape: 'embers', blend: 'add', flicker: true, main: true }],
  fire: [{ shape: 'quad', sprite: 'soft', bill: true, blend: 'add', grow: 0.35, flicker: true, main: true, dim: 0.7 }],
  smoke: [{ shape: 'quad', sprite: 'smoke', bill: true, blend: 'alpha', grow: 3, main: true }],
  organs: [{ shape: 'organs', blend: 'solid', main: true }],
  bones: [{ shape: 'bones', blend: 'solid', main: true }],
  gibs: [{ shape: 'gibs', blend: 'solid', main: true }],
  debris: [{ shape: 'debris', blend: 'solid', main: true }],
  confetti: [{ shape: 'confetti', blend: 'solid', palette: ['#ff4d6d', '#ffd23f', '#3ad1ff', '#6bff8a', '#b46bff', '#ff8a3a'], main: true }],
  coins: [{ shape: 'coins', blend: 'solid', main: true }],
  stars: [{ shape: 'stars', blend: 'solid', main: true }],
  leaves: [{ shape: 'leaves', blend: 'solid', main: true }],
  bubbles: [{ shape: 'bubbles', blend: 'alpha', main: true }],
  magic: [{ shape: 'quad', sprite: 'twinkle', bill: true, blend: 'add', flicker: true, main: true }],
  casings: [{ shape: 'casings', blend: 'solid', main: true }],
  custom: [{ shape: 'custom', blend: 'solid', main: true }],
};
/** Tipos que se disparan de golpe (cada ráfaga es un disparo completo). */
export const isShot = (t: PartType) => SPEC[t].some(l => l.fixed);

const QUAL = { low: 300, medium: 800, high: 1600 } as const;
const MAX_LIGHTS = 6;
const AXES: Record<string, readonly [number, number, number]> = { up: [0, 1, 0], down: [0, -1, 0], front: [0, 0, 1], back: [0, 0, -1], left: [-1, 0, 0], right: [1, 0, 0] };
const SOLIDISH = new Set<PartType>(['organs', 'bones', 'gibs', 'debris', 'coins', 'casings']);

/** Una pieza dibujable de la forma: geometría (radio 1), material y su posición dentro de la forma. */
export interface ShapePart { geo: T.BufferGeometry; mat: T.Material | T.Material[]; M: T.Matrix4 }
interface Draw { mesh: T.InstancedMesh; outline: T.InstancedMesh | null; fade: T.InstancedBufferAttribute | null; M: T.Matrix4 | null; count: number }
interface Layer { spec: LayerSpec; variants: Draw[][]; custom: boolean; c1: T.Color; c2: T.Color; pal: T.Color[] | null }
interface Emitter { id: string; cfg: Particles3; W: T.Matrix4; on: boolean; align: boolean; acc: number; layers: Layer[]; cap: number; alive: number; light: T.PointLight | null; flash: number; lx: number; ly: number; lz: number; group: T.Group }

/** Añade la transparencia por instancia (aFade) a un material. */
function withFade(m: T.Material) {
  m.onBeforeCompile = sh => {
    sh.vertexShader = 'attribute float aFade;\nvarying float vFade;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vFade = aFade;');
    sh.fragmentShader = 'varying float vFade;\n' + sh.fragmentShader.replace('#include <dithering_fragment>', '#include <dithering_fragment>\n  gl_FragColor.a *= vFade;');
  };
  m.customProgramCacheKey = () => 'yosa-pfade';
  return m;
}
/** Material de una capa según el estilo (las formas de serie traen colores por vértice). */
function layerMat(spec: LayerSpec, style: PartStyle, type: PartType, glow: number, map: T.Texture | null): { mat: T.Material; outline: T.Material | null } {
  const side = type === 'confetti' || type === 'leaves' || spec.shape === 'flash' || spec.bill ? T.DoubleSide : T.FrontSide;
  if (spec.blend === 'add') {
    const m = new T.MeshBasicMaterial({ vertexColors: true, map, transparent: true, blending: T.AdditiveBlending, depthWrite: false, side });
    m.toneMapped = false;
    return { mat: m, outline: null };
  }
  if (spec.blend === 'alpha') {
    const m = type === 'bubbles' && style === 'real'
      ? new T.MeshPhysicalMaterial({ vertexColors: true, transparent: true, opacity: 0.4, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.02, depthWrite: false })
      : style === 'real' ? new T.MeshLambertMaterial({ vertexColors: true, map, transparent: true, depthWrite: false, side }) : new T.MeshBasicMaterial({ vertexColors: true, map, transparent: true, depthWrite: false, side });
    return { mat: withFade(m), outline: null };
  }
  const wet = type === 'organs' || type === 'gibs';
  switch (style) {
    case 'cel': return { mat: new T.MeshToonMaterial({ vertexColors: true, map, gradientMap: celRamp(3, 0.05), side, alphaTest: map ? 0.4 : 0 }), outline: null };
    case 'cartoon': return { mat: new T.MeshToonMaterial({ vertexColors: true, map, gradientMap: celRamp(2, 0), side, alphaTest: map ? 0.4 : 0 }), outline: map || side === T.DoubleSide ? null : new T.MeshBasicMaterial({ color: '#120a10', side: T.BackSide }) };
    case 'flat': return { mat: new T.MeshBasicMaterial({ vertexColors: true, map, side, alphaTest: map ? 0.4 : 0 }), outline: null };
    case 'neon': { const m = new T.MeshBasicMaterial({ vertexColors: true, map, side, alphaTest: map ? 0.4 : 0 }); m.toneMapped = false; return { mat: m, outline: null }; }
    default: return {
      mat: new T.MeshPhysicalMaterial({ vertexColors: true, map, side, alphaTest: map ? 0.4 : 0, roughness: type === 'coins' || type === 'casings' ? 0.28 : wet ? 0.32 : 0.7, metalness: type === 'coins' || type === 'casings' ? 0.9 : 0, clearcoat: wet ? 0.7 : 0, clearcoatRoughness: 0.15, emissive: glow > 0 ? new T.Color('#ffffff') : new T.Color('#000000'), emissiveIntensity: glow * 0.25 }),
      outline: null,
    };
  }
}

export class ParticleSystem {
  readonly root = new T.Group();
  private emits: Emitter[] = [];
  private max: number;
  private n = 0;
  // Partículas (estructura de arreglos: sin objetos por partícula).
  private px: Float32Array; private py: Float32Array; private pz: Float32Array;
  private vx: Float32Array; private vy: Float32Array; private vz: Float32Array;
  private qx: Float32Array; private qy: Float32Array; private qz: Float32Array; private qw: Float32Array;
  private wx: Float32Array; private wy: Float32Array; private wz: Float32Array;
  private ang: Float32Array; private angV: Float32Array;
  private life: Float32Array; private life0: Float32Array; private size: Float32Array; private seed: Float32Array;
  private em: Int16Array; private ly: Int8Array; private vr: Int8Array; private rest: Uint8Array; private hit: Uint8Array; private seen: Uint8Array;
  private _m = new T.Matrix4(); private _q = new T.Quaternion(); private _q2 = new T.Quaternion(); private _v = new T.Vector3(); private _s = new T.Vector3(); private _p = new T.Vector3(); private _c = new T.Color(); private _c2 = new T.Color(); private _e = new T.Euler();
  private lights = 0;
  /** Sangrado (lo atiende el modo en vivo con el líquido sangre). */
  onBleed: ((x: number, y: number, z: number, n: number, style: PartStyle) => void) | null = null;

  constructor(private quality: keyof typeof QUAL, private ground: boolean, total: number) {
    this.max = Math.max(64, Math.min(12000, total));
    const f = () => new Float32Array(this.max);
    this.px = f(); this.py = f(); this.pz = f(); this.vx = f(); this.vy = f(); this.vz = f();
    this.qx = f(); this.qy = f(); this.qz = f(); this.qw = f(); this.wx = f(); this.wy = f(); this.wz = f();
    this.ang = f(); this.angV = f(); this.life = f(); this.life0 = f(); this.size = f(); this.seed = f();
    this.em = new Int16Array(this.max); this.ly = new Int8Array(this.max); this.vr = new Int8Array(this.max); this.rest = new Uint8Array(this.max); this.hit = new Uint8Array(this.max); this.seen = new Uint8Array(this.max);
    this.root.name = 'partículas';
  }
  static capFor(quality: keyof typeof QUAL) { return QUAL[quality] ?? QUAL.medium; }
  get count() { return this.n; }
  /** Luces dinámicas en uso (para las pruebas). */
  get lightCount() { return this.lights; }
  lightOf(id: string) { return this.emits.find(e => e.id === id)?.light ?? null; }

  /**
   * Añade un emisor. `shape` es la forma elegida por el usuario (un objeto o modelo
   * de la escena, ya en piezas) o una imagen; sin ella, la forma de serie.
   */
  addEmitter(id: string, cfg: Particles3, W: T.Matrix4, on: boolean, custom: { parts?: ShapePart[]; tex?: T.Texture | null; align?: boolean }) {
    const cap = ParticleSystem.capFor(this.quality);
    const group = new T.Group();
    const mk = (geo: T.BufferGeometry, mat: T.Material | T.Material[], fade: boolean): { mesh: T.InstancedMesh; fade: T.InstancedBufferAttribute | null } => {
      const g = fade ? geo.clone() : geo;
      const fa = fade ? new T.InstancedBufferAttribute(new Float32Array(cap), 1) : null;
      if (fa) { fa.setUsage(T.DynamicDrawUsage); g.setAttribute('aFade', fa); }
      const m = new T.InstancedMesh(g, mat, cap);
      m.instanceMatrix.setUsage(T.DynamicDrawUsage); m.count = 0; m.frustumCulled = false; m.userData.noOcclude = true; m.raycast = () => undefined;
      m.userData.ownGeo = fade;
      m.castShadow = cfg.style === 'real' && !fade && (SOLIDISH.has(cfg.type) || !!custom.parts);
      m.receiveShadow = false;
      // Color por instancia (tinte, degradado y desvanecido de lo aditivo).
      m.instanceColor = new T.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3); m.instanceColor.setUsage(T.DynamicDrawUsage);
      group.add(m);
      return { mesh: m, fade: fa };
    };
    // Colores ya convertidos (no se lee el texto «#rrggbb» por partícula y fotograma).
    const cols = (sp: LayerSpec) => ({ c1: new T.Color(sp.colors?.[0] ?? cfg.color), c2: new T.Color(sp.colors?.[1] ?? cfg.color2), pal: sp.palette ? sp.palette.map(x => new T.Color(x)) : null });
    const layers: Layer[] = SPEC[cfg.type].map(spec => {
      const useObj = spec.main && cfg.shape === 'object' && custom.parts?.length;
      const useTex = spec.main && cfg.shape === 'texture' && custom.tex !== undefined;
      if (useObj) {
        // El objeto elegido: cada pieza con su propio material (texturas incluidas).
        const v: Draw[] = custom.parts!.map(p => { const { mesh, fade } = mk(p.geo, p.mat, false); return { mesh, outline: null, fade, M: p.M, count: 0 }; });
        return { spec, variants: [v], custom: true, ...cols(spec) };
      }
      const s2: LayerSpec = useTex ? { ...spec, shape: 'quad', bill: true, sprite: undefined } : spec;
      const map = useTex ? custom.tex ?? partSprite('soft') : s2.sprite ? partSprite(s2.sprite) : null;
      const geos = partShapes(s2.shape, cfg.caliber ?? '9mm');
      const variants = geos.map(geo => {
        const { mat, outline } = layerMat(s2, cfg.style, cfg.type, cfg.glow, map);
        if (useTex && s2.blend !== 'add') { (mat as T.MeshBasicMaterial).alphaTest = 0.35; (mat as T.MeshBasicMaterial).transparent = s2.blend === 'alpha'; }
        const { mesh, fade } = mk(geo, mat, s2.blend === 'alpha');
        let ol: T.InstancedMesh | null = null;
        if (outline) { ol = mk(geo, outline, false).mesh; ol.castShadow = false; ol.instanceColor = null; }
        return [{ mesh, outline: ol, fade, M: null, count: 0 }];
      });
      return { spec: s2, variants: variants.map(v => v[0]).map(d => [d]), custom: !!useTex, ...cols(s2) };
    });
    let light: T.PointLight | null = null;
    if (cfg.light > 0 && this.lights < MAX_LIGHTS) {
      light = new T.PointLight(cfg.lightColor, 0, cfg.lightRange, 2);
      light.castShadow = false; light.userData.dynamic = true;
      this.root.add(light); this.lights++;
    }
    this.root.add(group);
    const p = new T.Vector3().setFromMatrixPosition(W);
    this.emits.push({ id, cfg, W: W.clone(), on, align: !!custom.align, acc: 0, layers, cap, alive: 0, light, flash: 0, lx: p.x, ly: p.y, lz: p.z, group });
  }
  /** La imagen de un emisor terminó de cargarse: se pone en lugar de la provisional. */
  setTexture(id: string, tex: T.Texture) {
    const e = this.emits[this.indexOf(id)]; if (!e) return;
    for (const l of e.layers) if (l.custom && l.spec.main) for (const v of l.variants) for (const d of v) for (const m of ([] as T.Material[]).concat(d.mesh.material)) { (m as T.MeshBasicMaterial).map = tex; m.needsUpdate = true; }
  }
  setWorld(i: number, W: T.Matrix4) { this.emits[i]?.W.copy(W); }
  /** Coloca un emisor por su id (armas: boca, ventana de expulsión, impactos). */
  place(id: string, W: T.Matrix4) { const i = this.indexOf(id); if (i >= 0) this.emits[i].W.copy(W); }
  indexOf(id: string) { return this.emits.findIndex(e => e.id === id); }
  setOn(id: string, on: boolean) { const e = this.emits[this.indexOf(id)]; if (e) e.on = on; }
  /** Ráfaga: `count` partículas (en los tipos de disparo, `count` disparos, como mucho 8). */
  burst(id: string, count: number) {
    const i = this.indexOf(id); if (i < 0) return;
    const e = this.emits[i];
    if (isShot(e.cfg.type)) { for (let k = 0; k < Math.max(1, Math.min(8, Math.round(count))); k++) this.shot(i); return; }
    for (let k = 0; k < count; k++) this.spawn(i, this.pickLayer(e));
    e.flash = 1;
  }
  private shot(i: number) {
    const e = this.emits[i];
    e.layers.forEach((l, li) => { for (let k = 0; k < (l.spec.fixed ?? 0); k++) this.spawn(i, li); });
    e.flash = 1;
  }
  private pickLayer(e: Emitter) {
    const L = e.layers;
    if (L.length === 1) return 0;
    let r = Math.random(), tot = 0;
    for (const l of L) tot += l.spec.share ?? 0;
    r *= tot || 1;
    for (let i = 0; i < L.length; i++) { r -= L[i].spec.share ?? 0; if (r <= 0) return i; }
    return 0;
  }
  private spawn(i: number, li: number) {
    if (this.n >= this.max) return;
    const e = this.emits[i], c = e.cfg, sp = e.layers[li].spec;
    if (e.alive >= e.cap) return;
    const W = e.W, o = this._p.setFromMatrixPosition(W);
    const ax = AXES[c.dir] ?? AXES.up;
    const d = this._v.set(ax[0], ax[1], ax[2]).transformDirection(W);
    const a = Math.min(Math.PI, (c.spread * (sp.spreadK ?? 1) * Math.PI) / 180);
    const th = Math.random() * Math.PI * 2, ph = Math.acos(1 - Math.random() * (1 - Math.cos(a)));
    // Dirección: el eje del emisor abierto en cono (base perpendicular sin crear vectores).
    let t1x: number, t1y: number, t1z: number;
    if (Math.abs(d.y) < 0.9) { t1x = d.z; t1y = 0; t1z = -d.x; } else { t1x = 0; t1y = -d.z; t1z = d.y; }
    const tl = Math.hypot(t1x, t1y, t1z) || 1; t1x /= tl; t1y /= tl; t1z /= tl;
    const t2x = d.y * t1z - d.z * t1y, t2y = d.z * t1x - d.x * t1z, t2z = d.x * t1y - d.y * t1x;
    const cp = Math.cos(ph), sph = Math.sin(ph), ct = Math.cos(th), st = Math.sin(th);
    const dx = d.x * cp + (t1x * ct + t2x * st) * sph, dy = d.y * cp + (t1y * ct + t2y * st) * sph, dz = d.z * cp + (t1z * ct + t2z * st) * sph;
    const speed = c.speed * (sp.speedK ?? 1) * (0.7 + Math.random() * 0.6);
    const k = this.n++;
    e.alive++;
    this.px[k] = o.x; this.py[k] = o.y; this.pz[k] = o.z;
    this.vx[k] = dx * speed; this.vy[k] = dy * speed; this.vz[k] = dz * speed;
    // Orientación inicial y giro.
    if (e.align) this._q.setFromRotationMatrix(this._m.extractRotation(W));
    else if (sp.orient === 'dir') { this._q.setFromUnitVectors(this._s.set(0, 0, 1), d).multiply(this._q2.setFromAxisAngle(this._s.set(0, 0, 1), Math.random() * Math.PI)); }
    else this._q.setFromEuler(this._e.set(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28));
    this.qx[k] = this._q.x; this.qy[k] = this._q.y; this.qz[k] = this._q.z; this.qw[k] = this._q.w;
    const spin = c.spin * (0.5 + Math.random());
    this.wx[k] = (Math.random() - 0.5) * spin; this.wy[k] = (Math.random() - 0.5) * spin; this.wz[k] = (Math.random() - 0.5) * spin;
    this.ang[k] = Math.random() * 6.28; this.angV[k] = (Math.random() - 0.5) * c.spin;
    const life = Math.max(0.02, c.life * (sp.lifeK ?? 1) * (0.75 + Math.random() * 0.5));
    this.life[k] = life; this.life0[k] = life;
    this.size[k] = Math.max(0.002, c.size * (sp.sizeK ?? 1) * (1 + (Math.random() * 2 - 1) * c.sizeVar));
    this.seed[k] = Math.random();
    this.em[k] = i; this.ly[k] = li;
    this.vr[k] = Math.floor(Math.random() * e.layers[li].variants.length);
    this.rest[k] = 0; this.hit[k] = 0; this.seen[k] = 0;
  }
  private kill(k: number) {
    this.emits[this.em[k]] && this.emits[this.em[k]].alive--;
    const j = --this.n;
    if (k === j) return;
    const A = [this.px, this.py, this.pz, this.vx, this.vy, this.vz, this.qx, this.qy, this.qz, this.qw, this.wx, this.wy, this.wz, this.ang, this.angV, this.life, this.life0, this.size, this.seed];
    for (const a of A) a[k] = a[j];
    this.em[k] = this.em[j]; this.ly[k] = this.ly[j]; this.vr[k] = this.vr[j]; this.rest[k] = this.rest[j]; this.hit[k] = this.hit[j]; this.seen[k] = this.seen[j];
  }

  step(dt: number, gravity: number, cols: FluidCollider[], cam: T.Camera) {
    if (dt <= 0) return;
    // Emisión continua (en los tipos de disparo, `rate` son disparos por segundo: fuego automático).
    for (let i = 0; i < this.emits.length; i++) {
      const e = this.emits[i];
      if (!e.on || e.cfg.rate <= 0) continue;
      e.acc += e.cfg.rate * dt;
      const shot = isShot(e.cfg.type);
      while (e.acc >= 1) { e.acc -= 1; if (shot) this.shot(i); else this.spawn(i, this.pickLayer(e)); }
    }
    // Subpasos: con pocos fps la física sigue al tiempo real sin volverse inestable.
    const sub = Math.max(1, Math.min(4, Math.ceil(dt / (1 / 60))));
    const h = dt / sub;
    for (let si = 0; si < sub; si++) this.physics(h, gravity, cols);
    // Sangrado al volar (un hilo de gotas).
    if (this.onBleed) for (let k = 0; k < this.n; k++) {
      const c = this.emits[this.em[k]].cfg;
      if (c.bleed > 0 && !this.rest[k] && Math.random() < c.bleed * dt * 6) this.onBleed(this.px[k], this.py[k], this.pz[k], 1, c.style);
    }
    this.lightsStep(dt);
    this.draw(cam);
  }
  private physics(h: number, gravity: number, cols: FluidCollider[]) {
    const px = this.px, py = this.py, pz = this.pz, vx = this.vx, vy = this.vy, vz = this.vz;
    for (let k = 0; k < this.n; k++) {
      const e = this.emits[this.em[k]]; if (!e) { this.kill(k); k--; continue; }
      const c = e.cfg, sp = e.layers[this.ly[k]].spec;
      this.life[k] -= h;
      // Toda partícula se ve al menos un fotograma (el destello del fogonazo con pocos fps).
      if (this.life[k] <= 0 && !this.seen[k]) this.life[k] = this.life0[k] * 0.4;
      else if (this.life[k] <= 0 || py[k] < -40) { this.kill(k); k--; continue; }
      if (this.rest[k]) continue;
      const g = (sp.grav ?? c.gravity) * gravity, dr = Math.max(0, 1 - (sp.drag ?? c.drag) * h);
      vy[k] -= g * h; vx[k] *= dr; vy[k] *= dr; vz[k] *= dr;
      // Las hojas y el confeti planean (se mecen de lado al caer).
      if (c.type === 'leaves' || c.type === 'confetti') { const w = Math.sin((this.life[k] + this.seed[k] * 9) * 3.2); vx[k] += w * 1.4 * h; vz[k] += Math.cos((this.life[k] + this.seed[k] * 7) * 2.6) * 1.1 * h; }
      px[k] += vx[k] * h; py[k] += vy[k] * h; pz[k] += vz[k] * h;
      // Giro.
      const wl = Math.hypot(this.wx[k], this.wy[k], this.wz[k]);
      if (wl > 1e-4) {
        this._q2.setFromAxisAngle(this._s.set(this.wx[k] / wl, this.wy[k] / wl, this.wz[k] / wl), wl * h);
        this._q.set(this.qx[k], this.qy[k], this.qz[k], this.qw[k]).premultiply(this._q2);
        this.qx[k] = this._q.x; this.qy[k] = this._q.y; this.qz[k] = this._q.z; this.qw[k] = this._q.w;
      }
      this.ang[k] += this.angV[k] * h;
      // Choques: suelo y objetos con física.
      if (!(c.collide || sp.collide)) continue;
      const r = this.size[k] * (SOLIDISH.has(c.type) ? 0.7 : 0.5);
      let hit = false, nx = 0, ny = 1, nz = 0;
      if (this.ground && py[k] < r) { py[k] = r; hit = true; nx = 0; ny = 1; nz = 0; }
      for (const C of cols) {
        if (C.skip === e.id) continue;
        if (C.kind === 'sphere') {
          const ex = px[k] - C.pos.x, ey = py[k] - C.pos.y, ez = pz[k] - C.pos.z, L = Math.hypot(ex, ey, ez), R = C.radius + r;
          if (L < R && L > 1e-6) { nx = ex / L; ny = ey / L; nz = ez / L; px[k] = C.pos.x + nx * R; py[k] = C.pos.y + ny * R; pz[k] = C.pos.z + nz * R; hit = true; }
        } else {
          const lp = this._v.set(px[k] - C.pos.x, py[k] - C.pos.y, pz[k] - C.pos.z).applyQuaternion(this._q2.copy(C.quat).invert());
          const hx = C.half.x + r, hy = C.half.y + r, hz = C.half.z + r;
          if (Math.abs(lp.x) < hx && Math.abs(lp.y) < hy && Math.abs(lp.z) < hz) {
            const ox = hx - Math.abs(lp.x), oy = hy - Math.abs(lp.y), oz = hz - Math.abs(lp.z);
            const n = this._s.set(0, 0, 0);
            if (ox < oy && ox < oz) { lp.x = Math.sign(lp.x) * hx; n.x = Math.sign(lp.x); } else if (oy < oz) { lp.y = Math.sign(lp.y) * hy; n.y = Math.sign(lp.y); } else { lp.z = Math.sign(lp.z) * hz; n.z = Math.sign(lp.z); }
            lp.applyQuaternion(C.quat); n.applyQuaternion(C.quat);
            px[k] = C.pos.x + lp.x; py[k] = C.pos.y + lp.y; pz[k] = C.pos.z + lp.z; nx = n.x; ny = n.y; nz = n.z; hit = true;
          }
        }
      }
      if (!hit) continue;
      const vn = vx[k] * nx + vy[k] * ny + vz[k] * nz;
      const speed = Math.hypot(vx[k], vy[k], vz[k]);
      if (vn < 0) { const b = 1 + c.bounce; vx[k] -= vn * nx * b; vy[k] -= vn * ny * b; vz[k] -= vn * nz * b; }
      const fr = Math.max(0, 1 - 9 * h); vx[k] *= fr; vz[k] *= fr; if (ny < 0.5) vy[k] *= fr;
      this.wx[k] *= 0.8; this.wy[k] *= 0.8; this.wz[k] *= 0.8;
      // Sangra al chocar fuerte (la primera vez, más).
      if (c.bleed > 0 && this.onBleed && speed > 1.5) { this.onBleed(px[k], py[k], pz[k], Math.round((this.hit[k] ? 3 : 10) * c.bleed), c.style); }
      this.hit[k] = 1;
      // Quieto en el suelo: deja de simularse (hasta que muere).
      if (c.stay && ny > 0.6 && speed < 0.35) { this.rest[k] = 1; vx[k] = vy[k] = vz[k] = 0; }
    }
  }
  /** Luces dinámicas: destello de cada ráfaga y luz continua que sigue a las partículas. */
  private lightsStep(dt: number) {
    for (let i = 0; i < this.emits.length; i++) {
      const e = this.emits[i], L = e.light;
      if (!L) continue;
      const c = e.cfg, shot = isShot(c.type);
      // Centro de las partículas vivas (o el emisor).
      let sx = 0, sy = 0, sz = 0, n = 0;
      if (!shot) for (let k = 0; k < this.n; k++) if (this.em[k] === i && !this.rest[k]) { sx += this.px[k]; sy += this.py[k]; sz += this.pz[k]; n++; }
      const p = this._p.setFromMatrixPosition(e.W);
      const ax = AXES[c.dir] ?? AXES.up, d = this._v.set(ax[0], ax[1], ax[2]).transformDirection(e.W);
      const tx = n ? sx / n : p.x + d.x * c.size, ty = n ? sy / n : p.y + d.y * c.size, tz = n ? sz / n : p.z + d.z * c.size;
      const k = Math.min(1, dt * 12);
      e.lx += (tx - e.lx) * k; e.ly += (ty - e.ly) * k; e.lz += (tz - e.lz) * k;
      if (shot) { e.lx = tx; e.ly = ty; e.lz = tz; }
      L.position.set(e.lx, e.ly, e.lz);
      // Fogonazo: un destello muy corto; explosión: se apaga en un segundo; el resto, según cuántas haya.
      const decay = c.type === 'muzzle' ? 26 : c.type === 'explosion' ? 2.2 : 6;
      const flash = e.flash;
      e.flash *= Math.exp(-dt * decay);
      const steady = shot || c.type === 'explosion' ? 0 : Math.min(1, e.alive / Math.max(4, c.rate * c.life * 0.4 + c.burst * 0.2));
      const flick = c.type === 'muzzle' ? 1 : 0.82 + 0.18 * Math.sin(performance.now() * 0.023 + i) * Math.sin(performance.now() * 0.011);
      L.intensity = c.light * Math.max(flash, steady * flick) * 3;
      L.distance = c.lightRange;
      L.visible = L.intensity > 0.01;
    }
  }
  private draw(cam: T.Camera) {
    for (const e of this.emits) for (const l of e.layers) for (const v of l.variants) for (const d of v) d.count = 0;
    const M = this._m, q = this._q, sc = this._s, p = this._p, col = this._c, c2 = this._c2;
    const camQ = cam.quaternion;
    for (let k = 0; k < this.n; k++) {
      const e = this.emits[this.em[k]], L = e.layers[this.ly[k]], sp = L.spec, cfg = e.cfg;
      this.seen[k] = 1;
      const u = Math.min(1, 1 - this.life[k] / this.life0[k]); // 0 al nacer → 1 al morir
      let s = this.size[k] * (1 + ((sp.grow ?? 1) - 1) * u);
      // Lo sólido se encoge al final si se desvanece; lo demás se apaga.
      if (sp.blend === 'solid' && cfg.fade && u > 0.8) s *= Math.max(0, (1 - u) / 0.2);
      if (sp.blend === 'solid' && cfg.stay && u > 0.92) s *= Math.max(0, (1 - u) / 0.08);
      const fl = sp.flicker ? 0.75 + 0.25 * Math.sin((this.life[k] + this.seed[k] * 20) * 40) : 1;
      // Color: degradado del color 1 al 2 (o la paleta del confeti), tinte de la forma.
      if (L.pal && !L.custom) col.copy(L.pal[Math.floor(this.seed[k] * L.pal.length)]);
      else col.copy(L.c1).lerp(L.c2, u);
      let alpha = 1;
      if (sp.blend === 'add') { const fade = cfg.fade ? (sp.shape === 'flash' ? 1 - u * u * u : 1 - u * u) : 1; const gl = Math.max(0.6, cfg.glow) * (sp.dim ?? 1); col.multiplyScalar(gl * fade * fl); if (u < 0.08 && sp.shape !== 'flash') col.multiplyScalar(u / 0.08 + 0.3); }
      else if (sp.blend === 'alpha') { alpha = (cfg.fade ? Math.min(1, (1 - u) * 1.6) : 1) * Math.min(1, u * 8 + 0.15) * (sp.fixed ? 0.55 : 0.8); }
      else if (cfg.glow > 0 && cfg.style === 'neon') col.multiplyScalar(1 + cfg.glow);
      // Orientación.
      if (sp.bill) q.copy(camQ).multiply(this._q2.setFromAxisAngle(this._v.set(0, 0, 1), this.ang[k]));
      else if (sp.stretch) {
        const vl = Math.hypot(this.vx[k], this.vy[k], this.vz[k]);
        if (vl > 1e-3) q.setFromUnitVectors(this._v.set(0, 1, 0), sc.set(this.vx[k] / vl, this.vy[k] / vl, this.vz[k] / vl)); else q.set(this.qx[k], this.qy[k], this.qz[k], this.qw[k]);
      } else q.set(this.qx[k], this.qy[k], this.qz[k], this.qw[k]);
      p.set(this.px[k], this.py[k], this.pz[k]);
      const stretchY = sp.stretch ? 1 + Math.min(6, Math.hypot(this.vx[k], this.vy[k], this.vz[k]) * sp.stretch) : 1;
      for (const d of L.variants[this.vr[k]] ?? L.variants[0]) {
        const i = d.count++;
        if (sp.stretch) M.compose(p, q, sc.set(s, s * stretchY, s)); else M.compose(p, q, sc.set(s, s, s));
        if (d.M) M.multiply(d.M);
        d.mesh.setMatrixAt(i, M);
        if (d.mesh.instanceColor) { if (L.custom && sp.blend === 'solid') d.mesh.setColorAt(i, c2.setRGB(1, 1, 1)); else d.mesh.setColorAt(i, col); }
        if (d.fade) d.fade.setX(i, alpha);
        if (d.outline) { M.compose(p, q, sc.set(s * 1.1, s * 1.1, s * 1.1)); d.outline.setMatrixAt(i, M); }
      }
    }
    for (const e of this.emits) for (const l of e.layers) for (const v of l.variants) for (const d of v) {
      for (const m of [d.mesh, d.outline]) if (m) { m.count = d.count; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; m.visible = d.count > 0; }
      if (d.fade) d.fade.needsUpdate = true;
    }
  }
  dispose() {
    this.root.removeFromParent();
    for (const e of this.emits) {
      e.group.traverse(o => { if (o instanceof T.InstancedMesh) { for (const m of ([] as T.Material[]).concat(o.material)) m.dispose(); if (o.userData.ownGeo) o.geometry.dispose(); o.dispose(); } });
      e.light?.dispose();
    }
    this.emits = [];
  }
}

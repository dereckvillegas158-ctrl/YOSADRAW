import * as T from 'three';
import type { Fluid3, LiquidStyle, LiquidType } from '../model';
import { celRamp } from '../toon';

/**
 * Líquidos del modo En vivo (sangre, agua, lava, slime, pintura, tinta).
 *
 * Partículas ligeras en tiempo real: gravedad, viscosidad (las gotas cercanas
 * igualan su velocidad), cohesión (se atraen un poco y se separan si se pisan),
 * choques con el suelo y con los objetos con física, y manchas donde caen. La
 * vecindad se busca con una rejilla hash (sin pares innecesarios) y todo se dibuja
 * con mallas instanciadas: una llamada de dibujo por emisor y estilo, sin crear
 * objetos por gota. Los estilos cambian sólo los materiales (realista, cel shading,
 * caricatura con contorno, tinta de manga, neón que brilla).
 */

/** Algo con lo que chocan las gotas (esfera o caja orientada). */
export interface FluidCollider { kind: 'sphere' | 'box'; pos: T.Vector3; quat: T.Quaternion; half: T.Vector3; radius: number; still: boolean; skip?: string }
interface Emit { id: string; cfg: Fluid3; W: T.Matrix4; on: boolean; acc: number; mesh: StyleMeshes; t0: number }
interface StyleMeshes { drops: T.InstancedMesh; outline: T.InstancedMesh | null; shine: T.InstancedMesh | null; stains: T.InstancedMesh; stainLine: T.InstancedMesh | null; group: T.Group }

const QUAL = { low: 700, medium: 1600, high: 3200 } as const;
const MAX_STAINS = 700;
const STAIN_FADE: Record<LiquidType, number> = { blood: 0, water: 5, lava: 0, slime: 12, paint: 0, ink: 0 };

const drop = new T.IcosahedronGeometry(1, 1);
const disc = new T.CircleGeometry(1, 18).rotateX(-Math.PI / 2);

/** Materiales de un estilo (la gota, su contorno, el brillo y la mancha). */
function styleMats(style: LiquidStyle, liquid: LiquidType, color: string) {
  const c = new T.Color(color);
  const dark = c.clone().multiplyScalar(0.35);
  const glow = liquid === 'lava' ? 1.4 : 0;
  switch (style) {
    case 'cel': {
      const m = new T.MeshToonMaterial({ color: c, gradientMap: celRamp(3, 0.05) });
      return { drop: m, outline: new T.MeshBasicMaterial({ color: '#0d0810', side: T.BackSide }), out: 1.18, shine: null, stain: new T.MeshToonMaterial({ color: c.clone().multiplyScalar(0.8), gradientMap: celRamp(2, 0) }), stainLine: new T.MeshBasicMaterial({ color: '#0d0810' }) };
    }
    case 'cartoon': {
      // Caricatura: color plano y saturado, contorno grueso oscuro y un brillo blanco.
      return { drop: new T.MeshBasicMaterial({ color: c }), outline: new T.MeshBasicMaterial({ color: dark, side: T.BackSide }), out: 1.38, shine: new T.MeshBasicMaterial({ color: '#ffffff' }), stain: new T.MeshBasicMaterial({ color: c.clone().multiplyScalar(0.85) }), stainLine: new T.MeshBasicMaterial({ color: dark }) };
    }
    case 'ink': {
      const ink = c.clone().lerp(new T.Color('#000000'), 0.55);
      return { drop: new T.MeshBasicMaterial({ color: ink }), outline: new T.MeshBasicMaterial({ color: '#000000', side: T.BackSide }), out: 1.12, shine: new T.MeshBasicMaterial({ color: '#ffffff' }), stain: new T.MeshBasicMaterial({ color: ink }), stainLine: null };
    }
    case 'neon': {
      const g = c.clone().multiplyScalar(2.2);
      const m = new T.MeshBasicMaterial({ color: g }); m.toneMapped = false;
      const st = new T.MeshBasicMaterial({ color: c.clone().multiplyScalar(liquid === 'lava' ? 0.5 : 0.9), transparent: true, opacity: 0.85 }); st.toneMapped = false;
      return { drop: m, outline: null, out: 1, shine: null, stain: st, stainLine: null };
    }
    default: {
      // Realista: brillante y algo translúcido (el agua), oscura al secarse (la sangre).
      const water = liquid === 'water';
      // (sin «transmission»: obligaría a dibujar la escena dos veces)
      // (la sangre, más oscura y con un brillo húmedo suave; el agua, clara y transparente)
      const blood = liquid === 'blood', base = blood ? c.clone().multiplyScalar(0.62) : c;
      const m = new T.MeshPhysicalMaterial({ color: base, roughness: water ? 0.05 : blood ? 0.3 : 0.2, metalness: 0, clearcoat: blood ? 0.55 : 1, clearcoatRoughness: blood ? 0.18 : 0.08, envMapIntensity: blood ? 0.5 : 1, transparent: water, opacity: water ? 0.7 : 1, emissive: c, emissiveIntensity: glow });
      const st = new T.MeshPhysicalMaterial({ color: liquid === 'blood' ? c.clone().multiplyScalar(0.55) : c, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.05, transparent: water, opacity: water ? 0.5 : 1, emissive: c, emissiveIntensity: glow * 0.4, polygonOffset: true, polygonOffsetFactor: -2 });
      return { drop: m, outline: null, out: 1, shine: null, stain: st, stainLine: null };
    }
  }
}

export class FluidSystem {
  readonly root = new T.Group();
  private max: number;
  // Gotas (estructura de arrays para ir rápido).
  private n = 0;
  private px: Float32Array; private py: Float32Array; private pz: Float32Array;
  private vx: Float32Array; private vy: Float32Array; private vz: Float32Array;
  private r: Float32Array; private life: Float32Array; private em: Int16Array;
  /** Contacto con una superficie: su normal, cuánto queda del contacto y cuánto lleva quieta. */
  private cnx: Float32Array; private cny: Float32Array; private cnz: Float32Array; private ct: Float32Array; private rest: Float32Array;
  // Manchas (anillo circular).
  private sN = 0; private sHead = 0;
  private sx = new Float32Array(MAX_STAINS); private sy = new Float32Array(MAX_STAINS); private sz = new Float32Array(MAX_STAINS);
  private snx = new Float32Array(MAX_STAINS); private sny = new Float32Array(MAX_STAINS); private snz = new Float32Array(MAX_STAINS);
  private sr = new Float32Array(MAX_STAINS); private sMax = new Float32Array(MAX_STAINS); private sAge = new Float32Array(MAX_STAINS); private sem = new Int16Array(MAX_STAINS);
  private emits: Emit[] = [];
  private grid = new Map<number, number[]>();
  private _m = new T.Matrix4(); private _q = new T.Quaternion(); private _v = new T.Vector3(); private _s = new T.Vector3(); private _p = new T.Vector3();
  private static readonly Y = new T.Vector3(0, 1, 0);
  /** Gotas vivas (para el contador y las pruebas). */
  get count() { return this.n; }
  get stains() { return this.sN; }

  constructor(quality: keyof typeof QUAL, private ground: boolean) {
    this.max = QUAL[quality] ?? QUAL.medium;
    const f = () => new Float32Array(this.max);
    this.px = f(); this.py = f(); this.pz = f(); this.vx = f(); this.vy = f(); this.vz = f(); this.r = f(); this.life = f();
    this.cnx = f(); this.cny = f(); this.cnz = f(); this.ct = f(); this.rest = f();
    this.em = new Int16Array(this.max);
    this.root.name = 'Líquidos';
  }
  /** Añade un emisor (un objeto con líquido). */
  addEmitter(id: string, cfg: Fluid3, W: T.Matrix4, on: boolean, time: number) {
    const mats = styleMats(cfg.style, cfg.liquid, cfg.color);
    const cap = this.max;
    const mk = (geo: T.BufferGeometry, mat: T.Material, n: number) => { const m = new T.InstancedMesh(geo, mat, n); m.instanceMatrix.setUsage(T.DynamicDrawUsage); m.count = 0; m.frustumCulled = false; m.userData.noOcclude = true; m.raycast = () => undefined; return m; };
    const group = new T.Group();
    const drops = mk(drop, mats.drop, cap); drops.castShadow = cfg.style === 'real';
    const outline = mats.outline ? mk(drop, mats.outline, cap) : null;
    const shine = mats.shine ? mk(drop, mats.shine, cap) : null;
    const stains = mk(disc, mats.stain, MAX_STAINS); stains.receiveShadow = true;
    const stainLine = mats.stainLine ? mk(disc, mats.stainLine, MAX_STAINS) : null;
    if (outline) outline.userData.out = mats.out;
    for (const m of [stainLine, stains, outline, drops, shine]) if (m) group.add(m);
    this.root.add(group);
    this.emits.push({ id, cfg, W: W.clone(), on, acc: 0, mesh: { drops, outline, shine, stains, stainLine, group }, t0: time });
    return this.emits.length - 1;
  }
  setWorld(i: number, W: T.Matrix4) { this.emits[i]?.W.copy(W); }
  indexOf(id: string) { return this.emits.findIndex(e => e.id === id); }
  setOn(id: string, on: boolean) { const e = this.emits[this.indexOf(id)]; if (e) e.on = on; }
  /** Chorro: `count` gotas de golpe desde el emisor. */
  burst(id: string, count: number) { const i = this.indexOf(id); if (i >= 0) for (let k = 0; k < count; k++) this.spawn(i, 1.25); }

  private spawn(i: number, speedK = 1) {
    if (this.n >= this.max) return;
    const e = this.emits[i], c = e.cfg;
    const W = e.W;
    const o = this._p.setFromMatrixPosition(W);
    // Dirección del eje elegido del objeto, abierta en cono.
    const ax = { up: [0, 1, 0], down: [0, -1, 0], front: [0, 0, 1], back: [0, 0, -1], left: [-1, 0, 0], right: [1, 0, 0] }[c.dir] as [number, number, number];
    const d = this._v.set(ax[0], ax[1], ax[2]).transformDirection(W);
    const a = (c.spread * Math.PI) / 180;
    const th = Math.random() * Math.PI * 2, ph = Math.acos(1 - Math.random() * (1 - Math.cos(a)));
    // Base perpendicular a d.
    const t1 = Math.abs(d.y) < 0.9 ? new T.Vector3(0, 1, 0).cross(d).normalize() : new T.Vector3(1, 0, 0).cross(d).normalize();
    const t2 = d.clone().cross(t1);
    const dir = d.clone().multiplyScalar(Math.cos(ph)).addScaledVector(t1, Math.sin(ph) * Math.cos(th)).addScaledVector(t2, Math.sin(ph) * Math.sin(th));
    const sp = c.speed * speedK * (0.75 + Math.random() * 0.5);
    const k = this.n++;
    const rr = c.size * (0.6 + Math.random() * 0.8);
    this.px[k] = o.x + dir.x * rr; this.py[k] = o.y + dir.y * rr; this.pz[k] = o.z + dir.z * rr;
    this.vx[k] = dir.x * sp; this.vy[k] = dir.y * sp; this.vz[k] = dir.z * sp;
    this.r[k] = rr; this.life[k] = 6 + Math.random() * 3; this.em[k] = i;
    this.ct[k] = 0; this.rest[k] = 0;
  }
  private kill(k: number) {
    const j = --this.n;
    if (k === j) return;
    this.px[k] = this.px[j]; this.py[k] = this.py[j]; this.pz[k] = this.pz[j];
    this.vx[k] = this.vx[j]; this.vy[k] = this.vy[j]; this.vz[k] = this.vz[j];
    this.r[k] = this.r[j]; this.life[k] = this.life[j]; this.em[k] = this.em[j];
    this.cnx[k] = this.cnx[j]; this.cny[k] = this.cny[j]; this.cnz[k] = this.cnz[j]; this.ct[k] = this.ct[j]; this.rest[k] = this.rest[j];
  }
  private stain(k: number, nx: number, ny: number, nz: number) {
    const i = this.sHead;
    this.sHead = (this.sHead + 1) % MAX_STAINS;
    this.sN = Math.min(MAX_STAINS, this.sN + 1);
    this.sx[i] = this.px[k]; this.sy[i] = this.py[k] - this.r[k] * ny * 0.9; this.sz[i] = this.pz[k];
    this.snx[i] = nx; this.sny[i] = ny; this.snz[i] = nz;
    const sp = Math.hypot(this.vx[k], this.vy[k], this.vz[k]);
    this.sr[i] = this.r[k] * 0.8; this.sMax[i] = this.r[k] * (1.6 + Math.min(2.2, sp * 0.35)) * (0.8 + Math.random() * 0.5);
    this.sAge[i] = 0; this.sem[i] = this.em[k];
  }

  /** Avanza la simulación (en pasos pequeños) y dibuja. */
  step(dt: number, time: number, gravity: number, colliders: FluidCollider[]) {
    if (dt <= 0) return;
    // Emisión continua (la sangre late como un corazón).
    this.emits.forEach((e, i) => {
      if (!e.on || e.cfg.rate <= 0) return;
      let rate = e.cfg.rate;
      if (e.cfg.pulse) { const ph = ((time - e.t0) * 1.25) % 1; rate *= ph < 0.18 ? 2.6 : ph < 0.32 ? 1.2 : 0.15; }
      e.acc += rate * dt;
      while (e.acc >= 1) { e.acc -= 1; this.spawn(i, e.cfg.pulse && ((time - e.t0) * 1.25) % 1 < 0.18 ? 1.25 : 1); }
    });
    const sub = Math.max(1, Math.min(3, Math.ceil(dt / (1 / 90))));
    const h = Math.min(dt, 1 / 20) / sub;
    for (let s = 0; s < sub; s++) this.sub(h, gravity, colliders);
    // Manchas: se extienden un poco y algunas se secan (el agua).
    for (let i = 0; i < this.sN; i++) { this.sAge[i] += dt; if (this.sr[i] < this.sMax[i]) this.sr[i] = Math.min(this.sMax[i], this.sr[i] + dt * this.sMax[i] * 1.4); }
    this.draw();
  }
  private sub(h: number, g: number, cols: FluidCollider[]) {
    const n = this.n, px = this.px, py = this.py, pz = this.pz, vx = this.vx, vy = this.vy, vz = this.vz, r = this.r;
    // 1) Gravedad y un poco de rozamiento con el aire.
    for (let k = 0; k < n; k++) { vy[k] -= g * h; const dr = 1 - 0.15 * h; vx[k] *= dr; vy[k] *= dr; vz[k] *= dr; }
    // 2) Vecinos (rejilla hash): separar si se pisan, cohesión y viscosidad.
    const cell = 0.12;
    const grid = this.grid; grid.clear();
    const key = (x: number, y: number, z: number) => ((Math.floor(x / cell) * 73856093) ^ (Math.floor(y / cell) * 19349663) ^ (Math.floor(z / cell) * 83492791)) | 0;
    for (let k = 0; k < n; k++) { const kk = key(px[k], py[k], pz[k]); let a = grid.get(kk); if (!a) { a = []; grid.set(kk, a); } a.push(k); }
    for (let k = 0; k < n; k++) {
      const ck = this.emits[this.em[k]]?.cfg; if (!ck) continue;
      const cx = Math.floor(px[k] / cell), cy = Math.floor(py[k] / cell), cz = Math.floor(pz[k] / cell);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const a = grid.get((((cx + dx) * 73856093) ^ ((cy + dy) * 19349663) ^ ((cz + dz) * 83492791)) | 0);
        if (!a) continue;
        for (const j of a) {
          if (j <= k) continue;
          const ex = px[j] - px[k], ey = py[j] - py[k], ez = pz[j] - pz[k];
          const d2 = ex * ex + ey * ey + ez * ez, rs = r[k] + r[j], H = rs * 1.9;
          if (d2 > H * H || d2 < 1e-12) continue;
          const d = Math.sqrt(d2), nx = ex / d, ny = ey / d, nz = ez / d;
          const cj = this.emits[this.em[j]]?.cfg ?? ck;
          const visc = (ck.visc + cj.visc) * 0.5, coh = (ck.cohesion + cj.cohesion) * 0.5;
          if (d < rs) {
            // Se pisan: separar las posiciones (líquido casi incompresible).
            const push = (rs - d) * 0.5;
            px[k] -= nx * push; py[k] -= ny * push; pz[k] -= nz * push;
            px[j] += nx * push; py[j] += ny * push; pz[j] += nz * push;
          } else {
            // Cohesión: se atraen un poco (gotas que forman hilos y charcos).
            const pull = coh * 3.5 * h * (1 - (d - rs) / (H - rs));
            vx[k] += nx * pull; vy[k] += ny * pull; vz[k] += nz * pull;
            vx[j] -= nx * pull; vy[j] -= ny * pull; vz[j] -= nz * pull;
          }
          // Viscosidad: igualan su velocidad.
          const m = Math.min(0.5, visc * 9 * h);
          const ux = (vx[j] - vx[k]) * m, uy = (vy[j] - vy[k]) * m, uz = (vz[j] - vz[k]) * m;
          vx[k] += ux; vy[k] += uy; vz[k] += uz; vx[j] -= ux; vy[j] -= uy; vz[j] -= uz;
        }
      }
    }
    // 3) Mover, chocar y manchar.
    for (let k = 0; k < this.n; k++) {
      px[k] += vx[k] * h; py[k] += vy[k] * h; pz[k] += vz[k] * h;
      this.life[k] -= h;
      const c = this.emits[this.em[k]]?.cfg;
      let hit = false, hx = 0, hy = 1, hz = 0, still = true;
      if (this.ground && py[k] < r[k]) { py[k] = r[k]; hit = true; }
      for (const C of cols) {
        if (C.skip && this.emits[this.em[k]]?.id === C.skip) continue;
        if (C.kind === 'sphere') {
          const ex = px[k] - C.pos.x, ey = py[k] - C.pos.y, ez = pz[k] - C.pos.z, R = C.radius + r[k];
          const d2 = ex * ex + ey * ey + ez * ez;
          if (d2 < R * R && d2 > 1e-12) { const d = Math.sqrt(d2); px[k] = C.pos.x + ex / d * R; py[k] = C.pos.y + ey / d * R; pz[k] = C.pos.z + ez / d * R; hit = true; hx = ex / d; hy = ey / d; hz = ez / d; still = C.still; }
        } else {
          // Caja orientada: al espacio de la caja, empujar hacia fuera por la cara más cercana.
          const lp = this._v.set(px[k] - C.pos.x, py[k] - C.pos.y, pz[k] - C.pos.z).applyQuaternion(this._q.copy(C.quat).invert());
          const hx2 = C.half.x + r[k], hy2 = C.half.y + r[k], hz2 = C.half.z + r[k];
          if (Math.abs(lp.x) < hx2 && Math.abs(lp.y) < hy2 && Math.abs(lp.z) < hz2) {
            const ox = hx2 - Math.abs(lp.x), oy = hy2 - Math.abs(lp.y), oz = hz2 - Math.abs(lp.z);
            const n = this._s.set(0, 0, 0);
            if (ox < oy && ox < oz) { lp.x = Math.sign(lp.x) * hx2; n.x = Math.sign(lp.x); } else if (oy < oz) { lp.y = Math.sign(lp.y) * hy2; n.y = Math.sign(lp.y); } else { lp.z = Math.sign(lp.z) * hz2; n.z = Math.sign(lp.z); }
            lp.applyQuaternion(C.quat); n.applyQuaternion(C.quat);
            px[k] = C.pos.x + lp.x; py[k] = C.pos.y + lp.y; pz[k] = C.pos.z + lp.z;
            hit = true; hx = n.x; hy = n.y; hz = n.z; still = C.still;
          }
        }
      }
      if (hit && c) {
        // Rebote casi nulo y deslizamiento según la viscosidad.
        const vn = vx[k] * hx + vy[k] * hy + vz[k] * hz;
        const speed = Math.hypot(vx[k], vy[k], vz[k]);
        if (vn < 0) { vx[k] -= vn * hx * 1.1; vy[k] -= vn * hy * 1.1; vz[k] -= vn * hz * 1.1; }
        const fr = 1 - Math.min(1, (0.6 + c.visc * 3) * h * 10);
        vx[k] *= fr; vz[k] *= fr; if (hy < 0.5) vy[k] *= fr;
        // Contacto: la gota se aplasta contra la superficie (charco) mientras dura.
        this.cnx[k] = hx; this.cny[k] = hy; this.cnz[k] = hz; this.ct[k] = 0.15;
        this.rest[k] = speed < 0.4 ? this.rest[k] + h : 0;
        // Mancha en el suelo o en algo quieto: al caer rápido (salpicadura) o cuando el charco se queda quieto.
        const settle = this.rest[k] > 0.35 && Math.random() < c.stick * h * 12;
        if (still && hy > -0.2 && (settle || Math.random() < c.stick * (0.2 + Math.min(1, speed * 0.25)) * h * 30)) { this.stain(k, hx, hy, hz); this.kill(k); k--; continue; }
      } else if (this.ct[k] > 0) this.ct[k] -= h;
      if (this.life[k] <= 0 || py[k] < -30) { this.kill(k); k--; }
    }
  }
  /** Gotas (estiradas según su velocidad), su contorno, el brillo y las manchas. */
  private draw() {
    const counts = new Int32Array(this.emits.length);
    const M = this._m, q = this._q, sc = this._s, p = this._p, v = this._v;
    for (let k = 0; k < this.n; k++) {
      const i = this.em[k], e = this.emits[i]; if (!e) continue;
      const c = counts[i]++;
      v.set(this.vx[k], this.vy[k], this.vz[k]);
      const sp = v.length();
      const cartoon = e.cfg.style === 'cartoon';
      // Se dibujan algo más grandes que su tamaño de choque: así las gotas vecinas se funden.
      const rr = this.r[k] * 1.3;
      let st: number;
      if (this.ct[k] > 0) {
        // Apoyada: aplastada contra la superficie (charco que se extiende).
        q.setFromUnitVectors(FluidSystem.Y, v.set(this.cnx[k], this.cny[k], this.cnz[k]));
        const f = Math.min(1, this.ct[k] / 0.15);
        st = 1 - 0.55 * f;
        sc.set(rr * (1 + 0.5 * f), rr * st, rr * (1 + 0.5 * f));
      } else {
        // En el aire: estirada según su velocidad (lágrima).
        st = 1 + Math.min(cartoon ? 2.6 : 1.8, sp * (cartoon ? 0.22 : 0.12));
        if (sp > 1e-4) q.setFromUnitVectors(FluidSystem.Y, v.multiplyScalar(1 / sp)); else q.identity();
        sc.set(rr / Math.sqrt(st), rr * st, rr / Math.sqrt(st));
      }
      M.compose(p.set(this.px[k], this.py[k], this.pz[k]), q, sc);
      e.mesh.drops.setMatrixAt(c, M);
      if (e.mesh.outline) { const o = (e.mesh.outline.userData.out as number) ?? 1.2; M.compose(p, q, sc.multiplyScalar(o)); e.mesh.outline.setMatrixAt(c, M); sc.multiplyScalar(1 / o); }
      if (e.mesh.shine) { M.compose(p.set(this.px[k] - rr * 0.3, this.py[k] + rr * 0.35 * st, this.pz[k] + rr * 0.3), q, sc.multiplyScalar(0.28)); e.mesh.shine.setMatrixAt(c, M); }
    }
    this.emits.forEach((e, i) => {
      for (const m of [e.mesh.drops, e.mesh.outline, e.mesh.shine]) if (m) { m.count = counts[i]; m.instanceMatrix.needsUpdate = true; }
    });
    // Manchas.
    const sc2 = new Int32Array(this.emits.length);
    for (let s = 0; s < this.sN; s++) {
      const i = this.sem[s], e = this.emits[i]; if (!e) continue;
      const fade = STAIN_FADE[e.cfg.liquid];
      let k = 1; if (fade > 0) { k = 1 - this.sAge[s] / fade; if (k <= 0) continue; }
      const c = sc2[i]++;
      q.setFromUnitVectors(FluidSystem.Y, v.set(this.snx[s], this.sny[s], this.snz[s]));
      const rr = this.sr[s] * k;
      M.compose(p.set(this.sx[s] + this.snx[s] * 0.002, this.sy[s] + this.sny[s] * 0.002, this.sz[s] + this.snz[s] * 0.002), q, sc.set(rr, 1, rr));
      e.mesh.stains.setMatrixAt(c, M);
      if (e.mesh.stainLine) { M.compose(p.set(this.sx[s] + this.snx[s] * 0.001, this.sy[s] + this.sny[s] * 0.001, this.sz[s] + this.snz[s] * 0.001), q, sc.set(rr * 1.15, 1, rr * 1.15)); e.mesh.stainLine.setMatrixAt(c, M); }
    }
    this.emits.forEach((e, i) => { for (const m of [e.mesh.stains, e.mesh.stainLine]) if (m) { m.count = sc2[i]; m.instanceMatrix.needsUpdate = true; } });
  }
  dispose() {
    this.root.removeFromParent();
    for (const e of this.emits) for (const m of [e.mesh.drops, e.mesh.outline, e.mesh.shine, e.mesh.stains, e.mesh.stainLine]) if (m) { (m.material as T.Material).dispose(); m.dispose(); }
    this.emits = [];
  }
}

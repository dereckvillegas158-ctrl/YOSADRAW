import * as T from 'three';
import { CALIBERS, defaultParticles, type Obj3, type PartRole, type Weapon3, type WPart3 } from '../model';
import type { ParticleSystem, ShapePart } from './particles';

/**
 * Armas del modo En vivo: funcionan como las reales.
 *
 * Al disparar: el gatillo y el martillo se mueven, sale el fogonazo (con luz), el
 * arma retrocede y vuelve con un muelle, la corredera o el cerrojo hace su ciclo y
 * en su punto más atrasado el casquillo sale despedido por la ventana de expulsión
 * (con física: rebota, rueda y se queda en el suelo). Con el último cartucho la
 * corredera se queda atrás. La escopeta bombea, el fusil de cerrojo abre, retrocede
 * y cierra, el revólver gira su tambor y guarda las vainas hasta recargar.
 *
 * Recarga: el cargador cae (con física, con su forma real) y entra uno nuevo, y se
 * suelta la corredera o se tira de la palanca de carga. El cargador también se puede
 * sacar y meter arrastrándolo con el ratón. Inspección: el arma gira para mirarla,
 * se comprueba la recámara y se saca un poco el cargador.
 *
 * Las balas son rayos: donde pegan saltan chispas y empujan lo que tiene física.
 */

export interface WeaponEnv {
  /** Matriz local animada (keyframes) de un objeto y su matriz de mundo en vivo. */
  local(o: Obj3): T.Matrix4;
  world(id: string): T.Matrix4;
  obj(id: string): Obj3 | undefined;
  parts: ParticleSystem;
  /** Piezas de un objeto para dibujarlo como partícula (el cargador que cae). */
  shape(id: string): ShapePart[];
  /** Rayo de la bala: lo primero que toca (sin el arma). */
  raycast(from: T.Vector3, dir: T.Vector3, skip: Set<string>): { point: T.Vector3; normal: T.Vector3; oid: string } | null;
  impulse(oid: string, point: T.Vector3, imp: T.Vector3): void;
  shake(k: number): void;
  hidden: Set<string>;
  out: Map<string, T.Matrix4>;
  /** Pantalla: proyecta un punto del mundo a píxeles. */
  project(p: T.Vector3): { x: number; y: number };
  log(m: string): void;
}

type Seq = { t: number; dur: number; kind: 'reload' | 'inspect' | 'pump' | 'bolt' };
interface WState {
  id: string; w: Weapon3; parts: Map<PartRole, WPart3>; all: Set<string>;
  ammo: number; chambered: boolean; locked: boolean;
  /** Tiempo desde el último disparo (ciclo de la corredera) y del gatillo. */
  cyc: number; trig: number; hammer: number;
  ejected: boolean;
  rec: number; recV: number;
  hold: boolean; next: number;
  seq: Seq | null; seqDone: Set<string>;
  /** Cargador: 0 = puesto … 1 = fuera (visible abajo), oculto si `magGone`. */
  mag: number; magGone: boolean; magDrag: { x0: number; y0: number; v0: number; ax: number; ay: number; px: number } | null;
  cyl: number; spent: number;
  /** Cargador nuevo en la mano (se llena al meterlo). */
  fresh: boolean;
  /** Ciclo manual (bombeo / cerrojo) pendiente. */
  needCycle: boolean;
  ids: { flash: string; casing: string; mag: string };
  magCenter: T.Vector3; magSize: number;
}
const CYCLE = 0.075; // corredera atrás y adelante (s)

export class WeaponSystem {
  private st: WState[] = [];
  private time = 0;
  private _m = new T.Matrix4(); private _m2 = new T.Matrix4(); private _v = new T.Vector3(); private _q = new T.Quaternion(); private _e = new T.Euler();
  readonly spark = '~w-impact';
  shots = 0;

  constructor(private env: WeaponEnv, guns: Obj3[], sub: (id: string) => Obj3[]) {
    for (const g of guns) {
      const w = g.weapon!;
      const parts = new Map<PartRole, WPart3>();
      for (const p of w.parts) if (env.obj(p.id)) parts.set(p.role, p);
      const all = new Set([g.id, ...sub(g.id).map(o => o.id)]);
      const s: WState = {
        id: g.id, w, parts, all, ammo: w.ammo, chambered: true, locked: false, cyc: 9, trig: 9, hammer: 0, ejected: true, rec: 0, recV: 0, hold: false, next: 0,
        seq: null, seqDone: new Set(), mag: 0, magGone: false, magDrag: null, cyl: 0, spent: 0, fresh: false, needCycle: false,
        ids: { flash: `~wf-${g.id}`, casing: `~wc-${g.id}`, mag: `~wm-${g.id}` }, magCenter: new T.Vector3(), magSize: 0.05,
      };
      // Emisores propios: fogonazo, casquillos y el cargador que cae (con su forma real).
      const P = env.parts, I = new T.Matrix4();
      P.addEmitter(s.ids.flash, { ...defaultParticles('muzzle'), size: 0.07 * Math.max(0.2, w.flash) * (w.kind === 'pistol' || w.kind === 'revolver' ? 0.8 : w.kind === 'shotgun' || w.kind === 'sniper' ? 1.5 : 1), light: 3 * w.flashLight, lightRange: 5, dir: 'front' }, I, false, {});
      P.addEmitter(s.ids.casing, { ...defaultParticles('casings'), caliber: w.caliber, size: CALIBERS[w.caliber].size * w.casingScale, sizeVar: 0.02, rate: 0, dir: 'up', speed: w.kind === 'shotgun' ? 2.2 : 3, spread: 16 }, I, false, {});
      const mag = parts.get('mag'), mo = mag ? env.obj(mag.id) : undefined;
      if (mag && mo?.mesh) {
        const b = new T.Box3(), v = new T.Vector3();
        for (let i = 0; i < mo.mesh.v.length; i += 3) b.expandByPoint(v.set(mo.mesh.v[i], mo.mesh.v[i + 1], mo.mesh.v[i + 2]));
        b.getCenter(s.magCenter); s.magSize = Math.max(0.01, b.getSize(v).length() / 2);
        P.addEmitter(s.ids.mag, { ...defaultParticles('custom'), shape: 'object', size: s.magSize, sizeVar: 0, rate: 0, speed: 0.4, spread: 10, dir: 'down', spin: 2.5, life: 30, bounce: 0.25, collide: true, stay: true, fade: false }, I, false, { parts: env.shape(mag.id), align: true });
      }
      this.st.push(s);
    }
    env.parts.addEmitter(this.spark, { ...defaultParticles('sparks'), rate: 0, light: 0, speed: 3.5, spread: 70, life: 0.35, size: 0.012 }, new T.Matrix4(), false, {});
  }
  static emittersFor(guns: Obj3[]) { return guns.length * 3 + 1; }
  get count() { return this.st.length; }
  /** Estado de un arma (pruebas e interfaz). */
  info(id: string) { const s = this.st.find(x => x.id === id); return s ? { ammo: s.ammo, chambered: s.chambered, locked: s.locked, mag: s.mag, magGone: s.magGone, seq: s.seq?.kind ?? null, spent: s.spent } : null; }

  // ---------------------------------------------------------------- órdenes

  private find(id?: string) { return id ? this.st.filter(s => s.id === id) : this.st; }
  /** Disparo (o empieza/para el fuego automático con `hold`). */
  fire(id?: string, hold?: boolean) {
    for (const s of this.find(id)) {
      if (hold !== undefined) { s.hold = hold && s.w.action === 'auto'; if (!hold) continue; }
      this.shoot(s);
    }
  }
  reload(id?: string) { for (const s of this.find(id)) if (!s.seq || s.seq.kind === 'inspect') { s.seq = { t: 0, dur: this.reloadDur(s), kind: 'reload' }; s.seqDone.clear(); } }
  inspect(id?: string) { for (const s of this.find(id)) if (!s.seq) { s.seq = { t: 0, dur: 2.6, kind: 'inspect' }; s.seqDone.clear(); } }
  /** ¿Alguna arma usa esta tecla? */
  uses(k: string) { const l = k.toLowerCase(); return this.st.some(s => [s.w.fireKey, s.w.reloadKey, s.w.inspectKey].some(x => !!x && x.toLowerCase() === l)); }
  /** Teclas de cada arma: disparar (mantener = automático), recargar, inspeccionar. */
  key(k: string, down: boolean) {
    let used = false;
    for (const s of this.st) {
      const is = (x: string) => !!x && x.toLowerCase() === k.toLowerCase();
      if (is(s.w.fireKey)) { used = true; if (down) { if (!s.hold) this.shoot(s); s.hold = s.w.action === 'auto'; } else s.hold = false; }
      else if (down && is(s.w.reloadKey)) { used = true; this.reload(s.id); }
      else if (down && is(s.w.inspectKey)) { used = true; this.inspect(s.id); }
    }
    return used;
  }
  /** Clic en la escena: dispara las armas con «disparar con clic». */
  click() { let n = 0; for (const s of this.st) if (s.w.fireClick) { this.shoot(s); n++; } return n > 0; }

  private reloadDur(s: WState) { return s.w.action === 'revolver' ? 1.8 : s.w.action === 'pump' ? 0.5 + s.w.ammo * 0.25 : s.w.action === 'bolt' ? 2.2 : 1.7; }

  private shoot(s: WState) {
    if (s.seq && s.seq.kind !== 'inspect') return;
    if (s.seq?.kind === 'inspect') s.seq = null;
    if (this.time < s.next) return;
    s.next = this.time + 60 / Math.max(30, s.w.rpm);
    s.trig = 0;
    const act = s.w.action;
    // Sin cartucho en la recámara (o sin cargador puesto): sólo el gatillo («clic»).
    const magOk = !s.parts.has('mag') || (s.mag < 0.1 && !s.magGone);
    if (!s.chambered || s.needCycle || (act === 'revolver' ? s.ammo <= 0 : false)) { s.hold = false; return; }
    this.shots++;
    s.chambered = false;
    // Fogonazo, retroceso y la bala.
    const G = this.env.world(s.id), w = s.w;
    this.env.parts.place(s.ids.flash, this.frameAt(G, w.muzzle, w.fwd));
    this.env.parts.burst(s.ids.flash, 1);
    s.recV += 26 * w.recoil;
    this.env.shake(0.012 * w.recoil);
    if (w.bullets) this.bullet(s, G);
    s.hammer = 1;
    if (act === 'semi' || act === 'auto') {
      s.cyc = 0; s.ejected = false;
      // Carga el siguiente si queda munición y hay cargador; si no, la corredera se queda atrás.
      if (s.ammo > 0 && magOk) { s.ammo--; s.chambered = true; } else { s.locked = true; s.hold = false; }
    } else if (act === 'revolver') {
      s.ammo--; s.spent++; s.cyl += 1; s.chambered = s.ammo > 0;
    } else {
      // Bombeo y cerrojo: hay que accionar a mano (se hace solo tras el disparo).
      s.needCycle = true; s.hold = false;
      s.seq = { t: -0.22, dur: act === 'pump' ? 0.42 : 0.9, kind: act === 'pump' ? 'pump' : 'bolt' }; s.seqDone.clear();
    }
  }
  private bullet(s: WState, G: T.Matrix4) {
    const from = this._v.set(...s.w.muzzle).applyMatrix4(G).clone();
    const dir = new T.Vector3(...s.w.fwd).transformDirection(G).normalize();
    const pellets = s.w.caliber === '12g' ? 8 : 1;
    for (let i = 0; i < pellets; i++) {
      const d = pellets > 1 ? dir.clone().add(new T.Vector3((Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.08)).normalize() : dir;
      const hit = this.env.raycast(from, d, s.all);
      if (!hit) continue;
      // Chispas en el impacto, saliendo de la superficie.
      const q = this._q.setFromUnitVectors(new T.Vector3(0, 1, 0), hit.normal);
      this.env.parts.place(this.spark, this._m2.compose(hit.point, q, new T.Vector3(1, 1, 1)));
      this.env.parts.burst(this.spark, pellets > 1 ? 4 : 10);
      const k = { '9mm': 0.9, '45acp': 1.2, '357': 1.6, '556': 1.8, '762': 2.2, '308': 3, '50bmg': 6, '12g': 0.8 }[s.w.caliber];
      this.env.impulse(hit.oid, hit.point, d.clone().multiplyScalar(k));
    }
  }
  /** Matriz en un punto del arma con +Z hacia `fwd` (o +Y hacia `up`). */
  private frameAt(G: T.Matrix4, p: [number, number, number], fwd: [number, number, number], yAxis = false) {
    const pos = new T.Vector3(...p).applyMatrix4(G);
    const d = new T.Vector3(...fwd).transformDirection(G).normalize();
    const q = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, yAxis ? 1 : 0, yAxis ? 0 : 1), d);
    return new T.Matrix4().compose(pos, q, new T.Vector3(1, 1, 1));
  }
  private eject(s: WState, n = 1) {
    const G = this.env.world(s.id);
    this.env.parts.place(s.ids.casing, this.frameAt(G, s.w.eject, s.w.ejectDir, true));
    this.env.parts.burst(s.ids.casing, n);
  }
  private dropMag(s: WState) {
    const p = s.parts.get('mag');
    if (!p || s.magGone) return;
    const G = this.env.world(p.id);
    // Desde el centro del cargador, con su orientación.
    this.env.parts.place(s.ids.mag, this._m.copy(G).multiply(this._m2.makeTranslation(s.magCenter.x, s.magCenter.y, s.magCenter.z)));
    this.env.parts.burst(s.ids.mag, 1);
    s.magGone = true; s.mag = 1;
  }

  // ---------------------------------------------------------------- ratón (cargador)

  /** Pulsar sobre el cargador de un arma: empieza a arrastrarlo por su eje. */
  pointerDown(oid: string, x: number, y: number, point?: T.Vector3) {
    for (const s of this.st) {
      const p = s.parts.get('mag');
      if (!p || !s.w.magDrag || !s.all.has(oid)) continue;
      // El cargador suele estar metido en la empuñadura: vale tocar cualquier pieza del
      // arma si el punto cae en la zona del cargador (o en su base, que asoma).
      const onMag = oid === p.id || this.isChild(oid, p.id) || (!!point && this.inMagZone(s, p, point));
      if (!onMag) continue;
      const G = this.env.world(p.id), a = this.env.project(this._v.set(0, 0, 0).applyMatrix4(G));
      const end = new T.Vector3(...p.move).transformDirection(this.env.world(s.id)).multiplyScalar(new T.Vector3(...p.move).length());
      const b = this.env.project(this._v.set(0, 0, 0).applyMatrix4(G).add(end));
      const ax = b.x - a.x, ay = b.y - a.y, px = Math.max(8, Math.hypot(ax, ay));
      if (s.magGone) { s.magGone = false; s.mag = 1; s.fresh = true; } // coge uno nuevo (lleno)
      s.magDrag = { x0: x, y0: y, v0: s.mag, ax: ax / px, ay: ay / px, px };
      if (s.seq?.kind === 'reload') s.seq = null;
      return true;
    }
    return false;
  }
  pointerMove(x: number, y: number) {
    for (const s of this.st) if (s.magDrag) { const d = s.magDrag; s.mag = Math.max(0, Math.min(1.6, d.v0 + ((x - d.x0) * d.ax + (y - d.y0) * d.ay) / d.px)); return true; }
    return false;
  }
  pointerUp() {
    let used = false;
    for (const s of this.st) {
      if (!s.magDrag) continue;
      used = true; s.magDrag = null;
      if (s.mag > 1.15) { this.dropMag(s); s.ammo = 0; }
      else if (s.mag < 0.15) {
        // Cargador nuevo puesto: lleno; la corredera se suelta si estaba atrás.
        if (s.fresh) { s.ammo = s.w.ammo; s.fresh = false; }
        s.mag = 0;
        if (s.locked) { s.locked = false; s.cyc = CYCLE * 0.5; s.ejected = true; if (s.ammo > 0) { s.ammo--; s.chambered = true; } }
      }
    }
    return used;
  }
  private inMagZone(s: WState, p: WPart3, point: T.Vector3) {
    const inv = this.env.world(p.id).invert(), q = point.clone().applyMatrix4(inv);
    const r = s.magSize * 1.15;
    return q.distanceTo(s.magCenter) < r;
  }
  private isChild(oid: string, of: string) { let o = this.env.obj(oid), g = 0; while (o && g++ < 30) { if (o.parent === of) return true; o = o.parent ? this.env.obj(o.parent) : undefined; } return false; }

  // ---------------------------------------------------------------- cada fotograma

  step(dt: number) {
    this.time += dt;
    for (const s of this.st) {
      // Fuego automático mientras se mantiene la tecla.
      if (s.hold && this.time >= s.next) this.shoot(s);
      s.trig += dt; s.cyc += dt;
      // Retroceso: muelle amortiguado, en subpasos (estable aunque los fotogramas sean largos).
      const n = Math.max(1, Math.ceil(dt / (1 / 240))), h = dt / n;
      for (let i = 0; i < n; i++) { s.recV += (-s.rec * 320 - s.recV * 24) * h; s.rec += s.recV * h; }
      s.rec = Math.max(-0.5, Math.min(1.5, s.rec));
      s.hammer = Math.max(0, s.hammer - dt * 6);
      // Expulsión en el punto más atrasado de la corredera.
      if (!s.ejected && s.cyc >= CYCLE * 0.42) { s.ejected = true; this.eject(s); }
      if (s.seq) this.sequence(s, dt);
      this.output(s);
    }
  }
  /** Recarga, inspección y ciclos manuales (bombeo, cerrojo). */
  private sequence(s: WState, dt: number) {
    const q = s.seq!; q.t += dt;
    const u = q.t / q.dur, once = (k: string, at: number, fn: () => void) => { if (u >= at && !s.seqDone.has(k)) { s.seqDone.add(k); fn(); } };
    if (q.kind === 'pump' || q.kind === 'bolt') {
      once('eject', q.kind === 'pump' ? 0.4 : 0.5, () => this.eject(s));
      if (u >= 1) { s.needCycle = false; if (s.ammo > 0) { s.ammo--; s.chambered = true; } s.seq = null; }
      return;
    }
    if (q.kind === 'reload') {
      if (s.w.action === 'revolver') {
        once('out', 0.2, () => { if (s.spent) this.eject(s, s.spent); s.spent = 0; });
        if (u >= 1) { s.ammo = s.w.ammo; s.chambered = true; s.seq = null; }
        return;
      }
      if (s.w.action === 'pump') { if (u >= 1) { s.ammo = s.w.ammo; s.chambered = true; s.needCycle = false; s.seq = null; } return; }
      once('drop', 0.08, () => this.dropMag(s));
      once('new', 0.35, () => { s.magGone = false; s.mag = 1; });
      if (u > 0.35 && u < 0.62) s.mag = 1 - (u - 0.35) / 0.27;
      once('seat', 0.62, () => { s.mag = 0; s.ammo = s.w.ammo; });
      once('release', 0.8, () => {
        const wasLocked = s.locked || !s.chambered;
        s.locked = false;
        if (wasLocked) { s.cyc = CYCLE * 0.5; s.ejected = true; s.ammo--; s.chambered = true; }
      });
      if (u >= 1) s.seq = null;
      return;
    }
    if (u >= 1) s.seq = null;
  }
  /** Posición de cada pieza (0..1) ahora mismo. */
  private poses(s: WState): Map<PartRole, number> {
    const m = new Map<PartRole, number>();
    const q = s.seq, u = q ? Math.max(0, q.t / q.dur) : 0;
    const tri = (a: number, b: number, c: number, x: number) => (x <= a || x >= c ? 0 : x < b ? (x - a) / (b - a) : 1 - (x - b) / (c - b));
    // Corredera / cerrojo: ciclo del disparo, atrás si se quedó trabada.
    const cyc = s.cyc < CYCLE ? (s.cyc < CYCLE * 0.42 ? s.cyc / (CYCLE * 0.42) : 1 - (s.cyc - CYCLE * 0.42) / (CYCLE * 0.58)) : 0;
    let back = s.locked ? 1 : cyc;
    m.set('trigger', s.trig < 0.12 ? 1 - s.trig / 0.12 : 0);
    m.set('hammer', s.w.action === 'revolver' ? (s.trig < 0.05 ? s.trig / 0.05 : s.trig < 0.09 ? 1 - (s.trig - 0.05) / 0.04 : 0) : 0);
    m.set('cylinder', s.cyl - (s.trig < 0.08 ? 1 - s.trig / 0.08 : 0));
    m.set('cover', this.shots > 0 || s.locked ? 1 : 0);
    if (q?.kind === 'pump') { const v = tri(0, 0.45, 1, u); m.set('pump', v); back = Math.max(back, v); }
    if (q?.kind === 'bolt') { m.set('handle', u < 0.15 ? u / 0.15 : u < 0.85 ? 1 : 1 - (u - 0.85) / 0.15); back = Math.max(back, tri(0.15, 0.5, 0.85, u)); }
    if (q?.kind === 'reload') {
      if (s.w.action === 'revolver') m.set('cylinder', s.cyl + tri(0.05, 0.3, 1, u) * 0.5);
      if (s.w.action === 'pump') m.set('pump', u > 0.85 ? tri(0.85, 0.92, 1, u) : 0);
      if (s.w.action === 'auto' || s.parts.has('handle') && s.w.action !== 'bolt') { const h = tri(0.72, 0.8, 0.88, u); m.set('handle', h); back = Math.max(back, h); }
    }
    if (q?.kind === 'inspect') {
      back = Math.max(back, tri(0.18, 0.28, 0.42, u) * 0.55);
      if (s.parts.has('handle')) m.set('handle', Math.max(m.get('handle') ?? 0, tri(0.14, 0.2, 0.44, u)));
      if (!s.magDrag) s.mag = s.magGone ? s.mag : tri(0.55, 0.65, 0.8, u) * 0.45;
    }
    m.set('slide', back); m.set('bolt', back);
    m.set('mag', s.mag);
    return m;
  }
  /** Escribe la transformación local del arma (retroceso, inspección) y de sus piezas. */
  private output(s: WState) {
    const g = this.env.obj(s.id); if (!g) return;
    const w = s.w, f = this._v.set(...w.fwd).normalize();
    const R = this.env.local(g);
    // Retroceso: hacia atrás por el cañón y la boca hacia arriba (giro sobre el eje derecho).
    const right = new T.Vector3().crossVectors(new T.Vector3(0, 1, 0), f).normalize();
    const kick = new T.Matrix4().makeTranslation(-f.x * s.rec * 0.012, -f.y * s.rec * 0.012, -f.z * s.rec * 0.012)
      .multiply(new T.Matrix4().makeRotationAxis(right, -s.rec * 0.06));
    if (s.seq?.kind === 'inspect') {
      const u = s.seq.t / s.seq.dur, e = (a: number, b: number) => Math.sin(Math.min(1, Math.max(0, (u - a) / (b - a))) * Math.PI);
      kick.multiply(new T.Matrix4().makeRotationFromEuler(this._e.set(e(0, 0.5) * -0.15, e(0, 0.5) * 0.7 - e(0.5, 1) * 0.5, e(0, 0.5) * -0.35 + e(0.5, 1) * 1.0)));
    }
    this.env.out.set(s.id, R.multiply(kick));
    const poses = this.poses(s);
    for (const [role, p] of s.parts) {
      const o = this.env.obj(p.id); if (!o) continue;
      const v = poses.get(role) ?? 0;
      const base = this.env.local(o);
      const M = new T.Matrix4().makeTranslation(p.move[0] * v, p.move[1] * v, p.move[2] * v).multiply(base);
      if (p.rot[0] || p.rot[1] || p.rot[2]) M.multiply(new T.Matrix4().makeRotationFromEuler(this._e.set(p.rot[0] * v * Math.PI / 180, p.rot[1] * v * Math.PI / 180, p.rot[2] * v * Math.PI / 180)));
      this.env.out.set(p.id, M);
      if (role === 'mag') { if (s.magGone) this.env.hidden.add(p.id); else this.env.hidden.delete(p.id); }
    }
  }
}

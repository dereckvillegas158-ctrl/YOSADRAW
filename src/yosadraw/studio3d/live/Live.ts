import * as C from 'cannon-es';
import * as T from 'three';
import { valueAt } from '../../motion/keys';
import { bounds } from '../mesh';
import { cardPhys, defaultAudio, defaultCtrl, defaultFx, defaultPhys, effVisible, objOf, type Act3, type Ctrl3, type EventType, type Fx3, type Obj3, type Phys3, type TransType, type Rule3 } from '../model';
import { round, type Studio3D } from '../Studio3D';
import { LiveAudio } from './audio';
import type { LiveHooks, View3D } from '../View3D';

/**
 * Modo En vivo de YOSADRAW 3D: la escena se ejecuta como un videojuego. Físicas
 * (cannon-es) para los objetos y personajes, control con el ratón (agarrar,
 * sacudir, lanzar, guiar personajes), disparadores (reglas) y programa (script),
 * luces dinámicas y efectos que se pueden cambiar mientras corre. No modifica el
 * proyecto: se puede grabar lo que pasa como keyframes o como vídeo.
 */

const D2R = Math.PI / 180;
const STEP = 1 / 60;

interface BodyInfo {
  id: string; obj: Obj3; body: C.Body;
  /** Centro de la caja respecto al origen del objeto (local, sin escala). */
  center: T.Vector3; scale: T.Vector3; rot0: T.Quaternion;
  ctrl: Ctrl3 | null; origin: T.Vector3; patrolSign: 1 | -1; target: T.Vector3 | null;
  yaw: number; jig: number; jigV: number; prevV: T.Vector3; grounded: boolean;
  kinematic: boolean;
  /** Hasta cuándo el control no frena un empujón (s de simulación). */
  free: number;
  /**
   * Inclinación de frente sólo visual (personajes «siempre de pie»): ángulo, su
   * velocidad, eje (la vista) y punto de giro respecto al centro del cuerpo.
   */
  tilt: number; tiltV: number; tiltAxis: T.Vector3; tiltPivot: T.Vector3;
  /** Físicas efectivas (los carteles PNG sin físicas usan las de cartel). */
  ph: Phys3;
}
interface Tween { apply: (k: number) => void; t0: number; dur: number; done?: () => void }
export interface LiveLog { t: number; msg: string; error?: boolean }

/** Curvas de las transiciones de pose (u = 0..1): escala, giro, salto, opacidad y cuándo se cambia el dibujo. */
export function poseCurve(type: TransType, u: number): { sx: number; sy: number; ry: number; rz: number; dy: number; a: number; swapAt: number } {
  const r = { sx: 1, sy: 1, ry: 0, rz: 0, dy: 0, a: 1, swapAt: 0.5 };
  const inQ = (x: number) => x * x, outQ = (x: number) => 1 - (1 - x) * (1 - x);
  const elastic = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1);
  const keep = (sy: number) => (sy <= 1 ? 1 + (1 - sy) * 0.7 : 1 - (sy - 1) * 0.6);
  switch (type) {
    case 'squash': {
      // Squash and stretch: se aplasta, cambia, se estira de más y rebota hasta quedar normal.
      r.swapAt = 0.35;
      r.sy = u < 0.35 ? 1 - 0.6 * inQ(u / 0.35) : 0.4 + 0.6 * elastic((u - 0.35) / 0.65);
      r.sx = keep(r.sy);
      break;
    }
    case 'flip': r.ry = u < 0.5 ? (Math.PI / 2) * inQ(u / 0.5) : -(Math.PI / 2) * (1 - outQ((u - 0.5) / 0.5)); break;
    case 'spin': { const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2; r.rz = -2 * Math.PI * e; r.sx = r.sy = 1 - 0.35 * Math.sin(Math.PI * u); break; }
    case 'pop': { r.swapAt = 0.35; const s = u < 0.35 ? Math.max(0.01, 1 - inQ(u / 0.35) * 1.05) : Math.max(0.01, elastic((u - 0.35) / 0.65)); r.sx = r.sy = s; break; }
    case 'fade': r.a = u < 0.5 ? 1 - 2 * u : 2 * u - 1; break;
    case 'jump': { r.dy = 0.45 * Math.sin(Math.PI * u); const e = Math.min(u, 1 - u), land = e < 0.12 ? Math.sin((Math.PI * e) / 0.12) : 0; r.sy = 1 - 0.25 * land; r.sx = keep(r.sy); break; }
    case 'shake': { const f = 1 - u; r.rz = 0.22 * Math.sin(u * Math.PI * 9) * f; r.sx = 1 + 0.08 * Math.sin(u * Math.PI * 11) * f; break; }
    case 'cut': r.swapAt = 0; break;
  }
  return r;
}

export class Live {
  running = false;
  paused = false;
  timescale = 1;
  time = 0;
  private world = new C.World({ gravity: new C.Vec3(0, -9.81, 0), allowSleep: true });
  private bodies = new Map<string, BodyInfo>();
  private byBody = new Map<C.Body, BodyInfo>();
  private hooks: LiveHooks;
  private raf = 0; private last = 0; private acc = 0;
  private tweens: Tween[] = [];
  private rules: (Rule3 & { fired: boolean; next: number })[] = [];
  private handlers = new Map<string, ((e: { a?: string; b?: string; key?: string }) => void)[]>();
  private timers: { at: number; every: number; fn: () => void }[] = [];
  private pairCool = new Map<string, number>();
  private grab: {
    info: BodyInfo; joint: C.PointToPointConstraint; mouse: C.Body; dist: number; plane: T.Plane;
    /** Inclinación de frente (como una hoja): giro en su plano, muelle y velocidad del ratón. */
    face: { q0: T.Quaternion; roll: number; rollV: number; vel: number; prev: T.Vector3; side: number } | null;
  } | null = null;
  private steer = false;
  private spawned: string[] = [];
  private shakeAmt = 0; private shakeEnd = 0;
  private lightBase = new Map<string, T.Vector3>();
  /** Grabación: matrices del mundo por objeto en cada muestra. */
  private rec: { fps: number; frames: Map<string, number[][]>; n: number; next: number } | null = null;
  logs: LiveLog[] = [];
  /** Tiempos medios por fotograma (ms): física y dibujo. */
  stats = { phys: 0, draw: 0 };
  onLog: (l: LiveLog) => void = () => {};
  onState: () => void = () => {};
  private keyFn = (e: KeyboardEvent) => this.key(e);
  private keyUpFn = (e: KeyboardEvent) => { this.held.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key); };
  /** Actor que se controla ahora (con su tecla); los demás actores esperan. */
  private actor: BodyInfo | null = null;
  /** Teclas de movimiento pulsadas (WASD / flechas) para el actor. */
  private held = new Set<string>();
  /** Poses de los dibujos: la actual y la transición en curso (con su matriz local). */
  private poses = new Map<string, { cur: string | null; hc: number; anim: { type: TransType; t0: number; dur: number; to: string | null; swapped: boolean } | null; mod: T.Matrix4 | null }>();
  /** Tecla H: ocultar o mostrar la interfaz (la pone la interfaz). */
  onToggleUi: () => void = () => {};
  /** Después de dibujar cada fotograma (la grabación de vídeo lo copia). */
  onFrame: () => void = () => {};
  /** Tecla F9: empezar o parar la grabación de vídeo. */
  onRecordKey: () => void = () => {};

  constructor(private s: Studio3D, private view: View3D) {
    const fx = { ...defaultFx(), ...(s.scene.fx ?? {}) };
    this.hooks = { world: new Map(), hidden: new Set(), lightK: new Map(), lightColor: new Map(), matColor: new Map(), shake: new T.Vector3(), fx, time: 0, actor: null, cardTex: new Map(), cardAlpha: new Map(), cardGlow: new Map() };
    this.audio = new LiveAudio(() => s.scene.audio ?? defaultAudio());
  }
  get fx() { return this.hooks.fx; }
  get bodyCount() { return this.bodies.size; }
  get recording() { return !!this.rec; }

  // ---------------------------------------------------------------- iniciar y parar

  start(runScript: boolean) {
    const s = this.s, sc = s.scene;
    s.pause();
    if (s.mode === 'edit') s.exitEdit();
    this.world.gravity.set(0, -this.fx.gravity, 0);
    this.world.broadphase = new C.SAPBroadphase(this.world);
    (this.world.solver as C.GSSolver).iterations = this.fx.quality === 'low' ? 6 : 10;
    this.world.defaultContactMaterial.friction = 0.4;
    this.world.defaultContactMaterial.restitution = 0.2;
    if (this.fx.ground) { const g = new C.Body({ type: C.Body.STATIC, shape: new C.Plane(), material: new C.Material({ friction: 0.6, restitution: 0.5 }) }); g.quaternion.setFromEuler(-Math.PI / 2, 0, 0); this.world.addBody(g); }
    for (const o of sc.objects) if (o.phys && o.phys.body !== 'none' && effVisible(sc, o)) this.addBody(o);
    // Carteles (PNG) sin físicas: flotan y se pueden agarrar y balancear.
    // (las partes de un personaje no: siguen a su padre)
    for (const o of sc.objects) if (o.card && !o.phys && !o.part && !this.bodies.has(o.id) && effVisible(sc, o)) this.addBody(o);
    // Personajes sin física: se les pone un cuerpo dinámico (de pie).
    for (const o of sc.objects) if (o.ctrl && !this.bodies.has(o.id) && effVisible(sc, o)) this.addBody(o, true);
    this.world.addEventListener('beginContact', (e: { bodyA: C.Body; bodyB: C.Body }) => this.contact(e.bodyA, e.bodyB));
    for (const o of sc.objects) if (o.light && o.lightFx === 'orbit') this.lightBase.set(o.id, new T.Vector3().setFromMatrixPosition(s.worldMatrix(o)));
    this.rules = (sc.rules ?? []).filter(r => r.enabled).map(r => ({ ...structuredClone(r), fired: false, next: r.on.type === 'every' ? (r.on.t ?? 1) : 0 }));
    if (runScript && sc.script?.trim()) this.runScript(sc.script);
    // Poses: se cargan ya sus texturas (el cambio en vivo es instantáneo).
    for (const o of sc.objects) for (const p of o.card?.poses ?? []) this.view.poseTexture(p.tex);
    this.view.live = this.hooks;
    this.view.liveInput = { down: e => this.down(e), move: e => this.move(e), up: () => this.up(), wheel: e => this.wheel(e) };
    this.view.sync();
    this.time = 0;
    this.running = true;
    window.addEventListener('keydown', this.keyFn, true);
    window.addEventListener('keyup', this.keyUpFn, true);
    void this.audio.start().then(() => { if (sc.audio?.mic && !this.audio.micOn) this.log('No se pudo usar el micrófono (permiso denegado o no hay micrófono).', true); });
    this.emit('start', {});
    this.last = performance.now();
    this.raf = requestAnimationFrame(t => this.loop(t));
    this.onState();
  }
  stop() {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.keyFn, true);
    window.removeEventListener('keyup', this.keyUpFn, true);
    this.held.clear();
    this.audio.stop();
    this.view.resetLive();
    this.onState();
  }
  togglePause() { this.paused = !this.paused; this.onState(); }

  // ---------------------------------------------------------------- cuerpos

  private addBody(o: Obj3, asChar = false) {
    const s = this.s, ph: Phys3 = { ...defaultPhys(), ...(o.phys ?? (o.card ? cardPhys() : {})) };
    const W = s.worldMatrix(o);
    const p = new T.Vector3(), q = new T.Quaternion(), sc = new T.Vector3();
    W.decompose(p, q, sc);
    const b = o.mesh?.v.length ? bounds(o.mesh) : { min: [-0.25, -0.25, -0.25], max: [0.25, 0.25, 0.25] };
    const center = new T.Vector3((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
    const half = new T.Vector3((b.max[0] - b.min[0]) / 2 * Math.abs(sc.x), (b.max[1] - b.min[1]) / 2 * Math.abs(sc.y), (b.max[2] - b.min[2]) / 2 * Math.abs(sc.z)).max(new T.Vector3(0.02, 0.02, 0.02));
    const type = asChar || ph.body === 'none' ? 'dynamic' : ph.body;
    const ctrl = o.ctrl ? { ...defaultCtrl(), ...o.ctrl } : null;
    const round_ = o.prim?.type === 'sphere' || (ph?.shape === 'sphere');
    const terrain = o.gen?.type === 'terrain' && type === 'static';
    let shape: C.Shape;
    let wc = center.clone().multiply(sc).applyQuaternion(q).add(p);
    if (terrain && o.gen) {
      // Terreno: campo de alturas con la malla del generador.
      const res = Math.round(o.gen.p.res), size = o.gen.p.size * Math.abs(sc.x);
      const data: number[][] = [];
      for (let i = 0; i <= res; i++) { const row: number[] = []; for (let k = 0; k <= res; k++) { const j = res - k; row.push(o.mesh!.v[(i * (res + 1) + j) * 3 + 1] * Math.abs(sc.y)); } data.push(row); }
      shape = new C.Heightfield(data, { elementSize: size / res });
      wc = new T.Vector3(p.x - size / 2, p.y, p.z + size / 2);
      q.setFromEuler(new T.Euler(-Math.PI / 2, 0, 0));
    } else if (round_) shape = new C.Sphere(Math.max(half.x, half.y, half.z));
    else shape = new C.Box(new C.Vec3(half.x, half.y, half.z));
    const mass = type === 'dynamic' ? Math.max(0.05, ph?.mass ?? 1) : 0;
    const body = new C.Body({ mass, type: type === 'static' ? C.Body.STATIC : type === 'kinematic' ? C.Body.KINEMATIC : C.Body.DYNAMIC, shape, linearDamping: ctrl ? 0.05 : ph.float ? 0.35 : 0.02, angularDamping: ph.float ? 0.45 : 0.08 });
    body.position.set(wc.x, wc.y, wc.z);
    body.quaternion.set(q.x, q.y, q.z, q.w);
    body.material = new C.Material({ friction: ctrl ? 0 : ph.friction, restitution: ph.bounce });
    if (ph.float) body.allowSleep = false;
    if (ph.zone) { body.collisionResponse = false; body.type = C.Body.STATIC; body.mass = 0; }
    if (ctrl) {
      body.fixedRotation = ctrl.upright;
      body.linearFactor.set(ctrl.lock.x ? 0 : 1, ctrl.lock.y ? 0 : 1, ctrl.lock.z ? 0 : 1);
      body.allowSleep = false;
    }
    // PNGTuber (2D): todo se mueve en el plano de la pantalla.
    if (s.s.kind === 'tuber' && type === 'dynamic') body.linearFactor.z = 0;
    body.updateMassProperties();
    this.world.addBody(body);
    const info: BodyInfo = { id: o.id, obj: o, body, center, scale: sc, rot0: q.clone(), ctrl, origin: wc.clone(), patrolSign: 1, target: null, yaw: 0, jig: 0, jigV: 0, prevV: new T.Vector3(), grounded: false, kinematic: type === 'kinematic', free: 0, ph, tilt: 0, tiltV: 0, tiltAxis: new T.Vector3(0, 0, -1), tiltPivot: new T.Vector3() };
    if (terrain) info.rot0 = new T.Quaternion();
    this.bodies.set(o.id, info);
    this.byBody.set(body, info);
    body.addEventListener('collide', (e: { body: C.Body }) => { const other = this.byBody.get(e.body); this.pairEvent('collide', o.id, other?.id); });
  }
  private contact(a: C.Body, b: C.Body) {
    const A = this.byBody.get(a), B = this.byBody.get(b);
    // Zonas: «entra en».
    if (A?.obj.phys?.zone && B) this.pairEvent('enter', A.id, B.id);
    if (B?.obj.phys?.zone && A) this.pairEvent('enter', B.id, A.id);
  }
  /** Evita repetir el mismo choque muchas veces seguidas. */
  private pairEvent(type: 'collide' | 'enter', a: string, b?: string) {
    const k = `${type}|${a}|${b ?? ''}`, now = this.time;
    if ((this.pairCool.get(k) ?? -1) > now) return;
    this.pairCool.set(k, now + 0.25);
    this.emit(type, { a, b });
  }

  // ---------------------------------------------------------------- bucle

  private loop(now: number) {
    if (!this.running) return;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const t0 = performance.now();
    if (!this.paused) this.tick(dt * this.timescale, dt);
    const t1 = performance.now();
    this.view.renderNow();
    this.onFrame();
    const t2 = performance.now();
    this.stats.phys += (t1 - t0 - this.stats.phys) * 0.1;
    this.stats.draw += (t2 - t1 - this.stats.draw) * 0.1;
    this.raf = requestAnimationFrame(t => this.loop(t));
  }
  private tick(dt: number, realDt: number) {
    const s = this.s;
    this.time += dt;
    this.hooks.time = this.time;
    // Las animaciones con keyframes siguen sonando (en bucle).
    const dur = s.scene.dur;
    if (dur > 0 && s.scene.objects.some(o => Object.values(o.tf).some(p => p.k?.length))) { s.s.time = this.time % dur; this.view.sync(false); }
    this.timeRules();
    for (const t of [...this.timers]) if (this.time >= t.at) { this.safe(t.fn); if (t.every > 0) t.at += t.every; else this.timers.splice(this.timers.indexOf(t), 1); }
    this.control(dt);
    this.acc += dt;
    let n = 0;
    while (this.acc >= STEP && n++ < 4) { this.forces(); this.world.step(STEP); this.acc -= STEP; }
    if (n >= 4) this.acc = 0;
    this.lights();
    this.poseStep();
    for (const e of this.audio.step(this.time, dt)) this.emit(e, {});
    this.tuberStep(dt);
    this.tweenStep();
    this.shake(realDt);
    this.output(dt);
    this.partsStep(dt);
    if (this.rec) this.record();
  }

  /** Personajes: caminar en su dirección, patrullar o seguir al ratón; saltar; mirar hacia donde van. */
  private control(dt: number) {
    for (const b of this.bodies.values()) {
      if (b.kinematic) {
        // Cinemático: sigue sus keyframes y empuja a lo dinámico.
        const W = this.s.worldMatrix(b.obj);
        const p = new T.Vector3(), q = new T.Quaternion(), sc = new T.Vector3();
        W.decompose(p, q, sc);
        const wc = b.center.clone().multiply(sc).applyQuaternion(q).add(p);
        b.body.velocity.set((wc.x - b.body.position.x) / Math.max(dt, 1e-3), (wc.y - b.body.position.y) / Math.max(dt, 1e-3), (wc.z - b.body.position.z) / Math.max(dt, 1e-3));
        b.body.position.set(wc.x, wc.y, wc.z); b.body.quaternion.set(q.x, q.y, q.z, q.w);
        continue;
      }
      const c = b.ctrl;
      if (!c) continue;
      const v = b.body.velocity;
      b.grounded = this.groundedAt(b);
      const a = c.dir * D2R;
      const fwd = new T.Vector3(Math.cos(a), 0, -Math.sin(a));
      let want = new T.Vector3();
      if (this.actorKeys(b).length) want = this.actorWant(b, c);
      else if (c.behavior === 'walk') want = fwd.clone().multiplyScalar(c.speed);
      else if (c.behavior === 'patrol') {
        const off = new T.Vector3(b.body.position.x - b.origin.x, 0, b.body.position.z - b.origin.z).dot(fwd);
        if (off > c.dist) b.patrolSign = -1; else if (off < 0) b.patrolSign = 1;
        want = fwd.clone().multiplyScalar(c.speed * b.patrolSign);
      } else if (c.behavior === 'mouse' && b.target) {
        const d = new T.Vector3(b.target.x - b.body.position.x, 0, b.target.z - b.body.position.z);
        const L = d.length();
        if (L > 0.25) want = d.multiplyScalar(Math.min(c.speed, L * 3) / L); else b.target = this.steer ? b.target : null;
      }
      if (this.grab?.info === b || this.time < b.free) continue;
      // Aceleración suave hacia la velocidad deseada (en el aire, menos control).
      const k = Math.min(1, dt * (b.grounded ? 10 : 2.5));
      v.x += (want.x - v.x) * k;
      v.z += (want.z - v.z) * k;
      if (c.lock.x) v.x = 0; if (c.lock.z) v.z = 0;
      // Mira hacia donde va.
      if (want.lengthSq() > 0.01) { const target = Math.atan2(want.x, want.z); let d = target - b.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); b.yaw += d * Math.min(1, dt * 8); }
    }
  }
  /**
   * Fuerzas de cada paso: los que flotan anulan la gravedad y vuelven a ponerse
   * derechos (como un cartel colgado de un muelle); al arrastrar, el aire frena la
   * parte que no se agarra y el objeto se inclina y gira según cómo se mueva el ratón.
   */
  private static readonly CUP = new C.Vec3(0, 1, 0);
  private _cup = new C.Vec3(); private _cax = new C.Vec3();
  private forces() {
    const g = this.world.gravity;
    for (const b of this.bodies.values()) {
      const body = b.body, ph = b.ph;
      // Siempre de pie: la inclinación de frente es sólo visual; se agarra igual y,
      // al soltarlo, se balancea y vuelve a quedar de pie (nunca vuelca).
      if (b.ctrl?.upright && body.type === C.Body.DYNAMIC) {
        if (this.grab?.info === b && this.grab.face) this.faceRoll(b, this.grab.face);
        else if (b.tilt !== 0 || b.tiltV !== 0) {
          b.tiltV += (-b.tilt * 55 - b.tiltV * 4.2) * STEP;
          b.tilt += b.tiltV * STEP;
          if (Math.abs(b.tilt) < 1e-4 && Math.abs(b.tiltV) < 1e-3) { b.tilt = 0; b.tiltV = 0; }
        }
        continue;
      }
      if (body.type !== C.Body.DYNAMIC || b.ctrl || ph.zone) continue;
      const grabbed = this.grab?.info === b;
      const m = body.mass;
      if (ph.float) { body.force.x -= g.x * m; body.force.y -= g.y * m; body.force.z -= g.z * m; }
      // Quieto y dormido: no hay nada que corregir.
      if (body.sleepState === C.Body.SLEEPING && !grabbed) continue;
      const up = body.quaternion.vmult(Live.CUP, this._cup);
      if (ph.float) {
        // Muelle que lo endereza (más flojo mientras se agarra).
        // Eje × ángulo (no × seno): sigue enderezando aunque esté muy volcado.
        const axis = up.cross(Live.CUP, this._cax), sn = axis.length();
        if (sn > 1e-6) axis.scale(Math.acos(Math.max(-1, Math.min(1, up.y))) / sn, axis);
        const k = (grabbed ? 4 : 7) * m, d = (grabbed ? 1.4 : 0.9) * m;
        const av = body.angularVelocity;
        body.torque.x += axis.x * k - av.x * d; body.torque.y += axis.y * k - av.y * d * 0.3; body.torque.z += axis.z * k - av.z * d;
      }
      if (grabbed && this.grab!.face) { this.faceRoll(b, this.grab!.face); continue; }
      if (grabbed && ph.swing > 0) {
        // Balanceo: la parte de abajo se queda atrás al arrastrar.
        const v = body.velocity;
        const sw = up.cross(new C.Vec3(v.x, 0, v.z));
        const k = ph.swing * m * 0.7;
        body.torque.vadd(new C.Vec3(sw.x * k, sw.y * k, sw.z * k), body.torque);
      }
    }
  }
  /** ¿Se inclina de frente al arrastrarlo? (por defecto, los dibujos). */
  private faces(b: BodyInfo) { return b.ph.turn ? b.ph.turn === 'face' : !!b.obj.card; }
  /**
   * Inclinación de frente: el objeto gira sólo alrededor del eje de la vista (sigue
   * mirando hacia donde miraba) y se balancea como una hoja agarrada: al mover el
   * ratón hacia un lado la parte que no se agarra se queda atrás, y al parar oscila
   * y vuelve. Muelle amortiguado, a paso fijo.
   */
  private faceRoll(b: BodyInfo, f: NonNullable<NonNullable<Live['grab']>['face']>) {
    const camQ = this.view.liveCamera.quaternion;
    const fwd = new T.Vector3(0, 0, -1).applyQuaternion(camQ), right = new T.Vector3(1, 0, 0).applyQuaternion(camQ);
    const mp = this.grab!.mouse.position, cur = new T.Vector3(mp.x, mp.y, mp.z);
    const v = cur.clone().sub(f.prev).dot(right) / STEP;
    f.prev.copy(cur);
    f.vel += (v - f.vel) * 0.25;
    const sw = Math.max(0.05, b.ph.swing);
    // Agarrado por arriba, la parte de abajo se queda atrás (y al revés si se agarra por abajo).
    const target = Math.max(-1.1, Math.min(1.1, f.vel * 0.11 * sw)) * f.side;
    const k = 55, c = 4.2 + (1 - Math.min(1, sw)) * 4;
    f.rollV += (-(f.roll - target) * k - f.rollV * c) * STEP;
    f.roll = Math.max(-1.4, Math.min(1.4, f.roll + f.rollV * STEP));
    if (b.ctrl?.upright) {
      // De pie: el cuerpo no gira; se dibuja inclinado alrededor del punto agarrado.
      b.tilt = f.roll; b.tiltV = f.rollV; b.tiltAxis.copy(fwd);
      const bp = b.body.position;
      b.tiltPivot.set(mp.x - bp.x, mp.y - bp.y, mp.z - bp.z);
      return;
    }
    const q = new T.Quaternion().setFromAxisAngle(fwd, f.roll).multiply(f.q0);
    b.body.quaternion.set(q.x, q.y, q.z, q.w);
    b.body.angularVelocity.set(0, 0, 0);
  }

  // ---------------------------------------------------------------- poses de los dibujos

  private keyIs = (want: string | undefined, k: string) => !!want?.trim() && (want.trim().length === 1 ? want.trim().toLowerCase() : want.trim()) === k;
  /** Tecla de una pose: cambia los dibujos que la usan. Devuelve si alguna la usó. */
  private poseKey(k: string, repeat: boolean): boolean {
    let used = false;
    for (const o of this.s.scene.objects) {
      const c = o.card;
      if (!c?.poses?.length) continue;
      const st = this.poses.get(o.id);
      const cur = st?.anim ? st.anim.to : st?.cur ?? null;
      let to: string | null | undefined;
      if (this.keyIs(c.baseKey ?? '0', k)) to = null;
      const p = c.poses.find(x => this.keyIs(x.key, k));
      if (p) to = p.tex;
      if (this.keyIs(c.nextKey, k)) { const list = [null, ...c.poses.map(x => x.tex)]; to = list[(list.indexOf(cur) + 1) % list.length]; }
      if (to === undefined) continue;
      used = true;
      if (!repeat) this.setPose(o, to);
    }
    return used;
  }
  /** Cambia la pose de un dibujo con su transición. */
  setPose(o: Obj3, to: string | null) {
    let st = this.poses.get(o.id);
    if (!st) {
      const v = o.mesh?.v ?? [];
      let hc = 0; for (let i = 1; i < v.length; i += 3) hc = Math.max(hc, v[i]);
      st = { cur: null, hc: hc / 2, anim: null, mod: null };
      this.poses.set(o.id, st);
    }
    if (st.anim) { this.swapPose(o.id, st, st.anim.to); st.anim = null; }
    if (to === st.cur) return;
    const tr = o.card?.trans ?? { type: 'squash' as TransType, dur: 0.45 };
    if (tr.type === 'cut' || tr.dur <= 0) { this.swapPose(o.id, st, to); return; }
    st.anim = { type: tr.type, t0: this.time, dur: Math.max(0.05, tr.dur), to, swapped: false };
  }
  private swapPose(id: string, st: { cur: string | null }, to: string | null) { st.cur = to; this.hooks.cardTex!.set(id, to); }
  /** Avanza las transiciones: escala, giro, salto y fundido alrededor de la base del dibujo. */
  private release = new Set<string>();
  private poseStep() {
    for (const id of this.release) { if (!this.poses.get(id)?.anim) this.hooks.world.delete(id); }
    this.release.clear();
    for (const [id, st] of this.poses) {
      const a = st.anim;
      if (!a) continue;
      const u = Math.min(1, (this.time - a.t0) / a.dur);
      const k = poseCurve(a.type, u);
      if (!a.swapped && u >= k.swapAt) { a.swapped = true; this.swapPose(id, st, a.to); }
      const m = (st.mod ??= new T.Matrix4());
      m.makeTranslation(0, k.dy * st.hc * 2, 0);
      if (k.rz) m.multiply(new T.Matrix4().makeTranslation(0, st.hc, 0)).multiply(new T.Matrix4().makeRotationZ(k.rz)).multiply(new T.Matrix4().makeTranslation(0, -st.hc, 0));
      if (k.ry) m.multiply(new T.Matrix4().makeRotationY(k.ry));
      m.multiply(new T.Matrix4().makeScale(k.sx, k.sy, 1));
      if (a.type === 'fade' || this.hooks.cardAlpha!.has(id)) this.hooks.cardAlpha!.set(id, k.a);
      if (u >= 1) { st.anim = null; st.mod = null; if (!a.swapped) this.swapPose(id, st, a.to); }
      // Dibujos sin cuerpo físico: se mueven aquí (los demás, en output()).
    }
  }

  // ---------------------------------------------------------------- PNGTuber

  /** Audio de la escena (pistas, micrófono, nivel y «hablando»). */
  readonly audio: LiveAudio;
  /** Estado PNGTuber de cada dibujo: textura mostrada, parpadeo y rebote al hablar. */
  private tub = new Map<string, { shown: string | null | undefined; nextBlink: number; blinkEnd: number; amp: number; hc: number }>();
  /** Matrices locales de cada dibujo (transición de pose × rebote al hablar). */
  private mods = new Map<string, T.Matrix4>();
  /** Balanceo de las partes (pelo, orejas…). */
  private parts = new Map<string, { ang: number; angV: number; prev: T.Vector3 | null }>();
  /** ¿Habla este dibujo? (con un actor elegido, sólo él; si no, todos). */
  private speaks(id: string) {
    if (!this.actor) return true;
    let o = objOf(this.s.scene, id);
    while (o) { if (o.id === this.actor.id) return true; o = o.parent ? objOf(this.s.scene, o.parent) : undefined; }
    return false;
  }
  /**
   * Boca, parpadeo y rebote: la textura mostrada sale de la expresión actual (pose)
   * y de si habla o parpadea; el rebote y el aplastado se suman a la transición de
   * pose y a la física. Sólo se cambia la textura cuando cambia algo.
   */
  private tuberStep(dt: number) {
    const sc = this.s.scene, au = this.audio, th = sc.audio?.threshold ?? 0.08;
    const lvl = au.active ? Math.max(0, (au.level - th) / Math.max(0.05, 1 - th)) : 0;
    for (const o of sc.objects) {
      const c = o.card;
      if (!c) continue;
      const tb = c.tuber, poseMod = this.poses.get(o.id)?.mod ?? null;
      let st = this.tub.get(o.id);
      if (tb) {
        if (!st) {
          const v = o.mesh?.v ?? []; let hc = 0; for (let i = 1; i < v.length; i += 3) hc = Math.max(hc, v[i]);
          st = { shown: undefined, nextBlink: this.time + 1 + Math.random() * Math.max(0.5, tb.blinkEvery), blinkEnd: 0, amp: 0, hc };
          this.tub.set(o.id, st);
        }
        const talking = au.talking && this.speaks(o.id);
        // Expresión actual y sus variantes.
        const cur = this.poses.get(o.id)?.cur ?? null;
        const pose = cur ? c.poses?.find(p => p.tex === cur) : null;
        const talkTex = pose ? pose.talk : tb.talk, blinkTex = pose ? pose.blink : tb.blink;
        // (al menos un fotograma visible aunque vaya lento)
        if (tb.blinkEvery > 0 && this.time >= st.nextBlink) { st.blinkEnd = this.time + Math.max(0.13, dt * 1.5); st.nextBlink = this.time + tb.blinkEvery * (0.6 + Math.random() * 0.8); }
        const blinking = this.time < st.blinkEnd && !!blinkTex;
        const show = blinking ? blinkTex! : talking && talkTex ? talkTex : cur;
        // (comparando con lo que se muestra: un cambio de pose también la cambia)
        if (this.hooks.cardTex!.get(o.id) !== show) this.hooks.cardTex!.set(o.id, show);
        st.shown = show;
        // Rebote al hablar (amplitud suavizada con el nivel).
        const want = talking ? Math.min(1, 0.35 + lvl * 1.6) : 0;
        st.amp += (want - st.amp) * Math.min(1, dt * (want > st.amp ? 18 : 7));
        if (tb.glow > 0) this.hooks.cardGlow!.set(o.id, st.amp * tb.glow * 0.6);
      }
      const amp = st && tb ? st.amp : 0;
      if (amp > 1e-3 || poseMod) {
        const m = this.mods.get(o.id) ?? new T.Matrix4();
        if (poseMod) m.copy(poseMod); else m.identity();
        if (amp > 1e-3 && tb && st) {
          const wob = Math.sin(this.time * 18) * 0.5 + 0.5;
          const dy = tb.bounce * 0.12 * st.hc * amp * (0.6 + 0.4 * wob);
          const sy = 1 + tb.squash * 0.14 * amp * wob, sx = 1 - tb.squash * 0.07 * amp * wob;
          m.multiply(this._m.makeTranslation(0, dy, 0)).multiply(this._m.makeScale(sx, sy, 1));
        }
        this.mods.set(o.id, m);
      } else if (this.mods.has(o.id)) {
        this.mods.delete(o.id);
        // Sin cuerpo: un fotograma en su sitio y luego vuelve a mandar el proyecto (keyframes).
        if (!this.bodies.has(o.id)) { this.hooks.world.set(o.id, this.s.worldMatrix(o).clone()); this.release.add(o.id); }
      }
      // Dibujos sin cuerpo físico: se mueven aquí (los demás, en output()).
      const mm = this.mods.get(o.id);
      if (mm && !this.bodies.has(o.id)) this.hooks.world.set(o.id, this.s.worldMatrix(o).clone().multiply(mm));
    }
  }
  /**
   * Partes que se balancean: siguen a su padre (su matriz se calcula desde la del
   * padre en vivo) con un muelle que se inclina al acelerar, como pelo u orejas.
   */
  private partsStep(dt: number) {
    if (dt <= 0) return;
    const sc = this.s.scene, world = this.hooks.world;
    for (const o of sc.objects) {
      if (!o.part || o.part.sway <= 0 || !o.parent || this.bodies.has(o.id)) continue;
      const PW = world.get(o.parent);
      if (!PW) continue;
      let st = this.parts.get(o.id);
      if (!st) { st = { ang: 0, angV: 0, prev: null }; this.parts.set(o.id, st); }
      const pos = this._v.setFromMatrixPosition(PW);
      const right = this._s.setFromMatrixColumn(PW, 0).normalize();
      const vx = st.prev ? pos.clone().sub(st.prev).dot(right) / dt : 0;
      (st.prev ??= new T.Vector3()).copy(pos);
      const target = Math.max(-0.9, Math.min(0.9, -vx * 0.14 * o.part.sway));
      // Muelle amortiguado en pasos pequeños (estable aunque el fotograma sea largo).
      for (let t = Math.min(dt, 0.25); t > 1e-6; t -= 1 / 120) {
        const h = Math.min(1 / 120, t);
        st.angV += (-(st.ang - target) * 60 - st.angV * 5) * h;
        st.ang = Math.max(-1, Math.min(1, st.ang + st.angV * h));
      }
      const W = world.get(o.id) ?? new T.Matrix4();
      // Gira alrededor de su punto de giro (donde se une al cuerpo).
      const v = o.mesh?.v ?? [], pv = o.part.pivot ?? [0.5, 0];
      const px = v.length >= 12 ? v[0] + (v[3] - v[0]) * pv[0] : 0, py = v.length >= 12 ? v[1] + (v[7] - v[1]) * pv[1] : 0;
      W.copy(PW).multiply(this.s.localMatrix(o, this.s.time)).multiply(this._m.makeTranslation(px, py, 0)).multiply(this._m2.makeRotationZ(st.ang)).multiply(this._m.makeTranslation(-px, -py, 0));
      const pm = this.mods.get(o.id);
      if (pm) W.multiply(pm);
      world.set(o.id, W);
    }
  }
  /** Pose actual de un dibujo (para el programa y las pruebas). */
  poseOf(id: string) { const st = this.poses.get(id); return { cur: st?.cur ?? null, moving: !!st?.anim }; }

  // ---------------------------------------------------------------- actores

  /** Teclas de un actor («1», «1, q», «z x»…), en minúsculas. */
  private actorKeys(b: BodyInfo): string[] {
    const k = b.ctrl?.keys?.trim();
    if (!k) return [];
    return k.split(/[\s,;]+/).filter(Boolean).map(x => (x.length === 1 ? x.toLowerCase() : x));
  }
  /** Actores de la escena (para la barra del modo En vivo). */
  actors(): { id: string; name: string; keys: string; active: boolean }[] {
    return [...this.bodies.values()].filter(b => this.actorKeys(b).length).map(b => ({ id: b.id, name: b.obj.name, keys: this.actorKeys(b).join(', ').toUpperCase(), active: this.actor === b }));
  }
  /** Elige el actor que se controla (null = ninguno). */
  selectActor(id: string | null) {
    const b = id ? this.bodies.get(id) ?? null : null;
    if (b && !this.actorKeys(b).length) return;
    if (this.actor && this.actor !== b) this.actor.target = null;
    this.actor = b;
    this.hooks.actor = b?.id ?? null;
    if (b) { b.target = null; b.body.wakeUp(); this.log(`🎮 Controlas a «${b.obj.name}»`); }
    this.onState();
  }
  get activeActor() { return this.actor?.id ?? null; }
  /** Hacia dónde quiere ir un actor: el elegido sigue las teclas o el clic; los demás esperan o vuelven a su sitio. */
  private actorWant(b: BodyInfo, c: Ctrl3): T.Vector3 {
    const pos = b.body.position;
    const toward = (x: number, z: number, stop: number) => {
      const d = new T.Vector3(x - pos.x, 0, z - pos.z), L = d.length();
      return L > stop ? d.multiplyScalar(Math.min(c.speed, L * 3) / L) : null;
    };
    if (b === this.actor) {
      const h = this.held;
      const f = new T.Vector3(0, 0, -1).applyQuaternion(this.view.liveCamera.quaternion); f.y = 0;
      if (f.lengthSq() < 1e-6) f.set(0, 0, -1);
      f.normalize();
      const r = new T.Vector3().crossVectors(f, new T.Vector3(0, 1, 0));
      const mv = new T.Vector3();
      if (h.has('w') || h.has('ArrowUp')) mv.add(f);
      if (h.has('s') || h.has('ArrowDown')) mv.sub(f);
      if (h.has('d') || h.has('ArrowRight')) mv.add(r);
      if (h.has('a') || h.has('ArrowLeft')) mv.sub(r);
      if (mv.lengthSq() > 0) { b.target = null; return mv.normalize().multiplyScalar(c.speed); }
      if (b.target) { const w = toward(b.target.x, b.target.z, 0.25); if (w) return w; if (!this.steer) b.target = null; }
      return new T.Vector3();
    }
    if (c.rest === 'return') return toward(b.origin.x, b.origin.z, 0.15) ?? new T.Vector3();
    return new T.Vector3();
  }
  /** Punto de la escena bajo el puntero (suelo, objetos, paredes) para mandar allí al actor. */
  private pointAt(e: PointerEvent, skip: string): T.Vector3 | null {
    const v = this.view;
    const hits = v.rayAt(e).intersectObjects(v.rootNode.children, true).filter(h => (h.object as T.Mesh).isMesh && h.object.visible && h.object.userData.oid && h.object.userData.oid !== skip && !h.object.userData.helper);
    return hits[0]?.point.clone() ?? v.groundAt(e);
  }

  /** ¿Apoyado en algo? (algún contacto con la normal hacia arriba). */
  private groundedAt(b: BodyInfo): boolean {
    for (const c of this.world.contacts) {
      if (c.bi === b.body && -c.ni.y > 0.5) return true;
      if (c.bj === b.body && c.ni.y > 0.5) return true;
    }
    return false;
  }
  /** Luces dinámicas: parpadeo, pulso y órbita. */
  private lights() {
    const s = this.s, t = this.time;
    for (const o of s.scene.objects) {
      if (!o.light || !o.lightFx || o.lightFx === 'none') continue;
      const tw = this.hooks.lightK.get(`tween:${o.id}`) ?? 1;
      if (o.lightFx === 'flicker') this.hooks.lightK.set(o.id, tw * (0.55 + 0.45 * (Math.sin(t * 23) * Math.sin(t * 7.3 + 1) > -0.2 ? 1 : Math.random())));
      else if (o.lightFx === 'pulse') this.hooks.lightK.set(o.id, tw * (0.6 + 0.4 * Math.sin(t * 3)));
      else if (o.lightFx === 'orbit') {
        const base = this.lightBase.get(o.id); if (!base) continue;
        const r = Math.hypot(base.x, base.z) || 3, a = Math.atan2(base.z, base.x) + t * 0.8;
        const W = s.worldMatrix(o).clone();
        W.setPosition(Math.cos(a) * r, base.y, Math.sin(a) * r);
        this.hooks.world.set(o.id, W);
      }
    }
  }
  private shake(dt: number) {
    const sh = this.hooks.shake;
    if (this.time > this.shakeEnd || this.shakeAmt <= 0) { sh.set(0, 0, 0); return; }
    const k = this.shakeAmt * ((this.shakeEnd - this.time) / Math.max(0.05, this.shakeEnd - this.time + dt));
    sh.set((Math.random() - 0.5) * k, (Math.random() - 0.5) * k, (Math.random() - 0.5) * k * 0.5);
  }
  /** Posición final de cada objeto con física (con su «gelatina» al moverse o sacudirlo). */
  // Objetos de trabajo reutilizados en cada fotograma (sin crear basura para el recolector).
  private _v = new T.Vector3(); private _p = new T.Vector3(); private _s = new T.Vector3(); private _q = new T.Quaternion();
  private _m = new T.Matrix4(); private _m2 = new T.Matrix4(); private static readonly UP = new T.Vector3(0, 1, 0);
  private output(dt: number) {
    const world = this.hooks.world;
    for (const b of this.bodies.values()) {
      if (b.ph.zone) continue;
      if (b.obj.gen?.type === 'terrain' && b.body.type === C.Body.STATIC) continue;
      const pm = this.mods.get(b.id);
      const prev = world.get(b.id);
      // Quieto: lo estático no se mueve y lo dormido sin gelatina ni transición tampoco.
      const still = b.body.type === C.Body.STATIC || (b.body.sleepState === C.Body.SLEEPING && Math.abs(b.jig) < 1e-4 && Math.abs(b.jigV) < 1e-3);
      if (prev && still && !pm && b.tilt === 0 && this.grab?.info !== b) continue;
      const bp = b.body.position, bq = b.body.quaternion;
      const v = this._v.set(b.body.velocity.x, b.body.velocity.y, b.body.velocity.z);
      // Muelle de gelatina impulsado por la aceleración.
      const w = b.ctrl?.wobble ?? (this.grab?.info === b ? Math.max(0.3, b.ph.jelly) : b.ph.jelly * 0.6);
      if (w > 0 && dt > 0) {
        const acc = Math.hypot(v.x - b.prevV.x, v.y - b.prevV.y, v.z - b.prevV.z) / dt;
        b.jigV += (-b.jig * 180 - b.jigV * 12 + Math.min(40, acc) * 0.6 * w) * dt;
        b.jig += b.jigV * dt;
        b.jig = Math.max(-0.35, Math.min(0.35, b.jig));
      }
      b.prevV.copy(v);
      const q = this._q;
      if (b.ctrl?.upright) q.setFromAxisAngle(Live.UP, b.yaw).multiply(b.rot0); else q.set(bq.x, bq.y, bq.z, bq.w);
      const sq = 1 + b.jig, st = 1 / Math.sqrt(Math.max(0.3, sq));
      const S = this._s.copy(b.scale).multiply(this._p.set(st, sq, st));
      const W = prev ?? new T.Matrix4();
      W.compose(this._p.set(bp.x, bp.y, bp.z), q, S).multiply(this._m.makeTranslation(-b.center.x, -b.center.y, -b.center.z));
      // Transición de pose (en el espacio del dibujo: base en el suelo, centrada).
      if (pm) W.multiply(pm);
      // Inclinación de frente de un personaje de pie (alrededor del punto donde se agarró).
      if (b.tilt !== 0) {
        const pv = this._p.set(bp.x, bp.y, bp.z).add(b.tiltPivot);
        this._m.makeTranslation(pv.x, pv.y, pv.z).multiply(this._m2.makeRotationAxis(b.tiltAxis, b.tilt)).multiply(this._m2.makeTranslation(-pv.x, -pv.y, -pv.z));
        W.premultiply(this._m);
      }
      if (!prev) world.set(b.id, W);
    }
  }

  // ---------------------------------------------------------------- ratón

  private down(e: PointerEvent): boolean {
    if (!this.running) return false;
    if (e.button !== 0) return false;
    const v = this.view;
    // Con un actor elegido, el clic sólo lo mueve a él (no agarra ni elige nada).
    if (this.actor && this.fx.actorClick !== false) {
      const p = this.pointAt(e, this.actor.id);
      if (p) { this.actor.target = p; this.steer = true; (e.target as HTMLElement).setPointerCapture(e.pointerId); v.controls.enabled = false; }
      return true;
    }
    // Agarrar un objeto con física (o un personaje): queda unido al puntero con un muelle.
    const hits = v.rayAt(e).intersectObjects([...this.bodies.keys()].map(id => v.nodeOf(id)?.mesh).filter((m): m is T.Mesh => !!m), false);
    const hit = hits[0];
    const info = hit ? this.bodies.get(hit.object.userData.oid as string) : undefined;
    if (hit) this.emit('click', { a: hit.object.userData.oid as string });
    if (info && info.body.type === C.Body.DYNAMIC && info.ph.grab) {
      const p = hit!.point;
      const mouse = new C.Body({ mass: 0, type: C.Body.KINEMATIC });
      mouse.collisionResponse = false;
      mouse.position.set(p.x, p.y, p.z);
      this.world.addBody(mouse);
      const local = info.body.pointToLocalFrame(new C.Vec3(p.x, p.y, p.z));
      const joint = new C.PointToPointConstraint(info.body, local, mouse, new C.Vec3(0, 0, 0), Math.max(30, info.body.mass * 80));
      this.world.addConstraint(joint);
      info.body.wakeUp();
      const cam = v.liveCamera;
      const n = new T.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      // De frente: no gira por la física; la inclinación la lleva faceRoll.
      let face: NonNullable<Live['grab']>['face'] = null;
      if (this.faces(info)) {
        const bq = info.body.quaternion;
        if (!info.ctrl?.upright) { info.body.fixedRotation = true; info.body.updateMassProperties(); }
        face = { q0: new T.Quaternion(bq.x, bq.y, bq.z, bq.w), roll: 0, rollV: 0, vel: 0, prev: p.clone(), side: local.y >= 0 ? 1 : -1 };
      }
      this.grab = { info, joint, mouse, dist: 0, plane: new T.Plane().setFromNormalAndCoplanarPoint(n, p), face };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      this.emit('grab', { a: info.id });
      v.controls.enabled = false;
      return true;
    }
    // Suelo: los personajes «seguir al ratón» van hacia ahí (manteniendo pulsado, lo siguen).
    const g = v.groundAt(e);
    const followers = [...this.bodies.values()].filter(b => b.ctrl?.behavior === 'mouse');
    if (g && followers.length) { for (const b of followers) b.target = g.clone(); this.steer = true; (e.target as HTMLElement).setPointerCapture(e.pointerId); v.controls.enabled = false; return true; }
    return false;
  }
  private move(e: PointerEvent) {
    const v = this.view;
    if (this.grab) {
      const p = new T.Vector3();
      if (v.rayAt(e).ray.intersectPlane(this.grab.plane, p)) this.grab.mouse.position.set(p.x, p.y, p.z);
      return;
    }
    if (this.steer && this.actor && this.fx.actorClick !== false) { const p = this.pointAt(e, this.actor.id); if (p) this.actor.target = p; return; }
    if (this.steer) { const g = v.groundAt(e); if (g) for (const b of this.bodies.values()) if (b.ctrl?.behavior === 'mouse') b.target = g.clone(); }
  }
  private up() {
    const v = this.view;
    if (this.grab) {
      this.world.removeConstraint(this.grab.joint);
      this.world.removeBody(this.grab.mouse);
      this.grab.info.free = this.time + 0.6;
      const f = this.grab.face, body = this.grab.info.body;
      if (f && this.grab.info.ctrl?.upright) {
        // De pie: sigue balanceándose (sólo visual, desde donde se agarró) hasta quedar derecho.
      } else if (f) {
        // Al soltarlo sigue oscilando con el giro que llevaba y luego se endereza.
        body.fixedRotation = false; body.updateMassProperties();
        const fwd = new T.Vector3(0, 0, -1).applyQuaternion(this.view.liveCamera.quaternion).multiplyScalar(f.rollV);
        body.angularVelocity.set(fwd.x, fwd.y, fwd.z);
      }
      this.emit('release', { a: this.grab.info.id });
      this.grab = null;
    }
    this.steer = false;
    v.controls.enabled = true;
  }
  /** Rueda mientras se agarra: acercar o alejar el objeto. */
  private wheel(e: WheelEvent): boolean {
    if (!this.grab) return false;
    const cam = this.view.liveCamera;
    const n = new T.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    this.grab.plane.constant += Math.sign(e.deltaY) * 0.3;
    void n;
    return true;
  }
  private key(e: KeyboardEvent) {
    if (!this.running) return;
    // Esc y F5 paran siempre (también con el foco en un deslizador del panel).
    if (e.key === 'Escape' || e.key === 'F5') { e.preventDefault(); e.stopPropagation(); this.stop(); return; }
    if (e.key === 'F9') { e.preventDefault(); e.stopPropagation(); if (!e.repeat) this.onRecordKey(); return; }
    const t = e.target as HTMLElement;
    if (t instanceof HTMLTextAreaElement || (t instanceof HTMLInputElement && !['range', 'checkbox', 'color'].includes(t.type))) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const ruleKey = (x: string) => this.rules.some(r => r.on.type === 'key' && (r.on.key ?? '').toLowerCase() === x) || this.handlers.has(`key:${x}`);
    const actorOf = [...this.bodies.values()].find(b => this.actorKeys(b).includes(k));
    const posed = this.poseKey(k, e.repeat);
    // H: ocultar o mostrar la interfaz (si ninguna regla ni actor usa la H).
    if (k === 'h' && !actorOf && !posed && !ruleKey('h') && !e.repeat) { e.preventDefault(); e.stopPropagation(); this.onToggleUi(); return; }
    // Tecla de un actor: pasa a controlarse ese; el anterior se queda quieto o vuelve a su sitio.
    if (actorOf && !e.repeat && this.actor !== actorOf) this.selectActor(actorOf.id);
    // WASD / flechas: mueven al actor elegido.
    if (this.actor && ['w', 'a', 's', 'd', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) this.held.add(k);
    // Espacio: saltan los personajes (si no hay una regla propia para el espacio); con un actor elegido, sólo él.
    if (k === ' ' && !this.rules.some(r => r.on.type === 'key' && r.on.key === ' ')) { if (this.actor) this.jump(this.actor, this.actor.ctrl?.jump ?? 5); else for (const b of this.bodies.values()) if (b.ctrl) this.jump(b, b.ctrl.jump); }
    this.emit('key', { key: k });
    e.preventDefault(); e.stopPropagation();
  }

  // ---------------------------------------------------------------- disparadores

  private emit(type: EventType, ev: { a?: string; b?: string; key?: string }) {
    for (const r of this.rules) {
      if (r.fired && r.once) continue;
      if (r.on.type !== type) continue;
      if (type === 'key' && (r.on.key ?? '').toLowerCase() !== ev.key) continue;
      if ((type === 'collide' || type === 'enter' || type === 'click' || type === 'grab' || type === 'release') && r.on.a && r.on.a !== ev.a && !(type === 'collide' && r.on.a === ev.b)) continue;
      if ((type === 'collide' || type === 'enter') && r.on.b && r.on.b !== ev.b && !(type === 'collide' && r.on.b === ev.a)) continue;
      r.fired = true;
      this.log(`▶ ${r.name}`);
      for (const a of r.do) this.act(a, ev.a);
    }
    for (const fn of this.handlers.get(type) ?? []) this.safe(() => fn(ev));
    if (type === 'key' && ev.key) for (const fn of this.handlers.get(`key:${ev.key}`) ?? []) this.safe(() => fn(ev));
  }
  private timeRules() {
    for (const r of this.rules) {
      if (r.on.type === 'time' && !r.fired && this.time >= (r.on.t ?? 0)) { r.fired = true; this.log(`▶ ${r.name}`); for (const a of r.do) this.act(a); }
      if (r.on.type === 'every' && this.time >= r.next && !(r.once && r.fired)) { r.fired = true; r.next += Math.max(0.05, r.on.t ?? 1); for (const a of r.do) this.act(a); }
    }
  }
  /** Ejecuta una acción (objetivo vacío = el objeto del suceso). */
  act(a: Act3, self?: string) {
    const id = a.target || self || '';
    const b = this.bodies.get(id);
    const dur = Math.max(0, a.dur ?? 0);
    switch (a.type) {
      case 'impulse': if (b) { const v = a.v ?? [0, 5, 0]; b.body.wakeUp(); b.body.velocity.vadd(new C.Vec3(v[0], v[1], v[2]), b.body.velocity); b.free = this.time + 0.35; } break;
      case 'jump': if (b) this.jump(b, a.value ?? b.ctrl?.jump ?? 5); break;
      case 'setdir': if (b?.ctrl) b.ctrl.dir = a.value ?? 0; break;
      case 'speed': if (b?.ctrl) b.ctrl.speed = a.value ?? 2; break;
      case 'behavior': if (b?.ctrl && a.param) b.ctrl.behavior = a.param as Ctrl3['behavior']; break;
      case 'color': { const o = this.s.obj(id); const m = o?.mats?.[0]; if (m && a.color) this.tweenColor(this.hooks.matColor, m, this.s.mat(m) ? valueAt(this.s.mat(m)!.color, 0) : '#ffffff', a.color, dur); break; }
      case 'light': { if (a.value !== undefined) { const from = this.hooks.lightK.get(`tween:${id}`) ?? 1; this.tween(k => { const x = from + (a.value! - from) * k; this.hooks.lightK.set(`tween:${id}`, x); this.hooks.lightK.set(id, x); }, dur); } if (a.color) this.tweenColor(this.hooks.lightColor, id, this.hooks.lightColor.get(id) ?? (this.s.obj(id)?.light ? valueAt(this.s.obj(id)!.light!.color, 0) : '#ffffff'), a.color, dur); break; }
      case 'fx': { const k = a.param as keyof Fx3; const f = this.hooks.fx as unknown as Record<string, number | string>; if (typeof f[k] === 'number' && a.value !== undefined) { const from = f[k] as number; this.tween(x => { f[k] = from + (a.value! - from) * x; }, dur); } else if (typeof f[k] === 'string' && a.color) f[k] = a.color; break; }
      case 'shake': this.shakeAmt = a.value ?? 0.3; this.shakeEnd = this.time + (dur || 0.5); break;
      case 'spawn': this.spawn(id, a.v ?? [0, 2, 0]); break;
      case 'hide': this.hooks.hidden.add(id); if (b) b.body.collisionResponse = false; break;
      case 'show': this.hooks.hidden.delete(id); if (b && !b.obj.phys?.zone) b.body.collisionResponse = true; break;
      case 'gravity': this.world.gravity.set(0, -(a.value ?? 9.81), 0); for (const x of this.bodies.values()) x.body.wakeUp(); break;
      case 'slowmo': { const prev = this.timescale; this.timescale = Math.max(0.05, Math.min(4, a.value ?? 0.3)); if (dur) this.after(dur, () => { this.timescale = prev; }); break; }
      case 'stop': this.stop(); break;
      case 'script': if (a.code) this.runScript(a.code, self); break;
      case 'pose': { const o = this.s.obj(id); const c = o?.card; if (o && c) { const p = a.param ? c.poses?.find(x => x.name === a.param || x.id === a.param) : null; if (!a.param || p) this.setPose(o, p ? p.tex : null); } break; }
      case 'audio': if (a.param) { if ((a.value ?? 1) > 0) this.audio.play(a.param); else this.audio.stopTrack(a.param); } else if ((a.value ?? 1) <= 0) this.audio.stopTrack(); break;
    }
  }
  private jump(b: BodyInfo, v: number) { if (b.grounded || !b.ctrl) { b.body.wakeUp(); b.body.velocity.y = v; } }
  private tween(apply: (k: number) => void, dur: number, done?: () => void) { if (dur <= 0) { apply(1); done?.(); return; } this.tweens.push({ apply, t0: this.time, dur, done }); }
  private tweenColor(map: Map<string, string>, key: string, from: string, to: string, dur: number) {
    const a = new T.Color(from), b = new T.Color(to), c = new T.Color();
    this.tween(k => { c.copy(a).lerp(b, k); map.set(key, `#${c.getHexString()}`); }, dur);
  }
  private tweenStep() { for (const t of [...this.tweens]) { const k = Math.min(1, (this.time - t.t0) / t.dur); t.apply(k); if (k >= 1) { this.tweens.splice(this.tweens.indexOf(t), 1); t.done?.(); } } }
  private after(sec: number, fn: () => void, every = 0) { this.timers.push({ at: this.time + sec, every, fn }); }
  /** Copia de un objeto en vivo (con su física), que desaparece al parar. */
  private spawn(id: string, off: number[]): string | null {
    const s = this.s, src = s.obj(id);
    if (!src?.mesh) return null;
    const n = this.view.nodeOf(id);
    if (!n) return null;
    const copyId = `${id}~${this.spawned.length}`;
    const clone = n.node.clone(true);
    clone.userData.oid = copyId;
    clone.traverse(x => { if ((x as T.Mesh).isMesh) x.userData.oid = copyId; });
    clone.matrixAutoUpdate = false;
    this.view.rootNode.add(clone);
    this.view.registerExtra(copyId, clone);
    const W = (this.hooks.world.get(id) ?? s.worldMatrix(src)).clone().premultiply(new T.Matrix4().makeTranslation(off[0], off[1], off[2]));
    const o: Obj3 = { ...structuredClone(src), id: copyId, parent: null };
    const p = new T.Vector3(), q = new T.Quaternion(), sc = new T.Vector3();
    W.decompose(p, q, sc);
    const e = new T.Euler().setFromQuaternion(q);
    Object.assign(o.tf, { px: { v: p.x }, py: { v: p.y }, pz: { v: p.z }, rx: { v: e.x / D2R }, ry: { v: e.y / D2R }, rz: { v: e.z / D2R }, sx: { v: sc.x }, sy: { v: sc.y }, sz: { v: sc.z } });
    o.phys = { ...(src.phys ?? (src.card ? cardPhys() : defaultPhys())), body: src.phys?.body === 'static' ? 'static' : 'dynamic' };
    const getW = s.worldMatrix.bind(s);
    s.worldMatrix = (x: Obj3, t?: number) => (x.id === copyId ? W.clone() : getW(x, t));
    this.addBody(o);
    s.worldMatrix = getW;
    this.spawned.push(copyId);
    return copyId;
  }

  // ---------------------------------------------------------------- programa (script)

  /** API del programa: eventos, objetos, luces, efectos, tiempo. */
  private api(self?: string) {
    const s = this.s, live = this;
    const find = (name: string) => s.scene.objects.find(o => o.name === name || o.id === name) ?? null;
    const handle = (id: string | null) => {
      if (!id) return null;
      const b = () => live.bodies.get(id);
      return {
        id, get name() { return s.obj(id.split('~')[0])?.name ?? id; },
        get pos() { const x = b()?.body.position; if (x) return [x.x, x.y, x.z]; const W = s.obj(id) ? s.worldMatrix(s.obj(id)!) : null; return W ? [W.elements[12], W.elements[13], W.elements[14]] : [0, 0, 0]; },
        set pos(p: number[]) { const x = b(); if (x) { x.body.position.set(p[0], p[1], p[2]); x.body.wakeUp(); } },
        get vel() { const x = b()?.body.velocity; return x ? [x.x, x.y, x.z] : [0, 0, 0]; },
        set vel(v: number[]) { const x = b(); if (x) { x.body.velocity.set(v[0], v[1], v[2]); x.body.wakeUp(); } },
        impulse(x: number, y: number, z: number) { live.act({ type: 'impulse', target: id, v: [x, y, z] }); },
        jump(v?: number) { live.act({ type: 'jump', target: id, value: v }); },
        dir(deg: number) { live.act({ type: 'setdir', target: id, value: deg }); },
        speed(v: number) { live.act({ type: 'speed', target: id, value: v }); },
        behavior(b2: string) { live.act({ type: 'behavior', target: id, param: b2 }); },
        color(c: string, dur = 0) { live.act({ type: 'color', target: id, color: c, dur }); },
        hide() { live.act({ type: 'hide', target: id }); }, show() { live.act({ type: 'show', target: id }); },
        /** Cambia la pose de un dibujo (nombre o número; 0 = original) con su transición. */
        pose(p: string | number) { const o = objOf(live.s.scene, id); const c = o?.card; if (!o || !c) return; const ps = c.poses ?? []; const t = typeof p === 'number' ? (p <= 0 ? null : ps[p - 1]?.tex) : p === '' ? null : ps.find(x => x.name === p)?.tex; if (t !== undefined) live.setPose(o, t ?? null); },
        spawn(x = 0, y = 2, z = 0) { return handle(live.spawn(id, [x, y, z])); },
        goTo(x: number, z: number) { const bb = b(); if (bb?.ctrl) { bb.ctrl.behavior = 'mouse'; bb.target = new T.Vector3(x, 0, z); } },
      };
    };
    return {
      self: handle(self ?? null),
      obj: (name: string) => handle(find(name)?.id ?? null),
      light: (name: string) => { const o = find(name); return o ? { intensity: (k: number, dur = 0) => live.act({ type: 'light', target: o.id, value: k, dur }), color: (c: string, dur = 0) => live.act({ type: 'light', target: o.id, color: c, dur }) } : null; },
      on: (ev: string, a: unknown, b?: unknown) => {
        const fn = (typeof a === 'function' ? a : b) as (e: unknown) => void;
        const filter = typeof a === 'string' ? find(a)?.id ?? a : null;
        const key = ev === 'key' && typeof a === 'string' ? `key:${a.toLowerCase()}` : ev;
        const wrap = (e: { a?: string; b?: string; key?: string }) => { if (filter && ev !== 'key' && e.a !== filter && e.b !== filter) return; fn({ ...e, a: handle(e.a ?? null), b: handle(e.b ?? null) }); };
        live.handlers.set(key, [...(live.handlers.get(key) ?? []), wrap]);
      },
      every: (sec: number, fn: () => void) => live.after(Math.max(0.02, sec), fn, Math.max(0.02, sec)),
      after: (sec: number, fn: () => void) => live.after(sec, fn),
      fx: (param: string, value: number | string, dur = 0) => live.act(typeof value === 'number' ? { type: 'fx', target: '', param, value, dur } : { type: 'fx', target: '', param, color: value }),
      shake: (amount = 0.3, dur = 0.5) => live.act({ type: 'shake', target: '', value: amount, dur }),
      gravity: (g: number) => live.act({ type: 'gravity', target: '', value: g }),
      slowmo: (k: number, dur = 0) => live.act({ type: 'slowmo', target: '', value: k, dur }),
      stop: () => live.stop(),
      /** Audio (PNGTuber): nivel 0..1, si habla, reproducir y parar pistas, micrófono. */
      audio: {
        get level() { return live.audio.level; },
        get talking() { return live.audio.talking; },
        play: (name: string) => live.audio.play(name),
        stop: (name?: string) => live.audio.stopTrack(name),
        mic: (on = true) => live.audio.useMic(on),
      },
      time: () => live.time,
      random: (a = 0, b = 1) => a + Math.random() * (b - a),
      log: (...m: unknown[]) => live.log(m.map(String).join(' ')),
    };
  }
  /** Ejecuta código del usuario con la API (sólo lo que el programa escribe; los errores se muestran). */
  private runScript(code: string, self?: string) {
    const api = this.api(self);
    const names = Object.keys(api);
    try {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const fn = new Function(...names, `"use strict";\n${code}`);
      fn(...names.map(n => (api as Record<string, unknown>)[n]));
    } catch (e) { this.log(`Error en el programa: ${e instanceof Error ? e.message : String(e)}`, true); }
  }
  private safe(fn: () => void) { try { fn(); } catch (e) { this.log(`Error en el programa: ${e instanceof Error ? e.message : String(e)}`, true); } }
  log(msg: string, error = false) { const l = { t: this.time, msg, error }; this.logs.push(l); if (this.logs.length > 200) this.logs.shift(); this.onLog(l); }

  // ---------------------------------------------------------------- grabar

  startRec() { this.rec = { fps: this.s.fps, frames: new Map(), n: 0, next: this.time }; this.onState(); }
  private record() {
    const r = this.rec!;
    while (this.time >= r.next) {
      for (const b of this.bodies.values()) {
        if (b.id.includes('~') || b.obj.phys?.zone || b.body.type === C.Body.STATIC) continue;
        const W = this.hooks.world.get(b.id);
        if (!W) continue;
        const list = r.frames.get(b.id) ?? [];
        list.push([...W.elements]);
        r.frames.set(b.id, list);
      }
      r.n++; r.next += 1 / r.fps;
    }
  }
  /** Termina la grabación y la pasa a keyframes en el proyecto (un paso que se puede deshacer). */
  stopRec(save: boolean): number {
    const r = this.rec;
    this.rec = null;
    this.onState();
    if (!r || !save || !r.n) return 0;
    const s = this.s;
    let keys = 0;
    s.edit('Grabar en vivo como keyframes', (_st, sc) => {
      const dur = r.n / r.fps;
      if (dur > sc.dur) sc.dur = Math.ceil(dur * 10) / 10;
      for (const [id, frames] of r.frames) {
        const o = objOf(sc, id);
        if (!o) continue;
        const parentInv = o.parent ? new T.Matrix4().copy(s.worldMatrix(objOf(sc, o.parent)!, 0)).invert() : null;
        const tracks: Record<string, { t: number; v: number }[]> = { px: [], py: [], pz: [], rx: [], ry: [], rz: [] };
        let prev: number[] | null = null;
        frames.forEach((el, i) => {
          const W = new T.Matrix4().fromArray(el);
          if (parentInv) W.premultiply(parentInv);
          const p = new T.Vector3(), q = new T.Quaternion(), sc2 = new T.Vector3();
          W.decompose(p, q, sc2);
          const e = new T.Euler().setFromQuaternion(q);
          // Ángulos continuos (sin saltos de 360°).
          const rot = [e.x / D2R, e.y / D2R, e.z / D2R].map((a, k) => { if (!prev) return a; let x = a; while (x - prev[k] > 180) x -= 360; while (x - prev[k] < -180) x += 360; return x; });
          prev = rot;
          const t = i / r.fps;
          tracks.px.push({ t, v: round(p.x) }); tracks.py.push({ t, v: round(p.y) }); tracks.pz.push({ t, v: round(p.z) });
          tracks.rx.push({ t, v: round(rot[0]) }); tracks.ry.push({ t, v: round(rot[1]) }); tracks.rz.push({ t, v: round(rot[2]) });
        });
        for (const [k, tr] of Object.entries(tracks)) {
          const ks = simplify(tr, k.startsWith('r') ? 0.5 : 0.005);
          (o.tf as unknown as Record<string, { v: number; k?: { t: number; v: number; e: 'linear' }[] }>)[k] = { v: ks[0].v, k: ks.map(x => ({ t: x.t, v: x.v, e: 'linear' as const })) };
          keys += ks.length;
        }
        // Grabado: ya no cae con la física al reproducir (las claves mandan).
        if (o.phys && o.phys.body === 'dynamic') o.phys.body = 'none';
      }
      return keys > 0;
    });
    return keys;
  }
}

/** Quita keyframes que se pueden calcular interpolando (error menor que `eps`). */
export function simplify(pts: { t: number; v: number }[], eps: number): { t: number; v: number }[] {
  if (pts.length <= 2) return pts;
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = -1, wd = eps;
    for (let i = a + 1; i < b; i++) {
      const k = (pts[i].t - pts[a].t) / (pts[b].t - pts[a].t);
      const d = Math.abs(pts[a].v + (pts[b].v - pts[a].v) * k - pts[i].v);
      if (d > wd) { wd = d; worst = i; }
    }
    if (worst >= 0) { keep[worst] = true; stack.push([a, worst], [worst, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

import * as C from 'cannon-es';
import * as T from 'three';
import { valueAt } from '../../motion/keys';
import { bounds } from '../mesh';
import { cardPhys, defaultCtrl, defaultFx, defaultPhys, effVisible, objOf, type Act3, type Ctrl3, type EventType, type Fx3, type Obj3, type Phys3, type Rule3 } from '../model';
import { round, type Studio3D } from '../Studio3D';
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
  /** Físicas efectivas (los carteles PNG sin físicas usan las de cartel). */
  ph: Phys3;
}
interface Tween { apply: (k: number) => void; t0: number; dur: number; done?: () => void }
export interface LiveLog { t: number; msg: string; error?: boolean }

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
  private grab: { info: BodyInfo; joint: C.PointToPointConstraint; mouse: C.Body; dist: number; plane: T.Plane } | null = null;
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
  /** Tecla H: ocultar o mostrar la interfaz (la pone la interfaz). */
  onToggleUi: () => void = () => {};

  constructor(private s: Studio3D, private view: View3D) {
    const fx = { ...defaultFx(), ...(s.scene.fx ?? {}) };
    this.hooks = { world: new Map(), hidden: new Set(), lightK: new Map(), lightColor: new Map(), matColor: new Map(), shake: new T.Vector3(), fx, time: 0, actor: null };
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
    for (const o of sc.objects) if (o.card && !o.phys && !this.bodies.has(o.id) && effVisible(sc, o)) this.addBody(o);
    // Personajes sin física: se les pone un cuerpo dinámico (de pie).
    for (const o of sc.objects) if (o.ctrl && !this.bodies.has(o.id) && effVisible(sc, o)) this.addBody(o, true);
    this.world.addEventListener('beginContact', (e: { bodyA: C.Body; bodyB: C.Body }) => this.contact(e.bodyA, e.bodyB));
    for (const o of sc.objects) if (o.light && o.lightFx === 'orbit') this.lightBase.set(o.id, new T.Vector3().setFromMatrixPosition(s.worldMatrix(o)));
    this.rules = (sc.rules ?? []).filter(r => r.enabled).map(r => ({ ...structuredClone(r), fired: false, next: r.on.type === 'every' ? (r.on.t ?? 1) : 0 }));
    if (runScript && sc.script?.trim()) this.runScript(sc.script);
    this.view.live = this.hooks;
    this.view.liveInput = { down: e => this.down(e), move: e => this.move(e), up: () => this.up(), wheel: e => this.wheel(e) };
    this.view.sync();
    this.time = 0;
    this.running = true;
    window.addEventListener('keydown', this.keyFn, true);
    window.addEventListener('keyup', this.keyUpFn, true);
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
    body.updateMassProperties();
    this.world.addBody(body);
    const info: BodyInfo = { id: o.id, obj: o, body, center, scale: sc, rot0: q.clone(), ctrl, origin: wc.clone(), patrolSign: 1, target: null, yaw: 0, jig: 0, jigV: 0, prevV: new T.Vector3(), grounded: false, kinematic: type === 'kinematic', free: 0, ph };
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
    this.tweenStep();
    this.shake(realDt);
    this.output(dt);
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
  private forces() {
    const g = this.world.gravity;
    for (const b of this.bodies.values()) {
      const body = b.body, ph = b.ph;
      if (body.type !== C.Body.DYNAMIC || b.ctrl || ph.zone) continue;
      const grabbed = this.grab?.info === b;
      const m = body.mass;
      if (ph.float) body.force.vadd(new C.Vec3(-g.x * m, -g.y * m, -g.z * m), body.force);
      const up = body.quaternion.vmult(new C.Vec3(0, 1, 0));
      if (ph.float) {
        // Muelle que lo endereza (más flojo mientras se agarra).
        // Eje × ángulo (no × seno): sigue enderezando aunque esté muy volcado.
        const axis = up.cross(new C.Vec3(0, 1, 0)), sn = axis.length();
        if (sn > 1e-6) axis.scale(Math.acos(Math.max(-1, Math.min(1, up.y))) / sn, axis);
        const k = (grabbed ? 4 : 7) * m, d = (grabbed ? 1.4 : 0.9) * m;
        body.torque.vadd(new C.Vec3(axis.x * k - body.angularVelocity.x * d, axis.y * k - body.angularVelocity.y * d * 0.3, axis.z * k - body.angularVelocity.z * d), body.torque);
      }
      if (grabbed && ph.swing > 0) {
        // Balanceo: la parte de abajo se queda atrás al arrastrar.
        const v = body.velocity;
        const sw = up.cross(new C.Vec3(v.x, 0, v.z));
        const k = ph.swing * m * 0.7;
        body.torque.vadd(new C.Vec3(sw.x * k, sw.y * k, sw.z * k), body.torque);
      }
    }
  }
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
  private output(dt: number) {
    for (const b of this.bodies.values()) {
      if (b.ph.zone) continue;
      const bp = b.body.position, bq = b.body.quaternion;
      const v = new T.Vector3(b.body.velocity.x, b.body.velocity.y, b.body.velocity.z);
      // Muelle de gelatina impulsado por la aceleración.
      const w = b.ctrl?.wobble ?? (this.grab?.info === b ? Math.max(0.3, b.ph.jelly) : b.ph.jelly * 0.6);
      if (w > 0 && dt > 0) {
        const acc = v.clone().sub(b.prevV).length() / dt;
        b.jigV += (-b.jig * 180 - b.jigV * 12 + Math.min(40, acc) * 0.6 * w) * dt;
        b.jig += b.jigV * dt;
        b.jig = Math.max(-0.35, Math.min(0.35, b.jig));
      }
      b.prevV.copy(v);
      let q = new T.Quaternion(bq.x, bq.y, bq.z, bq.w);
      if (b.ctrl?.upright) q = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), b.yaw).multiply(b.rot0);
      const sq = 1 + b.jig, st = 1 / Math.sqrt(Math.max(0.3, sq));
      const S = b.scale.clone().multiply(new T.Vector3(st, sq, st));
      const W = new T.Matrix4().compose(new T.Vector3(bp.x, bp.y, bp.z), q, S).multiply(new T.Matrix4().makeTranslation(-b.center.x, -b.center.y, -b.center.z));
      if (b.obj.gen?.type === 'terrain' && b.body.type === C.Body.STATIC) continue;
      this.hooks.world.set(b.id, W);
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
      this.grab = { info, joint, mouse, dist: 0, plane: new T.Plane().setFromNormalAndCoplanarPoint(n, p) };
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
    const t = e.target as HTMLElement;
    if (t instanceof HTMLTextAreaElement || (t instanceof HTMLInputElement && !['range', 'checkbox', 'color'].includes(t.type))) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const ruleKey = (x: string) => this.rules.some(r => r.on.type === 'key' && (r.on.key ?? '').toLowerCase() === x) || this.handlers.has(`key:${x}`);
    const actorOf = [...this.bodies.values()].find(b => this.actorKeys(b).includes(k));
    // H: ocultar o mostrar la interfaz (si ninguna regla ni actor usa la H).
    if (k === 'h' && !actorOf && !ruleKey('h') && !e.repeat) { e.preventDefault(); e.stopPropagation(); this.onToggleUi(); return; }
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

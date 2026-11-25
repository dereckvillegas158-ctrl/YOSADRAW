import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { ParticleSystem } from '../src/yosadraw/studio3d/live/particles';
import { ORGAN_NAMES, partShapes } from '../src/yosadraw/studio3d/live/partShapes';
import { PART_TYPES, defaultParticles, newStudio, normalizeStudio, type PartType } from '../src/yosadraw/studio3d/model';
import type { FluidCollider } from '../src/yosadraw/studio3d/live/fluid';

const cam = new T.PerspectiveCamera();
const run = (P: ParticleSystem, sec: number, dt = 1 / 60, cols: FluidCollider[] = []) => { for (let i = 0, n = Math.round(sec / dt); i < n; i++) P.step(dt, 9.81, cols, cam); };
const arr = (P: ParticleSystem) => P as unknown as { n: number; px: Float32Array; py: Float32Array; pz: Float32Array; rest: Uint8Array };
const at = (x: number, y: number, z: number) => new T.Matrix4().makeTranslation(x, y, z);

describe('Partículas', () => {
  it('formas de serie: órganos con 8 variantes, en radio 1 y con colores por vértice', () => {
    const v = partShapes('organs');
    expect(v.length).toBe(ORGAN_NAMES.length);
    for (const g of v) {
      g.computeBoundingSphere();
      expect(g.boundingSphere!.radius).toBeLessThanOrEqual(1.001);
      expect(g.attributes.color).toBeTruthy();
      expect(g.attributes.normal).toBeTruthy();
    }
    for (const t of ['bones', 'gibs', 'debris', 'coins', 'stars', 'leaves', 'confetti', 'sparks'] as PartType[]) expect(partShapes(t).length).toBeGreaterThan(0);
  });

  it('los órganos caen, no atraviesan el suelo, se quedan quietos y sangran', () => {
    const P = new ParticleSystem('medium', true, 800);
    let bled = 0;
    P.onBleed = (_x, _y, _z, n) => { bled += n; };
    P.addEmitter('o', { ...defaultParticles('organs'), burst: 0 }, at(0, 2, 0), false, {});
    P.burst('o', 16);
    run(P, 5);
    const a = arr(P);
    expect(P.count).toBe(16);
    let rest = 0;
    for (let k = 0; k < a.n; k++) { expect(a.py[k]).toBeGreaterThanOrEqual(0); rest += a.rest[k]; }
    expect(rest).toBe(16);
    expect(bled).toBeGreaterThan(10);
  });

  it('con pocos fps la física sigue al tiempo real (subpasos)', () => {
    const fall = (dt: number) => { const P = new ParticleSystem('low', false, 300); P.addEmitter('e', { ...defaultParticles('debris'), speed: 0, spread: 0, drag: 0, collide: false }, at(0, 50, 0), false, {}); P.burst('e', 1); run(P, 1, dt); return 50 - arr(P).py[0]; };
    const a = fall(1 / 60), b = fall(1 / 10);
    expect(a).toBeGreaterThan(4);
    expect(Math.abs(a - b) / a).toBeLessThan(0.12);
  });

  it('chocan con una caja de la física', () => {
    const P = new ParticleSystem('medium', false, 800);
    P.addEmitter('e', { ...defaultParticles('debris'), speed: 0.5, spread: 10, dir: 'down' }, at(0, 3, 0), false, {});
    P.burst('e', 30);
    const box: FluidCollider = { kind: 'box', pos: new T.Vector3(0, 0.5, 0), quat: new T.Quaternion(), half: new T.Vector3(1, 0.5, 1), radius: 0, still: true };
    run(P, 3, 1 / 60, [box]);
    const a = arr(P);
    for (let k = 0; k < a.n; k++) if (Math.abs(a.px[k]) < 0.9 && Math.abs(a.pz[k]) < 0.9) expect(a.py[k]).toBeGreaterThan(0.95);
  });

  it('luz dinámica: se enciende con las chispas y se apaga cuando se acaban', () => {
    const P = new ParticleSystem('medium', true, 800);
    P.addEmitter('s', { ...defaultParticles('sparks'), rate: 0 }, at(0, 1, 0), false, {});
    expect(P.lightCount).toBe(1);
    P.burst('s', 40);
    run(P, 0.1);
    const on = P.lightOf('s')!.intensity;
    run(P, 3);
    expect(on).toBeGreaterThan(0.5);
    expect(P.count).toBe(0);
    expect(P.lightOf('s')!.intensity).toBeLessThan(0.05);
  });

  it('se guardan y validan (tipo desconocido fuera, valores por defecto completos)', () => {
    const st = newStudio();
    const sc = st.scenes[0];
    sc.objects[0].particles = { type: 'organs', shape: 'object', shapeObj: 'x' } as never;
    sc.objects[1].particles = { type: 'nope' } as never;
    const n = normalizeStudio(JSON.parse(JSON.stringify(st)))!;
    const o0 = n.scenes[0].objects[0].particles!, o1 = n.scenes[0].objects[1].particles;
    expect(o0.type).toBe('organs');
    expect(o0.shape).toBe('object');
    expect(o0.bleed).toBeGreaterThan(0);
    expect(o0.stay).toBe(true);
    expect(o1).toBeUndefined();
    expect(Object.keys(PART_TYPES)).toContain('muzzle');
    expect(defaultParticles('muzzle').light).toBeGreaterThan(0);
  });
});

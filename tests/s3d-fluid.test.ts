import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { FluidSystem, type FluidCollider } from '../src/yosadraw/studio3d/live/fluid';
import { LIQUIDS, defaultFluid, newStudio, normalizeStudio } from '../src/yosadraw/studio3d/model';

const run = (F: FluidSystem, sec: number, cols: FluidCollider[] = [], t0 = 0) => { let t = t0; for (let i = 0; i < sec * 60; i++) { t += 1 / 60; F.step(1 / 60, t, 9.81, cols); } return t; };
const arr = (F: FluidSystem) => F as unknown as { n: number; px: Float32Array; py: Float32Array; pz: Float32Array; r: Float32Array };

describe('Líquidos', () => {
  it('la sangre sale, cae, no atraviesa el suelo y deja manchas', () => {
    const F = new FluidSystem('medium', true);
    F.addEmitter('e', { ...defaultFluid('blood'), rate: 120, speed: 2 }, new T.Matrix4().makeTranslation(0, 1, 0), true, 0);
    run(F, 3);
    const a = arr(F);
    expect(F.count).toBeGreaterThan(20);
    expect(F.stains).toBeGreaterThan(3);
    for (let k = 0; k < a.n; k++) expect(a.py[k]).toBeGreaterThanOrEqual(a.r[k] - 1e-6);
    F.dispose();
  });
  it('no atraviesa una caja (girada) y respeta el límite de gotas', () => {
    const F = new FluidSystem('low', false);
    F.addEmitter('e', { ...defaultFluid('water'), rate: 0, speed: 1, spread: 10, dir: 'down' }, new T.Matrix4().makeTranslation(0, 2, 0), false, 0);
    const box: FluidCollider = { kind: 'box', pos: new T.Vector3(0, 0.5, 0), quat: new T.Quaternion().setFromEuler(new T.Euler(0, 0.6, 0.2)), half: new T.Vector3(0.6, 0.5, 0.6), radius: 0, still: true };
    F.burst('e', 5000);
    expect(F.count).toBeLessThanOrEqual(700);
    run(F, 2, [box]);
    const a = arr(F), inv = box.quat.clone().invert();
    for (let k = 0; k < a.n; k++) {
      const lp = new T.Vector3(a.px[k], a.py[k], a.pz[k]).sub(box.pos).applyQuaternion(inv);
      const inside = Math.abs(lp.x) < box.half.x - 1e-3 && Math.abs(lp.y) < box.half.y - 1e-3 && Math.abs(lp.z) < box.half.z - 1e-3;
      expect(inside).toBe(false);
    }
    F.dispose();
  });
  it('los estilos crean sus mallas y los líquidos se guardan y completan', () => {
    for (const style of ['real', 'cel', 'cartoon', 'ink', 'neon'] as const) {
      const F = new FluidSystem('low', true);
      F.addEmitter('e', { ...defaultFluid('slime'), style }, new T.Matrix4(), true, 0);
      expect(F.root.children[0].children.length).toBeGreaterThanOrEqual(2);
      F.dispose();
    }
    expect(Object.keys(LIQUIDS)).toEqual(['blood', 'water', 'lava', 'slime', 'paint', 'ink']);
    const raw = JSON.parse(JSON.stringify(newStudio()));
    raw.scenes[0].objects[1].fluid = { liquid: 'lava', rate: 10 };
    raw.scenes[0].objects[2].fluid = { liquid: 'mercurio' };
    const n = normalizeStudio(raw)!;
    expect(n.scenes[0].objects[1].fluid).toMatchObject({ liquid: 'lava', rate: 10, style: 'neon', stick: 0.9 });
    expect(n.scenes[0].objects[2].fluid).toBeUndefined();
  });
});

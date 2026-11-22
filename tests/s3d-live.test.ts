import { describe, expect, it } from 'vitest';
import { simplify } from '../src/yosadraw/studio3d/live/Live';
import { defaultFx, newStudio, normalizeStudio, primObject, sceneOf } from '../src/yosadraw/studio3d/model';

describe('3D en vivo', () => {
  it('simplificar la grabación: quita lo que se puede interpolar y conserva las curvas', () => {
    const line = Array.from({ length: 31 }, (_, i) => ({ t: i / 30, v: i * 2 }));
    expect(simplify(line, 0.01).map(p => p.t)).toEqual([0, 1]);
    const parab = Array.from({ length: 31 }, (_, i) => ({ t: i / 30, v: (i / 30) ** 2 * 10 }));
    const s = simplify(parab, 0.05);
    expect(s.length).toBeGreaterThan(4);
    expect(s.length).toBeLessThan(31);
    // El error máximo entre puntos conservados es menor que la tolerancia.
    for (const p of parab) { const i = s.findIndex(x => x.t >= p.t); const a = s[Math.max(0, i - 1)], b = s[i]; const k = b.t === a.t ? 0 : (p.t - a.t) / (b.t - a.t); expect(Math.abs(a.v + (b.v - a.v) * k - p.v)).toBeLessThan(0.0501); }
  });
  it('proyectos 3D anteriores reciben física, reglas, programa y efectos por defecto; lo nuevo se valida', () => {
    const st = newStudio();
    const old = JSON.parse(JSON.stringify(st));
    delete old.scenes[0].fx; delete old.scenes[0].rules; delete old.scenes[0].script;
    const n = normalizeStudio(old)!;
    expect(sceneOf(n).fx).toEqual(defaultFx());
    expect(sceneOf(n).rules).toEqual([]);
    expect(sceneOf(n).script).toBe('');
    const o = primObject('box', st.materials[0].id);
    (o as unknown as Record<string, unknown>).phys = { body: 'dynamic', mass: 3 };
    (o as unknown as Record<string, unknown>).ctrl = { speed: 4, lock: { y: true } };
    const bad = JSON.parse(JSON.stringify(st));
    bad.scenes[0].objects.push(o);
    bad.scenes[0].rules = [{ name: 'x', on: { type: 'key', key: ' ' }, do: [{ type: 'jump', target: '' }] }, 'roto'];
    const m = normalizeStudio(bad)!;
    const x = sceneOf(m).objects.find(y => y.id === o.id)!;
    expect(x.phys).toMatchObject({ body: 'dynamic', mass: 3, bounce: 0.2, grab: true, zone: false });
    expect(x.ctrl).toMatchObject({ speed: 4, behavior: 'walk', lock: { x: false, y: true, z: false } });
    expect(sceneOf(m).rules).toHaveLength(1);
    expect(sceneOf(m).rules![0]).toMatchObject({ enabled: true, once: false });
  });
});

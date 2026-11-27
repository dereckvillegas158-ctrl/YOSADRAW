import { describe, expect, it } from 'vitest';
import { generateWeapon, guessRole, roleMotion } from '../src/yosadraw/studio3d/weaponGen';
import { CALIBERS, WEAPON_KINDS, defaultWeapon, newStudio, normalizeStudio, normalizeWeapon } from '../src/yosadraw/studio3d/model';

describe('Armas', () => {
  it('cada arma de serie tiene piezas con malla y las móviles con recorrido', () => {
    for (const k of Object.keys(WEAPON_KINDS) as (keyof typeof WEAPON_KINDS)[]) {
      const g = generateWeapon(k);
      expect(g.parts.length).toBeGreaterThanOrEqual(4);
      for (const p of g.parts) { expect(p.mesh.v.length).toBeGreaterThan(0); expect(p.mesh.f.length).toBeGreaterThan(0); expect(p.mats.length).toBeGreaterThan(0); }
      const roles = g.parts.map(p => p.role);
      expect(roles).toContain('trigger');
      const moving = g.parts.filter(p => p.role && p.role !== 'extra');
      for (const p of moving) expect([...(p.move ?? [0, 0, 0]), ...(p.rotMove ?? [0, 0, 0])].some(v => Math.abs(v) > 1e-6)).toBe(true);
      // La boca del cañón va por delante (+Z) de la ventana de expulsión.
      expect(g.muzzle[2]).toBeGreaterThan(g.eject[2]);
    }
    expect(generateWeapon('pistol').parts.map(p => p.role)).toEqual(expect.arrayContaining(['slide', 'mag', 'trigger']));
    expect(generateWeapon('shotgun').parts.map(p => p.role)).toContain('pump');
    expect(generateWeapon('revolver').parts.map(p => p.role)).toEqual(expect.arrayContaining(['cylinder', 'hammer']));
    expect(generateWeapon('sniper').parts.find(p => p.role === 'handle')?.parent).toBe('Cerrojo');
  });
  it('reconoce las piezas de un modelo importado por su nombre (español e inglés)', () => {
    expect(guessRole('Glock_Slide')).toBe('slide');
    expect(guessRole('Cargador')).toBe('mag');
    expect(guessRole('magazine.001')).toBe('mag');
    expect(guessRole('Trigger')).toBe('trigger');
    expect(guessRole('Martillo')).toBe('hammer');
    expect(guessRole('Bolt Carrier')).toBe('bolt');
    expect(guessRole('charging_handle')).toBe('handle');
    expect(guessRole('Receiver')).toBeNull();
    expect(roleMotion('slide', 0.2).move[2]).toBeLessThan(0);
    expect(roleMotion('mag', 0.2).move[1]).toBeLessThan(0);
  });
  it('se guardan y validan (calibre y acción desconocidos → por defecto)', () => {
    expect(normalizeWeapon({ kind: 'pistol', caliber: 'xx', action: 'zz', parts: [{ role: 'slide', id: 'a', move: [0, 0, -0.03] }, { role: 'nope', id: 'b' }] })).toMatchObject({ kind: 'pistol', caliber: '9mm', action: 'semi', parts: [{ role: 'slide', id: 'a' }] });
    expect(normalizeWeapon(null)).toBeUndefined();
    const st = newStudio();
    st.scenes[0].objects[0].weapon = { ...defaultWeapon('rifle'), parts: [] };
    const n = normalizeStudio(JSON.parse(JSON.stringify(st)))!;
    expect(n.scenes[0].objects[0].weapon?.kind).toBe('rifle');
    expect(n.scenes[0].objects[0].weapon?.fwd).toEqual([0, 0, 1]);
    expect(Object.keys(CALIBERS)).toContain('12g');
  });
});

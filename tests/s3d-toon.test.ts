import { describe, expect, it } from 'vitest';
import { poseCurve } from '../src/yosadraw/studio3d/live/Live';
import { TRANS_TYPES, newStudio, normalizeStudio } from '../src/yosadraw/studio3d/model';

describe('3D: poses y dibujo animado', () => {
  it('cada transición empieza y termina en el tamaño normal y cambia el dibujo una vez', () => {
    for (const [type] of TRANS_TYPES) {
      for (const u of [0, 1]) {
        const k = poseCurve(type, u);
        expect(k.sx, `${type} sx@${u}`).toBeCloseTo(1, 2);
        expect(k.sy, `${type} sy@${u}`).toBeCloseTo(1, 2);
        expect(Math.abs(k.dy), `${type} dy@${u}`).toBeLessThan(1e-6);
        expect(k.a, `${type} a@${u}`).toBeCloseTo(1, 5);
        expect(Math.abs(Math.sin(k.rz)), `${type} rz@${u}`).toBeLessThan(1e-6);
      }
      const at = poseCurve(type, 0).swapAt;
      expect(at).toBeGreaterThanOrEqual(0); expect(at).toBeLessThanOrEqual(1);
    }
    // Squash and stretch: se aplasta y luego se estira de más.
    let min = 9, max = 0;
    for (let u = 0; u <= 1; u += 0.01) { const k = poseCurve('squash', u); min = Math.min(min, k.sy); max = Math.max(max, k.sy); }
    expect(min).toBeLessThan(0.5); expect(max).toBeGreaterThan(1.05);
    // Volteo: a mitad el dibujo está de canto.
    expect(Math.abs(poseCurve('flip', 0.5).ry)).toBeCloseTo(Math.PI / 2, 2);
    expect(poseCurve('fade', 0.5).a).toBeCloseTo(0, 5);
  });
  it('cel shading, lineart y poses se completan al abrir', () => {
    const raw = JSON.parse(JSON.stringify(newStudio()));
    const sc = raw.scenes[0];
    sc.fx = { cel: { bands: 4 }, line: { width: 3, color: '#000' } };
    const o = sc.objects[1];
    o.style = { cel: { shade: 'color' }, line: { width: 2 } };
    o.card = { billboard: false, poses: [{ name: 'Feliz', tex: 't1', key: 'x' }, { bad: 1 }], trans: { type: 'flip', dur: 0.3 } };
    const n = normalizeStudio(raw)!;
    const x = n.scenes[0].objects[1];
    expect(n.scenes[0].fx!.cel).toMatchObject({ bands: 4, soft: 0.1, shade: 'ambient' });
    expect(n.scenes[0].fx!.line).toEqual({ width: 3, color: '#000' });
    expect(x.style!.cel).toMatchObject({ shade: 'color', bands: 3 });
    expect(x.style!.line).toEqual({ width: 2, color: '#111111' });
    expect(x.card!.poses!.map(p => `${p.name}:${p.key}`)).toEqual(['Feliz:x']);
    expect(x.card!.poses![0].id).toBeTruthy();
    expect(x.card!.trans).toEqual({ type: 'flip', dur: 0.3 });
  });
});

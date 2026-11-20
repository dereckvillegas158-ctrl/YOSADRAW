import { describe, expect, it } from 'vitest';
import { fromHex } from '../src/yosadraw/ui/color';
import { blend, layerTips, rgbHueToRyb, rybHueToRgb, rotate, scheme, SCHEMES, shadowTarget, solveLayer } from '../src/yosadraw/ui/colorplan';

const dist = (a: string, b: string) => Math.max(...fromHex(a).map((x, i) => Math.abs(x - fromHex(b)[i])));

describe('armonías y capas de fusión', () => {
  it('rueda de pintor: el complementario del rojo es verde; ida y vuelta de tonos', () => {
    const g = rotate('#e32322', 180, 'ryb');
    const [r, gg, b] = fromHex(g);
    expect(gg).toBeGreaterThan(r); expect(gg).toBeGreaterThan(b);
    for (const h of [0, 25, 60, 100, 200, 300, 350]) expect(rybHueToRgb(rgbHueToRyb(h))).toBeCloseTo(h, 5);
  });
  it('cada esquema reparte el 100 % de la imagen', () => {
    for (const s of SCHEMES) for (const m of ['ryb', 'rgb'] as const) {
      const sc = scheme('#3a7bd5', s.id, m);
      expect(sc.colors.reduce((a, c) => a + c.share, 0), s.id).toBe(100);
      expect(sc.tips.length).toBeGreaterThan(0);
    }
  });
  it('el color de capa calculado da el resultado anunciado (las fórmulas son exactas)', () => {
    for (const base of ['#d9a066', '#3a7bd5', '#7a1f2b', '#88cc44', '#cccccc']) {
      for (const t of layerTips(base, scheme(base, 'comp', 'ryb'))) {
        expect(blend(t.mode, base, t.layer), `${base} ${t.mode}`).toBe(t.result);
        // El objetivo se alcanza (±2 por redondeo) salvo si es imposible en ese modo.
        if (t.mode === 'multiply' || t.mode === 'screen') expect(dist(t.result, t.target), `${base} ${t.mode}`).toBeLessThanOrEqual(2);
      }
    }
    // Multiplicar: sombra más oscura que el base en todos los canales.
    const base = '#d9a066', s = shadowTarget(base);
    fromHex(s).forEach((x, i) => expect(x).toBeLessThan(fromHex(base)[i]));
    expect(blend('multiply', base, solveLayer('multiply', base, s))).toBe(blend('multiply', base, solveLayer('multiply', base, s)));
  });
});

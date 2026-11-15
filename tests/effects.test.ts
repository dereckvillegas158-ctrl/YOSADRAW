import { describe, expect, it } from 'vitest';
import { CATEGORIES, defaults, EFFECTS, hexRgb } from '../src/yosadraw/effects/effects';

describe('catálogo de efectos', () => {
  it('identificadores únicos, categorías válidas y parámetros con valores por defecto dentro de rango', () => {
    const ids = EFFECTS.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(EFFECTS.length).toBeGreaterThanOrEqual(40);
    for (const e of EFFECTS) {
      expect(CATEGORIES.some(c => c.id === e.cat)).toBe(true);
      const d = defaults(e);
      for (const p of e.params) {
        expect(d[p.key]).toBe(p.def);
        if (p.type === 'range') { expect(p.def).toBeGreaterThanOrEqual(p.min); expect(p.def).toBeLessThanOrEqual(p.max); }
        if (p.type === 'select') expect(p.options.map(o => o[0])).toContain(p.def);
      }
      // El margen (alcance) es finito y crece con la escala para los efectos espaciales.
      if (e.margin) { const m1 = e.margin(d, 1), m2 = e.margin(d, 2); expect(Number.isFinite(m1)).toBe(true); expect(m2).toBeGreaterThanOrEqual(m1); }
    }
  });
  it('todas las categorías tienen efectos y hay los pedidos', () => {
    for (const c of CATEGORIES) expect(EFFECTS.some(e => e.cat === c.id)).toBe(true);
    for (const id of ['hsl', 'replace', 'tint', 'chroma', 'gauss']) expect(EFFECTS.some(e => e.id === id)).toBe(true);
  });
  it('colores hex', () => {
    expect(hexRgb('#ff8000')).toEqual([1, 128 / 255, 0]);
  });
});

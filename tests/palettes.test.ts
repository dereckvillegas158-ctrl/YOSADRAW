import { describe, expect, it } from 'vitest';
import { harmonies, rotateHue, WHEELS } from '../src/yosadraw/ui/color';
import { normalizePalettePrefs, parsePalette, toGpl } from '../src/yosadraw/ui/palettes';

describe('paletas', () => {
  it('lee y escribe .gpl (GIMP/Krita/Inkscape) sin perder colores', () => {
    const gpl = 'GIMP Palette\nName: Atardecer\nColumns: 4\n#\n255   0   0\tRojo\n 0 128 255 Azul\n# comentario\n#00ff00\n';
    const p = parsePalette(gpl, 'x.gpl');
    expect(p.name).toBe('Atardecer');
    expect(p.colors).toEqual(['#ff0000', '#0080ff', '#00ff00']);
    expect(parsePalette(toGpl(p)).colors).toEqual(p.colors);
  });
  it('lee JSON y listas de colores; rechaza archivos sin colores', () => {
    expect(parsePalette('{"name":"Mía","colors":["#112233","no","#AABBCC"]}').colors).toEqual(['#112233', '#aabbcc']);
    expect(parsePalette('#ff0000, #00ff00 #0000ff', 'lista.txt').name).toBe('lista');
    expect(() => parsePalette('hola')).toThrow();
  });
  it('normaliza preferencias guardadas (sin duplicar las incluidas, modo por defecto el cuadro)', () => {
    const p = normalizePalettePrefs({ palettes: [{ id: 'yosadraw', name: 'x', colors: [] }, { id: 'a', name: 'A', colors: ['#000000', 'mal'] }], active: 'zzz', mode: 'raro' });
    expect(p.palettes).toEqual([{ id: 'a', name: 'A', colors: ['#000000'] }]);
    expect([p.active, p.mode, p.wheel]).toEqual(['yosadraw', 'square', 'ryb']);
  });
  it('rueda con 3 primarios, 3 secundarios y 6 terciarios; armonías correctas', () => {
    for (const w of Object.values(WHEELS)) {
      expect(w.filter(s => s.role === 'primario')).toHaveLength(3);
      expect(w.filter(s => s.role === 'secundario')).toHaveLength(3);
      expect(w).toHaveLength(12);
    }
    const hs = harmonies('#ff0000');
    expect(hs.find(h => h.id === 'comp')!.colors).toEqual(['#ff0000', '#00ffff']);
    expect(hs.find(h => h.id === 'tri')!.colors).toEqual(['#ff0000', '#00ff00', '#0000ff']);
    expect(rotateHue('#ff0000', 120)).toBe('#00ff00');
  });
});

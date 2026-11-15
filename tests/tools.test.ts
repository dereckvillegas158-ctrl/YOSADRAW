import { describe, expect, it } from 'vitest';
import { BrushLibrary } from '../src/yosadraw/brush/BrushLibrary';
import { clonePreset } from '../src/yosadraw/brush/BrushPreset';
import { BUILTIN_PRESETS, CATEGORY_ORDER, LEGACY_CATEGORY } from '../src/yosadraw/brush/builtin';
import { ColorMixer, type Sample } from '../src/yosadraw/brush/ColorMixer';
import { MemoryStorage } from '../src/yosadraw/brush/storage';
import { comboFromEvent, Keymap, normalizeCombo } from '../src/yosadraw/tools/keymap';

const key = (over: Partial<Parameters<typeof comboFromEvent>[0]>) => comboFromEvent({ key: 'a', code: 'KeyA', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...over });

describe('Atajos de teclado', () => {
  it('lee letras por tecla física y símbolos por carácter', () => {
    expect(key({ key: 'z', code: 'KeyZ', ctrlKey: true, shiftKey: true })).toBe('Ctrl+Shift+Z');
    expect(key({ key: 'Z', code: 'KeyZ', metaKey: true })).toBe('Ctrl+Z');
    expect(key({ key: '+', code: 'BracketRight', shiftKey: false })).toBe('+'); // teclado español
    expect(key({ key: '[', code: 'Quote', ctrlKey: true, altKey: true, altGraph: true })).toBe('[');
    expect(key({ key: 'Backspace', code: 'Backspace', altKey: true })).toBe('Alt+Backspace');
    expect(key({ key: 'Shift', code: 'ShiftLeft', shiftKey: true })).toBeNull();
    expect(normalizeCombo('shift + ctrl + z')).toBe('Ctrl+Shift+Z');
    expect(normalizeCombo('Ctrl++')).toBe('Ctrl++');
  });

  it('asignar un atajo ocupado se lo quita a la otra acción; se puede restablecer', () => {
    const k = new Keymap({ 'tool:a': ['B'], 'tool:b': ['N'], 'action:x': ['Ctrl+Z'] });
    expect(k.find('B')).toBe('tool:a');
    expect(k.set('tool:b', 'b')).toEqual(['tool:a']);
    expect(k.find('B')).toBe('tool:b');
    expect(k.get('tool:a')).toEqual([]);
    const saved = JSON.parse(JSON.stringify(k.toJSON()));
    const k2 = new Keymap({ 'tool:a': ['B'], 'tool:b': ['N'], 'action:x': ['Ctrl+Z'] });
    k2.load(saved);
    expect(k2.find('B')).toBe('tool:b');
    k2.reset();
    expect(k2.find('B')).toBe('tool:a');
    k2.load({ 'tool:hack': ['Q'], 'tool:a': 'no-array' });
    expect(k2.find('Q')).toBeUndefined();
  });
});

describe('Mezcla de color', () => {
  const fixed = (s: Sample) => () => s;
  it('húmedo: mezcla el color del pincel con el de la capa según "paint"', () => {
    const m = new ColorMixer({ mode: 'wet', pickup: 1, persistence: 0, paint: 0.5 }, '#ff0000', fixed([0, 0, 255, 1]));
    const c = m.next(0, 0, 10);
    expect(c[0]).toBeCloseTo(127.5, 0); expect(c[2]).toBeCloseTo(127.5, 0); expect(c[3]).toBe(1);
  });
  it('difuminar: arrastra el color de la capa sin añadir pintura y extiende la transparencia', () => {
    let s: Sample = [10, 200, 30, 1];
    const m = new ColorMixer({ mode: 'smudge', pickup: 0.8, persistence: 0.5, paint: 0 }, '#ff00ff', () => s);
    expect(m.next(0, 0, 5).slice(0, 3)).toEqual([10, 200, 30]);
    s = [255, 255, 255, 0];
    const later = Array.from({ length: 20 }, () => m.next(0, 0, 5)).pop()!;
    expect(later[3]).toBeLessThan(0.2);
    expect(later[1]).toBe(200); // el color no se contamina con lo transparente
  });
  it('sin pintura debajo, el húmedo pinta el color del pincel', () => {
    const m = new ColorMixer({ mode: 'wet', pickup: 0.8, persistence: 0.5, paint: 0.3 }, '#336699', fixed([255, 255, 255, 0]));
    expect(m.next(0, 0, 5).slice(0, 3).map(Math.round)).toEqual([51, 102, 153]);
  });
});

describe('Biblioteca por herramienta', () => {
  it('cada herramienta recuerda su pincel y usa su categoría por defecto', async () => {
    const lib = await BrushLibrary.open(new MemoryStorage());
    expect(lib.activeFor('oil', ['Óleos']).category).toBe('Óleos');
    expect(lib.activeFor('pencil', ['Lápices']).category).toBe('Lápices');
    const second = lib.presets.filter(p => p.category === 'Lápices')[1];
    lib.setActive('pencil', second.id);
    expect(lib.activeFor('pencil', ['Lápices']).id).toBe(second.id);
    expect(lib.activeFor('oil', ['Óleos']).category).toBe('Óleos');
    for (const c of ['Lápices', 'Plumas', 'Marcadores', 'Pinceles', 'Aerógrafos', 'Acuarelas', 'Óleos', 'Difuminadores', 'Borradores']) {
      expect(BUILTIN_PRESETS.some(p => p.category === c)).toBe(true);
      expect(CATEGORY_ORDER).toContain(c);
    }
    expect(BUILTIN_PRESETS.filter(p => p.mix.mode === 'smudge').every(p => p.category === 'Difuminadores')).toBe(true);
  });

  it('migra una biblioteca guardada con la versión anterior sin perder los cambios del usuario', async () => {
    const storage = new MemoryStorage();
    const old = BUILTIN_PRESETS.filter(p => p.builtinId! in LEGACY_CATEGORY).map(p => ({ ...clonePreset(p), category: LEGACY_CATEGORY[p.builtinId!] }));
    old[0].category = 'Mis favoritos'; // el usuario la cambió
    const mine = { ...clonePreset(old[1]), id: 'b_usuario', builtinId: undefined, name: 'Mío', category: 'Bocetos' };
    storage.data = { format: 'yosadraw-library', version: 1, presets: [...old, mine], activeBrushId: old[1].id, activeEraserId: old[1].id, color: '#123456' };
    const lib = await BrushLibrary.open(storage);
    expect(lib.get(old[0].id)!.category).toBe('Mis favoritos');
    expect(lib.get(old[1].id)!.category).toBe(BUILTIN_PRESETS.find(b => b.id === old[1].id)!.category);
    expect(lib.get('b_usuario')!.category).toBe('Bocetos');
    expect(lib.presets.some(p => p.builtinId === 'oil-round')).toBe(true);
    expect(lib.color).toBe('#123456');
  });
});

import { describe, expect, it } from 'vitest';
import { EFFECTS } from '../src/yosadraw/effects/effects';
import { FILTERS } from '../src/yosadraw/motion/filters';
import { applyPreset, MOTION_PRESETS, prop, valueAt } from '../src/yosadraw/motion/keys';

describe('filtros y presets de animación', () => {
  it('cada filtro usa efectos y parámetros que existen', () => {
    for (const f of FILTERS) for (const x of f.fx) {
      const def = EFFECTS.find(e => e.id === x.fx);
      expect(def, `${f.id}: ${x.fx}`).toBeTruthy();
      for (const k of Object.keys(x.p)) expect(def!.params.some(p => p.key === k), `${f.id}: ${x.fx}.${k}`).toBe(true);
    }
  });
  it('cada preset añade keyframes y termina donde empezó (entradas) o empieza donde estaba (salidas)', () => {
    for (const p of MOTION_PRESETS) {
      const tf = { x: prop(100), y: prop(100), sx: prop(1), sy: prop(1), rot: prop(0), opacity: prop(1), skx: prop(0), sky: prop(0) };
      applyPreset(tf, p.id, 4, 0.8, 1920, 1080);
      const props = Object.values(tf);
      expect(props.some(q => q.k?.length), p.id).toBe(true);
      for (const q of props) for (const k of q.k ?? []) expect(Number.isFinite(k.v as number), p.id).toBe(true);
      if (p.group === 'Entrada') for (const [n, q] of Object.entries(tf)) expect(valueAt(q, 4), `${p.id}.${n}`).toBeCloseTo(({ x: 100, y: 100, sx: 1, sy: 1, rot: 0, opacity: 1, skx: 0, sky: 0 } as Record<string, number>)[n], 3);
      if (p.group === 'Salida') for (const [n, q] of Object.entries(tf)) expect(valueAt(q, 0), `${p.id}.${n}`).toBeCloseTo(({ x: 100, y: 100, sx: 1, sy: 1, rot: 0, opacity: 1, skx: 0, sky: 0 } as Record<string, number>)[n], 3);
    }
  });
});

import { describe, expect, it } from 'vitest';
import type { StrokePoint } from '../src/core/types';
import { clonePreset, DEFAULT_PRESET, normalizePreset, type BrushPreset } from '../src/yosadraw/brush/BrushPreset';
import { BrushLibrary } from '../src/yosadraw/brush/BrushLibrary';
import { BUILTIN_PRESETS } from '../src/yosadraw/brush/builtin';
import { DabGenerator, DAB_STRIDE } from '../src/yosadraw/brush/DabGenerator';
import { tiltInfo } from '../src/yosadraw/brush/dynamics';
import { evalCurve } from '../src/yosadraw/brush/PressureCurve';
import { MemoryStorage } from '../src/yosadraw/brush/storage';

const P = (over: (p: BrushPreset) => void = () => {}) => { const p = clonePreset(DEFAULT_PRESET); over(p); return normalizePreset(p); };

/** Curva en S con presión creciente, 240 Hz. */
function stroke(n = 200, pressure = (i: number) => 0.2 + (0.8 * i) / n, tilt = { x: 0, y: 0 }): StrokePoint[] {
  return Array.from({ length: n }, (_, i) => ({ x: 50 + i * 2, y: 200 + Math.sin(i / 25) * 60, pressure: pressure(i), tiltX: tilt.x, tiltY: tilt.y, t: i * 4.17 }));
}

function dabs(p: BrushPreset, pts: StrokePoint[], seed = 7, total?: number) {
  const g = new DabGenerator(p, seed, { totalLength: total });
  pts.forEach(q => g.push(q));
  g.finish();
  const out: { x: number; y: number; d: number; flow: number; angle: number; round: number }[] = [];
  for (let i = 0; i < g.dabs.count; i++) {
    const o = i * DAB_STRIDE, a = g.dabs.data;
    out.push({ x: a[o], y: a[o + 1], d: a[o + 2], flow: a[o + 3], angle: a[o + 4], round: a[o + 5] });
  }
  return { list: out, length: g.length };
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('DabGenerator', () => {
  it('es determinista: misma semilla y puntos → mismos sellos', () => {
    const p = P(x => { x.scatter.amount = 1; x.scatter.count = 3; x.size.jitter = 0.5; x.rotation.mode = 'random'; });
    expect(dabs(p, stroke()).list).toEqual(dabs(p, stroke()).list);
    expect(dabs(p, stroke(), 8).list).not.toEqual(dabs(p, stroke(), 7).list);
  });

  it('la vista previa del tramo no altera el resultado final', () => {
    const p = P(x => { x.size.jitter = 0.4; });
    const g = new DabGenerator(p, 3);
    const tail = new (g.dabs.constructor as new () => typeof g.dabs)();
    for (const q of stroke()) { g.push(q); g.previewTail(tail); }
    g.finish();
    expect(Array.from(g.dabs.trimmed())).toEqual(Array.from(new Float32Array(dabs(p, stroke(), 3).list.flatMap(d => [d.x, d.y, d.d, d.flow, d.angle, d.round]))));
  });

  it('Spacing: la distancia entre sellos es espaciado × diámetro', () => {
    const pts = stroke(200, () => 1);
    for (const sp of [0.1, 0.5, 1.5]) {
      const { list } = dabs(P(x => { x.spacing.spacing = sp; x.pressure.size = 0; }), pts);
      const gaps = list.slice(1).map((d, i) => Math.hypot(d.x - list[i].x, d.y - list[i].y));
      expect(Math.abs(mean(gaps) - sp * 12) / (sp * 12)).toBeLessThan(0.05);
    }
  });

  it('Pressure Sensitivity: la presión cambia el tamaño y la curva lo modula', () => {
    const lin = dabs(P(x => { x.pressure.size = 1; x.size.minPercent = 0; }), stroke()).list;
    expect(lin[lin.length - 1].d).toBeGreaterThan(lin[0].d * 3);
    const soft = dabs(P(x => { x.pressure.size = 1; x.size.minPercent = 0; x.pressure.curve = [[0, 0], [0.5, 0.1], [0.8, 0.4], [1, 1]]; }), stroke()).list;
    expect(mean(soft.map(d => d.d))).toBeLessThan(mean(lin.map(d => d.d)) * 0.8);
    const flow = dabs(P(x => { x.pressure.size = 0; x.pressure.opacity = 1; }), stroke()).list;
    expect(flow[0].flow).toBeLessThan(0.35);
    expect(flow[flow.length - 1].flow).toBeGreaterThan(0.9);
  });

  it('Size Dynamics: afilado inicial/final y tamaño mínimo', () => {
    const p = P(x => { x.pressure.size = 0; x.size.taperStart = 40; x.size.taperEnd = 40; x.size.taperMin = 0; x.size.minPercent = 0.05; });
    const pts = stroke(200, () => 1);
    const len = dabs(p, pts).length;
    const { list } = dabs(p, pts, 7, len);
    expect(list[0].d).toBeLessThan(1);
    expect(list[list.length - 1].d).toBeLessThan(1.5);
    expect(Math.max(...list.map(d => d.d))).toBeCloseTo(12, 1);
    const floor = dabs(P(x => { x.pressure.size = 1; x.size.minPercent = 0.5; }), stroke(200, () => 0)).list;
    expect(Math.min(...floor.map(d => d.d))).toBeCloseTo(6, 3);
  });

  it('Scatter: dispersa perpendicularmente y multiplica los sellos', () => {
    const base = dabs(P(x => { x.pressure.size = 0; }), stroke(200, () => 1)).list;
    const sc = dabs(P(x => { x.pressure.size = 0; x.scatter.amount = 2; x.scatter.count = 4; }), stroke(200, () => 1)).list;
    expect(sc.length).toBeGreaterThan(base.length * 3.5);
    const off = (l: typeof sc) => mean(l.map(d => Math.abs(d.y - (200 + Math.sin((d.x - 50) / 2 / 25) * 60))));
    expect(off(sc)).toBeGreaterThan(off(base) + 5);
  });

  it('Rotation: fija, dirección del trazo, acimut del lápiz y aleatoria', () => {
    const horiz = Array.from({ length: 50 }, (_, i) => ({ x: i * 3, y: 0, pressure: 1, tiltX: 0, tiltY: 0, t: i * 4 }));
    const vert = horiz.map(p => ({ ...p, x: 0, y: p.x }));
    const ang = (mode: BrushPreset['rotation']['mode'], pts: StrokePoint[]) => dabs(P(x => { x.rotation.mode = mode; }), pts).list.map(d => d.angle);
    expect(new Set(ang('fixed', vert).map(a => a.toFixed(3))).size).toBe(1);
    expect(mean(ang('direction', vert))).toBeCloseTo(Math.PI / 2, 2);
    const tilted = horiz.map(p => ({ ...p, tiltX: 0, tiltY: 40 }));
    expect(mean(ang('azimuth', tilted))).toBeCloseTo(Math.PI / 2, 2);
    expect(new Set(ang('random', horiz).map(a => a.toFixed(2))).size).toBeGreaterThan(20);
  });

  it('Tilt Dynamics: la inclinación agranda y aplana la punta por encima del umbral', () => {
    const p = P(x => { x.pressure.size = 0; x.tilt.size = 1; x.tilt.roundness = 1; x.tilt.threshold = 20; });
    const flat = dabs(p, stroke(100, () => 1, { x: 0, y: 0 })).list;
    const tilt = dabs(p, stroke(100, () => 1, { x: 60, y: 0 })).list;
    expect(tilt[10].d).toBeGreaterThan(flat[10].d * 1.4);
    expect(tilt[10].round).toBeLessThan(0.7);
    const under = dabs(p, stroke(100, () => 1, { x: 15, y: 0 })).list;
    expect(under[10].d).toBeCloseTo(flat[10].d, 5);
    expect(tiltInfo(0, 0).tilt).toBe(0);
    expect(tiltInfo(45, 0).tilt).toBeCloseTo(45, 5);
  });

  it('Opacity Dynamics: flujo, variación y velocidad', () => {
    const f = dabs(P(x => { x.opacity.flow = 0.4; x.pressure.size = 0; }), stroke(100, () => 1)).list;
    expect(f.every(d => Math.abs(d.flow - 0.4) < 1e-6)).toBe(true);
    const j = dabs(P(x => { x.opacity.flowJitter = 1; }), stroke(100, () => 1)).list;
    expect(Math.min(...j.map(d => d.flow))).toBeLessThan(0.3);
    const slow = stroke(100, () => 1).map((q, i) => ({ ...q, t: i * 40 }));
    const fast = stroke(100, () => 1).map((q, i) => ({ ...q, t: i * 0.5 }));
    const sp = P(x => { x.opacity.speed = -1; });
    expect(mean(dabs(sp, fast).list.map(d => d.flow))).toBeLessThan(mean(dabs(sp, slow).list.map(d => d.flow)) * 0.5);
  });

  it('un toque sin movimiento produce un sello', () => {
    const g = new DabGenerator(P(), 1);
    g.push({ x: 10, y: 10, pressure: 1, tiltX: 0, tiltY: 0, t: 0 });
    g.finish();
    expect(g.dabs.count).toBe(1);
  });
});

describe('Curva de presión', () => {
  it('pasa por los puntos y es monótona', () => {
    const c: [number, number][] = [[0, 0], [0.3, 0.05], [0.7, 0.9], [1, 1]];
    expect(evalCurve(c, 0.3)).toBeCloseTo(0.05, 6);
    expect(evalCurve(c, 0.7)).toBeCloseTo(0.9, 6);
    let prev = -1;
    for (let x = 0; x <= 1; x += 0.01) { const y = evalCurve(c, x); expect(y).toBeGreaterThanOrEqual(prev - 1e-9); prev = y; }
  });
});

describe('Preset', () => {
  it('normaliza importaciones dañadas sin romperse', () => {
    const p = normalizePreset({ name: 42, size: { size: 1e9, jitter: 'x' }, tip: { shape: 'image' }, render: { blend: 'hack' }, pressure: { curve: [[0.5, 3], 'x'] } });
    expect(p.size.size).toBe(1000);
    expect(p.size.jitter).toBe(0);
    expect(p.tip.shape).toBe('round'); // 'image' sin imagen no es válido
    expect(p.render.blend).toBe('normal');
    expect(p.pressure.curve.length).toBeGreaterThanOrEqual(2);
    expect(normalizePreset(null).name).toBe('Pincel nuevo');
  });

  it('todos los pinceles de fábrica son válidos y distintos', () => {
    const ids = new Set(BUILTIN_PRESETS.map(p => p.id));
    expect(ids.size).toBe(BUILTIN_PRESETS.length);
    for (const p of BUILTIN_PRESETS) expect(normalizePreset(p)).toEqual(p);
    const signatures = new Set(BUILTIN_PRESETS.map(p => JSON.stringify({ ...p, id: 0, name: 0, builtinId: 0, category: 0 })));
    expect(signatures.size).toBe(BUILTIN_PRESETS.length);
  });
});

describe('BrushLibrary', () => {
  it('duplica, edita, borra, restablece, exporta, importa y guarda', async () => {
    const storage = new MemoryStorage();
    const lib = await BrushLibrary.open(storage);
    const n0 = lib.presets.length;
    const src = lib.presets[0];
    const dup = lib.duplicate(src.id)!;
    expect(dup.id).not.toBe(src.id);
    expect(dup.name).toBe(`${src.name} copia`);
    expect(lib.presets.length).toBe(n0 + 1);

    const edited = lib.update({ ...clonePreset(dup), size: { ...dup.size, size: 77 } });
    expect(edited.size.size).toBe(77);
    expect(edited.revision).toBe(dup.revision + 1);
    expect(Object.isFrozen(edited)).toBe(true);

    lib.update({ ...clonePreset(src), opacity: { ...src.opacity, opacity: 0.3 } });
    expect(lib.isModified(lib.get(src.id)!)).toBe(true);
    lib.reset(src.id);
    expect(lib.isModified(lib.get(src.id)!)).toBe(false);

    const json = lib.exportJSON([edited.id]);
    const res = lib.importJSON(json, 'prueba.yosabrush');
    expect(res.errors).toEqual([]);
    expect(res.added[0].size.size).toBe(77);
    expect(res.added[0].name).not.toBe(edited.name); // nombre único
    expect(lib.importJSON('{no json', 'x').errors.length).toBe(1);

    expect(lib.remove(dup.id)).toBe(true);
    await lib.saveNow();
    const again = await BrushLibrary.open(storage);
    expect(again.presets.map(p => p.id)).toEqual(lib.presets.map(p => p.id));
    expect(again.presets.find(p => p.id === res.added[0].id)!.size.size).toBe(77);
  });

  it('al borrar el pincel activo se elige otro y nunca queda vacía', async () => {
    const lib = await BrushLibrary.open(new MemoryStorage());
    const id = lib.activeId('brush');
    lib.remove(id);
    expect(lib.activeFor('brush')).toBeDefined();
    expect(lib.activeId('brush')).not.toBe(id);
    lib.presets.slice().forEach(p => lib.remove(p.id));
    expect(lib.presets.length).toBe(1);
  });
});

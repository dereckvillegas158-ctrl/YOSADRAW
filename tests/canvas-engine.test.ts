import { describe, expect, it } from 'vitest';
import { History } from '../src/yosadraw/engine/History';
import { projectPoints } from '../src/yosadraw/engine/StrokeRasterizer';
import { computeBounds, StrokeStore } from '../src/yosadraw/engine/StrokeStore';
import { DEFAULT_PRESET } from '../src/yosadraw/brush/BrushPreset';
import { interpolateView, invert, MAX_SCALE, multiply, ViewTransform } from '../src/yosadraw/engine/ViewTransform';
import type { StrokePoint } from '../src/core/types';

const close = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);
const pt = (x: number, y: number): StrokePoint => ({ x, y, pressure: 0.5, tiltX: 0, tiltY: 0, t: 0 });

function sampleView() {
  const v = new ViewTransform();
  v.scale = 2.7; v.rotation = 0.6; v.x = 130; v.y = -45;
  return v;
}

describe('ViewTransform', () => {
  it('toDoc es la inversa exacta de toScreen', () => {
    const v = sampleView();
    for (const [x, y] of [[0, 0], [4096, 3072], [-120.5, 77.25]]) {
      const s = v.toScreen(x, y), d = v.toDoc(s.x, s.y);
      close(d.x, x, 1e-7); close(d.y, y, 1e-7);
    }
  });

  it('matrix() coincide con toScreen y invert() con toDoc', () => {
    const v = sampleView(), m = v.matrix(), s = v.toScreen(10, 20);
    close(m[0] * 10 + m[2] * 20 + m[4], s.x); close(m[1] * 10 + m[3] * 20 + m[5], s.y);
    const id = multiply(m, invert(m));
    [1, 0, 0, 1, 0, 0].forEach((e, i) => close(id[i], e, 1e-9));
  });

  it('el zoom y la rotación mantienen fijo el punto ancla', () => {
    const v = sampleView();
    const before = v.toDoc(300, 200);
    v.zoomAt(3.3, 300, 200).rotateAt(1.1, 300, 200);
    const after = v.toDoc(300, 200);
    close(after.x, before.x, 1e-7); close(after.y, before.y, 1e-7);
  });

  it('la escala queda limitada', () => {
    const v = new ViewTransform().setScaleAt(10_000, 0, 0);
    expect(v.scale).toBe(MAX_SCALE);
  });

  it('el gesto de dos dedos deja los puntos del documento bajo los dedos', () => {
    const v = sampleView();
    const dA = v.toDoc(100, 100), dB = v.toDoc(300, 180);
    const sA = { x: 140, y: 60 }, sB = { x: 420, y: 330 };
    v.fromPointPairs(dA, dB, sA, sB);
    const a = v.toScreen(dA.x, dA.y), b = v.toScreen(dB.x, dB.y);
    close(a.x, sA.x, 1e-6); close(a.y, sA.y, 1e-6); close(b.x, sB.x, 1e-6); close(b.y, sB.y, 1e-6);
  });

  it('fit centra el documento y cabe entero, también rotado', () => {
    const v = new ViewTransform();
    v.rotation = Math.PI / 6;
    v.fit(1200, 800, 4096, 3072, 32);
    const c = v.toScreen(2048, 1536);
    close(c.x, 600, 1e-6); close(c.y, 400, 1e-6);
    for (const [x, y] of [[0, 0], [4096, 0], [0, 3072], [4096, 3072]]) {
      const s = v.toScreen(x, y);
      expect(s.x).toBeGreaterThanOrEqual(32 - 1e-6); expect(s.x).toBeLessThanOrEqual(1168 + 1e-6);
      expect(s.y).toBeGreaterThanOrEqual(32 - 1e-6); expect(s.y).toBeLessThanOrEqual(768 + 1e-6);
    }
  });

  it('visibleDocBounds contiene las cuatro esquinas de la pantalla', () => {
    const v = sampleView(), b = v.visibleDocBounds(800, 600);
    for (const [x, y] of [[0, 0], [800, 0], [0, 600], [800, 600]]) {
      const d = v.toDoc(x, y);
      expect(d.x).toBeGreaterThanOrEqual(b.minX - 1e-9); expect(d.x).toBeLessThanOrEqual(b.maxX + 1e-9);
      expect(d.y).toBeGreaterThanOrEqual(b.minY - 1e-9); expect(d.y).toBeLessThanOrEqual(b.maxY + 1e-9);
    }
  });

  it('la interpolación empieza y acaba en las vistas dadas', () => {
    const a = sampleView(), b = new ViewTransform().fit(800, 600, 4096, 3072);
    const v0 = interpolateView(a, b, 0, 800, 600), v1 = interpolateView(a, b, 1, 800, 600);
    close(v0.scale, a.scale); close(v0.x, a.x, 1e-6); close(v1.scale, b.scale); close(v1.x, b.x, 1e-6); close(v1.y, b.y, 1e-6);
  });
});

describe('History + StrokeStore', () => {
  const make = (store: StrokeStore, x: number) => {
    const points = [pt(x, 0), pt(x + 10, 5)];
    return store.create({ preset: DEFAULT_PRESET, color: '#000', tool: 'brush', seed: 1, dabs: new Float32Array(0), dabCount: 0, points, total: 11, bounds: computeBounds(points, 4) });
  };

  it('deshacer y rehacer trazos y el vaciado', () => {
    const store = new StrokeStore(), h = new History();
    const s1 = make(store, 0), s2 = make(store, 100);
    store.add(s1); h.push({ kind: 'add', stroke: s1 });
    store.add(s2); h.push({ kind: 'add', stroke: s2 });
    const op = { kind: 'clear' as const, strokes: store.strokes.slice() };
    h.push(op); store.clear();
    expect(store.count).toBe(0);

    const u1 = h.undo()!; expect(u1.kind).toBe('clear'); store.restore(op.strokes);
    expect(store.count).toBe(2);
    const u2 = h.undo()!; expect(u2.kind === 'add' && u2.stroke.id).toBe(s2.id); store.remove(s2.id);
    expect(store.strokes.map(s => s.id)).toEqual([s1.id]);
    expect(h.canRedo).toBe(true);
    const r = h.redo()!; expect(r.kind === 'add' && r.stroke.id).toBe(s2.id);
    h.push({ kind: 'add', stroke: make(store, 5) });
    expect(h.canRedo).toBe(false); // una acción nueva invalida el rehacer
  });

  it('el recorte por visibilidad descarta trazos fuera de la vista', () => {
    const store = new StrokeStore();
    store.add(make(store, 0)); store.add(make(store, 5000));
    const vis = [...store.visible({ minX: -50, minY: -50, maxX: 500, maxY: 500 })];
    expect(vis).toHaveLength(1);
    expect(store.totalPoints).toBe(4);
  });
});

describe('projectPoints', () => {
  it('proyecta a pantalla y reduce puntos sub-píxel al alejar, conservando extremos', () => {
    const pts = Array.from({ length: 101 }, (_, i) => pt(i * 0.5, 0));
    const v = new ViewTransform(); v.scale = 0.1;
    const out = projectPoints(pts, v);
    expect(out.length).toBeLessThanOrEqual(10); // 5 px de pantalla, un punto cada ≥0,6 px + el final
    close(out[0].x, 0); close(out[out.length - 1].x, 5);
    v.scale = 8;
    expect(projectPoints(pts, v)).toHaveLength(101);
  });
});

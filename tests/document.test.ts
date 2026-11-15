import { describe, expect, it } from 'vitest';
import { Document, History } from '../src/yosadraw/doc/Document';
import { dilate, floodFill, maskToRGBA, softenEdges } from '../src/yosadraw/doc/flood';
import { constrainDrag, projectOnRuler, regularPoints, symmetryMatrices, type ShapeSpec } from '../src/yosadraw/doc/geometry';
import { transformItem } from '../src/yosadraw/doc/items';
import { combine, invertSelection, selectionBounds, transformSelection } from '../src/yosadraw/doc/Selection';
import { applyMat, matScale, rotateMat, scaleMat } from '../src/yosadraw/engine/ViewTransform';

const shape = (over: Partial<ShapeSpec> = {}): ShapeSpec => ({ type: 'rect', x0: 10, y0: 10, x1: 110, y1: 60, sides: 5, inner: 0.5, radius: 0, fill: '#000', stroke: null, width: 4, opacity: 1, ...over });

describe('Document + History', () => {
  it('añade elementos, capas y deshace/rehace en orden', () => {
    const doc = new Document(1000, 800), h = new History();
    const base = doc.active.id;
    h.exec(doc.cmdAddItems(base, [doc.item({ kind: 'shape', shape: shape() })], 'Forma'));
    h.exec(doc.cmdAddLayer(base));
    const top = doc.activeId;
    expect(doc.layers.map(l => l.id)).toEqual([base, top]);
    h.exec(doc.cmdAddItems(top, [doc.item({ kind: 'shape', shape: shape({ type: 'ellipse' }) })], 'Elipse'));
    h.exec(doc.cmdLayerProps(top, { opacity: 0.5, blend: 'multiply' }));
    expect(doc.layer(top)!.opacity).toBe(0.5);
    h.undo(); expect(doc.layer(top)!.opacity).toBe(1);
    h.undo(); expect(doc.layer(top)!.items).toHaveLength(0);
    h.undo(); expect(doc.layers).toHaveLength(1); expect(doc.activeId).toBe(base);
    h.redo(); h.redo();
    expect(doc.layers).toHaveLength(2); expect(doc.layer(top)!.items).toHaveLength(1);
  });

  it('fusionar hacia abajo conserva opacidad y fusión en un grupo, y se deshace', () => {
    const doc = new Document(500, 500), h = new History();
    const a = doc.active.id;
    h.exec(doc.cmdAddItems(a, [doc.item({ kind: 'shape', shape: shape() })], 'x'));
    h.exec(doc.cmdAddLayer(a));
    const b = doc.activeId;
    h.exec(doc.cmdAddItems(b, [doc.item({ kind: 'shape', shape: shape() })], 'y'));
    h.exec(doc.cmdLayerProps(b, { opacity: 0.4 }));
    h.exec(doc.cmdMergeDown(b)!);
    expect(doc.layers).toHaveLength(1);
    const items = doc.layer(a)!.items, last = items[items.length - 1];
    expect(last.kind).toBe('group');
    expect(last.kind === 'group' && last.opacity).toBe(0.4);
    h.undo();
    expect(doc.layers.map(l => l.id)).toEqual([a, b]);
    expect(doc.layer(a)!.items).toHaveLength(1);
  });

  it('mover, duplicar y eliminar capas; nunca queda sin capas', () => {
    const doc = new Document(100, 100), h = new History();
    const a = doc.active.id;
    h.exec(doc.cmdAddLayer(a)); const b = doc.activeId;
    h.exec(doc.cmdDuplicateLayer(b)); const c = doc.activeId;
    expect(doc.layers.map(l => l.id)).toEqual([a, b, c]);
    h.exec(doc.cmdMoveLayer(c, 0)!);
    expect(doc.layers[0].id).toBe(c);
    h.undo();
    expect(doc.layers[2].id).toBe(c);
    h.exec(doc.cmdDeleteLayer(c)!); h.exec(doc.cmdDeleteLayer(b)!);
    expect(doc.cmdDeleteLayer(a)).toBeNull();
  });

  it('transformar una capa es no destructivo y recalcula las cajas', () => {
    const doc = new Document(500, 500), h = new History();
    const id = doc.active.id;
    const it = doc.item({ kind: 'shape', shape: shape() });
    h.exec(doc.cmdAddItems(id, [it], 'x'));
    h.exec(doc.cmdTransformLayer(id, scaleMat(2, 2)));
    const t = doc.layer(id)!.items[0];
    expect(t.bounds.maxX).toBeCloseTo(it.bounds.maxX * 2, 6);
    expect(t.kind === 'shape' && it.kind === 'shape' && t.shape === it.shape).toBe(true); // datos originales intactos
    h.undo();
    expect(doc.layer(id)!.items[0]).toBe(it);
    const r = transformItem(it, rotateMat(Math.PI / 2, 60, 35));
    expect(r.bounds.maxX - r.bounds.minX).toBeCloseTo(it.bounds.maxY - it.bounds.minY, 6);
  });

  it('las selecciones también se deshacen', () => {
    const doc = new Document(100, 100), h = new History();
    h.exec(doc.cmdSelection(combine(null, 'replace', { type: 'rect', x: 0, y: 0, w: 10, h: 10 })));
    h.exec(doc.cmdSelection(null));
    expect(doc.selection).toBeNull();
    h.undo();
    expect(selectionBounds(doc.selection!)).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
  });
});

describe('Cajas de contenido', () => {
  it('lo recortado por una selección no sale de ella y los borrados no cuentan como contenido', () => {
    const doc = new Document(1000, 1000), h = new History(), id = doc.active.id;
    const sel = combine(null, 'replace', { type: 'rect', x: 100, y: 100, w: 50, h: 50 });
    const g = doc.item({ kind: 'gradient', grad: { type: 'linear', x0: 0, y0: 0, x1: 10, y1: 0, c0: '#000000', c1: '#ffffff', a0: 1, a1: 1, opacity: 1 } }, { clip: sel });
    expect(g.bounds).toEqual({ minX: 100, minY: 100, maxX: 150, maxY: 150 });
    h.exec(doc.cmdAddItems(id, [g, doc.item({ kind: 'clear' }, { clip: combine(null, 'replace', { type: 'rect', x: 0, y: 0, w: 900, h: 900 }) })], 'x'));
    expect(doc.contentBounds(id)).toEqual(g.bounds);
  });
});

describe('Selección', () => {
  it('combina, transforma e invierte', () => {
    let s = combine(null, 'replace', { type: 'rect', x: 0, y: 0, w: 10, h: 10 })!;
    s = combine(s, 'add', { type: 'ellipse', cx: 30, cy: 5, rx: 5, ry: 5 })!;
    expect(selectionBounds(s)).toEqual({ minX: 0, minY: 0, maxX: 35, maxY: 10 });
    s = combine(s, 'intersect', { type: 'rect', x: 5, y: 0, w: 100, h: 100 })!;
    expect(selectionBounds(s)!.minX).toBe(5);
    expect(selectionBounds(transformSelection(s, [1, 0, 0, 1, 100, 0]))!.minX).toBe(105);
    const inv = invertSelection(s, 200, 100)!;
    expect(selectionBounds(inv)).toEqual({ minX: 0, minY: 0, maxX: 200, maxY: 100 });
    expect(combine(null, 'subtract', { type: 'rect', x: 0, y: 0, w: 1, h: 1 })).toBeNull();
  });
});

describe('Geometría', () => {
  it('polígonos, estrellas y arrastre restringido', () => {
    expect(regularPoints(shape({ type: 'polygon', sides: 6 }))).toHaveLength(6);
    const star = regularPoints(shape({ type: 'star', sides: 5, x0: 0, y0: 0, x1: 100, y1: 100, inner: 0.4 }));
    expect(star).toHaveLength(10);
    expect(Math.hypot(star[1].x - 50, star[1].y - 50)).toBeCloseTo(20, 6);
    expect(constrainDrag('rect', { x: 0, y: 0 }, { x: 30, y: 10 }, true, false)).toEqual({ x0: 0, y0: 0, x1: 30, y1: 30 });
    expect(constrainDrag('ellipse', { x: 50, y: 50 }, { x: 60, y: 70 }, false, true)).toEqual({ x0: 40, y0: 30, x1: 60, y1: 70 });
    const l = constrainDrag('line', { x: 0, y: 0 }, { x: 100, y: 8 }, true, false);
    expect(l.y1).toBeCloseTo(0, 6);
  });

  it('simetría: cada copia es una reflexión o giro correcto alrededor del centro', () => {
    const v = symmetryMatrices({ enabled: true, mode: 'vertical', cx: 100, cy: 0, count: 2 });
    const pv = applyMat(v[0], 90, 7);
    expect(pv.x).toBeCloseTo(110, 9); expect(pv.y).toBeCloseTo(7, 9);
    const q = symmetryMatrices({ enabled: true, mode: 'quadrant', cx: 0, cy: 0, count: 2 });
    expect(q.map(m => applyMat(m, 3, 4)).map(p => [Math.round(p.x), Math.round(p.y)])).toEqual([[-3, 4], [3, -4], [-3, -4]]);
    expect(symmetryMatrices({ enabled: true, mode: 'radial', cx: 0, cy: 0, count: 6 })).toHaveLength(5);
    expect(symmetryMatrices({ enabled: true, mode: 'mandala', cx: 0, cy: 0, count: 4 })).toHaveLength(7);
    expect(symmetryMatrices({ enabled: false, mode: 'radial', cx: 0, cy: 0, count: 6 })).toHaveLength(0);
    for (const m of symmetryMatrices({ enabled: true, mode: 'mandala', cx: 5, cy: 5, count: 5 })) expect(matScale(m).mean).toBeCloseTo(1, 9);
  });

  it('la regla proyecta sobre su recta', () => {
    expect(projectOnRuler({ enabled: true, x0: 0, y0: 0, x1: 10, y1: 10 }, { x: 10, y: 0 })).toEqual({ x: 5, y: 5 });
  });
});

describe('Relleno por inundación', () => {
  /** Imagen 20×20 transparente con un cuadrado negro hueco (borde de 1 px) de 4..15. */
  function img() {
    const W = 20, H = 20, d = new Uint8ClampedArray(W * H * 4);
    for (let y = 4; y <= 15; y++) for (let x = 4; x <= 15; x++) if (x === 4 || x === 15 || y === 4 || y === 15) d[(y * W + x) * 4 + 3] = 255;
    return { d, W, H };
  }
  it('rellena sólo el interior cerrado', () => {
    const { d, W, H } = img();
    const r = floodFill(d, W, H, 10, 10, 10);
    expect(r.count).toBe(10 * 10);
    expect([r.x0, r.y0, r.x1, r.y1]).toEqual([5, 5, 14, 14]);
    const out = floodFill(d, W, H, 0, 0, 10);
    expect(out.count).toBe(W * H - 12 * 12);
    expect(floodFill(d, W, H, 10, 10, 10, false).count).toBe(W * H - 44);
  });
  it('dilatar cubre el borde y el suavizado conserva el interior', () => {
    const { d, W, H } = img();
    const r = dilate(floodFill(d, W, H, 10, 10, 10), W, H, 1);
    expect([r.x0, r.x1]).toEqual([4, 15]);
    const s = softenEdges(r, W, H);
    expect(s.mask[10 * W + 10]).toBe(255);
    const rgba = maskToRGBA(r, W, [255, 0, 0]);
    expect(rgba.w).toBe(12);
    expect(rgba.data[0]).toBe(255);
  });
  it('la tolerancia compara en premultiplicado (transparente ≈ transparente)', () => {
    const W = 4, H = 1, d = new Uint8ClampedArray([255, 0, 0, 0, 0, 0, 255, 0, 0, 0, 0, 255, 0, 0, 0, 0]);
    expect(floodFill(d, W, H, 0, 0, 0).count).toBe(2);
  });
});

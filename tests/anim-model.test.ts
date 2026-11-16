import { describe, expect, it } from 'vitest';
import { Document, History, type Command } from '../src/yosadraw/doc/Document';
import {
  apply, capture, celAt, cmdAnimSettings, cmdDeleteCels, cmdGroupTracks, cmdInsertTime, cmdMakeAnimated, cmdMarker, cmdMoveCels,
  cmdNewFrame, cmdPasteCels, cmdRetime, cmdSetLength, copyCels, newAnimation, newCel,
} from '../src/yosadraw/anim/model';

function setup() {
  const doc = new Document(200, 100);
  doc.anim = newAnimation(12, 24);
  const h = new History();
  const run = (c: Command | null) => { expect(c).not.toBeNull(); capture(doc); h.exec(c!); };
  const layer = doc.layers[0];
  run(cmdMakeAnimated(doc, layer.id));
  const go = (f: number) => { capture(doc); doc.anim!.current = f; apply(doc); };
  const draw = (tag: number) => {
    // Lo que hace el motor al pintar: un comando de elementos sobre la capa en el fotograma actual.
    if (!celAt(layer, doc.anim!.current)) run(cmdNewFrame(doc, layer.id));
    run(doc.cmdAddItems(layer.id, [doc.item({ kind: 'clear' }), ...Array(tag - 1).fill(0).map(() => doc.item({ kind: 'clear' }))], 'Trazo'));
    capture(doc);
  };
  return { doc, h, run, layer, go, draw };
}

const spans = (l: { cels?: { start: number; length: number }[] }) => l.cels!.map(c => [c.start, c.length]);

describe('YOSADRAW ANIMATE: modelo', () => {
  it('cada fotograma conserva su dibujo y deshacer/rehacer funciona', () => {
    const { doc, h, layer, go, draw } = setup();
    draw(1);
    h.exec(cmdNewFrame(doc, layer.id)!);
    expect(doc.anim!.current).toBe(1);
    draw(3);
    expect(spans(layer)).toEqual([[0, 1], [1, 1]]);
    go(0);
    expect(layer.items).toHaveLength(1);
    go(1);
    expect(layer.items).toHaveLength(3);
    h.undo(); capture(doc); // quita el trazo del fotograma 1
    expect(layer.items).toHaveLength(0);
    h.undo(); capture(doc); // quita el fotograma 1
    expect(spans(layer)).toEqual([[0, 1]]);
    h.redo(); h.redo(); capture(doc);
    go(1);
    expect(layer.items).toHaveLength(3);
  });

  it('duplicar copia el dibujo y la duración; editar la copia no cambia el original', () => {
    const { doc, run, layer, go, draw } = setup();
    draw(2);
    run(cmdSetLength(doc, layer.id, layer.cels![0].id, 3));
    go(0);
    run(cmdNewFrame(doc, layer.id, true));
    expect(spans(layer)).toEqual([[0, 3], [3, 3]]);
    expect(doc.anim!.current).toBe(3);
    draw(1);
    go(0);
    expect(layer.items).toHaveLength(2);
    go(4);
    expect(layer.items).toHaveLength(3);
  });

  it('insertar en medio desplaza lo que sigue y la duración ripplea en pistas sincronizadas', () => {
    const { doc, run, layer, go } = setup();
    run(cmdNewFrame(doc, layer.id));
    run(cmdNewFrame(doc, layer.id));
    run(cmdNewFrame(doc, layer.id));
    expect(spans(layer)).toEqual([[0, 1], [1, 1], [2, 1]]);
    go(0);
    run(cmdNewFrame(doc, layer.id));
    expect(spans(layer)).toEqual([[0, 1], [1, 1], [2, 1], [3, 1]]);
    run(cmdSetLength(doc, layer.id, layer.cels![0].id, 2));
    expect(spans(layer)).toEqual([[0, 2], [2, 1], [3, 1], [4, 1]]);
    // Pista 2 sincronizada: el tiempo insertado en la 1 también la desplaza.
    const l2 = doc.newLayer('B'); doc.layers.push(l2);
    l2.cels = [newCel(2, 2)]; l2.sync = true; layer.sync = true;
    go(1);
    run(cmdInsertTime(doc, layer.id, 2));
    expect(spans(layer)).toEqual([[0, 4], [4, 1], [5, 1], [6, 1]]);
    expect(spans(l2)).toEqual([[4, 2]]);
    run(cmdInsertTime(doc, layer.id, -3));
    expect(spans(layer)).toEqual([[0, 1], [1, 1], [2, 1], [3, 1]]);
    expect(spans(l2)).toEqual([[1, 2]]);
  });

  it('mover, copiar, borrar con cierre de hueco, pegar y exponer en doses', () => {
    const { doc, run, layer, go } = setup();
    for (let i = 0; i < 3; i++) run(cmdNewFrame(doc, layer.id));
    const ids = layer.cels!.map(c => ({ layer: layer.id, cel: c.id }));
    expect(cmdMoveCels(doc, [ids[0]], 1)).toBeNull(); // chocaría
    run(cmdMoveCels(doc, [ids[2]], 5));
    expect(spans(layer)).toEqual([[0, 1], [1, 1], [7, 1]]);
    run(cmdDeleteCels(doc, [ids[1]], true));
    expect(spans(layer)).toEqual([[0, 1], [6, 1]]);
    const clip = copyCels(doc, [{ layer: layer.id, cel: layer.cels![0].id }])!;
    go(6);
    run(cmdPasteCels(doc, clip, layer.id));
    expect(spans(layer)).toEqual([[0, 1], [6, 1], [7, 1]]);
    run(cmdRetime(doc, layer.id, 2));
    expect(spans(layer)).toEqual([[0, 2], [2, 2], [4, 2]]);
  });

  it('ajustes, marcadores y grupos se deshacen', () => {
    const { doc, h, run, layer } = setup();
    run(cmdAnimSettings(doc, { fps: 24, range: [5, 2] }));
    expect(doc.anim!.fps).toBe(24);
    expect(doc.anim!.range).toEqual([2, 5]);
    run(cmdMarker(doc, { add: { frame: 3, name: 'Golpe', color: '#ff0' } }));
    expect(doc.anim!.markers.map(m => m.name)).toEqual(['Golpe']);
    const l2 = doc.newLayer('B'); doc.layers.unshift(l2); const l3 = doc.newLayer('C'); doc.layers.push(l3);
    run(cmdGroupTracks(doc, [l2.id, l3.id], 'Personaje'));
    const order = doc.layers.map(l => l.name);
    expect(order.indexOf('C') - order.indexOf('B')).toBe(1);
    expect(doc.layer(l2.id)!.group).toBe(doc.anim!.groups[0].id);
    h.undo(); h.undo(); h.undo();
    expect(doc.anim!.fps).toBe(12);
    expect(doc.anim!.markers).toEqual([]);
    expect(doc.anim!.groups).toEqual([]);
    expect(layer.cels).toBeDefined();
  });
});

describe('YOSADRAW ANIMATE: interpolación', () => {
  it('genera intermedios transformados, en doses, y la clave final', async () => {
    const { transformItem } = await import('../src/yosadraw/doc/items');
    const { cmdTween, alongPath } = await import('../src/yosadraw/anim/model');
    const doc = new Document(400, 300);
    doc.anim = newAnimation(12, 10);
    const l = doc.layers[0];
    const shape = doc.item({ kind: 'shape', shape: { type: 'rect', x0: 0, y0: 0, x1: 20, y1: 20, sides: 4, inner: 0.5, radius: 0, fill: '#000000', stroke: null, width: 1, opacity: 1 } });
    l.cels = [newCel(0, 1, [shape]), newCel(1, 1)];
    apply(doc);
    const h = new History();
    h.exec(cmdTween(doc, l.id, l.cels[0].id, { frames: 6, step: 2, dx: 100, dy: 0, rotate: 0, scale: 1, opacity: 0.5, ease: 'linear' }, transformItem)!);
    expect(l.cels!.map(c => [c.start, c.length, c.key])).toEqual([[0, 1, true], [1, 2, false], [3, 2, false], [5, 2, true], [7, 1, true]]);
    const last = l.cels![3].content.items[0];
    expect(last.kind).toBe('group');
    if (last.kind === 'group') {
      expect(last.opacity).toBeCloseTo(0.5);
      expect(last.items[0].bounds.minX).toBeCloseTo(shape.bounds.minX + 100);
    }
    expect(alongPath([0, 0, 10, 0, 10, 10], 0.75)).toEqual({ x: 10, y: 5, angle: Math.PI / 2 });
    h.undo();
    expect(l.cels!.length).toBe(2);
  });
});

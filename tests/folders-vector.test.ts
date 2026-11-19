import { describe, expect, it } from 'vitest';
import { strToU8 } from 'fflate';
import { Document } from '../src/yosadraw/doc/Document';
import { cmdDeleteFolder, cmdFolderProps, cmdLayerToFolder, cmdMoveLayerFolders, cmdNewFolder, folderOf, layerLocked, layerVisible, membersOf } from '../src/yosadraw/doc/folders';
import { dragNode, nodeIndices, simplifyStroke, smoothStroke } from '../src/yosadraw/doc/vector';
import { readProject, writeProject, type ImageCodec } from '../src/yosadraw/project/format';

const codec: ImageCodec = { async encode() { return strToU8('{}'); }, async decode() { return {} as CanvasImageSource; } };
const run = (c: { redo(): void; undo(): void } | null) => { c!.redo(); return c!; };

function doc4() {
  const d = new Document(200, 100);
  for (let i = 0; i < 3; i++) run(d.cmdAddLayer(d.activeId));
  return d; // capas 0..3 de abajo arriba
}

describe('carpetas de capas', () => {
  it('crear, meter, sacar, mover por los bordes y deshacer', () => {
    const d = doc4();
    const [a, b, c] = d.layers;
    const mk = run(cmdNewFolder(d, b.id, 'F'));
    const f = folderOf(d, b)!;
    expect(f.name).toBe('F');
    run(cmdLayerToFolder(d, a.id, f.id));
    expect(membersOf(d, f.id).map(l => l.id)).toEqual([b.id, a.id]);
    expect(d.layers.indexOf(a)).toBe(d.layers.indexOf(b) + 1); // seguidas
    // Subir la de arriba de la carpeta: sale sin moverse.
    const i0 = d.index(a.id);
    run(cmdMoveLayerFolders(d, a.id, 1));
    expect(a.group).toBeNull(); expect(d.index(a.id)).toBe(i0);
    // Bajar de nuevo: entra.
    run(cmdMoveLayerFolders(d, a.id, -1));
    expect(a.group).toBe(f.id);
    run(cmdFolderProps(d, f.id, { visible: false, locked: true }));
    expect(layerVisible(d, b)).toBe(false); expect(layerLocked(d, b)).toBe(true); expect(layerVisible(d, c)).toBe(true);
    const del = run(cmdDeleteFolder(d, f.id, true));
    expect(d.layers.length).toBe(2);
    del.undo();
    expect(d.layers.length).toBe(4); expect(b.group).toBe(f.id);
    mk.undo; // (los anteriores también se deshacen con su comando)
  });
  it('se guarda y se abre (carpetas, pertenencia, capa vectorial)', async () => {
    const d = doc4();
    run(cmdNewFolder(d, d.layers[1].id, 'Personaje'));
    const f = d.folders[0];
    run(cmdFolderProps(d, f.id, { opacity: 0.5, blend: 'multiply' }));
    d.layers[2].vector = true;
    const r = await readProject(await writeProject(d, { id: 'x', name: 'x', width: 200, height: 100, dpi: 72, background: null, profile: 'srgb', created: 1, modified: 1, layers: 4, anim: null, motion: null, source: 'yosa', rev: 1, app: 't' }, { codec }), codec);
    expect(r.doc.folders).toEqual([{ ...f, opacity: 0.5, blend: 'multiply' }]);
    expect(r.doc.layers[1].group).toBe(f.id);
    expect(r.doc.layers[2].vector).toBe(true);
    expect(r.doc.layers[0].vector).toBeUndefined();
  });
});

describe('trazos vectoriales', () => {
  const line = Array.from({ length: 41 }, (_, i) => ({ x: i * 5, y: 0, pressure: 0.5, tiltX: 0, tiltY: 0, t: i }));
  it('arrastrar un nodo deforma con caída suave y deja quietos los lejanos', () => {
    const out = dragNode(line, 20, 0, 30, 40);
    expect(out[20].y).toBeCloseTo(30);
    expect(out[18].y).toBeGreaterThan(20); expect(out[18].y).toBeLessThan(30);
    expect(out[0].y).toBe(0); expect(out[40].y).toBe(0); expect(out[10].y).toBe(0);
  });
  it('simplificar una recta deja sólo los extremos; suavizar no mueve los extremos', () => {
    expect(simplifyStroke(line, 0.5).length).toBe(2);
    const zig = line.map((p, i) => ({ ...p, y: i % 2 ? 4 : 0 }));
    const sm = smoothStroke(zig, 3);
    expect(sm[0]).toEqual(zig[0]); expect(sm[40]).toEqual(zig[40]);
    expect(Math.max(...sm.slice(5, 35).map(p => p.y)) - Math.min(...sm.slice(5, 35).map(p => p.y))).toBeLessThan(1.5);
    expect(nodeIndices(line, 50)).toEqual([0, 10, 20, 30, 40]);
  });
});

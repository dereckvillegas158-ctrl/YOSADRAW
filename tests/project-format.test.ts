import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { BUILTIN_PRESETS } from '../src/yosadraw/brush/builtin';
import type { FinishedStroke } from '../src/yosadraw/brush/BrushStrokeSession';
import { Document } from '../src/yosadraw/doc/Document';
import { normalizeMeta, ProjectFormatError, readProject, readProjectInfo, writeProject, type ImageCodec } from '../src/yosadraw/project/format';

/** Imagen falsa: sólo dimensiones y un contenido identificable. */
class FakeImage { constructor(public width: number, public height: number, public tag: string) {} }
const codec: ImageCodec = {
  async encode(img) { const f = img as unknown as FakeImage; return strToU8(JSON.stringify(f)); },
  async decode(png) { const o = JSON.parse(new TextDecoder().decode(png)); return new FakeImage(o.width, o.height, o.tag) as unknown as CanvasImageSource; },
};

function stroke(preset = BUILTIN_PRESETS[0], color = '#123456'): FinishedStroke {
  const dabs = new Float32Array([10, 20, 5, 0.8, 0.1, 1, 30, 40, 6, 0.9, 0.2, 1]);
  return {
    preset, color, tool: 'brush', seed: 4242, total: 33.5,
    sets: [{ dabs, count: 2, colors: new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 200]) }],
    points: [{ x: 10.25, y: 20.5, pressure: 0.33, tiltX: 12, tiltY: -7, t: 1234567.891 }, { x: 30, y: 40, pressure: 1, tiltX: 0, tiltY: 0, t: 1234600 }],
    mirrors: [[-1, 0, 0, 1, 200, 0]],
    bounds: { minX: 5, minY: 15, maxX: 36, maxY: 46 },
  };
}

function sampleDoc() {
  const doc = new Document(1200, 800, { background: null, dpi: 600, profile: 'p3' });
  const l1 = doc.layers[0];
  const mask = new FakeImage(50, 40, 'varita');
  const clip = { ops: [{ mode: 'add' as const, shape: { type: 'rect' as const, x: 0, y: 0, w: 100, h: 100 } }, { mode: 'subtract' as const, shape: { type: 'mask' as const, x: 5, y: 6, w: 50, h: 40, canvas: mask as unknown as CanvasImageSource } }] };
  l1.items.push(doc.item({ kind: 'stroke', stroke: stroke() }, { clip }));
  l1.items.push(doc.item({ kind: 'stroke', stroke: { ...stroke(BUILTIN_PRESETS[0], '#ff0000'), sets: [{ dabs: new Float32Array(6), count: 1 }] } }, { m: [2, 0, 0, 2, 10, 10] }));
  const l2 = doc.newLayer('Tinta');
  Object.assign(l2, { opacity: 0.7, blend: 'multiply', locked: true, visible: false, alphaLock: true });
  doc.layers.push(l2);
  l2.items.push(doc.paintItem(l2.id, { kind: 'shape', shape: { type: 'star', x0: 0, y0: 0, x1: 90, y1: 90, sides: 5, inner: 0.5, radius: 0, fill: '#00ff00', stroke: null, width: 2, opacity: 1 } }));
  l2.items.push(doc.item({ kind: 'gradient', grad: { type: 'radial', x0: 1, y0: 2, x1: 3, y1: 4, c0: '#000000', c1: '#ffffff', a0: 1, a1: 0, opacity: 0.5 } }));
  l2.items.push(doc.item({ kind: 'bitmap', image: new FakeImage(64, 32, 'relleno') as unknown as CanvasImageSource, x: 3, y: 4, w: 64, h: 32 }));
  l2.items.push(doc.item({ kind: 'clear' }, { clip: { ops: [{ mode: 'add', shape: { type: 'ellipse', cx: 5, cy: 5, rx: 3, ry: 2 } }] } }));
  l2.items.push(doc.item({ kind: 'group', opacity: 0.5, blend: 'screen', items: [doc.item({ kind: 'stroke', stroke: stroke() })] }));
  doc.activeId = l2.id;
  doc.selection = { ops: [{ mode: 'add', shape: { type: 'poly', pts: [0, 0, 10, 0, 10, 10] } }, { mode: 'intersect', shape: { type: 'sel', sel: { ops: [{ mode: 'add', shape: { type: 'rect', x: 1, y: 1, w: 5, h: 5, m: [1, 0, 0, 1, 2, 2] } }] } } }] };
  return doc;
}

const meta = normalizeMeta({ id: 'abc', name: 'Prueba', created: 1000, modified: 2000, rev: 3 });

describe('formato .yosa', () => {
  it('guarda las imágenes de referencia (imagen, ventana, zoom y opacidad)', async () => {
    const doc = new Document(300, 200);
    doc.references.push({ id: 'r1', name: 'Pose', image: new FakeImage(80, 60, 'pose') as unknown as HTMLCanvasElement, rect: [0.1, 0.2, 0.3, 0.4], zoom: 2.5, pan: [40, 30], opacity: 0.5 });
    const r = await readProject(await writeProject(doc, meta, { codec }), codec);
    const ref = r.doc.references[0];
    expect(r.doc.references).toHaveLength(1);
    expect({ ...ref, image: undefined }).toEqual({ id: 'r1', name: 'Pose', image: undefined, rect: [0.1, 0.2, 0.3, 0.4], zoom: 2.5, pan: [40, 30], opacity: 0.5 });
    expect((ref.image as unknown as FakeImage).tag).toBe('pose');
    // Proyectos anteriores a 1.3 no traen referencias.
    expect((await readProject(await writeProject(new Document(100, 100), meta, { codec }), codec)).doc.references).toEqual([]);
  });

  it('ida y vuelta conserva capas, elementos editables, pinceles, máscaras y selección', async () => {
    const doc = sampleDoc();
    const bytes = await writeProject(doc, meta, { codec, thumb: new Uint8Array([9, 9, 9]), view: { scale: 0.5, rotation: 0.3, x: 10, y: 20 } });
    const r = await readProject(bytes, codec);
    expect(r.meta).toMatchObject({ id: 'abc', name: 'Prueba', width: 1200, height: 800, dpi: 600, background: null, profile: 'p3', layers: 2, rev: 3 });
    expect(r.view).toEqual({ scale: 0.5, rotation: 0.3, x: 10, y: 20 });
    expect([...r.thumb!]).toEqual([9, 9, 9]);
    const d = r.doc;
    expect(d.settings).toEqual({ background: null, dpi: 600, profile: 'p3' });
    expect(d.activeId).toBe(doc.activeId);
    expect(d.layers.map(l => [l.id, l.name, l.visible, l.locked, l.alphaLock, l.opacity, l.blend])).toEqual(doc.layers.map(l => [l.id, l.name, l.visible, l.locked, l.alphaLock, l.opacity, l.blend]));
    // Alfa bloqueado: la capa y el elemento pintado con él.
    expect(d.layers[1].alphaLock).toBe(true);
    expect(d.layers[1].items[0].lock).toBe(true);
    expect(d.layers[1].items[1].lock).toBeUndefined();
    // Trazo: pincel congelado, puntos, sellos y colores exactos.
    const [a, b] = d.layers[0].items;
    const sa = (a as { stroke: FinishedStroke }).stroke, oa = (doc.layers[0].items[0] as { stroke: FinishedStroke }).stroke;
    expect(sa.preset).toEqual(oa.preset);
    expect(sa.points).toEqual(oa.points);
    expect([...sa.sets[0].dabs]).toEqual([...oa.sets[0].dabs]);
    expect([...sa.sets[0].colors!]).toEqual([...oa.sets[0].colors!]);
    expect([sa.seed, sa.total, sa.color, sa.mirrors]).toEqual([oa.seed, oa.total, oa.color, oa.mirrors]);
    expect(b.m).toEqual([2, 0, 0, 2, 10, 10]);
    expect(b.bounds).toEqual(doc.layers[0].items[1].bounds);
    // Máscara del recorte (varita) recuperada como imagen.
    const maskShape = a.clip!.ops[1].shape as unknown as { type: string; canvas: FakeImage };
    expect(maskShape.type).toBe('mask');
    expect(maskShape.canvas).toMatchObject({ width: 50, height: 40, tag: 'varita' });
    // Resto de elementos.
    const kinds = d.layers[1].items.map(i => i.kind);
    expect(kinds).toEqual(['shape', 'gradient', 'bitmap', 'clear', 'group']);
    expect(d.layers[1].items[0]).toMatchObject({ shape: { type: 'star', fill: '#00ff00' } });
    expect((d.layers[1].items[2] as unknown as { image: FakeImage }).image).toMatchObject({ tag: 'relleno', width: 64 });
    expect(d.layers[1].items[4]).toMatchObject({ opacity: 0.5, blend: 'screen' });
    expect(d.selection).toEqual(doc.selection);
    // Los identificadores nuevos no chocan con los cargados.
    const fresh = d.item({ kind: 'clear' });
    const ids = d.layers.flatMap(l => l.items.map(i => i.id));
    expect(ids).not.toContain(fresh.id);
    expect(d.newLayer().id).not.toBe(d.layers[0].id);
  });

  it('el mismo pincel se guarda una vez', async () => {
    const doc = new Document(100, 100);
    for (let i = 0; i < 20; i++) doc.layers[0].items.push(doc.item({ kind: 'stroke', stroke: stroke() }));
    const bytes = await writeProject(doc, meta, { codec });
    const once = await writeProject(new Document(100, 100), meta, { codec });
    expect(bytes.length - once.length).toBeLessThan(20 * 600 + JSON.stringify(BUILTIN_PRESETS[0]).length * 1.5);
  });

  it('lee sólo metadatos y miniatura sin decodificar capas', async () => {
    const bytes = await writeProject(sampleDoc(), meta, { codec, thumb: new Uint8Array([1, 2]) });
    const info = readProjectInfo(bytes);
    expect(info.meta.name).toBe('Prueba');
    expect([...info.thumb!]).toEqual([1, 2]);
  });

  it('rechaza archivos que no son proyectos o están dañados', async () => {
    await expect(readProject(new Uint8Array([1, 2, 3]), codec)).rejects.toBeInstanceOf(ProjectFormatError);
    await expect(readProject(zipSync({ 'a.txt': strToU8('hola') }), codec)).rejects.toThrow(/no es un proyecto/);
    const future = zipSync({ mimetype: strToU8('application/x-yosadraw'), 'project.json': strToU8(JSON.stringify({ format: 'yosadraw-project', version: 99 })) });
    await expect(readProject(future, codec)).rejects.toThrow(/más nueva/);
    const missing = zipSync({ mimetype: strToU8('application/x-yosadraw'), 'project.json': strToU8(JSON.stringify({ format: 'yosadraw-project', version: 1, meta: { width: 100, height: 100 }, document: { layers: [{ id: 'L1', items: [{ kind: 'stroke', id: 1, stroke: { preset: 'p1', points: 'bin/9.bin', sets: [] } }] }] } })) });
    await expect(readProject(missing, codec)).rejects.toThrow(/Falta/);
  });
});

describe('formato .yosa: animación', () => {
  it('conserva cels, pistas, grupos, audio, papel cebolla, marcadores y notas; los dibujos repetidos se escriben una vez', async () => {
    const { newAnimation, newCel } = await import('../src/yosadraw/anim/model');
    const doc = new Document(320, 240);
    doc.anim = newAnimation(24, 60);
    const l = doc.layers[0];
    const shared = [doc.item({ kind: 'stroke', stroke: stroke() })];
    l.cels = [newCel(0, 2, shared, true, 'A'), newCel(2, 3, shared.slice(), false, 'B'), newCel(8, 1, [doc.item({ kind: 'bitmap', image: new FakeImage(8, 8, 'cel') as unknown as CanvasImageSource, x: 0, y: 0, w: 8, h: 8 })])];
    l.sync = true;
    const bg = doc.newLayer('Fondo'); bg.reference = true; doc.layers.unshift(bg);
    doc.anim.groups.push({ id: 'g1', name: 'Personaje', visible: true, locked: false, opacity: 0.5, collapsed: false });
    l.group = 'g1';
    doc.anim.current = 3; doc.anim.range = [2, 40]; doc.anim.onion.before = 4; doc.anim.onion.colorAfter = '#00ff00';
    doc.anim.markers.push({ id: 'm1', frame: 10, name: 'Impacto', color: '#ff0000' });
    doc.anim.notes[5] = 'Mira a cámara';
    doc.anim.audio.push({ id: 'a1', name: 'voz.mp3', lane: doc.anim.lanes[0].id, data: new Uint8Array([1, 2, 3, 4]), mime: 'audio/mpeg', duration: 2.5, offset: 0.5, trimStart: 0.1, trimEnd: 0.2, volume: 0.8, muted: false, dialogue: [{ id: 'd', start: 3, end: 20, text: 'Hola' }], mouth: [{ frame: 4, shape: 'D' }] });
    l.items = l.cels[1].content.items; // fotograma 3 = cel B
    const bytes = await writeProject(doc, meta, { codec });
    const json = JSON.parse(new TextDecoder().decode((await import('fflate')).unzipSync(bytes)['project.json']));
    expect(json.document.pool).toHaveLength(2); // el trazo compartido una sola vez
    const r = await readProject(bytes, codec);
    const a = r.doc.anim!;
    expect([a.fps, a.length, a.current, a.range]).toEqual([24, 60, 3, [2, 40]]);
    expect(r.meta.anim).toEqual({ frames: 60, fps: 24 });
    const rl = r.doc.layers[1];
    expect(rl.cels!.map(c => [c.start, c.length, c.key, c.label, c.content.items.length])).toEqual([[0, 2, true, 'A', 1], [2, 3, false, 'B', 1], [8, 1, true, '', 1]]);
    expect(rl.cels![0].content.items[0]).toBe(rl.cels![1].content.items[0]);
    expect([rl.sync, rl.group, r.doc.layers[0].reference, r.doc.layers[0].cels]).toEqual([true, 'g1', true, undefined]);
    expect(a.groups[0].opacity).toBe(0.5);
    expect(a.onion.before).toBe(4);
    expect(a.onion.colorAfter).toBe('#00ff00');
    expect(a.markers[0].name).toBe('Impacto');
    expect(a.notes[5]).toBe('Mira a cámara');
    const c = a.audio[0];
    expect([...c.data]).toEqual([1, 2, 3, 4]);
    expect([c.offset, c.trimStart, c.trimEnd, c.volume, c.dialogue[0].text, c.mouth[0].shape]).toEqual([0.5, 0.1, 0.2, 0.8, 'Hola', 'D']);
    // Un proyecto de dibujo sigue sin animación.
    expect((await readProject(await writeProject(new Document(100, 100), meta, { codec }), codec)).doc.anim).toBeNull();
  });
});

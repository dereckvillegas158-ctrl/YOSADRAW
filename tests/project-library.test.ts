import { describe, expect, it } from 'vitest';
import { strToU8 } from 'fflate';
import { Document } from '../src/yosadraw/doc/Document';
import { normalizeMeta, readProject, readProjectInfo, writeProject, type ImageCodec, type ProjectMeta } from '../src/yosadraw/project/format';
import { ConflictError, MAX_VERSIONS, ProjectLibrary } from '../src/yosadraw/project/library';
import { MemoryBlobStore } from '../src/yosadraw/project/store';

const codec: ImageCodec = { async encode() { return strToU8('x'); }, async decode() { return {} as CanvasImageSource; } };
const build = (layers = 1) => async (m: ProjectMeta) => {
  const doc = new Document(m.width, m.height);
  for (let i = 1; i < layers; i++) doc.layers.push(doc.newLayer());
  return { bytes: await writeProject(doc, m, { codec, thumb: strToU8('thumb') }), thumb: strToU8('thumb'), meta: { layers } };
};
const meta = (name: string) => normalizeMeta({ name, width: 800, height: 600 });

describe('galería de proyectos', () => {
  it('crear, guardar con versiones y recuperar la anterior', async () => {
    const store = new MemoryBlobStore();
    const lib = await ProjectLibrary.open(store);
    const e = await lib.create(meta('Uno'), build());
    expect(e.rev).toBe(1);
    let cur = e;
    for (let i = 2; i <= MAX_VERSIONS + 4; i++) { await new Promise(r => setTimeout(r, 2)); cur = await lib.save(e.id, cur.rev, build(i)); }
    expect(cur.rev).toBe(MAX_VERSIONS + 4);
    expect(cur.layers).toBe(MAX_VERSIONS + 4);
    const versions = await lib.versions(e.id);
    expect(versions.length).toBe(MAX_VERSIONS);
    const newest = await readProject(await lib.readVersion(versions[0].key), codec);
    expect(newest.doc.layers.length).toBe(MAX_VERSIONS + 3);
    expect(readProjectInfo(await lib.read(e.id)).meta.rev).toBe(cur.rev);
  });

  it('no sobrescribe si otra ventana guardó antes', async () => {
    const store = new MemoryBlobStore();
    const a = await ProjectLibrary.open(store);
    const e = await a.create(meta('Compartido'), build());
    const b = await ProjectLibrary.open(store);
    await b.save(e.id, 1, build(2));
    // `a` es otra pestaña con el índice desfasado (cree que la revisión sigue en 1): el archivo manda.
    await expect(a.save(e.id, 1, build(3))).rejects.toBeInstanceOf(ConflictError);
    const forced = await a.save(e.id, 1, build(3), true);
    expect(forced.rev).toBe(3);
    // Lo que guardó la otra pestaña no se perdió: está en el historial.
    const v = await a.versions(e.id);
    expect(readProjectInfo(await a.readVersion(v[0].key)).meta.rev).toBe(2);
  });

  it('recuperación, renombrar, duplicar, favoritos, carpetas y papelera', async () => {
    const store = new MemoryBlobStore();
    const lib = await ProjectLibrary.open(store);
    const e = await lib.create(meta('Dibujo'), build());
    await lib.writeRecovery(e.id, strToU8('temp'));
    expect(lib.get(e.id)!.recovery).toBeGreaterThan(0);
    expect(new TextDecoder().decode((await lib.readRecovery(e.id))!)).toBe('temp');
    await lib.save(e.id, 1, build());
    expect(lib.get(e.id)!.recovery).toBeNull();
    expect(await lib.readRecovery(e.id)).toBeNull();

    await lib.rename(e.id, 'Retrato');
    expect(readProjectInfo(await lib.read(e.id)).meta.name).toBe('Retrato');
    const copy = await lib.duplicate(e.id);
    expect(copy.name).toBe('Retrato copia');
    expect(copy.id).not.toBe(e.id);
    expect(readProjectInfo(await lib.read(copy.id)).meta.id).toBe(copy.id);
    expect(lib.uniqueName('Retrato')).toBe('Retrato (2)');

    await lib.update(e.id, { favorite: true });
    const f = await lib.createFolder('Bocetos');
    await lib.update(copy.id, { folder: f.id });
    expect(lib.get(copy.id)!.folder).toBe(f.id);
    await lib.deleteFolder(f.id);
    expect(lib.get(copy.id)!.folder).toBeNull();

    await lib.trash(copy.id);
    expect(lib.get(copy.id)!.trashed).toBeGreaterThan(0);
    await lib.restore(copy.id);
    expect(lib.get(copy.id)!.trashed).toBeNull();
    await lib.trash(copy.id);
    await lib.emptyTrash();
    expect(lib.get(copy.id)).toBeUndefined();
    expect((await store.list('p/')).length).toBe(1);
    expect(await store.list('v/' + copy.id)).toEqual([]);

    // Importar un .yosa: siempre proyecto nuevo, sin pisar al original.
    const imported = await lib.importFile(await lib.read(e.id));
    expect(imported.id).not.toBe(e.id);
    expect(imported.name).toBe('Retrato (2)');
  });

  it('reconstruye la galería si se pierde el índice', async () => {
    const store = new MemoryBlobStore();
    const lib = await ProjectLibrary.open(store);
    const a = await lib.create(meta('A'), build(2));
    await lib.create(meta('B'), build());
    await lib.writeRecovery(a.id, strToU8('r'));
    await store.delete('meta/index.json');
    const again = await ProjectLibrary.open(store);
    expect(again.list().map(e => e.name).sort()).toEqual(['A', 'B']);
    expect(again.get(a.id)!.layers).toBe(2);
    expect(again.get(a.id)!.recovery).toBeGreaterThan(0);
    // Índice dañado: igual.
    await store.put('meta/index.json', strToU8('{roto'));
    expect((await ProjectLibrary.open(store)).list().length).toBe(2);
  });
});

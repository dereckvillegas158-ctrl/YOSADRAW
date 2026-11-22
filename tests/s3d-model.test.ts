import { describe, expect, it } from 'vitest';
import { strToU8 } from 'fflate';
import { Document } from '../src/yosadraw/doc/Document';
import { readProject, readProjectInfo, writeProject, type ImageCodec } from '../src/yosadraw/project/format';
import { valueAt } from '../src/yosadraw/motion/keys';
import { GENERATORS, generate, genDefaults } from '../src/yosadraw/studio3d/generators';
import { faceCenter, faceNormal, dot, isClosed, triangulate } from '../src/yosadraw/studio3d/mesh';
import {
  History3, PRIMS, effVisible, genObject, newStudio, normalizeStudio, objOf, presetMaterial, primHeight, primMesh, primObject, rebuild, sceneOf, subtree,
} from '../src/yosadraw/studio3d/model';

const codec: ImageCodec = { async encode() { return strToU8('{}'); }, async decode() { return {} as CanvasImageSource; } };
const meta = { id: 'p1', name: '3D', width: 1920, height: 1080, dpi: 72, background: '#ffffff', profile: 'srgb' as const, created: 1, modified: 2, layers: 1, anim: null, motion: null, source: 'yosa', rev: 1, app: 'test' };

describe('3D: modelo', () => {
  it('todas las primitivas y generadores producen geometría dibujable', () => {
    for (const p of PRIMS) { const m = primMesh(p.type, p.p); expect(triangulate(m).pos.length, p.type).toBeGreaterThan(0); expect(primHeight(p.type, p.p)).toBeGreaterThanOrEqual(0); }
    for (const g of GENERATORS) {
      const m = generate(g.type, genDefaults(g.type));
      const t = triangulate(m);
      expect(t.pos.length, g.type).toBeGreaterThan(0);
      expect([...t.pos].every(Number.isFinite), g.type).toBe(true);
      // Ranuras de material dentro de las que sugiere el generador.
      expect(Math.max(...m.m), g.type).toBeLessThan(g.mats.length);
    }
    // Los tejados son sólidos cerrados con las normales hacia fuera.
    for (const kind of [0, 1]) {
      const r = generate('roof', { ...genDefaults('roof'), kind });
      expect(isClosed(r)).toBe(true);
      const c = r.v.reduce((a, _, i) => (i % 3 === 1 ? a + r.v[i] : a), 0) / (r.v.length / 3);
      expect(r.f.every(f => dot(faceNormal(r, f), [faceCenter(r, f)[0], faceCenter(r, f)[1] - c, faceCenter(r, f)[2]]) > 0)).toBe(true);
    }
    // Pared con puerta y 2 ventanas: hay huecos (menos volumen que una pared maciza).
    const w = generate('wall', { ...genDefaults('wall'), windows: 2 });
    expect(isClosed(w)).toBe(true);
  });
  it('generador editable: cambiar parámetros regenera la malla', () => {
    const st = newStudio();
    const o = genObject('stairs', [st.materials[0].id]);
    const n = o.mesh!.f.length;
    o.gen!.p.steps = 12; o.gen!.p.rail = 0;
    rebuild(o);
    expect(o.mesh!.f.length).toBe(12 * 6);
    expect(n).not.toBe(o.mesh!.f.length);
  });
  it('historial: deshacer/rehacer, y las texturas no se duplican en las instantáneas', () => {
    const st = newStudio();
    const changes: string[] = [];
    const h = new History3(st, (_s, l) => changes.push(l));
    st.textures.push({ id: 't1', name: 'x', src: 'data:image/png;base64,AAAA' });
    h.edit('añadir', s => { sceneOf(s).objects.push(primObject('sphere', s.materials[0].id, [0, 1, 0])); });
    expect(sceneOf(h.s).objects.length).toBe(6);
    h.undo();
    expect(sceneOf(h.s).objects.length).toBe(5);
    expect(h.s.textures.map(t => t.id)).toEqual(['t1']);
    h.redo();
    expect(sceneOf(h.s).objects.length).toBe(6);
    expect(changes).toEqual(['añadir', 'Deshacer: añadir', 'Rehacer: añadir']);
  });
  it('jerarquía: ocultar el grupo oculta a sus hijos; subárbol', () => {
    const st = newStudio(), sc = sceneOf(st);
    const g = { ...primObject('box', st.materials[0].id), kind: 'group' as const, mesh: undefined, name: 'Grupo' };
    const a = primObject('box', st.materials[0].id); a.parent = g.id;
    sc.objects.push(g, a);
    g.visible = false;
    expect(effVisible(sc, a)).toBe(false);
    expect(subtree(sc, g.id).map(o => o.id)).toEqual([g.id, a.id]);
  });
});

describe('3D: proyecto en .yosa', () => {
  it('guarda y abre escenas, objetos, materiales, animación y texturas usadas', async () => {
    const doc = new Document(1920, 1080, { background: '#ffffff', dpi: 72, profile: 'srgb' });
    const st = newStudio();
    const wood = presetMaterial('Madera'); wood.tex = 't1';
    st.materials.push(wood);
    st.textures.push({ id: 't1', name: 'dibujo', src: 'data:image/png;base64,AAAA' }, { id: 'tX', name: 'sin usar', src: 'data:image/png;base64,BBBB' });
    const sc = sceneOf(st);
    const cube = sc.objects.find(o => o.prim?.type === 'box')!;
    cube.tf.py = { v: 0.5, k: [{ t: 0, v: 0.5, e: 'inout' }, { t: 2, v: 3, e: 'bezier', b: [0.2, 0, 0.3, 1] }] };
    cube.mats = [wood.id];
    doc.s3d = st;
    const bytes = await writeProject(doc, meta, { codec });
    expect(readProjectInfo(bytes).meta.s3d).toEqual({ scenes: 1, objects: 2 });
    const r = await readProject(bytes, codec);
    const back = r.doc.s3d!;
    expect(back.textures.map(t => t.id)).toEqual(['t1']);
    expect({ ...back, textures: [] }).toEqual({ ...st, textures: [] });
    expect(valueAt(objOf(sceneOf(back), cube.id)!.tf.py, 1)).toBeCloseTo(valueAt(cube.tf.py, 1));
    // Un dibujo normal no tiene 3D.
    const d2 = await readProject(await writeProject(new Document(100, 100), { ...meta, width: 100, height: 100 }, { codec }), codec);
    expect(d2.doc.s3d).toBeNull();
  });
  it('un proyecto dañado se repara al abrir', () => {
    const st = newStudio();
    const bad = JSON.parse(JSON.stringify(st));
    const sc = bad.scenes[0];
    sc.objects[1].parent = sc.objects[1].id; // se contiene a sí mismo
    sc.objects[1].mesh.f.push([0, 1, 999]); // índice fuera
    sc.objects[1].mats = ['no-existe'];
    delete sc.objects[2].tf;
    const n = normalizeStudio(bad)!;
    const o = n.scenes[0].objects[1];
    expect(o.parent).toBeNull();
    expect(o.mesh!.f.every(f => f.every(i => i < o.mesh!.v.length / 3))).toBe(true);
    expect(o.mats).toEqual([n.materials[0].id]);
    expect(n.scenes[0].objects[2].tf.sx.v).toBe(1);
    expect(normalizeStudio({})).toBeNull();
  });
  it('proyectos anteriores reciben los valores nuevos (gelatina, balanceo, estilos, efectos en el render)', () => {
    const st = newStudio();
    const old = JSON.parse(JSON.stringify(st));
    const sc = old.scenes[0];
    sc.objects[1].phys = { body: 'dynamic', mass: 2, bounce: 0.1, friction: 0.5, shape: 'auto', grab: true, zone: false };
    sc.fx = { godrays: 1 };
    delete old.render.fx;
    const n = normalizeStudio(old)!;
    const ph = n.scenes[0].objects[1].phys!;
    expect(ph.mass).toBe(2);
    expect(ph.jelly).toBeGreaterThan(0);
    expect(ph.float).toBe(false);
    expect(n.scenes[0].fx!.godrays).toBe(1);
    expect(n.scenes[0].fx!.squiggle).toBe(0);
    expect(n.scenes[0].fx!.squigFps).toBe(8);
    expect(n.render.fx).toBe(true);
    expect(n.scenes[0].fx!.ao).toBe(0);
    expect(n.scenes[0].fx!.actorClick).toBe(true);
  });
  it('estilo por objeto y actores se guardan y se completan', () => {
    const st = newStudio();
    const raw = JSON.parse(JSON.stringify(st));
    const o = raw.scenes[0].objects[1];
    o.style = { squiggle: 0.5 };
    o.ctrl = { behavior: 'idle', keys: '1, q', rest: 'return' };
    const n = normalizeStudio(raw)!;
    const x = n.scenes[0].objects[1];
    expect(x.style!.squiggle).toBe(0.5);
    expect(x.style!.squigFps).toBe(8);
    expect(x.style!.ink).toBe(0);
    expect(x.ctrl!.keys).toBe('1, q');
    expect(x.ctrl!.rest).toBe('return');
    expect(x.ctrl!.speed).toBeGreaterThan(0);
  });
});

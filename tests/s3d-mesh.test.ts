import { describe, expect, it } from 'vitest';
import {
  bevel, box, bridge, capsule, cone, cylinder, deleteFaces, dot, edgeList, extrude, faceCenter, faceNormal, fromTriangles, hole, inset, isClosed, mergeVerts,
  pyramid, sphere, sub, subdivide, torus, triangulate, vcount, plane, type Mesh,
} from '../src/yosadraw/studio3d/mesh';

const outward = (m: Mesh) => m.f.every(f => dot(faceNormal(m, f), faceCenter(m, f)) > -1e-9);
const volume = (m: Mesh) => { const t = triangulate(m); let v = 0; for (let i = 0; i < t.pos.length; i += 9) { const a = [t.pos[i], t.pos[i + 1], t.pos[i + 2]], b = [t.pos[i + 3], t.pos[i + 4], t.pos[i + 5]], c = [t.pos[i + 6], t.pos[i + 7], t.pos[i + 8]]; v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6; } return v; };

describe('3D: primitivas', () => {
  it('cerradas, con las normales hacia fuera y volumen correcto', () => {
    for (const [name, m] of [['cubo', box(1, 2, 3)], ['esfera', sphere(1, 24, 12)], ['cilindro', cylinder(0.5, 2)], ['cono', cone(0.5, 1)], ['cápsula', capsule()], ['pirámide', pyramid()]] as const) {
      expect(isClosed(m), name).toBe(true);
      expect(outward(m), name).toBe(true);
      expect(volume(m), name).toBeGreaterThan(0);
    }
    expect(volume(box(1, 2, 3))).toBeCloseTo(6, 5);
    expect(volume(sphere(1, 48, 24))).toBeCloseTo((4 / 3) * Math.PI, 1);
    expect(isClosed(torus())).toBe(true);
    expect(volume(torus(1, 0.25, 64, 32))).toBeCloseTo(2 * Math.PI * Math.PI * 1 * 0.0625, 1);
    expect(isClosed(plane())).toBe(false);
  });
});

describe('3D: modelado', () => {
  it('extruir una cara del cubo: sigue cerrado y crece el volumen', () => {
    const top = box().f.findIndex(f => faceNormal(box(), f)[1] > 0.9);
    const r = extrude(box(), [top], 0.5);
    expect(isClosed(r.mesh)).toBe(true);
    expect(r.mesh.f.length).toBe(10);
    expect(volume(r.mesh)).toBeCloseTo(1.5, 5);
    // Región: dos caras vecinas juntas (sin pared entre ellas).
    const sp = subdivide(box(), 1, false);
    const tops = sp.f.map((f, i) => (faceNormal(sp, f)[1] > 0.9 ? i : -1)).filter(i => i >= 0);
    const reg = extrude(sp, tops, 0.25, true), ind = extrude(sp, tops, 0.25, false);
    expect(isClosed(reg.mesh)).toBe(true);
    expect(reg.mesh.f.length).toBe(sp.f.length + 8);
    expect(ind.mesh.f.length).toBe(sp.f.length + 16);
    expect(volume(reg.mesh)).toBeCloseTo(1.25, 5);
  });
  it('inset, agujero y puente (agujero pasante)', () => {
    const m = box();
    const i = inset(m, [0], 0.5);
    expect(isClosed(i.mesh)).toBe(true);
    expect(i.mesh.f.length).toBe(10);
    expect(volume(i.mesh)).toBeCloseTo(1, 5);
    const h = hole(m, [0], 0.5);
    expect(isClosed(h)).toBe(false);
    // Atravesar: inset en +z y -z y puente entre las dos caras interiores.
    const a = inset(m, [0, 1], 0.4);
    const b = bridge(a.mesh, a.faces[0], a.faces[1])!;
    expect(isClosed(b)).toBe(true);
    expect(volume(b)).toBeLessThan(1 - 0.3);
  });
  it('bisel de una arista: cerrado y quita volumen', () => {
    const m = box();
    const e = edgeList(m)[0];
    const b = bevel(m, [e], 0.1);
    expect(isClosed(b)).toBe(true);
    expect(volume(b)).toBeCloseTo(1 - 0.1 * 0.1 / 2, 3);
    const all = bevel(m, edgeList(m), 0.05);
    expect(isClosed(all)).toBe(true);
    expect(volume(all)).toBeLessThan(1);
  });
  it('subdivisión Catmull-Clark: cubo → esfera aproximada; fusionar y borrar', () => {
    const s = subdivide(box(2, 2, 2), 3, true);
    expect(isClosed(s)).toBe(true);
    expect(s.f.length).toBe(6 * 4 ** 3);
    const r = s.v.filter((_, i) => i % 3 === 0).map((_, k) => Math.hypot(s.v[k * 3], s.v[k * 3 + 1], s.v[k * 3 + 2]));
    expect(Math.max(...r) / Math.min(...r)).toBeLessThan(1.4);
    const m = mergeVerts(box(), [0, 1], 'center');
    expect(vcount(m)).toBe(7);
    expect(isClosed(m)).toBe(true);
    expect(deleteFaces(box(), [0]).f.length).toBe(5);
  });
  it('importar triángulos une los vértices repetidos', () => {
    const t = triangulate(box());
    const m = fromTriangles(t.pos, null);
    expect(vcount(m)).toBe(8);
    expect(isClosed(m)).toBe(true);
    expect(sub([1, 1, 1], [1, 1, 1])).toEqual([0, 0, 0]);
  });
});

import { describe, expect, it } from 'vitest';
import { keyTimes, newComposition, retimeKeys, solidClip } from '../src/yosadraw/motion/model';

const setup = () => {
  const comp = newComposition(100, 100, 30, 10);
  const c = solidClip(comp, comp.tracks[0].id, 0);
  c.dur = 5;
  c.tf.x = { v: 0, k: [{ t: 0, v: 0, e: 'linear' }, { t: 1, v: 10, e: 'out' }, { t: 2, v: 20, e: 'linear' }] };
  c.tf.rot = { v: 0, k: [{ t: 1, v: 45, e: 'linear' }, { t: 3, v: 90, e: 'linear' }] };
  return c;
};

describe('retocar el tiempo de varios keyframes', () => {
  it('keyTimes junta los tiempos de todas las propiedades', () => {
    expect(keyTimes(setup())).toEqual([0, 1, 2, 3]);
  });
  it('mueve varios a la vez en todas las propiedades, conservando valores y curvas', () => {
    const c = setup();
    expect(retimeKeys(c, [1, 2], t => t + 0.5, 30)).toEqual([1.5, 2.5]);
    expect(c.tf.x.k!.map(k => [k.t, k.v, k.e])).toEqual([[0, 0, 'linear'], [1.5, 10, 'out'], [2.5, 20, 'linear']]);
    expect(c.tf.rot.k!.map(k => k.t)).toEqual([1.5, 3]);
  });
  it('invertir y estirar desde el primero', () => {
    const c = setup();
    retimeKeys(c, [0, 1, 2], t => 2 - t, 30);
    expect(c.tf.x.k!.map(k => [k.t, k.v])).toEqual([[0, 20], [1, 10], [2, 0]]);
    const d = setup();
    retimeKeys(d, [1, 3], t => 1 + (t - 1) * 2, 30);
    expect(d.tf.rot.k!.map(k => k.t)).toEqual([1, 5]);
  });
  it('se ajusta al fotograma y al clip; un keyframe tapado por uno movido desaparece', () => {
    const c = setup();
    retimeKeys(c, [2], t => t + 10, 30);
    expect(c.tf.x.k!.map(k => k.t)).toEqual([0, 1, 5]);
    const d = setup();
    retimeKeys(d, [0], () => 1.01, 30);
    expect(d.tf.x.k!.map(k => [k.t, k.v])).toEqual([[1, 0], [2, 20]]);
  });
  it('dos movidos al mismo fotograma se quedan en uno', () => {
    const c = setup();
    retimeKeys(c, [0, 1, 2], () => 4, 30);
    expect(c.tf.x.k!.length).toBe(1);
  });
});

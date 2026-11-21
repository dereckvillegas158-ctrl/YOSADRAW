import { describe, expect, it } from 'vitest';
import { valueAt, easeOf } from '../src/yosadraw/motion/keys';
import { newComposition, solidClip, textClip, normalizeMotion, newMotion, compOf, keyTimes } from '../src/yosadraw/motion/model';
import {
  copyMultiKeys, freezeAt, invertEase, makeLink, pasteMultiKeys, pastePreview, quickAnimate, repeatKeys, repeatsToFill, resolveLinks, smoothKeys, linkLoops,
} from '../src/yosadraw/motion/keytools';

const comp = () => newComposition(1000, 500, 30, 20);

describe('herramientas de keyframes', () => {
  it('suavizado automático: Bézier con la velocidad continua y sin pasarse en los extremos', () => {
    const cp = comp(), c = solidClip(cp, cp.tracks[0].id, 0);
    c.tf.x = { v: 0, k: [{ t: 0, v: 0, e: 'linear' }, { t: 1, v: 100, e: 'linear' }, { t: 2, v: 300, e: 'linear' }, { t: 3, v: 0, e: 'linear' }] };
    expect(smoothKeys(c, null)).toBe(3);
    const k = c.tf.x.k!;
    expect(k[0].e).toBe('bezier');
    // Velocidad en t=1 a ambos lados ≈ pendiente media (300-0)/2 = 150 /s.
    const h = 1e-4;
    const left = (valueAt(c.tf.x, 1) - valueAt(c.tf.x, 1 - h)) / h, right = (valueAt(c.tf.x, 1 + h) - valueAt(c.tf.x, 1)) / h;
    expect(left).toBeCloseTo(150, -1);
    expect(right).toBeCloseTo(150, -1);
    // En el máximo (t=2) la pendiente es 0 y no se pasa de 300.
    for (let t = 1; t <= 3; t += 0.01) expect(valueAt(c.tf.x, t)).toBeLessThanOrEqual(300.001);
  });
  it('invertir curva: ease in ↔ ease out y Bézier reflejada', () => {
    const k = { t: 0, v: 0, e: 'in' as const };
    const a = { ...k }; invertEase(a); expect(a.e).toBe('out');
    const b = { t: 0, v: 0, e: 'bezier' as const, b: [0.1, 0.2, 0.3, 0.4] as [number, number, number, number] };
    invertEase(b); expect(b.b).toEqual([0.7, 0.6, 0.9, 0.8]);
    const f = easeOf({ e: 'bezier', b: [0.42, 0, 1, 1] }), g = (() => { const x = { t: 0, v: 0, e: 'bezier' as const, b: [0.42, 0, 1, 1] as [number, number, number, number] }; invertEase(x); return easeOf(x); })();
    expect(g(0.3)).toBeCloseTo(1 - f(0.7), 3);
  });
  it('repetir hacia delante, ida y vuelta, hacia atrás y rellenar el clip', () => {
    const cp = comp(), c = solidClip(cp, cp.tracks[0].id, 0);
    c.dur = 10;
    c.tf.rot = { v: 0, k: [{ t: 1, v: 0, e: 'in' }, { t: 2, v: 90, e: 'linear' }] };
    const ts = repeatKeys(c, [1, 2], 2, 0.5, 30);
    expect(ts).toEqual([2.5, 3.5, 4, 5]);
    expect(c.tf.rot.k!.map(k => [k.t, k.v])).toEqual([[1, 0], [2, 90], [2.5, 0], [3.5, 90], [4, 0], [5, 90]]);
    const d = solidClip(cp, cp.tracks[0].id, 0); d.dur = 10;
    d.tf.x = { v: 0, k: [{ t: 0, v: 0, e: 'in' }, { t: 1, v: 10, e: 'linear' }] };
    repeatKeys(d, [0, 1], 2, 0, 30, { pingpong: true });
    expect(d.tf.x.k!.map(k => [k.t, k.v])).toEqual([[0, 0], [1, 10], [2, 0], [3, 10]]);
    expect(d.tf.x.k![1].e).toBe('out'); // el tramo de vuelta frena donde la ida aceleraba
    expect(repeatsToFill(c, [1, 2], 0, 30)).toBe(8);
    const e = solidClip(cp, cp.tracks[0].id, 0); e.dur = 10;
    e.tf.y = { v: 0, k: [{ t: 6, v: 0, e: 'linear' }, { t: 7, v: 5, e: 'linear' }] };
    expect(repeatKeys(e, [6, 7], 1, 1, 30, { dir: -1 })).toEqual([4, 5]);
  });
  it('congelar: conserva lo anterior y deja el valor fijo desde el cabezal', () => {
    const cp = comp(), c = solidClip(cp, cp.tracks[0].id, 0);
    c.tf.x = { v: 0, k: [{ t: 0, v: 0, e: 'linear' }, { t: 2, v: 200, e: 'linear' }, { t: 4, v: 0, e: 'linear' }] };
    expect(freezeAt(c, 1)).toBe(1);
    expect(valueAt(c.tf.x, 0.5)).toBe(50);
    expect(valueAt(c.tf.x, 3)).toBe(100);
    expect(c.tf.x.k).toHaveLength(2);
  });
});

describe('portapapeles de varias capas', () => {
  it('copia de 2 capas y pega en otras 2 conservando el desfase; también en sus tiempos originales', () => {
    const cp = comp();
    const a = solidClip(cp, cp.tracks[0].id, 0), b = solidClip(cp, cp.tracks[1].id, 1);
    a.tf.x = { v: 0, k: [{ t: 1, v: 10, e: 'linear' }, { t: 2, v: 20, e: 'linear' }] };
    b.tf.y = { v: 0, k: [{ t: 1, v: 5, e: 'linear' }] }; // t comp = 2
    const c = solidClip(cp, cp.tracks[0].id, 5), d = solidClip(cp, cp.tracks[1].id, 5);
    cp.clips.push(a, b, c, d);
    const mc = copyMultiKeys(cp, new Map([[a.id, [{ times: null, paths: null }]], [b.id, [{ times: null, paths: ['tf.y'] }]]]))!;
    expect(mc.items.map(i => i.off)).toEqual([0, 1]);
    expect(pastePreview(cp, mc, [d, c], 6).map(p => p.t)).toEqual([6, 7, 7]);
    const r = pasteMultiKeys(cp, mc, [d, c], 6);
    expect(r.n).toBe(3);
    expect(c.tf.x.k!.map(k => k.t)).toEqual([1, 2]); // 6 y 7 en la composición
    expect(d.tf.y.k!.map(k => k.t)).toEqual([2]); // 7 en la composición
    // Cada capa conserva sus propios valores en lo que no se pegó.
    expect(c.tf.y.k).toBeUndefined();
    const e = solidClip(cp, cp.tracks[0].id, 0); cp.clips.push(e);
    pasteMultiKeys(cp, mc, [e], 'orig');
    expect(e.tf.x.k!.map(k => k.t)).toEqual([1, 2]);
  });
});

describe('animación rápida', () => {
  it('entrada desde la izquierda en el cabezal, a media intensidad y con curva elegida; conserva otras animaciones', () => {
    const cp = comp(), c = solidClip(cp, cp.tracks[0].id, 0);
    c.dur = 5; c.tf.x.v = 500;
    c.tf.x.k = [{ t: 4, v: 500, e: 'linear' }, { t: 5, v: 800, e: 'linear' }];
    expect(quickAnimate(c, { kind: 'enter', dir: 'left', len: 1, intensity: 0.5, ease: 'linear', at: 1 }, 1000, 500, 30)).toBe(1);
    expect(valueAt(c.tf.x, 1)).toBe(0); // 500 - 1000·0,5
    expect(valueAt(c.tf.x, 1.5)).toBe(250);
    expect(valueAt(c.tf.x, 2)).toBe(500);
    expect(valueAt(c.tf.x, 5)).toBe(800);
    expect(quickAnimate(c, { kind: 'fade-out', dir: 'left', len: 0.5, intensity: 1, ease: 'preset', at: 0 }, 1000, 500, 30)).toBe(1);
    expect(valueAt(c.tf.opacity, 5)).toBe(0);
    expect(valueAt(c.tf.opacity, 4)).toBe(1);
  });
});

describe('propiedades vinculadas y compatibilidad', () => {
  it('el clip vinculado sigue la animación del otro con su desfase; sin bucles', () => {
    const cp = comp();
    const a = solidClip(cp, cp.tracks[0].id, 0), b = solidClip(cp, cp.tracks[1].id, 0);
    a.tf.x = { v: 0, k: [{ t: 0, v: 0, e: 'linear' }, { t: 2, v: 100, e: 'linear' }] };
    b.tf.x.v = 300;
    cp.clips.push(a, b);
    b.link = makeLink(cp, b, a, ['tf.x', 'tf.y'], 0);
    expect(b.link.off['tf.x']).toBe(300);
    expect(valueAt(resolveLinks(cp, b).tf.x, 1)).toBe(350);
    expect(linkLoops(cp, a, b)).toBe(true);
  });
  it('un proyecto de antes (v1) se abre igual; los campos nuevos se validan', () => {
    const m = newMotion(100, 100, 30);
    const cp = compOf(m);
    const t = textClip(cp, cp.tracks[0].id, 0);
    t.tf.x.k = [{ t: 0, v: 1, e: 'bezier', b: [0.1, 0.2, 0.3, 0.4] }, { t: 1, v: 2, e: 'linear' }];
    cp.clips.push(t);
    const old = JSON.parse(JSON.stringify(m));
    old.version = 1;
    const n = normalizeMotion(old)!;
    expect(n.version).toBe(2);
    expect(compOf(n).clips[0].tf.x.k).toEqual(t.tf.x.k);
    expect(keyTimes(compOf(n).clips[0])).toEqual([0, 1]);
    const bad = JSON.parse(JSON.stringify(m));
    (compOf(bad).tracks[0] as { h?: unknown }).h = 'x'; compOf(bad).clips[0].link = { to: 'nadie', paths: ['tf.x'], off: {} }; compOf(bad).clips[0].adjust = true;
    const nb = normalizeMotion(bad)!;
    expect(compOf(nb).tracks[0].h).toBeUndefined();
    expect(compOf(nb).clips[0].link).toBeNull();
    expect(compOf(nb).clips[0].adjust).toBe(false);
  });
});

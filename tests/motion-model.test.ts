import { describe, expect, it } from 'vitest';
import { cubicBezier, easeOf, keyAt, setValue, toggleKey, valueAt, applyPreset, type Prop } from '../src/yosadraw/motion/keys';
import {
  activeClips, clipEnd, deleteClips, duplicateClips, freezeFrame, mediaClip, MotionHistory, moveClips, newMotion, precompose, setSpeed, shapeClip, snapTo,
  sourceTime, splitClip, textClip, toggleGroup, trimClip, copyAttrs, pasteAttrs, compOf, type MediaItem, type MediaClip,
} from '../src/yosadraw/motion/model';

const video: MediaItem = { id: 'v1', name: 'clip.mp4', kind: 'video', mime: 'video/mp4', size: 1, w: 1920, h: 1080, dur: 10, fps: 30, frames: 300, hasAudio: true, folder: '', added: 0 };

describe('MOTION: keyframes y curvas', () => {
  it('interpola números y colores con lineal, mantener y Bézier', () => {
    const p: Prop = { v: 0, k: [{ t: 0, v: 0, e: 'linear' }, { t: 2, v: 100, e: 'linear' }] };
    expect(valueAt(p, 1)).toBe(50);
    expect(valueAt(p, -1)).toBe(0);
    expect(valueAt(p, 5)).toBe(100);
    p.k![0].e = 'hold';
    expect(valueAt(p, 1.9)).toBe(0);
    p.k![0].e = 'inout';
    expect(valueAt(p, 1)).toBeCloseTo(50, 5);
    expect(valueAt(p, 0.5)).toBeLessThan(25);
    const c: Prop<string> = { v: '#000000', k: [{ t: 0, v: '#000000', e: 'linear' }, { t: 1, v: '#ff0080', e: 'linear' }] };
    expect(valueAt(c, 0.5)).toBe('#800040');
  });
  it('curvas: bezier CSS, rebasar pasa de 1, rebote y elástico terminan en 1', () => {
    const ease = cubicBezier([0.25, 0.1, 0.25, 1]);
    expect(ease(0.5)).toBeCloseTo(0.8024, 3);
    const ov = easeOf({ e: 'overshoot' });
    expect(Math.max(...Array.from({ length: 50 }, (_, i) => ov(i / 49)))).toBeGreaterThan(1.05);
    expect(easeOf({ e: 'bounce' })(1)).toBeCloseTo(1);
    expect(easeOf({ e: 'elastic' })(1)).toBe(1);
  });
  it('poner valores: sin animar cambia el fijo; animado crea/actualiza keyframes; alternar quita', () => {
    const p: Prop = { v: 10 };
    setValue(p, 1, 20);
    expect([p.v, p.k]).toEqual([20, undefined]);
    toggleKey(p, 0);
    setValue(p, 2, 80);
    expect(p.k!.map(k => [k.t, k.v])).toEqual([[0, 20], [2, 80]]);
    setValue(p, 2, 90);
    expect(keyAt(p, 2)!.v).toBe(90);
    toggleKey(p, 2);
    toggleKey(p, 0);
    expect(p.k).toBeUndefined();
  });
});

describe('MOTION: edición en la línea de tiempo', () => {
  const setup = () => {
    const m = newMotion(1920, 1080, 30);
    m.media.push(video);
    const h = new MotionHistory(m, () => undefined);
    h.edit('añadir', mm => { compOf(mm).clips.push(mediaClip(compOf(mm), video, compOf(mm).tracks[0].id, 0)); });
    return { h, comp: () => compOf(h.m), id: () => compOf(h.m).clips[0].id };
  };
  it('dividir conserva el origen y los keyframes a ambos lados; deshacer y rehacer', () => {
    const { h, comp, id } = setup();
    h.edit('anim', m => { const c = compOf(m).clips[0]; c.tf.x.k = [{ t: 0, v: 0, e: 'linear' }, { t: 10, v: 1000, e: 'linear' }]; });
    h.edit('dividir', m => { splitClip(compOf(m), m, id(), 4); });
    const [a, b] = comp().clips as MediaClip[];
    expect([a.start, a.dur, b.start, b.dur, b.in]).toEqual([0, 4, 4, 6, 4]);
    expect(valueAt(b.tf.x, 0)).toBeCloseTo(400);
    h.undo();
    expect(comp().clips).toHaveLength(1);
    h.redo();
    expect(comp().clips).toHaveLength(2);
  });
  it('recortar no pasa del origen; ripple desplaza lo que sigue; borrar con ripple cierra el hueco', () => {
    const { h, comp, id } = setup();
    h.edit('recortar', m => { trimClip(compOf(m), m, id(), 'l', 2); });
    expect([comp().clips[0].start, (comp().clips[0] as MediaClip).in]).toEqual([2, 2]);
    h.edit('estirar', m => { trimClip(compOf(m), m, id(), 'r', 50); });
    expect(clipEnd(comp().clips[0])).toBe(10);
    h.edit('dup', m => { duplicateClips(compOf(m), [id()]); });
    expect(comp().clips.map(c => c.start)).toEqual([2, 10]);
    h.edit('borrar', m => { deleteClips(compOf(m), [compOf(m).clips[0].id], true); });
    expect(comp().clips.map(c => c.start)).toEqual([2]);
  });
  it('velocidad, invertir, congelar y bucle calculan el segundo de origen', () => {
    const { h, comp, id } = setup();
    h.edit('vel', m => { setSpeed(compOf(m).clips[0] as MediaClip, 2); });
    const c = comp().clips[0] as MediaClip;
    expect(c.dur).toBe(5);
    expect(sourceTime(c, 1, 10)).toBe(2);
    c.reverse = true;
    expect(sourceTime(c, 0, 10)).toBeCloseTo(10, 2);
    h.edit('congelar', m => { freezeFrame(compOf(m), m, id(), 1, 2); });
    const fr = comp().clips.find(x => (x as MediaClip).freeze !== null) as MediaClip;
    expect([fr.start, fr.dur]).toEqual([1, 2]);
    expect(sourceTime(fr, 0.5, 10)).toBe(fr.freeze);
  });
  it('mover con grupos y entre pistas; ajuste magnético; activos en orden', () => {
    const { h, comp } = setup();
    h.edit('texto', m => { const cp = compOf(m); cp.clips.push(textClip(cp, cp.tracks[1].id, 3)); cp.clips.push(shapeClip(cp, cp.tracks[1].id, 20, 'star')); });
    const ids = comp().clips.map(c => c.id);
    h.edit('agrupar', m => { toggleGroup(compOf(m), [ids[0], ids[1]]); });
    h.edit('mover', m => { moveClips(compOf(m), [ids[0]], 1); });
    expect(comp().clips.filter(c => c.group).map(c => c.start)).toEqual([1, 4]);
    expect(snapTo(comp(), 10.95, 0.1, new Set(), 0)).toBe(11);
    const act = activeClips(comp(), 4.5).map(c => c.kind);
    expect(act).toEqual(['text', 'media']); // pista de arriba encima
  });
  it('precomponer, copiar/pegar atributos y presets', () => {
    const { h, comp } = setup();
    h.edit('texto', m => { const cp = compOf(m); cp.clips.push(textClip(cp, cp.tracks[1].id, 1)); });
    const [v, t] = comp().clips;
    h.edit('pre', m => { precompose(m, compOf(m), [v.id, t.id], 'Precomp'); });
    expect(h.m.comps).toHaveLength(2);
    expect(comp().clips).toHaveLength(1);
    expect(comp().clips[0].kind).toBe('comp');
    const attrs = copyAttrs(comp().clips[0]);
    applyPreset(attrs.tf, 'fade-in', 5, 1, 1920, 1080);
    h.edit('pegar', m => { pasteAttrs(compOf(m).clips[0], attrs); });
    expect(valueAt(comp().clips[0].tf.opacity, 0)).toBe(0);
    expect(h.undoStack.map(c => c.label)).toEqual(['añadir', 'texto', 'pre', 'pegar']);
  });
});

import { copyKeys, pasteKeys, deleteKeysAt, newComposition as nc2, solidClip as sc2, textClip as tc2 } from '../src/yosadraw/motion/model';
describe('portapapeles de keyframes', () => {
  it('copia de un clip y pega en otro en el cabezal, conservando curvas', () => {
    const comp = nc2(1920, 1080, 30, 10);
    const a = tc2(comp, comp.tracks[0].id, 0, 'A'), b = sc2(comp, comp.tracks[1].id, 0, '#000000');
    a.tf.x = { v: 0, k: [{ t: 1, v: 10, e: 'bounce' }, { t: 2, v: 50, e: 'linear' }] };
    a.tf.opacity = { v: 1, k: [{ t: 1.5, v: 0.5, e: 'linear' }] };
    const kc = copyKeys(a)!;
    expect(kc.items.map(i => i.path).sort()).toEqual(['tf.opacity', 'tf.x']);
    expect(kc.span).toBe(1);
    expect(pasteKeys(b, kc, 3)).toBe(3);
    expect(b.tf.x.k!.map(k => [k.t, k.v, k.e])).toEqual([[3, 10, 'bounce'], [4, 50, 'linear']]);
    expect(b.tf.opacity.k!.map(k => k.t)).toEqual([3.5]);
  });
  it('sólo los tiempos elegidos, a otra propiedad del mismo tipo, y no a una de otro tipo', () => {
    const comp = nc2(100, 100, 30, 10);
    const a = sc2(comp, comp.tracks[0].id, 0);
    a.tf.x = { v: 0, k: [{ t: 0, v: 1, e: 'linear' }, { t: 1, v: 2, e: 'linear' }] };
    const kc = copyKeys(a, [1])!;
    expect(kc.items[0].keys.map(k => [k.t, k.v])).toEqual([[0, 2]]);
    expect(pasteKeys(a, kc, 2, 'tf.rot')).toBe(1);
    expect(a.tf.rot.k![0]).toMatchObject({ t: 2, v: 2 });
    expect(pasteKeys(a, kc, 2, 'color')).toBe(0);
    expect(deleteKeysAt(a, [0, 1])).toBe(2);
    expect(a.tf.x.k).toBeUndefined();
  });
  it('efectos con id distinto: se pega en el mismo tipo de efecto', () => {
    const comp = nc2(100, 100, 30, 10);
    const a = sc2(comp, comp.tracks[0].id, 0), b = sc2(comp, comp.tracks[0].id, 5);
    a.fx.push({ id: 'f1', fx: 'gauss', on: true, p: { radius: { v: 1, k: [{ t: 0, v: 1, e: 'linear' }, { t: 1, v: 9, e: 'linear' }] } } });
    b.fx.push({ id: 'zz', fx: 'gauss', on: true, p: { radius: { v: 3 } } });
    expect(pasteKeys(b, copyKeys(a)!, 0)).toBe(2);
    expect(b.fx[0].p.radius.k!.length).toBe(2);
  });
});

import { describe, expect, it } from 'vitest';
import { LiveAudio } from '../src/yosadraw/studio3d/live/audio';
import { defaultAudio, newStudio, normalizeStudio } from '../src/yosadraw/studio3d/model';

describe('PNGTuber', () => {
  it('detecta cuándo habla: abre al pasar el umbral, aguanta la boca y avisa de los sonidos fuertes', () => {
    const cfg = { ...defaultAudio(), threshold: 0.1, hold: 0.2, loud: 0.6 };
    const a = new LiveAudio(() => cfg);
    const run = (lvl: number, sec: number, t0: number) => { a.forced = lvl; const ev: string[] = []; let t = t0; for (let i = 0; i < sec * 60; i++) { t += 1 / 60; ev.push(...a.step(t, 1 / 60)); } return { ev, t }; };
    let r = run(0.3, 0.5, 0);
    expect(r.ev).toEqual(['talk']);
    expect(a.talking).toBe(true);
    // Silencio corto (sílabas): no se cierra.
    r = run(0, 0.08, r.t);
    expect(a.talking).toBe(true);
    // Silencio largo: se calla una sola vez.
    r = run(0, 0.8, r.t);
    expect(r.ev).toEqual(['quiet']);
    expect(a.talking).toBe(false);
    // Grito: habla y «sonido fuerte», sin repetirlo en cada fotograma.
    r = run(0.9, 1, r.t);
    expect(r.ev[0]).toBe('talk');
    const louds = r.ev.filter(e => e === 'loud').length;
    expect(louds).toBeGreaterThanOrEqual(1); expect(louds).toBeLessThanOrEqual(2);
    // Sin fuente de audio no hace nada.
    expect(new LiveAudio(() => cfg).step(1, 1 / 60)).toEqual([]);
  });
  it('el nivel baja por tiempo, no por fotograma (igual con pocos FPS)', () => {
    const cfg = defaultAudio();
    const fast = new LiveAudio(() => cfg), slow = new LiveAudio(() => cfg);
    fast.forced = slow.forced = 1; for (let i = 0; i < 60; i++) fast.step(i / 60, 1 / 60); for (let i = 0; i < 6; i++) slow.step(i / 6, 1 / 6);
    fast.forced = slow.forced = 0; for (let i = 0; i < 12; i++) fast.step(1 + i / 60, 1 / 60); for (let i = 0; i < 2; i++) slow.step(1 + i / 10, 1 / 10);
    expect(Math.abs(fast.level - slow.level)).toBeLessThan(0.05);
  });
  it('personaje, partes y audio se guardan y se completan', () => {
    const raw = JSON.parse(JSON.stringify(newStudio()));
    const sc = raw.scenes[0];
    sc.audio = { tracks: [{ name: 'Voz', src: 'data:audio/wav;base64,AAAA' }, { bad: 1 }], mic: true };
    const o = sc.objects[1];
    o.card = { billboard: false, tuber: { bounce: 0.8 }, poses: [{ name: 'Feliz', tex: 't1', key: 'f', talk: 't2', blink: 5 }] };
    o.part = { sway: 'x' };
    const n = normalizeStudio(raw)!;
    const s2 = n.scenes[0], x = s2.objects[1];
    expect(s2.audio!.tracks.map(t => [t.name, t.auto, t.loop, t.volume])).toEqual([['Voz', true, false, 1]]);
    expect(s2.audio!.mic).toBe(true);
    expect(s2.audio!.threshold).toBeGreaterThan(0);
    expect(x.card!.tuber).toMatchObject({ bounce: 0.8, squash: 0.25, blinkEvery: 4 });
    expect(x.card!.poses![0]).toMatchObject({ talk: 't2' });
    expect(x.card!.poses![0].blink).toBeUndefined();
    expect(x.part).toBeUndefined();
  });
});

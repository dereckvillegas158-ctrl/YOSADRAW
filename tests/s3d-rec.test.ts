import { describe, expect, it } from 'vitest';
import { nextSlot } from '../src/yosadraw/studio3d/live/recorder';

/** Simula dibujos a `hz` con variación aleatoria y graba a `fps`: fotogramas guardados por segundo y adelanto máximo. */
function sim(hz: number, fps: number, jitterMs: number, phase: number) {
  let last = -1, lastS = -1e9, kept = 0, ahead = 0;
  for (let i = 0; i < hz * 10; i++) {
    const s = (phase / hz + i / hz + (Math.random() * jitterMs) / 1000) * fps;
    const r = nextSlot(last, lastS, s);
    if (r === null) continue;
    expect(r).toBeGreaterThan(last);
    kept++; ahead = Math.max(ahead, r - s); last = r; lastS = s;
  }
  return { fps: kept / 10, ahead };
}

describe('Grabación en vivo: fotogramas', () => {
  it('pantalla de 60 Hz grabando a 60 fps: no se pierden fotogramas aunque la hora varíe', () => {
    for (const phase of [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9]) {
      const r = sim(60, 60, 6, phase);
      expect(r.fps).toBeGreaterThanOrEqual(59.5);
      expect(r.ahead).toBeLessThanOrEqual(1);
    }
  });
  it('pantalla rápida (144 Hz) a 60 fps: ~60 fps, sin adelantarse a su hora', () => {
    const r = sim(144, 60, 4, 0.5);
    expect(r.fps).toBeGreaterThan(55); expect(r.fps).toBeLessThan(61);
    expect(r.ahead).toBeLessThanOrEqual(1);
  });
  it('a 30 fps desde 60 Hz: ~30 fps', () => {
    const r = sim(60, 30, 6, 0.7);
    expect(r.fps).toBeGreaterThan(29); expect(r.fps).toBeLessThan(31);
  });
  it('si el equipo dibuja menos, se guarda lo que dibuja', () => {
    const r = sim(40, 60, 4, 0.2);
    expect(r.fps).toBeGreaterThan(39); expect(r.fps).toBeLessThan(41);
  });
});

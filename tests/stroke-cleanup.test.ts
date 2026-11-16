import { describe, expect, it } from 'vitest';
import { cleanStroke, CLEANUP_TOUCH } from '../src/filters/StrokeCleanup';

const P = (x: number, y: number, t: number) => ({ x, y, pressure: 1, tiltX: 0, tiltY: 0, t });

describe('limpieza de extremos del trazo', () => {
  it('quita el garabato inicial del dedo y el gancho al levantarlo', () => {
    const pts = [
      P(0, 0, 0), P(2, 1, 8), P(-1, 2, 16), P(1, -1, 24), P(2, 2, 32),           // temblor al apoyar (< 5 px, < 70 ms)
      ...Array.from({ length: 30 }, (_, i) => P(10 + i * 6, 0, 80 + i * 8)),       // trazo recto hacia la derecha
      P(184, 6, 328), P(181, 11, 336),                                              // gancho al levantar (gira ~110°, < 14 px)
    ];
    const out = cleanStroke(pts, CLEANUP_TOUCH);
    expect(out[0]).toEqual(pts[0]);
    expect(out.slice(1, 3).every(p => p.x >= 10)).toBe(true);                       // el garabato desaparece
    expect(out[out.length - 1]).toMatchObject({ x: 184, y: 0 });                     // termina donde iba el trazo
  });

  it('conserva un final con giro largo intencionado y trazos cortos', () => {
    const pts = [...Array.from({ length: 20 }, (_, i) => P(i * 6, 0, i * 8)), ...Array.from({ length: 8 }, (_, i) => P(114, 6 + i * 6, 160 + i * 8))];
    expect(cleanStroke(pts, CLEANUP_TOUCH)).toHaveLength(pts.length);
    const dot = [P(0, 0, 0), P(1, 1, 8), P(0, 1, 16)];
    expect(cleanStroke(dot, CLEANUP_TOUCH)).toHaveLength(3);
  });

  it('no toca un trazo que empieza moviéndose', () => {
    const pts = Array.from({ length: 20 }, (_, i) => P(i * 8, i * 2, i * 8));
    expect(cleanStroke(pts, CLEANUP_TOUCH)).toEqual(pts);
  });
});

import { describe, expect, it } from 'vitest';
import type { StrokePoint } from '../src/core/types';
import { createEngine, type EngineSettings } from '../src/filters';
import { turning } from '../src/playground/Metrics';
import { NoiseInjector } from '../src/playground/Noise';

function run(settings: EngineSettings, stroke: StrokePoint[], tweak?: (e: ReturnType<typeof createEngine>) => void) {
  const e = createEngine();
  e.apply(settings);
  tweak?.(e);
  const out: StrokePoint[] = [...e.pipeline.beginStroke(stroke[0])];
  const lags: number[] = [];
  for (let i = 1; i < stroke.length; i++) {
    out.push(...e.pipeline.pushPoint(stroke[i]));
    const tip = out[out.length - 1];
    lags.push(Math.hypot(tip.x - stroke[i].x, tip.y - stroke[i].y));
  }
  out.push(...e.pipeline.endStroke());
  return { out, lags };
}

/** Línea recta a velocidad constante, 240 Hz. */
function line(len: number, speedPxMs: number): StrokePoint[] {
  const n = Math.round(len / speedPxMs / (1000 / 240));
  return Array.from({ length: n + 1 }, (_, i) => ({ x: 50 + (len * i) / n, y: 100, pressure: 0.6, tiltX: 0, tiltY: 0, t: (i * 1000) / 240 }));
}

function withNoise(s: StrokePoint[], tremor: number, spikes: number, seed = 7) {
  const n = new NoiseInjector();
  n.tremor = tremor; n.spikes = spikes;
  n.beginStroke(seed, s[0].t);
  return s.map(p => n.apply(p));
}

const minDistTo = (pts: StrokePoint[], x: number, y: number) => Math.min(...pts.map(p => Math.hypot(p.x - x, p.y - y)));
const OFF: EngineSettings = { streamLine: 0, stabilization: 0, motionFiltering: 0 };

describe('pipeline', () => {
  it('con todo al 0% es un bypass exacto', () => {
    const s = withNoise(line(300, 0.5), 0.5, 0.3);
    const { out } = run(OFF, s);
    expect(out).toEqual(s);
  });

  it('los tres al 100% siguen terminando en el punto donde se levantó el lápiz', () => {
    const s = withNoise(line(300, 0.4), 0.5, 0);
    const { out } = run({ streamLine: 100, stabilization: 100, motionFiltering: 100 }, s);
    const a = out[out.length - 1], b = s[s.length - 1];
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(0.01);
  });

  it('procesa 100 000 muestras con todo al 100% en tiempo real holgado', () => {
    const s = withNoise(line(20000, 0.5), 0.5, 0.2);
    const t0 = performance.now();
    run({ streamLine: 100, stabilization: 100, motionFiltering: 100 }, s.slice(0, 100000));
    const perSampleUs = ((performance.now() - t0) * 1000) / Math.min(100000, s.length);
    expect(perSampleUs).toBeLessThan(20); // presupuesto a 240 Hz: 4166 µs por muestra
  });
});

describe('Stabilization', () => {
  const rms = (pts: StrokePoint[]) => {
    const mid = pts.filter(p => p.x > 150 && p.x < 400);
    return Math.sqrt(mid.reduce((a, p) => a + (p.y - 100) ** 2, 0) / mid.length);
  };

  it('elimina la mayor parte del temblor (8–12 Hz) en un trazo lento', () => {
    const s = withNoise(line(500, 0.15), 0.6, 0);
    expect(rms(run({ ...OFF, stabilization: 80 }, s).out)).toBeLessThan(rms(s) * 0.35);
    expect(rms(run({ ...OFF, stabilization: 100 }, s).out)).toBeLessThan(rms(s) * 0.2);
  });

  it('la intensidad es monótona: más porcentaje, menos temblor', () => {
    const s = withNoise(line(500, 0.2), 0.6, 0);
    const v = [0, 25, 50, 75, 100].map(st => rms(run({ ...OFF, stabilization: st }, s).out));
    for (let i = 1; i < v.length; i++) expect(v[i]).toBeLessThan(v[i - 1]);
  });

  it('conserva la velocidad: retraso temporal < 8 ms a 2500 px/s, incluso al 100%', () => {
    const s = line(1500, 2.5);
    const { lags } = run({ ...OFF, stabilization: 100 }, s);
    const steady = lags.slice(lags.length / 2);
    const avgPx = steady.reduce((a, b) => a + b, 0) / steady.length;
    expect(avgPx / 2.5).toBeLessThan(8);
  });
});

describe('Motion Filtering', () => {
  it('suprime un pico aislado de 25 px', () => {
    const s = line(300, 0.5);
    const k = Math.floor(s.length / 2);
    s[k] = { ...s[k], y: s[k].y + 25 };
    const { out } = run({ ...OFF, motionFiltering: 100 }, s);
    const maxDev = Math.max(...out.map(p => Math.abs(p.y - 100)));
    expect(maxDev).toBeLessThan(4);
  });

  it('no reintroduce un pico situado en la última muestra', () => {
    const s = line(300, 0.5);
    const k = s.length - 1;
    s[k] = { ...s[k], y: s[k].y + 25 };
    const { out } = run({ ...OFF, motionFiltering: 100 }, s);
    expect(Math.max(...out.map(p => Math.abs(p.y - 100)))).toBeLessThan(6);
  });

  it('no altera un trazo limpio y regular', () => {
    const s = line(300, 0.5);
    const { out } = run({ ...OFF, motionFiltering: 100 }, s);
    expect(Math.max(...out.map(p => Math.abs(p.y - 100)))).toBeLessThan(1e-9);
  });
});

describe('StreamLine', () => {
  // Cuadrado recorrido a velocidad constante (sin frenar en los vértices),
  // el peor caso para el redondeo de esquinas.
  const corners: [number, number][] = [[300, 100], [300, 300], [100, 300]];
  const square: StrokePoint[] = [];
  const path: [number, number][] = [[100, 100], ...corners, [100, 100]];
  let t = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const [x0, y0] = path[i], [x1, y1] = path[i + 1];
    for (let j = i ? 1 : 0; j <= 100; j++) {
      square.push({ x: x0 + ((x1 - x0) * j) / 100, y: y0 + ((y1 - y0) * j) / 100, pressure: 0.5, tiltX: 0, tiltY: 0, t });
      t += 1000 / 240;
    }
  }

  it('suaviza ondulaciones', () => {
    const s = withNoise(line(500, 0.3), 0.5, 0);
    const raw = turning(s);
    const o = turning(run({ ...OFF, streamLine: 70 }, s).out);
    expect(o.turn / o.len).toBeLessThan((raw.turn / raw.len) / 2);
  });

  it('preserva las esquinas en lugar de redondearlas', () => {
    const on = run({ ...OFF, streamLine: 80 }, square).out;
    const off = run({ ...OFF, streamLine: 80 }, square, e => { e.streamLine.preserveCorners = false; }).out;
    for (const [x, y] of corners) {
      expect(minDistTo(on, x, y)).toBeLessThan(1.5);
      expect(minDistTo(off, x, y)).toBeGreaterThan(5);
    }
  });
});

describe('Pressure & Tilt Smoothing', () => {
  const jittery = () => line(400, 0.3).map((p, i) => ({
    ...p,
    pressure: 0.5 + (i % 2 ? 0.08 : -0.08),
    tiltX: 40 + (i % 3) - 1, tiltY: -20 + (i % 2) * 2,
  }));

  it('reduce el ruido de presión e inclinación sin mover la posición', () => {
    const s = jittery();
    const { out } = run({ ...OFF, pressureSmoothing: 80 }, s);
    const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
    const tail = out.slice(out.length / 2);
    expect(spread(tail.map(p => p.pressure))).toBeLessThan(0.04);
    expect(spread(tail.map(p => p.tiltX))).toBeLessThan(0.8);
    out.forEach((p, i) => { expect(p.x).toBe(s[i].x); expect(p.y).toBe(s[i].y); });
  });

  it('el acimut no salta al cruzar ±180°', () => {
    const s = line(200, 0.3).map((p, i) => ({ ...p, tiltX: -30, tiltY: i % 2 ? 0.5 : -0.5 }));
    const { out } = run({ ...OFF, pressureSmoothing: 100 }, s);
    for (const p of out) expect(p.tiltX).toBeLessThan(-25);
  });
});

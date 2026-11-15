import type { StrokePoint } from '../../core/types';
import type { BrushPreset } from './BrushPreset';
import { DabGenerator } from './DabGenerator';
import type { PaintStroke, StrokeTool } from './StrokePainter';

/** Genera un trazo terminado (dos pasadas: la segunda conoce la longitud para el afilado final). */
export function buildStroke(preset: BrushPreset, points: readonly StrokePoint[], seed: number, color: string, tool: StrokeTool = 'brush'): PaintStroke {
  const a = new DabGenerator(preset, seed);
  for (const p of points) a.push(p);
  a.finish();
  const b = new DabGenerator(preset, seed, { totalLength: a.length });
  for (const p of points) b.push(p);
  b.finish();
  return { preset, color, tool, dabs: b.dabs.trimmed(), dabCount: b.dabs.count, points, total: a.length };
}

/**
 * Trazo de muestra: curva en S con la presión subiendo y bajando, la
 * inclinación variando y velocidad realista. Hace visibles casi todos los
 * parámetros del pincel en una sola línea.
 */
export function sampleStroke(w: number, h: number, margin: number): StrokePoint[] {
  const n = 160, pts: StrokePoint[] = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const x = margin + u * (w - 2 * margin);
    const y = h / 2 - Math.sin(u * Math.PI * 2) * (h / 2 - margin) * 0.62;
    const pressure = 0.15 + 0.85 * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.1)), 0.8);
    const tilt = 55 * Math.sin(Math.PI * u);
    pts.push({ x, y, pressure, tiltX: tilt * 0.8, tiltY: tilt * 0.6, t: i * 6 });
  }
  return pts;
}

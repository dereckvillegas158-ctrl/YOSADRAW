import type { CurvePoint } from './BrushPreset';

/**
 * Curva de respuesta a la presión: interpolación cúbica monótona
 * (Fritsch–Carlson) por los puntos de control. Monótona = nunca "rebota":
 * más presión nunca da menos efecto si los puntos son crecientes.
 */
export function evalCurve(pts: readonly CurvePoint[], x: number): number {
  const n = pts.length;
  if (x <= pts[0][0]) return pts[0][1];
  if (x >= pts[n - 1][0]) return pts[n - 1][1];
  const dx: number[] = [], m: number[] = [];
  for (let i = 0; i < n - 1; i++) { dx.push(Math.max(1e-6, pts[i + 1][0] - pts[i][0])); m.push((pts[i + 1][1] - pts[i][1]) / dx[i]); }
  const t: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]));
  t.push(m[n - 2]);
  let k = 0;
  while (k < n - 2 && x > pts[k + 1][0]) k++;
  const h = dx[k], s = (x - pts[k][0]) / h;
  const h00 = 2 * s ** 3 - 3 * s ** 2 + 1, h10 = s ** 3 - 2 * s ** 2 + s, h01 = -2 * s ** 3 + 3 * s ** 2, h11 = s ** 3 - s ** 2;
  return Math.min(1, Math.max(0, h00 * pts[k][1] + h10 * h * t[k] + h01 * pts[k + 1][1] + h11 * h * t[k + 1]));
}

/** Tabla de 256 entradas para evaluar la curva en O(1) dentro del bucle de sellos. */
export function curveLUT(pts: readonly CurvePoint[]): Float32Array {
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) lut[i] = evalCurve(pts, i / 255);
  return lut;
}

export const lookup = (lut: Float32Array, x: number) => lut[Math.round(Math.min(1, Math.max(0, x)) * 255)];

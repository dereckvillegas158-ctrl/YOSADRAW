import type { StrokePoint } from '../../core/types';
import type { ViewTransform } from './ViewTransform';

/**
 * Puntos de documento → pantalla, descartando los que caen a < 0,6 px del
 * anterior (al alejar). La spline Catmull-Rom centrípeta es invariante ante
 * similitudes, así que dibujar en pantalla da la misma curva, nítida a
 * cualquier zoom. Lo usa el modo "línea lisa" de los pinceles.
 */
export function projectPoints(points: readonly StrokePoint[], view: ViewTransform): StrokePoint[] {
  const m = view.matrix();
  const out: StrokePoint[] = [];
  let lx = NaN, ly = NaN;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const x = m[0] * p.x + m[2] * p.y + m[4];
    const y = m[1] * p.x + m[3] * p.y + m[5];
    const last = i === points.length - 1;
    if (!last && out.length && (x - lx) * (x - lx) + (y - ly) * (y - ly) < 0.36) continue;
    out.push({ x, y, pressure: p.pressure, tiltX: p.tiltX, tiltY: p.tiltY, t: p.t });
    lx = x; ly = y;
  }
  return out;
}

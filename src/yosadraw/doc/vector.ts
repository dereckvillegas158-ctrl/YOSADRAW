import type { StrokePoint } from '../../core/types';
import { strokeBounds, type FinishedStroke } from '../brush/BrushStrokeSession';
import { applyMat, invert, transformAABB } from '../engine/ViewTransform';
import { itemMatrix, type Item, type StrokeItem } from './items';

/**
 * Capas vectoriales: los trazos son líneas (puntos con presión) que se dibujan
 * con el motor de línea lisa. Aquí: tocar trazos, nodos editables, deformar con
 * influencia suave, suavizar y simplificar. Todo devuelve trazos nuevos (los
 * elementos del documento son inmutables: deshacer funciona igual que siempre).
 */

export const isVectorStroke = (it: Item): it is StrokeItem => it.kind === 'stroke' && it.stroke.preset.render.mode === 'smooth';

/** Radio de la línea (px de documento) en un punto, según la presión. */
export function radiusAt(s: FinishedStroke, p: StrokePoint) {
  const pr = s.preset;
  return Math.max(0.5, (pr.size.size / 2) * (1 - pr.pressure.size + pr.pressure.size * Math.max(0.05, p.pressure)));
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Distancia (px de documento) del punto al trazo, menos su grosor (≤ 0 = encima). */
export function strokeDistance(it: StrokeItem, x: number, y: number): number {
  const q = applyMat(invert(itemMatrix(it)), x, y);
  const pts = it.stroke.points;
  let best = Infinity;
  if (pts.length === 1) return Math.hypot(q.x - pts[0].x, q.y - pts[0].y) - radiusAt(it.stroke, pts[0]);
  for (let i = 1; i < pts.length; i++) {
    const d = segDist(q.x, q.y, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y) - radiusAt(it.stroke, pts[i]);
    if (d < best) best = d;
  }
  return best;
}

/** ¿El trazo toca el camino (del borrador) con radio r? */
export function itemTouchesPath(it: Item, path: { x: number; y: number }[], r: number): boolean {
  if (it.kind !== 'stroke') return false;
  const b = it.bounds;
  if (!path.some(p => p.x >= b.minX - r && p.x <= b.maxX + r && p.y >= b.minY - r && p.y <= b.maxY + r)) return false;
  // Se muestrea el camino del borrador cada r/2 para no saltarse trazos finos.
  for (let i = 0; i < path.length; i++) {
    const a = path[Math.max(0, i - 1)], c = path[i];
    const n = Math.max(1, Math.ceil(Math.hypot(c.x - a.x, c.y - a.y) / Math.max(1, r / 2)));
    for (let k = 1; k <= n; k++) { const x = a.x + ((c.x - a.x) * k) / n, y = a.y + ((c.y - a.y) * k) / n; if (strokeDistance(it, x, y) <= r) return true; }
  }
  return false;
}

/** Trazo vectorial más cercano bajo (x, y) con tolerancia `tol` (el de más arriba). */
export function hitVector(items: Item[], x: number, y: number, tol: number): StrokeItem | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind !== 'stroke') continue;
    const b = it.bounds;
    if (x < b.minX - tol || x > b.maxX + tol || y < b.minY - tol || y > b.maxY + tol) continue;
    if (strokeDistance(it, x, y) <= tol) return it;
  }
  return null;
}

/** Índices de los nodos editables: extremos y un punto cada `step` px de recorrido. */
export function nodeIndices(pts: readonly StrokePoint[], step: number): number[] {
  if (pts.length <= 2) return pts.map((_, i) => i);
  const out = [0];
  let acc = 0;
  for (let i = 1; i < pts.length - 1; i++) { acc += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); if (acc >= step) { out.push(i); acc = 0; } }
  out.push(pts.length - 1);
  return out;
}

/** Mueve el nodo `idx` (dx, dy en coordenadas del trazo) arrastrando los vecinos con caída suave a lo largo de `falloff` px. */
export function dragNode(pts: readonly StrokePoint[], idx: number, dx: number, dy: number, falloff: number): StrokePoint[] {
  const s: number[] = [0];
  for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const s0 = s[idx], f = Math.max(1, falloff);
  return pts.map((p, i) => {
    const d = Math.abs(s[i] - s0) / f;
    if (d >= 1) return p;
    const w = 0.5 * (1 + Math.cos(Math.PI * d));
    return { ...p, x: p.x + dx * w, y: p.y + dy * w };
  });
}

/** Suaviza la línea (media de vecinos; los extremos no se mueven). */
export function smoothStroke(pts: readonly StrokePoint[], passes = 2): StrokePoint[] {
  let a = pts.slice();
  for (let k = 0; k < passes; k++) a = a.map((p, i) => (i === 0 || i === a.length - 1 ? p : { ...p, x: (a[i - 1].x + 2 * p.x + a[i + 1].x) / 4, y: (a[i - 1].y + 2 * p.y + a[i + 1].y) / 4, pressure: (a[i - 1].pressure + 2 * p.pressure + a[i + 1].pressure) / 4 }));
  return a;
}

/** Quita puntos que no cambian la forma (Ramer–Douglas–Peucker con tolerancia `eps` px). */
export function simplifyStroke(pts: readonly StrokePoint[], eps: number): StrokePoint[] {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let md = 0, mi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = segDist(pts[i].x, pts[i].y, pts[a].x, pts[a].y, pts[b].x, pts[b].y) + Math.abs(pts[i].pressure - (pts[a].pressure + pts[b].pressure) / 2) * 4;
      if (d > md) { md = d; mi = i; }
    }
    if (mi >= 0 && md > eps) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Elemento nuevo con el trazo cambiado (puntos, color o pincel); conserva id, transformación y recorte. */
export function withStroke(it: StrokeItem, patch: Partial<Pick<FinishedStroke, 'points' | 'color' | 'preset'>>): StrokeItem {
  const stroke: FinishedStroke = { ...it.stroke, ...patch, sets: [{ dabs: new Float32Array(0), count: 0 }] };
  if (patch.points) stroke.total = patch.points.reduce((a, p, i) => (i ? a + Math.hypot(p.x - patch.points![i - 1].x, p.y - patch.points![i - 1].y) : 0), 0);
  stroke.bounds = strokeBounds(stroke);
  const m = itemMatrix(it);
  return { ...it, stroke, local: stroke.bounds, bounds: transformAABB(m, stroke.bounds) };
}

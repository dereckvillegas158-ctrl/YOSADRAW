import type { StrokePoint } from '../../core/types';
import type { FinishedStroke } from '../brush/BrushStrokeSession';
import type { AABB } from './ViewTransform';

export type DrawTool = 'brush' | 'eraser';

/**
 * Trazo almacenado: puntos estabilizados en coordenadas de documento, los
 * sellos ya calculados y una copia congelada del preset con que se dibujó.
 * Editar el pincel después no altera los trazos existentes.
 */
export interface StoredStroke extends FinishedStroke {
  id: number;
}

export function computeBounds(points: readonly StrokePoint[], size: number): AABB {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  const r = size / 2 + 1;
  return { minX: minX - r, minY: minY - r, maxX: maxX + r, maxY: maxY + r };
}

export const intersects = (a: AABB, b: AABB) => a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;

/** Modelo del documento: lista ordenada de trazos. */
export class StrokeStore {
  private list: StoredStroke[] = [];
  private nextId = 1;
  totalPoints = 0;
  totalDabs = 0;

  get strokes(): readonly StoredStroke[] { return this.list; }
  get count() { return this.list.length; }

  create(data: FinishedStroke): StoredStroke { return { ...data, id: this.nextId++ }; }

  add(s: StoredStroke) { this.list.push(s); this.totalPoints += s.points.length; this.totalDabs += s.dabCount; }

  remove(id: number): boolean {
    const i = this.list.findIndex(s => s.id === id);
    if (i < 0) return false;
    this.totalPoints -= this.list[i].points.length;
    this.totalDabs -= this.list[i].dabCount;
    this.list.splice(i, 1);
    return true;
  }

  clear(): StoredStroke[] { const old = this.list; this.list = []; this.totalPoints = this.totalDabs = 0; return old; }

  restore(strokes: StoredStroke[]) {
    this.list = strokes.slice();
    this.totalPoints = strokes.reduce((n, s) => n + s.points.length, 0);
    this.totalDabs = strokes.reduce((n, s) => n + s.dabCount, 0);
  }

  *visible(view: AABB): Generator<StoredStroke> {
    for (const s of this.list) if (intersects(s.bounds, view)) yield s;
  }
}

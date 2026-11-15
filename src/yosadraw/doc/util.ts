import type { AABB } from '../engine/ViewTransform';

export function combineBounds(list: AABB[]): AABB | null {
  if (!list.length) return null;
  return list.reduce((a, b) => ({ minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) }));
}

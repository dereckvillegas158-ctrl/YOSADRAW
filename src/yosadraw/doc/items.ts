import type { FinishedStroke } from '../brush/BrushStrokeSession';
import { IDENTITY, multiply, transformAABB, type AABB, type Mat } from '../engine/ViewTransform';
import { arrowPoints, regularPoints, type ShapeSpec } from './geometry';
import type { Selection } from './Selection';

export type LayerBlend = 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'color-burn' | 'color-dodge' | 'soft-light' | 'hard-light' | 'difference';

export interface GradientSpec {
  type: 'linear' | 'radial';
  x0: number; y0: number; x1: number; y1: number;
  c0: string; c1: string;
  /** Opacidad de cada extremo (0..1). */
  a0: number; a1: number;
  opacity: number;
}

interface Base {
  id: number;
  /** Transformación propia (null = identidad). */
  m: Mat | null;
  /** Selección que recortaba al crear el elemento. */
  clip: Selection | null;
  /** Pintado con el alfa de la capa bloqueado: sólo cubre lo que ya había (source-atop). */
  lock?: boolean;
  /** Caja sin transformar y caja final en el documento. */
  local: AABB;
  bounds: AABB;
}

export interface StrokeItem extends Base { kind: 'stroke'; stroke: FinishedStroke }
export interface ShapeItem extends Base { kind: 'shape'; shape: ShapeSpec }
export interface GradientItem extends Base { kind: 'gradient'; grad: GradientSpec }
/** Píxeles a resolución de documento (relleno del bote, selección levantada). */
export interface BitmapItem extends Base { kind: 'bitmap'; image: CanvasImageSource; x: number; y: number; w: number; h: number }
/** Borra el área de su recorte (Suprimir con selección, levantar al transformar). */
export interface ClearItem extends Base { kind: 'clear' }
/** Contenido de otra capa fusionada, con su opacidad y fusión. */
export interface GroupItem extends Base { kind: 'group'; items: Item[]; opacity: number; blend: LayerBlend }

export type Item = StrokeItem | ShapeItem | GradientItem | BitmapItem | ClearItem | GroupItem;
export type ItemData = Omit<StrokeItem, keyof Base> | Omit<ShapeItem, keyof Base> | Omit<GradientItem, keyof Base> | Omit<BitmapItem, keyof Base> | Omit<ClearItem, keyof Base> | Omit<GroupItem, keyof Base>;

export function localBounds(d: ItemData, docW: number, docH: number): AABB {
  switch (d.kind) {
    case 'stroke': return d.stroke.bounds;
    case 'shape': {
      const s = d.shape, pad = (s.stroke ? s.width / 2 : 0) + 2;
      const pts = s.type === 'polygon' || s.type === 'star' ? regularPoints(s) : s.type === 'arrow' ? arrowPoints(s) : [{ x: s.x0, y: s.y0 }, { x: s.x1, y: s.y1 }];
      return {
        minX: Math.min(...pts.map(p => p.x)) - pad, minY: Math.min(...pts.map(p => p.y)) - pad,
        maxX: Math.max(...pts.map(p => p.x)) + pad, maxY: Math.max(...pts.map(p => p.y)) + pad,
      };
    }
    case 'bitmap': return { minX: d.x, minY: d.y, maxX: d.x + d.w, maxY: d.y + d.h };
    case 'gradient': case 'clear': return { minX: 0, minY: 0, maxX: docW, maxY: docH };
    case 'group': {
      if (!d.items.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
      return d.items.map(i => i.bounds).reduce((a, b) => ({ minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) }));
    }
  }
}

/** Devuelve una copia del elemento con la transformación t aplicada (no destructivo). */
export function transformItem(it: Item, t: Mat): Item {
  const m = multiply(t, it.m ?? IDENTITY);
  return { ...it, m, bounds: transformAABB(m, it.local) } as Item;
}

export const itemMatrix = (it: Item): Mat => it.m ?? IDENTITY;

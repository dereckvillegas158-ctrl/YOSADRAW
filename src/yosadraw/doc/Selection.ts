import { applyMat, IDENTITY, multiply, transformAABB, type AABB, type Mat } from '../engine/ViewTransform';

export type SelMode = 'replace' | 'add' | 'subtract' | 'intersect';

export type SelShape =
  | { type: 'rect'; x: number; y: number; w: number; h: number; m?: Mat }
  | { type: 'ellipse'; cx: number; cy: number; rx: number; ry: number; m?: Mat }
  | { type: 'poly'; pts: number[]; m?: Mat }
  /** Máscara de píxeles (varita mágica): alfa en `canvas`, colocada en (x, y) del documento. */
  | { type: 'mask'; x: number; y: number; w: number; h: number; canvas: CanvasImageSource; m?: Mat }
  /** Selección anidada (p. ej. para invertir una combinación cualquiera). */
  | { type: 'sel'; sel: Selection; m?: undefined };

export interface SelOp { mode: SelMode; shape: SelShape }

/** Selección inmutable: una lista de operaciones que se combinan en orden. */
export interface Selection { ops: SelOp[] }

export function combine(current: Selection | null, mode: SelMode, shape: SelShape): Selection | null {
  if (mode === 'replace' || !current) {
    if (mode === 'subtract' || mode === 'intersect') return current && mode === 'intersect' ? { ops: [...current.ops, { mode, shape }] } : current;
    return { ops: [{ mode: 'add', shape }] };
  }
  return { ops: [...current.ops, { mode, shape }] };
}

function shapeLocalBounds(s: SelShape): AABB {
  switch (s.type) {
    case 'sel': return selectionBounds(s.sel) ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    case 'rect': return { minX: Math.min(s.x, s.x + s.w), minY: Math.min(s.y, s.y + s.h), maxX: Math.max(s.x, s.x + s.w), maxY: Math.max(s.y, s.y + s.h) };
    case 'ellipse': return { minX: s.cx - s.rx, minY: s.cy - s.ry, maxX: s.cx + s.rx, maxY: s.cy + s.ry };
    case 'mask': return { minX: s.x, minY: s.y, maxX: s.x + s.w, maxY: s.y + s.h };
    case 'poly': {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i < s.pts.length; i += 2) { minX = Math.min(minX, s.pts[i]); maxX = Math.max(maxX, s.pts[i]); minY = Math.min(minY, s.pts[i + 1]); maxY = Math.max(maxY, s.pts[i + 1]); }
      return { minX, minY, maxX, maxY };
    }
  }
}

export const shapeBounds = (s: SelShape): AABB => (s.m ? transformAABB(s.m, shapeLocalBounds(s)) : shapeLocalBounds(s));

/** Caja que contiene la selección (aproximada por exceso cuando hay restas). */
export function selectionBounds(sel: Selection): AABB | null {
  let b: AABB | null = null;
  for (const op of sel.ops) {
    const sb = shapeBounds(op.shape);
    if (op.mode === 'add' || op.mode === 'replace') b = b ? { minX: Math.min(b.minX, sb.minX), minY: Math.min(b.minY, sb.minY), maxX: Math.max(b.maxX, sb.maxX), maxY: Math.max(b.maxY, sb.maxY) } : sb;
    else if (op.mode === 'intersect' && b) b = { minX: Math.max(b.minX, sb.minX), minY: Math.max(b.minY, sb.minY), maxX: Math.min(b.maxX, sb.maxX), maxY: Math.min(b.maxY, sb.maxY) };
  }
  return b && b.maxX > b.minX && b.maxY > b.minY ? b : null;
}

/** Aplica una transformación a toda la selección (tras transformar su contenido). */
export function transformSelection(sel: Selection, t: Mat): Selection {
  return {
    ops: sel.ops.map(op => ({
      mode: op.mode,
      shape: op.shape.type === 'sel' ? { type: 'sel', sel: transformSelection(op.shape.sel, t) } : { ...op.shape, m: multiply(t, op.shape.m ?? IDENTITY) } as SelShape,
    })),
  };
}

/** Selección de todo el documento. */
export const selectAll = (w: number, h: number): Selection => ({ ops: [{ mode: 'add', shape: { type: 'rect', x: 0, y: 0, w, h } }] });

/** Invierte: todo el documento menos lo seleccionado. */
export function invertSelection(sel: Selection | null, w: number, h: number): Selection | null {
  if (!sel) return selectAll(w, h);
  return { ops: [{ mode: 'add', shape: { type: 'rect', x: 0, y: 0, w, h } }, { mode: 'subtract', shape: { type: 'sel', sel } }] };
}

/* ---------------- Dibujo de la máscara ---------------- */

function tracePath(ctx: CanvasRenderingContext2D, s: Exclude<SelShape, { type: 'sel' }>) {
  ctx.beginPath();
  if (s.type === 'rect') ctx.rect(s.x, s.y, s.w, s.h);
  else if (s.type === 'ellipse') ctx.ellipse(s.cx, s.cy, Math.abs(s.rx), Math.abs(s.ry), 0, 0, Math.PI * 2);
  else if (s.type === 'poly') { for (let i = 0; i < s.pts.length; i += 2) (i ? ctx.lineTo : ctx.moveTo).call(ctx, s.pts[i], s.pts[i + 1]); ctx.closePath(); }
}

/**
 * Dibuja la máscara de selección (alfa = seleccionado) en `ctx` con la
 * matriz documento → dispositivo `D`. Las formas vectoriales salen nítidas a
 * cualquier zoom; las máscaras de píxeles se escalan.
 */
export function drawSelectionMask(ctx: CanvasRenderingContext2D, sel: Selection, D: Mat) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.fillStyle = '#fff';
  for (const op of sel.ops) {
    const m = multiply(D, op.shape.m ?? IDENTITY);
    ctx.globalCompositeOperation = op.mode === 'subtract' ? 'destination-out' : op.mode === 'intersect' ? 'destination-in' : 'source-over';
    ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    if (op.shape.type === 'sel') {
      const tmp = document.createElement('canvas');
      tmp.width = ctx.canvas.width; tmp.height = ctx.canvas.height;
      drawSelectionMask(tmp.getContext('2d')!, op.shape.sel, D);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(tmp, 0, 0);
    } else if (op.shape.type === 'mask') {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(op.shape.canvas, op.shape.x, op.shape.y, op.shape.w, op.shape.h);
    } else {
      tracePath(ctx, op.shape);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** Contorno de las formas vectoriales (para las "hormigas" de la selección). */
export function strokeSelectionOutline(ctx: CanvasRenderingContext2D, sel: Selection, D: Mat) {
  for (const op of sel.ops) {
    if (op.shape.type === 'sel') { strokeSelectionOutline(ctx, op.shape.sel, D); continue; }
    if (op.shape.type === 'mask') continue;
    const m = multiply(D, op.shape.m ?? IDENTITY);
    ctx.save();
    ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    tracePath(ctx, op.shape);
    ctx.restore();
    ctx.stroke();
  }
}

export const selPoint = (s: SelShape, x: number, y: number) => (s.m ? applyMat(s.m, x, y) : { x, y });

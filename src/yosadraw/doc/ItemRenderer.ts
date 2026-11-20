import type { StrokePainter } from '../brush/StrokePainter';
import { clampRect, rectEmpty, type Rect } from '../brush/StrokePainter';
import { IDENTITY, multiply, transformAABB, type AABB, type Mat } from '../engine/ViewTransform';
import { arrowPoints, regularPoints, type ShapeSpec } from './geometry';
import type { GradientSpec, Item, LayerBlend } from './items';
import { drawSelectionMask, type Selection } from './Selection';

export function hexToRgba(hex: string, a: number): string {
  const n = parseInt(hex.replace('#', ''), 16) || 0;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

const LAYER_OP: Record<LayerBlend, GlobalCompositeOperation> = {
  normal: 'source-over', multiply: 'multiply', screen: 'screen', overlay: 'overlay', darken: 'darken', lighten: 'lighten',
  'color-burn': 'color-burn', 'color-dodge': 'color-dodge', 'soft-light': 'soft-light', 'hard-light': 'hard-light', difference: 'difference',
};
export const blendOp = (b: LayerBlend) => LAYER_OP[b];

/** Traza el contorno de una forma en coordenadas de documento. */
export function traceShape(ctx: CanvasRenderingContext2D, s: ShapeSpec) {
  ctx.beginPath();
  const x = Math.min(s.x0, s.x1), y = Math.min(s.y0, s.y1), w = Math.abs(s.x1 - s.x0), h = Math.abs(s.y1 - s.y0);
  if (s.type === 'rect') {
    const r = Math.min(s.radius, w / 2, h / 2);
    if (r > 0) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
  } else if (s.type === 'ellipse') ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  else if (s.type === 'line') { ctx.moveTo(s.x0, s.y0); ctx.lineTo(s.x1, s.y1); }
  else {
    const pts = s.type === 'arrow' ? arrowPoints(s) : regularPoints(s);
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
  }
}

export function drawShape(ctx: CanvasRenderingContext2D, s: ShapeSpec, D: Mat) {
  ctx.setTransform(D[0], D[1], D[2], D[3], D[4], D[5]);
  traceShape(ctx, s);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (s.type === 'arrow' || (s.fill && s.type !== 'line')) { ctx.fillStyle = s.fill ?? s.stroke ?? '#000'; ctx.fill(); }
  if (s.stroke && s.type !== 'arrow' && s.width > 0) { ctx.strokeStyle = s.stroke; ctx.lineWidth = s.width; ctx.stroke(); }
}

export function drawGradient(ctx: CanvasRenderingContext2D, g: GradientSpec, D: Mat, docW: number, docH: number) {
  ctx.setTransform(D[0], D[1], D[2], D[3], D[4], D[5]);
  const grad = g.type === 'linear'
    ? ctx.createLinearGradient(g.x0, g.y0, g.x1, g.y1)
    : ctx.createRadialGradient(g.x0, g.y0, 0, g.x0, g.y0, Math.max(1, Math.hypot(g.x1 - g.x0, g.y1 - g.y0)));
  grad.addColorStop(0, hexToRgba(g.c0, g.a0));
  grad.addColorStop(1, hexToRgba(g.c1, g.a1));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, docW, docH);
}

/** Lienzo auxiliar del tamaño del destino. */
class Pool {
  private list: HTMLCanvasElement[] = [];
  get(i: number, w: number, h: number): CanvasRenderingContext2D {
    let c = this.list[i];
    if (!c) { c = document.createElement('canvas'); this.list[i] = c; }
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    return ctx;
  }
}

/**
 * Dibuja los elementos de una capa para una vista. `V` = documento → px CSS.
 * Cada elemento se dibuja con V · (su matriz), así los trazos y formas
 * transformados siguen siendo nítidos.
 */
export class ItemRenderer {
  private pool = new Pool();
  /** false = escalar los mapas de bits sin suavizar (exportación con bordes duros). */
  smoothBitmaps = true;
  private masks = new WeakMap<Selection, { key: string; canvas: HTMLCanvasElement }>();

  constructor(readonly painter: StrokePainter, readonly docW: number, readonly docH: number) {}

  /** Máscara de una selección para la vista y el tamaño dados (en caché por selección). */
  selectionMask(sel: Selection, V: Mat, dpr: number, w: number, h: number): HTMLCanvasElement {
    const key = `${V.join(',')}|${dpr}|${w}x${h}`;
    const hit = this.masks.get(sel);
    if (hit && hit.key === key) return hit.canvas;
    const canvas = hit?.canvas ?? document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    drawSelectionMask(canvas.getContext('2d')!, sel, [dpr * V[0], dpr * V[1], dpr * V[2], dpr * V[3], dpr * V[4], dpr * V[5]]);
    this.masks.set(sel, { key, canvas });
    return canvas;
  }

  deviceRect(b: AABB, V: Mat, dpr: number, w: number, h: number): Rect {
    const r = transformAABB(V, b);
    return clampRect({ x0: r.minX * dpr - 2, y0: r.minY * dpr - 2, x1: r.maxX * dpr + 2, y1: r.maxY * dpr + 2 }, w, h);
  }

  /** Dibuja una lista de elementos en `ctx` (lienzo de dispositivo). `depth` evita compartir lienzos en grupos anidados. */
  renderItems(ctx: CanvasRenderingContext2D, items: readonly Item[], V: Mat, dpr: number, view?: AABB, depth = 0) {
    for (const it of items) {
      if (view && (it.bounds.maxX < view.minX || it.bounds.minX > view.maxX || it.bounds.maxY < view.minY || it.bounds.minY > view.maxY)) continue;
      this.renderItem(ctx, it, V, dpr, depth);
    }
  }

  renderItem(ctx: CanvasRenderingContext2D, it: Item, V: Mat, dpr: number, depth = 0) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    const M = multiply(V, it.m ?? IDENTITY);
    const D: Mat = [dpr * M[0], dpr * M[1], dpr * M[2], dpr * M[3], dpr * M[4], dpr * M[5]];
    const clip = it.clip ? this.selectionMask(it.clip, V, dpr, W, H) : null;
    const scratch = this.pool.get(depth * 3, W, H);

    if (it.kind === 'stroke') {
      if (!this.painter.ready(it.stroke.preset)) return;
      this.painter.paint(ctx, it.stroke, M, dpr, scratch, clip, !!it.lock);
      return;
    }
    const r = this.deviceRect(it.bounds, V, dpr, W, H);
    if (rectEmpty(r) && it.kind !== 'clear') return;

    if (it.kind === 'clear') {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'destination-out';
      if (clip) ctx.drawImage(clip, 0, 0);
      else { ctx.setTransform(D[0], D[1], D[2], D[3], D[4], D[5]); ctx.fillRect(0, 0, this.docW, this.docH); }
      ctx.restore();
      return;
    }

    // Contenido aislado → recorte → composición.
    const iso = this.pool.get(depth * 3 + 1, W, H);
    iso.clearRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
    let alpha = 1;
    let op: GlobalCompositeOperation = 'source-over';
    if (it.kind === 'shape') {
      drawShape(iso, it.shape, D);
      alpha = it.shape.opacity;
    } else if (it.kind === 'gradient') {
      drawGradient(iso, it.grad, D, this.docW, this.docH);
      alpha = it.grad.opacity;
    } else if (it.kind === 'bitmap') {
      iso.imageSmoothingEnabled = this.smoothBitmaps;
      iso.imageSmoothingQuality = 'high';
      iso.setTransform(D[0], D[1], D[2], D[3], D[4], D[5]);
      // Alejado: se usa una versión reducida ya preparada (no se reduce la imagen entera cada vez).
      const src = this.smoothBitmaps ? reducedFor(it.image, Math.hypot(D[0], D[1]) * it.w / Math.max(1, sizeOf(it.image).w)) : it.image;
      iso.drawImage(src, it.x, it.y, it.w, it.h);
    } else if (it.kind === 'group') {
      this.renderItems(iso, it.items, M, dpr, undefined, depth + 1);
      alpha = it.opacity;
      op = blendOp(it.blend);
    }
    iso.setTransform(1, 0, 0, 1, 0, 0);
    // Alfa bloqueado: sólo sobre lo que ya hay en la capa (exacto con fusión normal).
    if (it.lock) {
      if (op === 'source-over') op = 'source-atop';
      else {
        iso.globalCompositeOperation = 'destination-in';
        iso.drawImage(ctx.canvas, r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0, r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
        iso.globalCompositeOperation = 'source-over';
      }
    }
    if (clip) {
      iso.globalCompositeOperation = 'destination-in';
      iso.drawImage(clip, r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0, r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
      iso.globalCompositeOperation = 'source-over';
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = op;
    ctx.drawImage(iso.canvas, r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0, r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
    ctx.restore();
  }
}

// ---------------------------------------------------------------- pirámide de mapas de bits

const sizeOf = (im: CanvasImageSource) => {
  const o = im as { width: number; height: number; naturalWidth?: number; naturalHeight?: number; videoWidth?: number; videoHeight?: number };
  return { w: o.naturalWidth || o.videoWidth || o.width || 1, h: o.naturalHeight || o.videoHeight || o.height || 1 };
};
const pyramids = new WeakMap<object, HTMLCanvasElement[]>();

/**
 * Versión reducida de una imagen grande para dibujarla a escala `s` (px de destino por
 * px de imagen): cada nivel mide la mitad que el anterior y se calcula una sola vez
 * (reducción de calidad alta paso a paso). Con s ≥ 0,5 se usa la original.
 */
export function reducedFor(image: CanvasImageSource, s: number): CanvasImageSource {
  if (!(s < 0.5)) return image;
  const { w, h } = sizeOf(image);
  if (w * h < 512 * 512) return image;
  const level = Math.min(8, Math.floor(Math.log2(1 / s)));
  let levels = pyramids.get(image as object);
  if (!levels) { levels = []; pyramids.set(image as object, levels); }
  let prev: CanvasImageSource = levels.length ? levels[levels.length - 1] : image;
  while (levels.length < level) {
    const pw = Math.max(1, Math.ceil(sizeOf(prev).w / 2)), ph = Math.max(1, Math.ceil(sizeOf(prev).h / 2));
    if (pw < 16 || ph < 16) break;
    const c = document.createElement('canvas');
    c.width = pw; c.height = ph;
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(prev, 0, 0, pw, ph);
    levels.push(c);
    prev = c;
  }
  return levels[Math.min(level, levels.length) - 1] ?? image;
}

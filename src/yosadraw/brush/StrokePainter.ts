import type { StrokePoint } from '../../core/types';
import { StrokeRenderer } from '../../render/StrokeRenderer';
import { projectPoints } from '../engine/StrokeRasterizer';
import type { ViewTransform } from '../engine/ViewTransform';
import type { BrushPreset } from './BrushPreset';
import { DAB_STRIDE } from './DabGenerator';
import { evalDynamics, type DynamicsOutput } from './dynamics';
import { GRAIN_TILE, GrainCache } from './GrainCache';
import { curveLUT } from './PressureCurve';
import { TipCache, tipBucket, vectorTipPath } from './TipCache';

export type StrokeTool = 'brush' | 'eraser';

/** Todo lo necesario para dibujar un trazo terminado (en coordenadas de documento). */
export interface PaintStroke {
  preset: BrushPreset;
  color: string;
  tool: StrokeTool;
  dabs: Float32Array;
  dabCount: number;
  points: readonly StrokePoint[];
  total: number;
}

/** Rectángulo en píxeles de dispositivo. */
export interface Rect { x0: number; y0: number; x1: number; y1: number }
export const emptyRect = (): Rect => ({ x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
export const rectEmpty = (r: Rect) => r.x1 <= r.x0 || r.y1 <= r.y0;
export function unionRect(a: Rect, b: Rect): Rect {
  a.x0 = Math.min(a.x0, b.x0); a.y0 = Math.min(a.y0, b.y0); a.x1 = Math.max(a.x1, b.x1); a.y1 = Math.max(a.y1, b.y1);
  return a;
}
function clampRect(r: Rect, w: number, h: number): Rect {
  return { x0: Math.max(0, Math.floor(r.x0)), y0: Math.max(0, Math.floor(r.y0)), x1: Math.min(w, Math.ceil(r.x1)), y1: Math.min(h, Math.ceil(r.y1)) };
}

const BLEND: Record<BrushPreset['render']['blend'], GlobalCompositeOperation> = {
  normal: 'source-over', multiply: 'multiply', screen: 'screen', overlay: 'overlay',
  darken: 'darken', lighten: 'lighten', 'color-burn': 'color-burn', 'soft-light': 'soft-light',
};

/**
 * Dibuja trazos de pincel en espacio de dispositivo para una vista dada.
 *
 * Opacidad y acumulación:
 *  - "glaze" (veladura): cada sello aporta su flujo y el trazo completo se
 *    limita a la opacidad → un trazo no se oscurece al pasar sobre sí mismo.
 *  - "buildup" (acumulación): cada sello lleva flujo × opacidad y se suma.
 * Cuando hace falta (veladura < 100%, fusión, borrador, grano fijo) el trazo
 * se dibuja primero en un búfer y luego se compone en el destino.
 */
export class StrokePainter {
  private grainCtx: CanvasRenderingContext2D | null = null;
  private dyn: DynamicsOutput = { size: 1, flow: 1, tilt: 0, azimuth: 0, taper: 1 };

  constructor(readonly tips: TipCache, readonly grains: GrainCache) {}

  ready(p: BrushPreset): boolean { return this.tips.ready(p.tip) && this.grains.ready(p.grain); }

  /** Alfa con que se dibuja el contenido (sellos o línea) dentro del trazo. */
  contentAlpha(p: BrushPreset): number {
    if (p.render.mode === 'smooth') return 1;
    return p.render.accumulation === 'buildup' ? p.opacity.opacity : 1;
  }
  /** Alfa con que se compone el trazo completo. */
  compositeAlpha(p: BrushPreset): number {
    if (p.render.mode === 'smooth') return p.opacity.flow * p.opacity.opacity;
    return p.render.accumulation === 'glaze' ? p.opacity.opacity : 1;
  }
  usesBuffer(p: BrushPreset, tool: StrokeTool): boolean {
    return tool === 'eraser' || p.render.blend !== 'normal' || (p.grain.enabled && p.grain.mode === 'fixed') || this.compositeAlpha(p) < 1;
  }

  /** Rectángulo de dispositivo que cubre un rango de sellos. */
  dabsRect(dabs: Float32Array, from: number, to: number, view: ViewTransform, dpr: number, out: Rect): Rect {
    const m = view.matrix(), sc = view.scale * dpr;
    for (let i = from; i < to; i++) {
      const o = i * DAB_STRIDE, x = dabs[o], y = dabs[o + 1];
      const X = dpr * (m[0] * x + m[2] * y + m[4]), Y = dpr * (m[1] * x + m[3] * y + m[5]);
      const R = dabs[o + 2] * sc * 0.75 + 2;
      if (X - R < out.x0) out.x0 = X - R; if (Y - R < out.y0) out.y0 = Y - R;
      if (X + R > out.x1) out.x1 = X + R; if (Y + R > out.y1) out.y1 = Y + R;
    }
    return out;
  }

  pointsRect(points: readonly StrokePoint[], size: number, view: ViewTransform, dpr: number, out: Rect): Rect {
    const m = view.matrix(), R = size * view.scale * dpr + 3;
    for (const p of points) {
      const X = dpr * (m[0] * p.x + m[2] * p.y + m[4]), Y = dpr * (m[1] * p.x + m[3] * p.y + m[5]);
      if (X - R < out.x0) out.x0 = X - R; if (Y - R < out.y0) out.y0 = Y - R;
      if (X + R > out.x1) out.x1 = X + R; if (Y + R > out.y1) out.y1 = Y + R;
    }
    return out;
  }

  strokeRect(s: PaintStroke, view: ViewTransform, dpr: number, w: number, h: number): Rect {
    const r = s.preset.render.mode === 'smooth'
      ? this.pointsRect(s.points, s.preset.size.size * 2, view, dpr, emptyRect())
      : this.dabsRect(s.dabs, 0, s.dabCount, view, dpr, emptyRect());
    return clampRect(r, w, h);
  }

  /** Dibuja sellos [from, to) en `ctx` (espacio de dispositivo). */
  drawDabs(ctx: CanvasRenderingContext2D, p: BrushPreset, color: string, dabs: Float32Array, from: number, to: number,
    view: ViewTransform, dpr: number, alphaMul: number) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    const m = view.matrix(), sc = view.scale * dpr, rot = view.rotation;
    const fx = p.tip.flipX ? -1 : 1, fy = p.tip.flipY ? -1 : 1;
    const moving = p.grain.enabled && p.grain.mode === 'moving';
    const vectorable = p.tip.hardness >= 0.9 && ['round', 'square', 'diamond', 'triangle'].includes(p.tip.shape);
    let lastBucket = -1, tip: HTMLCanvasElement | null = null;
    ctx.save();
    ctx.fillStyle = color;
    for (let i = from; i < to; i++) {
      const o = i * DAB_STRIDE;
      const x = dabs[o], y = dabs[o + 1];
      const X = dpr * (m[0] * x + m[2] * y + m[4]), Y = dpr * (m[1] * x + m[3] * y + m[5]);
      let D = dabs[o + 2] * sc;
      const R = D * 0.75 + 2;
      if (X + R < 0 || Y + R < 0 || X - R > W || Y - R > H) continue;
      let alpha = dabs[o + 3] * alphaMul;
      if (D < 1) { alpha *= D; D = 1; }
      if (alpha < 0.002) continue;
      const ang = dabs[o + 4] + rot, c = Math.cos(ang), s = Math.sin(ang);
      const sx = D * fx, sy = D * dabs[o + 5] * fy;

      if (moving) { this.grainDab(ctx, p, color, X, Y, D, ang, c, s, sx, sy, alpha); continue; }
      if (D > 1024 && vectorable) {
        ctx.globalAlpha = alpha;
        ctx.setTransform(c * sx, s * sx, -s * sy, c * sy, X, Y);
        vectorTipPath(ctx, p.tip.shape);
        ctx.fill();
        continue;
      }
      const b = tipBucket(D);
      if (b !== lastBucket) { tip = this.tips.coloredTip(p.tip, D, color); lastBucket = b; }
      if (!tip) continue;
      ctx.globalAlpha = alpha;
      ctx.setTransform(c * sx, s * sx, -s * sy, c * sy, X, Y);
      ctx.drawImage(tip, -0.5, -0.5, 1, 1);
    }
    ctx.restore();
  }

  /** Grano "móvil": la textura viaja con cada sello. */
  private grainDab(ctx: CanvasRenderingContext2D, p: BrushPreset, color: string, X: number, Y: number, D: number,
    ang: number, c: number, s: number, sx: number, sy: number, alpha: number) {
    const tip = this.tips.coloredTip(p.tip, D, color);
    if (!tip) return;
    const S = Math.ceil(D * 1.45) + 2;
    let g = this.grainCtx;
    if (!g || g.canvas.width < S) {
      const cv = document.createElement('canvas');
      cv.width = cv.height = Math.max(S, g?.canvas.width ?? 64);
      g = this.grainCtx = cv.getContext('2d')!;
    }
    const pat = this.grains.pattern(g, p.grain);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.clearRect(0, 0, S, S);
    g.setTransform(c * sx, s * sx, -s * sy, c * sy, S / 2, S / 2);
    g.drawImage(tip, -0.5, -0.5, 1, 1);
    if (pat) {
      const k = (D / GRAIN_TILE) * p.grain.scale * 1.5;
      pat.setTransform(new DOMMatrix().translate(S / 2, S / 2).rotate((ang * 180) / Math.PI).scale(k));
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = 'destination-in';
      g.fillStyle = pat;
      g.fillRect(0, 0, S, S);
      g.globalCompositeOperation = 'source-over';
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = alpha;
    ctx.drawImage(g.canvas, 0, 0, S, S, X - S / 2, Y - S / 2, S, S);
  }

  /** Modo "línea lisa": reutiliza el StrokeRenderer original con anchura dinámica. */
  /**
   * Puntos en pantalla con el factor de tamaño dinámico en `pressure`.
   * `decimate` = false conserva un punto por entrada (necesario en vivo, donde
   * los índices deben ser estables al añadir puntos).
   */
  smoothPoints(p: BrushPreset, points: readonly StrokePoint[], total: number, view: ViewTransform, decimate = true): StrokePoint[] {
    const lut = curveLUT(p.pressure.curve);
    let s = 0, speed = 0;
    const doc: StrokePoint[] = [];
    for (let i = 0; i < points.length; i++) {
      const q = points[i];
      if (i > 0) {
        const a = points[i - 1], d = Math.hypot(q.x - a.x, q.y - a.y);
        s += d;
        const v = d / Math.max(1, q.t - a.t);
        speed = i === 1 ? v : speed + 0.3 * (v - speed);
      }
      const dy = evalDynamics(p, lut, { pressure: q.pressure, tiltX: q.tiltX, tiltY: q.tiltY, speed, s, total }, this.dyn);
      doc.push({ ...q, pressure: Math.min(1, dy.size) });
    }
    if (decimate) return projectPoints(doc, view);
    const m = view.matrix();
    return doc.map(q => ({ ...q, x: m[0] * q.x + m[2] * q.y + m[4], y: m[1] * q.x + m[3] * q.y + m[5] }));
  }

  smoothBrush(p: BrushPreset, color: string, view: ViewTransform) {
    return { size: p.size.size * view.scale, color, usePressure: true, minRatio: 0, gamma: 1 };
  }

  drawSmooth(ctx: CanvasRenderingContext2D, s: PaintStroke, view: ViewTransform, dpr: number) {
    const pts = this.smoothPoints(s.preset, s.points, s.total, view);
    if (!pts.length) return;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const r = new StrokeRenderer(ctx, ctx, this.smoothBrush(s.preset, s.tool === 'eraser' ? '#000' : s.color, view));
    r.begin(pts);
    r.end([]);
    ctx.restore();
  }

  applyFixedGrain(ctx: CanvasRenderingContext2D, p: BrushPreset, view: ViewTransform, dpr: number, r: Rect) {
    const pat = this.grains.pattern(ctx, p.grain);
    if (!pat || rectEmpty(r)) return;
    const m = view.matrix(), k = p.grain.scale;
    pat.setTransform(new DOMMatrix([dpr * m[0] * k, dpr * m[1] * k, dpr * m[2] * k, dpr * m[3] * k, dpr * m[4], dpr * m[5]]));
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = pat;
    ctx.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
    ctx.restore();
  }

  /** Compone el contenido de `src` (rectángulo r) sobre el destino. */
  composite(target: CanvasRenderingContext2D, src: HTMLCanvasElement, r: Rect, p: BrushPreset, tool: StrokeTool) {
    if (rectEmpty(r)) return;
    target.save();
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.globalAlpha = this.compositeAlpha(p);
    target.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : BLEND[p.render.blend];
    const w = r.x1 - r.x0, h = r.y1 - r.y0;
    target.drawImage(src, r.x0, r.y0, w, h, r.x0, r.y0, w, h);
    target.restore();
  }

  drawContent(ctx: CanvasRenderingContext2D, s: PaintStroke, view: ViewTransform, dpr: number, alphaMul: number) {
    if (s.preset.render.mode === 'smooth') this.drawSmooth(ctx, s, view, dpr);
    else this.drawDabs(ctx, s.preset, s.tool === 'eraser' ? '#000' : s.color, s.dabs, 0, s.dabCount, view, dpr, alphaMul);
  }

  /** Dibuja un trazo terminado. `scratch` debe tener al menos el tamaño del destino. */
  paint(target: CanvasRenderingContext2D, s: PaintStroke, view: ViewTransform, dpr: number, scratch: CanvasRenderingContext2D): Rect {
    const W = target.canvas.width, H = target.canvas.height;
    const r = this.strokeRect(s, view, dpr, W, H);
    if (rectEmpty(r)) return r;
    const p = s.preset;
    if (!this.usesBuffer(p, s.tool)) { this.drawContent(target, s, view, dpr, this.contentAlpha(p)); return r; }
    scratch.save();
    scratch.setTransform(1, 0, 0, 1, 0, 0);
    scratch.globalCompositeOperation = 'source-over';
    scratch.globalAlpha = 1;
    scratch.clearRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
    scratch.restore();
    this.drawContent(scratch, s, view, dpr, this.contentAlpha(p));
    if (p.grain.enabled && p.grain.mode === 'fixed') this.applyFixedGrain(scratch, p, view, dpr, r);
    this.composite(target, scratch.canvas, r, p, s.tool);
    return r;
  }
}

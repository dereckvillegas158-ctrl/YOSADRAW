import type { StrokePoint } from '../../core/types';
import { StrokeRenderer } from '../../render/StrokeRenderer';
import { applyMat, matScale, type Mat } from '../engine/ViewTransform';
import type { BrushPreset } from './BrushPreset';
import { DAB_STRIDE } from './DabGenerator';
import { evalDynamics, type DynamicsOutput } from './dynamics';
import { GRAIN_TILE, GrainCache } from './GrainCache';
import { curveLUT } from './PressureCurve';
import { TipCache, tipBucket, vectorTipPath } from './TipCache';

export type StrokeTool = 'brush' | 'eraser';

/** Un juego de sellos (el trazo principal o una copia de simetría). */
export interface DabSet {
  dabs: Float32Array;
  count: number;
  /** RGBA por sello cuando el pincel mezcla color (óleo, difuminador). */
  colors?: Uint8ClampedArray;
}

/** Todo lo necesario para dibujar un trazo terminado (en coordenadas de documento). */
export interface PaintStroke {
  preset: BrushPreset;
  color: string;
  tool: StrokeTool;
  sets: DabSet[];
  points: readonly StrokePoint[];
  /** Matrices de simetría (copias del trazo); sólo se usan en el modo línea lisa. */
  mirrors?: Mat[];
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
export function clampRect(r: Rect, w: number, h: number): Rect {
  return { x0: Math.max(0, Math.floor(r.x0)), y0: Math.max(0, Math.floor(r.y0)), x1: Math.min(w, Math.ceil(r.x1)), y1: Math.min(h, Math.ceil(r.y1)) };
}

export const BLEND: Record<BrushPreset['render']['blend'], GlobalCompositeOperation> = {
  normal: 'source-over', multiply: 'multiply', screen: 'screen', overlay: 'overlay',
  darken: 'darken', lighten: 'lighten', 'color-burn': 'color-burn', 'soft-light': 'soft-light',
};

/**
 * Dibuja trazos de pincel en espacio de dispositivo con una matriz afín
 * cualquiera (documento → píxeles CSS). Así un elemento transformado
 * (escalado no uniforme, volteado, girado) sigue rasterizándose nítido.
 *
 * Opacidad y acumulación:
 *  - "glaze" (veladura): cada sello aporta su flujo y el trazo completo se
 *    limita a la opacidad.
 *  - "buildup" (acumulación): cada sello lleva flujo × opacidad y se suma.
 */
export class StrokePainter {
  private grainCtx: CanvasRenderingContext2D | null = null;
  private dyn: DynamicsOutput = { size: 1, flow: 1, tilt: 0, azimuth: 0, taper: 1 };

  constructor(readonly tips: TipCache, readonly grains: GrainCache) {}

  ready(p: BrushPreset): boolean { return this.tips.ready(p.tip) && this.grains.ready(p.grain); }

  contentAlpha(p: BrushPreset): number {
    if (p.render.mode === 'smooth') return 1;
    return p.render.accumulation === 'buildup' ? p.opacity.opacity : 1;
  }
  compositeAlpha(p: BrushPreset): number {
    if (p.render.mode === 'smooth') return p.opacity.flow * p.opacity.opacity;
    return p.render.accumulation === 'glaze' ? p.opacity.opacity : 1;
  }
  usesBuffer(p: BrushPreset, tool: StrokeTool): boolean {
    return tool === 'eraser' || p.render.blend !== 'normal' || (p.grain.enabled && p.grain.mode === 'fixed') || this.compositeAlpha(p) < 1;
  }

  /** Rectángulo de dispositivo que cubre un rango de sellos. */
  dabsRect(dabs: Float32Array, from: number, to: number, M: Mat, dpr: number, out: Rect): Rect {
    const smax = matScale(M).max * dpr;
    for (let i = from; i < to; i++) {
      const o = i * DAB_STRIDE, x = dabs[o], y = dabs[o + 1];
      const X = dpr * (M[0] * x + M[2] * y + M[4]), Y = dpr * (M[1] * x + M[3] * y + M[5]);
      const R = dabs[o + 2] * smax * 0.75 + 2;
      if (X - R < out.x0) out.x0 = X - R; if (Y - R < out.y0) out.y0 = Y - R;
      if (X + R > out.x1) out.x1 = X + R; if (Y + R > out.y1) out.y1 = Y + R;
    }
    return out;
  }

  pointsRect(points: readonly StrokePoint[], size: number, M: Mat, dpr: number, out: Rect): Rect {
    const R = size * matScale(M).max * dpr + 3;
    for (const p of points) {
      const X = dpr * (M[0] * p.x + M[2] * p.y + M[4]), Y = dpr * (M[1] * p.x + M[3] * p.y + M[5]);
      if (X - R < out.x0) out.x0 = X - R; if (Y - R < out.y0) out.y0 = Y - R;
      if (X + R > out.x1) out.x1 = X + R; if (Y + R > out.y1) out.y1 = Y + R;
    }
    return out;
  }

  strokeRect(s: PaintStroke, M: Mat, dpr: number, w: number, h: number): Rect {
    const r = emptyRect();
    if (s.preset.render.mode === 'smooth') {
      this.pointsRect(s.points, s.preset.size.size * 2, M, dpr, r);
      for (const mm of s.mirrors ?? []) this.pointsRect(s.points.map(p => ({ ...p, ...applyMat(mm, p.x, p.y) })), s.preset.size.size * 2, M, dpr, r);
    } else for (const set of s.sets) this.dabsRect(set.dabs, 0, set.count, M, dpr, r);
    return clampRect(r, w, h);
  }

  /** Dibuja sellos [from, to) en `ctx` (espacio de dispositivo). */
  drawDabs(ctx: CanvasRenderingContext2D, p: BrushPreset, color: string, set: DabSet | Float32Array, from: number, to: number,
    M: Mat, dpr: number, alphaMul: number, ignoreColors = false) {
    const dabs = set instanceof Float32Array ? set : set.dabs;
    const colors = set instanceof Float32Array || ignoreColors ? undefined : set.colors;
    const W = ctx.canvas.width, H = ctx.canvas.height;
    const L0 = dpr * M[0], L1 = dpr * M[1], L2 = dpr * M[2], L3 = dpr * M[3];
    const smax = matScale(M).max * dpr;
    const fx = p.tip.flipX ? -1 : 1, fy = p.tip.flipY ? -1 : 1;
    const moving = p.grain.enabled && p.grain.mode === 'moving';
    const vectorable = p.tip.hardness >= 0.9 && ['round', 'square', 'diamond', 'triangle'].includes(p.tip.shape);
    let lastBucket = -1, tip: HTMLCanvasElement | null = null;
    let maskBucket = -1, mask: HTMLCanvasElement | null = null;
    // Nivel de detalle: los sellos casi superpuestos (sub-píxel al alejar) se
    // funden en uno con la opacidad acumulada exacta 1 − Π(1 − aᵢ).
    let lx = -1e9, ly = -1e9, pending = 1;
    ctx.save();
    ctx.fillStyle = color;
    for (let i = from; i < to; i++) {
      const o = i * DAB_STRIDE;
      const x = dabs[o], y = dabs[o + 1];
      const X = dpr * (M[0] * x + M[2] * y + M[4]), Y = dpr * (M[1] * x + M[3] * y + M[5]);
      let d = dabs[o + 2];
      let D = d * smax;
      const R = D * 0.75 + 2;
      if (X + R < 0 || Y + R < 0 || X - R > W || Y - R > H) continue;
      let alpha = dabs[o + 3] * alphaMul;
      if (D < 1) { alpha *= D; d /= D; D = 1; }
      if (colors) alpha *= colors[i * 4 + 3] / 255;
      if (alpha < 0.002) continue;
      const near = Math.max(0.5, D * 0.3);
      if ((X - lx) * (X - lx) + (Y - ly) * (Y - ly) < near * near && (!colors || D < 4)) { pending *= 1 - alpha; continue; }
      alpha = 1 - (1 - alpha) * pending;
      pending = 1; lx = X; ly = Y;
      const ang = dabs[o + 4], c = Math.cos(ang), s = Math.sin(ang);
      const sx = d * fx, sy = d * dabs[o + 5] * fy;
      // Matriz del sello en el documento (giro + escala) compuesta con la del destino.
      const ra = c * sx, rb = s * sx, rc = -s * sy, rd = c * sy;
      const a = L0 * ra + L2 * rb, b = L1 * ra + L3 * rb, cc = L0 * rc + L2 * rd, dd = L1 * rc + L3 * rd;

      if (moving) {
        const mb = tipBucket(D);
        if (mb !== maskBucket) { mask = this.tips.mask(p.tip, D); maskBucket = mb; }
        if (!mask) continue;
        this.grainDab(ctx, p, mask, colors ? rgb(colors, i) : color, X, Y, D, a, b, cc, dd, alpha);
        continue;
      }
      if (colors) {
        // Punta teñida en caché por color (32 niveles por canal): una sola operación por sello.
        const ct = this.tips.coloredTip(p.tip, D, quantized(colors, i));
        if (!ct) continue;
        ctx.globalAlpha = alpha;
        ctx.setTransform(a, b, cc, dd, X, Y);
        ctx.drawImage(ct, -0.5, -0.5, 1, 1);
        continue;
      }
      if (D > 1024 && vectorable) {
        ctx.globalAlpha = alpha;
        ctx.setTransform(a, b, cc, dd, X, Y);
        vectorTipPath(ctx, p.tip.shape);
        ctx.fill();
        continue;
      }
      const bk = tipBucket(D);
      if (bk !== lastBucket) { tip = this.tips.coloredTip(p.tip, D, color); lastBucket = bk; }
      if (!tip) continue;
      ctx.globalAlpha = alpha;
      ctx.setTransform(a, b, cc, dd, X, Y);
      ctx.drawImage(tip, -0.5, -0.5, 1, 1);
    }
    ctx.restore();
  }

  private scratchCtx(S: number): CanvasRenderingContext2D {
    let g = this.grainCtx;
    if (!g || g.canvas.width < S) {
      const cv = document.createElement('canvas');
      cv.width = cv.height = Math.max(S, g?.canvas.width ?? 64);
      g = this.grainCtx = cv.getContext('2d')!;
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    return g;
  }

  /** Grano "móvil": la textura viaja con cada sello. */
  private grainDab(ctx: CanvasRenderingContext2D, p: BrushPreset, mask: HTMLCanvasElement, color: string, X: number, Y: number, D: number,
    a: number, b: number, c: number, d: number, alpha: number) {
    const S = Math.ceil(D * 1.45) + 2;
    const g = this.scratchCtx(S);
    g.clearRect(0, 0, S, S);
    g.setTransform(a, b, c, d, S / 2, S / 2);
    g.drawImage(mask, -0.5, -0.5, 1, 1);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = color;
    g.fillRect(0, 0, S, S);
    const pat = this.grains.pattern(g, p.grain);
    if (pat) {
      const k = (D / GRAIN_TILE) * p.grain.scale * 1.5;
      pat.setTransform(new DOMMatrix().translate(S / 2, S / 2).rotate((Math.atan2(b, a) * 180) / Math.PI).scale(k));
      g.globalCompositeOperation = 'destination-in';
      g.fillStyle = pat;
      g.fillRect(0, 0, S, S);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = alpha;
    ctx.drawImage(g.canvas, 0, 0, S, S, X - S / 2, Y - S / 2, S, S);
  }

  /**
   * Modo "línea lisa": puntos en pantalla con el factor de tamaño dinámico en
   * `pressure`. `decimate` = false conserva un punto por entrada (en vivo).
   */
  smoothPoints(p: BrushPreset, points: readonly StrokePoint[], total: number, M: Mat, decimate = true): StrokePoint[] {
    const lut = curveLUT(p.pressure.curve);
    let s = 0, speed = 0;
    const out: StrokePoint[] = [];
    let lx = NaN, ly = NaN;
    for (let i = 0; i < points.length; i++) {
      const q = points[i];
      if (i > 0) {
        const a = points[i - 1], d = Math.hypot(q.x - a.x, q.y - a.y);
        s += d;
        const v = d / Math.max(1, q.t - a.t);
        speed = i === 1 ? v : speed + 0.3 * (v - speed);
      }
      const dy = evalDynamics(p, lut, { pressure: q.pressure, tiltX: q.tiltX, tiltY: q.tiltY, speed, s, total }, this.dyn);
      const x = M[0] * q.x + M[2] * q.y + M[4], y = M[1] * q.x + M[3] * q.y + M[5];
      if (decimate && i < points.length - 1 && out.length && (x - lx) ** 2 + (y - ly) ** 2 < 0.36) continue;
      out.push({ ...q, x, y, pressure: Math.min(1, dy.size) });
      lx = x; ly = y;
    }
    return out;
  }

  smoothBrush(p: BrushPreset, color: string, M: Mat) {
    return { size: p.size.size * matScale(M).mean, color, usePressure: true, minRatio: 0, gamma: 1 };
  }

  drawSmooth(ctx: CanvasRenderingContext2D, s: PaintStroke, M: Mat, dpr: number) {
    const color = s.tool === 'eraser' ? '#000' : s.color;
    const all = [s.points, ...(s.mirrors ?? []).map(mm => s.points.map(p => ({ ...p, ...applyMat(mm, p.x, p.y) })))];
    ctx.save();
    for (const pts0 of all) {
      const pts = this.smoothPoints(s.preset, pts0, s.total, M);
      if (!pts.length) continue;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const r = new StrokeRenderer(ctx, ctx, this.smoothBrush(s.preset, color, M));
      r.begin(pts);
      r.end([]);
    }
    ctx.restore();
  }

  applyFixedGrain(ctx: CanvasRenderingContext2D, p: BrushPreset, M: Mat, dpr: number, r: Rect) {
    const pat = this.grains.pattern(ctx, p.grain);
    if (!pat || rectEmpty(r)) return;
    const k = p.grain.scale;
    pat.setTransform(new DOMMatrix([dpr * M[0] * k, dpr * M[1] * k, dpr * M[2] * k, dpr * M[3] * k, dpr * M[4], dpr * M[5]]));
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = pat;
    ctx.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
    ctx.restore();
  }

  /** Recorta el contenido de `ctx` (rectángulo r) con una máscara del mismo tamaño que el lienzo. */
  applyClip(ctx: CanvasRenderingContext2D, clip: HTMLCanvasElement, r: Rect) {
    if (rectEmpty(r)) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'destination-in';
    const w = r.x1 - r.x0, h = r.y1 - r.y0;
    ctx.drawImage(clip, r.x0, r.y0, w, h, r.x0, r.y0, w, h);
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

  drawContent(ctx: CanvasRenderingContext2D, s: PaintStroke, M: Mat, dpr: number, alphaMul: number) {
    if (s.preset.render.mode === 'smooth') { this.drawSmooth(ctx, s, M, dpr); return; }
    const color = s.tool === 'eraser' ? '#000' : s.color;
    for (const set of s.sets) this.drawDabs(ctx, s.preset, color, set, 0, set.count, M, dpr, alphaMul, s.tool === 'eraser');
  }

  /**
   * Dibuja un trazo terminado. `scratch` debe medir al menos lo que el
   * destino. `clip` (opcional) es una máscara de selección del tamaño del destino.
   */
  paint(target: CanvasRenderingContext2D, s: PaintStroke, M: Mat, dpr: number, scratch: CanvasRenderingContext2D, clip?: HTMLCanvasElement | null): Rect {
    const W = target.canvas.width, H = target.canvas.height;
    const r = this.strokeRect(s, M, dpr, W, H);
    if (rectEmpty(r)) return r;
    const p = s.preset;
    if (!clip && !this.usesBuffer(p, s.tool)) { this.drawContent(target, s, M, dpr, this.contentAlpha(p)); return r; }
    scratch.save();
    scratch.setTransform(1, 0, 0, 1, 0, 0);
    scratch.globalCompositeOperation = 'source-over';
    scratch.globalAlpha = 1;
    scratch.clearRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
    scratch.restore();
    this.drawContent(scratch, s, M, dpr, this.contentAlpha(p));
    if (p.grain.enabled && p.grain.mode === 'fixed') this.applyFixedGrain(scratch, p, M, dpr, r);
    if (clip) this.applyClip(scratch, clip, r);
    this.composite(target, scratch.canvas, r, p, s.tool);
    return r;
  }
}

function rgb(c: Uint8ClampedArray, i: number) { return `rgb(${c[i * 4]},${c[i * 4 + 1]},${c[i * 4 + 2]})`; }
const HEX = Array.from({ length: 32 }, (_, v) => Math.min(255, v * 8 + 4).toString(16).padStart(2, '0'));
function quantized(c: Uint8ClampedArray, i: number) { return `#${HEX[c[i * 4] >> 3]}${HEX[c[i * 4 + 1] >> 3]}${HEX[c[i * 4 + 2] >> 3]}`; }

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

  /** El pincel procesa el borde del trazo (suave o duro). */
  edged(p: BrushPreset) { return p.render.mode !== 'smooth' && (p.render.edge === 'soft' || p.render.edge === 'hard'); }
  /** Varía el color sello a sello (o trazo a trazo). */
  jitters(p: BrushPreset) { return p.render.mode !== 'smooth' && (p.color.hue > 0 || p.color.sat > 0 || p.color.light > 0); }

  ready(p: BrushPreset): boolean { return this.tips.ready(p.tip) && this.grains.ready(p.grain); }

  contentAlpha(p: BrushPreset): number {
    if (p.render.mode === 'smooth') return 1;
    return p.render.accumulation === 'buildup' ? p.opacity.opacity : 1;
  }
  compositeAlpha(p: BrushPreset): number {
    if (p.render.mode === 'smooth') return p.opacity.flow * p.opacity.opacity;
    return p.render.accumulation === 'glaze' ? p.opacity.opacity : 1;
  }
  usesBuffer(p: BrushPreset, tool: StrokeTool, atop = false): boolean {
    return atop || this.edged(p) || tool === 'eraser' || p.render.blend !== 'normal' || (p.grain.enabled && p.grain.mode === 'fixed') || this.compositeAlpha(p) < 1;
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
    // El borde suave se extiende un poco fuera de los sellos.
    if (s.preset.render.edge === 'soft') { r.x0 -= 6; r.y0 -= 6; r.x1 += 6; r.y1 += 6; }
    return clampRect(r, w, h);
  }

  /** Dibuja sellos [from, to) en `ctx` (espacio de dispositivo). */
  drawDabs(ctx: CanvasRenderingContext2D, p: BrushPreset, color: string, set: DabSet | Float32Array, from: number, to: number,
    M: Mat, dpr: number, alphaMul: number, ignoreColors = false) {
    const dabs = set instanceof Float32Array ? set : set.dabs;
    let colors = set instanceof Float32Array || ignoreColors ? undefined : set.colors;
    // Dinámica de color: colores por sello deterministas (dependen de la posición del sello).
    if (!colors && !ignoreColors && this.jitters(p) && to > from) colors = jitterColors(p, color, dabs, from, to);
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

  /**
   * Contorno «duro»: la silueta de los sellos dibujada como forma vectorial (con
   * antialiasing) en `env`. Se usa como máscara: fuera, limpio; dentro, los sellos.
   */
  drawEnvelope(env: CanvasRenderingContext2D, p: BrushPreset, dabs: Float32Array, from: number, to: number, M: Mat, dpr: number, ox = 0, oy = 0) {
    const L0 = dpr * M[0], L1 = dpr * M[1], L2 = dpr * M[2], L3 = dpr * M[3];
    const k = 0.45 + 0.5 * p.render.edgeAmount;
    const shape = ['round', 'square', 'diamond', 'triangle'].includes(p.tip.shape) ? p.tip.shape : 'round';
    const fx = p.tip.flipX ? -1 : 1, fy = p.tip.flipY ? -1 : 1;
    env.save();
    env.fillStyle = '#000';
    env.globalCompositeOperation = 'source-over';
    for (let i = from; i < to; i++) {
      const o = i * DAB_STRIDE;
      const x = dabs[o], y = dabs[o + 1], d = dabs[o + 2] * k;
      if (dabs[o + 3] < 0.01) continue;
      const ang = dabs[o + 4], c = Math.cos(ang), s = Math.sin(ang);
      const sx = d * fx, sy = d * dabs[o + 5] * fy;
      const ra = c * sx, rb = s * sx, rc = -s * sy, rd = c * sy;
      env.setTransform(L0 * ra + L2 * rb, L1 * ra + L3 * rb, L0 * rc + L2 * rd, L1 * rc + L3 * rd, dpr * (M[0] * x + M[2] * y + M[4]) - ox, dpr * (M[1] * x + M[3] * y + M[5]) - oy);
      vectorTipPath(env, shape);
      env.fill();
    }
    env.restore();
  }

  private edgeTmp: CanvasRenderingContext2D | null = null;
  private edgeCtx(w: number, h: number) {
    const t = this.edgeTmp ??= document.createElement('canvas').getContext('2d')!;
    if (t.canvas.width < w || t.canvas.height < h) { t.canvas.width = Math.max(w, t.canvas.width); t.canvas.height = Math.max(h, t.canvas.height); }
    t.setTransform(1, 0, 0, 1, 0, 0); t.globalCompositeOperation = 'source-over'; t.globalAlpha = 1; t.filter = 'none';
    return t;
  }

  /**
   * Procesa el borde del trazo ya dibujado en `ctx` (rectángulo r). Suave: el trazo
   * se superpone a una copia desenfocada de sí mismo (el borde se suaviza hacia
   * fuera, el interior no pierde nitidez). Duro: se recorta con la silueta vectorial
   * (`env` ya dibujada, o se calcula de los sellos).
   */
  applyEdge(ctx: CanvasRenderingContext2D, p: BrushPreset, r: Rect, dpr: number, env?: HTMLCanvasElement | null, sets?: DabSet[], M?: Mat) {
    if (rectEmpty(r) || !this.edged(p)) return;
    const w = r.x1 - r.x0, h = r.y1 - r.y0;
    if (p.render.edge === 'soft') {
      const t = this.edgeCtx(w, h);
      t.clearRect(0, 0, w, h);
      t.filter = `blur(${(0.5 + p.render.edgeAmount * 2.2) * Math.max(1, dpr * 0.75)}px)`;
      t.drawImage(ctx.canvas, r.x0, r.y0, w, h, 0, 0, w, h);
      t.filter = 'none';
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'destination-over';
      ctx.drawImage(t.canvas, 0, 0, w, h, r.x0, r.y0, w, h);
      ctx.restore();
      return;
    }
    let mask = env ?? null, mx = r.x0, my = r.y0;
    if (!mask && sets && M) {
      // Silueta en un lienzo del tamaño del trazo (no del documento).
      const t = this.edgeCtx(w, h);
      t.clearRect(0, 0, w, h);
      for (const s of sets) this.drawEnvelope(t, p, s.dabs, 0, s.count, M, dpr, r.x0, r.y0);
      mask = t.canvas; mx = 0; my = 0;
    }
    if (!mask) return;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(mask, mx, my, w, h, r.x0, r.y0, w, h);
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

  private atopTmp: CanvasRenderingContext2D | null = null;

  /**
   * Compone el contenido de `src` (rectángulo r) sobre el destino.
   * `atop` (alfa bloqueado): el trazo sólo cubre lo que ya hay; con fusión normal es
   * `source-atop` exacto; con otras fusiones se recorta antes por el alfa del destino.
   */
  composite(target: CanvasRenderingContext2D, src: HTMLCanvasElement, r: Rect, p: BrushPreset, tool: StrokeTool, atop = false) {
    if (rectEmpty(r)) return;
    const w = r.x1 - r.x0, h = r.y1 - r.y0;
    let source: CanvasImageSource = src;
    let op: GlobalCompositeOperation = tool === 'eraser' ? 'destination-out' : BLEND[p.render.blend];
    if (atop && tool !== 'eraser') {
      if (op === 'source-over') op = 'source-atop';
      else {
        const t = this.atopTmp ??= document.createElement('canvas').getContext('2d')!;
        if (t.canvas.width < src.width || t.canvas.height < src.height) { t.canvas.width = src.width; t.canvas.height = src.height; }
        t.setTransform(1, 0, 0, 1, 0, 0);
        t.globalCompositeOperation = 'copy';
        t.drawImage(src, r.x0, r.y0, w, h, r.x0, r.y0, w, h);
        t.globalCompositeOperation = 'destination-in';
        t.drawImage(target.canvas, r.x0, r.y0, w, h, r.x0, r.y0, w, h);
        t.globalCompositeOperation = 'source-over';
        source = t.canvas;
      }
    }
    target.save();
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.globalAlpha = this.compositeAlpha(p);
    target.globalCompositeOperation = op;
    target.drawImage(source, r.x0, r.y0, w, h, r.x0, r.y0, w, h);
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
  paint(target: CanvasRenderingContext2D, s: PaintStroke, M: Mat, dpr: number, scratch: CanvasRenderingContext2D, clip?: HTMLCanvasElement | null, atop = false): Rect {
    const W = target.canvas.width, H = target.canvas.height;
    const r = this.strokeRect(s, M, dpr, W, H);
    if (rectEmpty(r)) return r;
    const p = s.preset;
    if (!clip && !this.usesBuffer(p, s.tool, atop)) { this.drawContent(target, s, M, dpr, this.contentAlpha(p)); return r; }
    scratch.save();
    scratch.setTransform(1, 0, 0, 1, 0, 0);
    scratch.globalCompositeOperation = 'source-over';
    scratch.globalAlpha = 1;
    scratch.clearRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
    scratch.restore();
    this.drawContent(scratch, s, M, dpr, this.contentAlpha(p));
    if (this.edged(p)) this.applyEdge(scratch, p, r, dpr, null, s.sets, M);
    if (p.grain.enabled && p.grain.mode === 'fixed') this.applyFixedGrain(scratch, p, M, dpr, r);
    if (clip) this.applyClip(scratch, clip, r);
    this.composite(target, scratch.canvas, r, p, s.tool, atop);
    return r;
  }
}

/** Colores por sello con la dinámica de color del pincel (RGBA; el alfa queda a 255). */
function jitterColors(p: BrushPreset, color: string, dabs: Float32Array, from: number, to: number): Uint8ClampedArray {
  const n = parseInt(color.replace('#', ''), 16) || 0;
  const [h0, s0, l0] = rgbToHsl(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  const out = new Uint8ClampedArray(to * 4);
  const seedOf = (x: number, y: number) => { let k = Math.imul(Math.round(x * 8) | 0, 73856093) ^ Math.imul(Math.round(y * 8) | 0, 19349663); k = Math.imul(k ^ (k >>> 15), 2246822507); k = Math.imul(k ^ (k >>> 13), 3266489909); return (k ^ (k >>> 16)) >>> 0; };
  const rnd = (seed: number, j: number) => { let k = Math.imul(seed + j * 0x9e3779b9, 1597334677); k ^= k >>> 15; k = Math.imul(k, 2246822519); k ^= k >>> 13; return ((k >>> 0) % 100000) / 100000; };
  const strokeSeed = seedOf(dabs[0], dabs[1]);
  for (let i = from; i < to; i++) {
    const o = i * DAB_STRIDE;
    const sd = p.color.perStroke ? strokeSeed : seedOf(dabs[o], dabs[o + 1]);
    const hh = h0 + (rnd(sd, 1) - 0.5) * p.color.hue;
    const ss = Math.max(0, Math.min(1, s0 + (rnd(sd, 2) - 0.5) * 2 * p.color.sat));
    const ll = Math.max(0, Math.min(1, l0 + (rnd(sd, 3) - 0.5) * 2 * p.color.light * 0.5));
    const [r, g, b] = hslToRgb(((hh % 1) + 1) % 1, ss, ll);
    out[i * 4] = r * 255; out[i * 4 + 1] = g * 255; out[i * 4 + 2] = b * 255; out[i * 4 + 3] = 255;
  }
  return out;
}
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (!s) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t: number) => { t = ((t % 1) + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}

function rgb(c: Uint8ClampedArray, i: number) { return `rgb(${c[i * 4]},${c[i * 4 + 1]},${c[i * 4 + 2]})`; }
const HEX = Array.from({ length: 32 }, (_, v) => Math.min(255, v * 8 + 4).toString(16).padStart(2, '0'));
function quantized(c: Uint8ClampedArray, i: number) { return `#${HEX[c[i * 4] >> 3]}${HEX[c[i * 4 + 1] >> 3]}${HEX[c[i * 4 + 2] >> 3]}`; }

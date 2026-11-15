import type { BrushPreset } from '../brush/BrushPreset';
import { buildStroke, sampleStroke } from '../brush/buildStroke';
import { TipCache } from '../brush/TipCache';
import type { StrokePainter } from '../brush/StrokePainter';
import { ViewTransform } from '../engine/ViewTransform';

/** Miniaturas de pinceles dibujadas con el motor real (no imágenes fijas). */
export class Thumbnails {
  private cache = new Map<string, HTMLCanvasElement>();
  private scratch = document.createElement('canvas').getContext('2d')!;

  constructor(private painter: StrokePainter) {}

  invalidate() { this.cache.clear(); }

  stroke(p: BrushPreset, color: string, cssW: number, cssH: number): HTMLCanvasElement {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const key = `${p.id}@${p.revision}#${color}@${cssW}x${cssH}x${dpr}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const c = document.createElement('canvas');
    c.width = Math.round(cssW * dpr); c.height = Math.round(cssH * dpr);
    c.style.width = `${cssW}px`; c.style.height = `${cssH}px`;
    const ctx = c.getContext('2d')!;
    // Escala para que el pincel quepa en la miniatura sin cambiar su carácter.
    const scale = Math.min(1, (cssH * 0.36) / p.size.size);
    const view = new ViewTransform();
    view.scale = scale;
    const pts = sampleStroke(cssW / scale, cssH / scale, Math.max(p.size.size * 0.6, 10 / scale));
    if (this.scratch.canvas.width < c.width || this.scratch.canvas.height < c.height) { this.scratch.canvas.width = c.width; this.scratch.canvas.height = c.height; }
    this.painter.paint(ctx, buildStroke(p, pts, 11, color), view.matrix(), dpr, this.scratch);
    if (this.painter.ready(p)) {
      this.cache.set(key, c);
      if (this.cache.size > 200) this.cache.delete(this.cache.keys().next().value!);
    }
    return c;
  }

  /** Máscara de una forma de punta para el selector del editor. */
  tip(tips: TipCache, tip: BrushPreset['tip'], css: number, color: string): HTMLCanvasElement {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const c = document.createElement('canvas');
    c.width = c.height = Math.round(css * dpr);
    c.style.width = c.style.height = `${css}px`;
    const m = tips.coloredTip(tip, css * dpr * 0.8, color);
    if (m) {
      const g = c.getContext('2d')!;
      const s = css * dpr * 0.8, ang = (tip.angle * Math.PI) / 180;
      g.translate(c.width / 2, c.height / 2);
      g.rotate(ang);
      g.scale(tip.flipX ? -1 : 1, tip.roundness * (tip.flipY ? -1 : 1));
      g.drawImage(m, -s / 2, -s / 2, s, s);
    }
    return c;
  }
}

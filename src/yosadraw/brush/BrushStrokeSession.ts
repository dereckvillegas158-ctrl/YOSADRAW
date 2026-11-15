import type { StrokePoint } from '../../core/types';
import { StrokeRenderer } from '../../render/StrokeRenderer';
import type { AABB } from '../engine/ViewTransform';
import type { ViewTransform } from '../engine/ViewTransform';
import type { BrushPreset } from './BrushPreset';
import { DabBuffer, DabGenerator, DAB_STRIDE } from './DabGenerator';
import { emptyRect, rectEmpty, unionRect, type PaintStroke, type Rect, type StrokePainter, type StrokeTool } from './StrokePainter';

/** Lienzos auxiliares del tamaño del destino, reutilizados entre trazos. */
export class SessionBuffers {
  snap = document.createElement('canvas');
  buf = document.createElement('canvas');
  tmp = document.createElement('canvas');
  readonly snapCtx = this.snap.getContext('2d')!;
  readonly bufCtx = this.buf.getContext('2d')!;
  readonly tmpCtx = this.tmp.getContext('2d')!;
  ensure(w: number, h: number) {
    for (const c of [this.snap, this.buf, this.tmp]) if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  }
}

export interface SessionSurface {
  /** Lienzo de tinta (tamaño de dispositivo). Puede tener un recorte activo. */
  target: CanvasRenderingContext2D;
  /** Capa provisional, ya escalada por dpr. */
  overlay: CanvasRenderingContext2D;
  view: ViewTransform;
  dpr: number;
  buffers: SessionBuffers;
  paperColor: string;
}

export interface FinishedStroke extends PaintStroke { seed: number; bounds: AABB }

/**
 * Un trazo en curso. Mantiene una copia de la tinta previa (snapshot) y un
 * búfer con el trazo; en cada fotograma recompone sólo el rectángulo
 * afectado, así la opacidad, la fusión, el grano y el borrador se ven
 * exactamente como quedarán.
 * Al terminar, regenera los sellos conociendo la longitud total (para el
 * afilado final) y pinta con el mismo código que usa el repintado.
 */
export class BrushStrokeSession {
  private gen: DabGenerator;
  private tail = new DabBuffer();
  private drawn = 0;
  private rect: Rect = emptyRect();
  private dirty = false;
  private docPts: StrokePoint[] = [];
  private smooth: StrokeRenderer | null = null;
  private smoothCount = 0;

  constructor(private painter: StrokePainter, private surf: SessionSurface, readonly preset: BrushPreset,
    readonly color: string, readonly tool: StrokeTool, readonly seed: number) {
    this.gen = new DabGenerator(preset, seed);
  }

  begin(p: StrokePoint) {
    const t = this.surf.target, b = this.surf.buffers;
    b.ensure(t.canvas.width, t.canvas.height);
    b.snapCtx.setTransform(1, 0, 0, 1, 0, 0);
    b.snapCtx.globalCompositeOperation = 'copy';
    b.snapCtx.drawImage(t.canvas, 0, 0);
    b.snapCtx.globalCompositeOperation = 'source-over';
    b.bufCtx.setTransform(1, 0, 0, 1, 0, 0);
    b.bufCtx.clearRect(0, 0, b.buf.width, b.buf.height);
    if (this.preset.render.mode === 'smooth') {
      this.smooth = new StrokeRenderer(b.bufCtx, this.surf.overlay, this.painter.smoothBrush(this.preset, this.inkColor(), this.surf.view));
    }
    this.add([p]);
  }

  private inkColor() { return this.tool === 'eraser' ? '#000' : this.color; }

  add(points: StrokePoint[]) {
    const { view, dpr, buffers } = this.surf;
    for (const p of points) { this.docPts.push(p); this.gen.push(p); }
    if (this.smooth) {
      const all = this.painter.smoothPoints(this.preset, this.docPts, Infinity, view, false);
      const fresh = all.slice(this.smoothCount);
      this.smoothCount = all.length;
      buffers.bufCtx.save();
      buffers.bufCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (this.smoothCount === fresh.length) this.smooth.begin(fresh); else this.smooth.add(fresh);
      buffers.bufCtx.restore();
      this.painter.pointsRect(points, this.preset.size.size * 2, view, dpr, this.rect);
    } else {
      const d = this.gen.dabs;
      if (d.count > this.drawn) {
        this.painter.drawDabs(buffers.bufCtx, this.preset, this.inkColor(), d.data, this.drawn, d.count, view, dpr, this.painter.contentAlpha(this.preset));
        this.painter.dabsRect(d.data, this.drawn, d.count, view, dpr, this.rect);
        this.drawn = d.count;
      }
    }
    this.dirty = true;
  }

  /** Recompone la tinta y dibuja el tramo provisional. Llamar una vez por fotograma. */
  frame() {
    if (this.dirty) { this.composite(this.rect, false); this.dirty = false; }
    const { overlay, view, dpr, paperColor } = this.surf;
    if (this.smooth) { this.smooth.drawLive(); return; }
    this.gen.previewTail(this.tail);
    if (this.tail.count) {
      overlay.save();
      const color = this.tool === 'eraser' ? paperColor : this.color;
      this.painter.drawDabs(overlay, this.preset, color, this.tail.data, 0, this.tail.count, view, dpr,
        this.painter.contentAlpha(this.preset) * this.painter.compositeAlpha(this.preset));
      overlay.restore();
    }
  }

  private restore(r: Rect) {
    const t = this.surf.target, snap = this.surf.buffers.snap;
    const w = r.x1 - r.x0, h = r.y1 - r.y0;
    t.save();
    t.setTransform(1, 0, 0, 1, 0, 0);
    t.clearRect(r.x0, r.y0, w, h);
    t.drawImage(snap, r.x0, r.y0, w, h, r.x0, r.y0, w, h);
    t.restore();
  }

  private composite(rIn: Rect, _final: boolean) {
    const t = this.surf.target, b = this.surf.buffers;
    const r = { x0: Math.max(0, Math.floor(rIn.x0)), y0: Math.max(0, Math.floor(rIn.y0)), x1: Math.min(t.canvas.width, Math.ceil(rIn.x1)), y1: Math.min(t.canvas.height, Math.ceil(rIn.y1)) };
    if (rectEmpty(r)) return;
    this.restore(r);
    const p = this.preset;
    if (!this.painter.usesBuffer(p, this.tool)) {
      t.save(); t.setTransform(1, 0, 0, 1, 0, 0);
      t.drawImage(b.buf, r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0, r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
      t.restore();
      return;
    }
    let src = b.buf;
    if (p.grain.enabled && p.grain.mode === 'fixed') {
      b.tmpCtx.setTransform(1, 0, 0, 1, 0, 0);
      b.tmpCtx.globalCompositeOperation = 'copy';
      b.tmpCtx.drawImage(b.buf, r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0, r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
      b.tmpCtx.globalCompositeOperation = 'source-over';
      this.painter.applyFixedGrain(b.tmpCtx, p, this.surf.view, this.surf.dpr, r);
      src = b.tmp;
    }
    this.painter.composite(t, src, r, p, this.tool);
  }

  /** Termina el trazo y lo pinta en su forma final. */
  end(): FinishedStroke {
    this.gen.finish();
    const total = this.gen.length;
    const final = new DabGenerator(this.preset, this.seed, { totalLength: total });
    for (const p of this.docPts) final.push(p);
    final.finish();
    const stroke: FinishedStroke = {
      preset: this.preset, color: this.color, tool: this.tool, seed: this.seed,
      dabs: final.dabs.trimmed(), dabCount: final.dabs.count, points: this.docPts, total,
      bounds: this.bounds(final.dabs),
    };
    const { target, view, dpr, buffers } = this.surf;
    const fr = this.painter.strokeRect(stroke, view, dpr, target.canvas.width, target.canvas.height);
    const r = unionRect({ ...this.rect }, fr);
    const rc = { x0: Math.max(0, Math.floor(r.x0)), y0: Math.max(0, Math.floor(r.y0)), x1: Math.min(target.canvas.width, Math.ceil(r.x1)), y1: Math.min(target.canvas.height, Math.ceil(r.y1)) };
    if (!rectEmpty(rc)) this.restore(rc);
    this.painter.paint(target, stroke, view, dpr, buffers.bufCtx);
    return stroke;
  }

  cancel() {
    const t = this.surf.target;
    this.restore({ x0: 0, y0: 0, x1: t.canvas.width, y1: t.canvas.height });
  }

  private bounds(d: DabBuffer): AABB {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    if (this.preset.render.mode === 'smooth' || !d.count) {
      const r = this.preset.size.size * 2 + 2;
      for (const p of this.docPts) { minX = Math.min(minX, p.x - r); minY = Math.min(minY, p.y - r); maxX = Math.max(maxX, p.x + r); maxY = Math.max(maxY, p.y + r); }
    } else {
      for (let i = 0; i < d.count; i++) {
        const o = i * DAB_STRIDE, r = d.data[o + 2] * 0.75 + 1;
        minX = Math.min(minX, d.data[o] - r); minY = Math.min(minY, d.data[o + 1] - r);
        maxX = Math.max(maxX, d.data[o] + r); maxY = Math.max(maxY, d.data[o + 1] + r);
      }
    }
    return { minX, minY, maxX, maxY };
  }
}

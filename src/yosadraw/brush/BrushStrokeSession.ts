import type { StrokePoint } from '../../core/types';
import { StrokeRenderer } from '../../render/StrokeRenderer';
import { applyMat, matScale, type AABB, type Mat } from '../engine/ViewTransform';
import type { BrushPreset } from './BrushPreset';
import { ColorMixer, imageSampler, type Sampler } from './ColorMixer';
import { DabBuffer, DabGenerator, DAB_STRIDE } from './DabGenerator';
import { emptyRect, rectEmpty, unionRect, type DabSet, type PaintStroke, type Rect, type StrokePainter, type StrokeTool } from './StrokePainter';

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
  /** Lienzo de la capa (tamaño de dispositivo). Puede tener un recorte activo. */
  target: CanvasRenderingContext2D;
  /** Capa provisional, ya escalada por dpr. */
  overlay: CanvasRenderingContext2D;
  /** Documento → píxeles CSS. */
  M: Mat;
  dpr: number;
  buffers: SessionBuffers;
  paperColor: string;
  /** Máscara de selección (tamaño de dispositivo) que recorta el trazo. */
  clip?: HTMLCanvasElement | null;
  /** Copias de simetría (sin la identidad). */
  mirrors?: Mat[];
}

export interface FinishedStroke extends PaintStroke { seed: number; bounds: AABB }

class ColorTrack {
  data = new Uint8ClampedArray(1024);
  ensure(n: number) { if (n * 4 > this.data.length) { const d = new Uint8ClampedArray(Math.max(n * 4, this.data.length * 2)); d.set(this.data); this.data = d; } }
}

/**
 * Un trazo en curso. Mantiene una copia de la capa previa (snapshot) y un
 * búfer con el trazo; en cada fotograma recompone sólo el rectángulo
 * afectado, así opacidad, fusión, grano, recorte y borrador se ven exactamente
 * como quedarán. Con simetría, todas las copias van al mismo búfer (un solo
 * trazo, no se oscurecen al cruzarse).
 * Al terminar, regenera los sellos conociendo la longitud total (afilado
 * final) y pinta con el mismo código que usa el repintado.
 */
export class BrushStrokeSession {
  private gens: DabGenerator[];
  private mixers: ColorMixer[] = [];
  private tracks: ColorTrack[] = [];
  private sampler: Sampler | null = null;
  private tail = new DabBuffer();
  private drawn: number[];
  private rect: Rect = emptyRect();
  private dirty = false;
  private docPts: StrokePoint[] = [];
  private smooth: StrokeRenderer[] = [];
  private smoothCount = 0;
  private mirrors: Mat[];

  constructor(private painter: StrokePainter, private surf: SessionSurface, readonly preset: BrushPreset,
    readonly color: string, readonly tool: StrokeTool, readonly seed: number) {
    this.mirrors = surf.mirrors ?? [];
    this.gens = [null, ...this.mirrors].map((_, i) => new DabGenerator(preset, seed + i * 7919));
    this.drawn = this.gens.map(() => 0);
  }

  private get mixing() { return this.preset.mix.mode !== 'none' && this.preset.render.mode === 'stamp'; }

  begin(p: StrokePoint) {
    const t = this.surf.target, b = this.surf.buffers;
    b.ensure(t.canvas.width, t.canvas.height);
    b.snapCtx.setTransform(1, 0, 0, 1, 0, 0);
    b.snapCtx.globalCompositeOperation = 'copy';
    b.snapCtx.drawImage(t.canvas, 0, 0);
    b.snapCtx.globalCompositeOperation = 'source-over';
    b.bufCtx.setTransform(1, 0, 0, 1, 0, 0);
    b.bufCtx.clearRect(0, 0, b.buf.width, b.buf.height);
    if (this.mixing) {
      // Lo que hay en la capa al empezar: de ahí recoge color el pincel.
      const img = b.snapCtx.getImageData(0, 0, b.snap.width, b.snap.height);
      const { M, dpr } = this.surf;
      this.sampler = imageSampler(img, (x, y) => [dpr * (M[0] * x + M[2] * y + M[4]), dpr * (M[1] * x + M[3] * y + M[5])], matScale(M).mean * dpr);
      this.mixers = this.gens.map(() => new ColorMixer(this.preset.mix, this.color, this.sampler!));
      this.tracks = this.gens.map(() => new ColorTrack());
    }
    if (this.preset.render.mode === 'smooth') {
      this.smooth = this.gens.map(() => new StrokeRenderer(b.bufCtx, this.surf.overlay, this.painter.smoothBrush(this.preset, this.inkColor(), this.surf.M)));
    }
    this.add([p]);
  }

  private inkColor() { return this.tool === 'eraser' ? '#000' : this.color; }
  private mirrorPoint(p: StrokePoint, i: number): StrokePoint { return i === 0 ? p : { ...p, ...applyMat(this.mirrors[i - 1], p.x, p.y) }; }

  /** Calcula el color de los sellos nuevos del generador i (mezcla con la capa). */
  private colorize(i: number, gen: DabGenerator, from: number, mixer: ColorMixer, track: ColorTrack) {
    const d = gen.dabs;
    track.ensure(d.count);
    for (let k = from; k < d.count; k++) {
      const o = k * DAB_STRIDE;
      const c = mixer.next(d.data[o], d.data[o + 1], d.data[o + 2]);
      track.data[k * 4] = c[0]; track.data[k * 4 + 1] = c[1]; track.data[k * 4 + 2] = c[2]; track.data[k * 4 + 3] = Math.round(c[3] * 255);
    }
    void i;
  }

  add(points: StrokePoint[]) {
    const { M, dpr, buffers } = this.surf;
    for (const p of points) {
      this.docPts.push(p);
      this.gens.forEach((g, i) => g.push(this.mirrorPoint(p, i)));
    }
    if (this.smooth.length) {
      buffers.bufCtx.save();
      buffers.bufCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      let fresh = 0;
      this.smooth.forEach((r, i) => {
        const pts = i === 0 ? this.docPts : this.docPts.map(p => this.mirrorPoint(p, i));
        const all = this.painter.smoothPoints(this.preset, pts, Infinity, M, false);
        const add = all.slice(this.smoothCount);
        fresh = all.length;
        if (this.smoothCount === 0) r.begin(add); else r.add(add);
        this.painter.pointsRect(pts.slice(-points.length - 1), this.preset.size.size * 2, M, dpr, this.rect);
      });
      this.smoothCount = fresh;
      buffers.bufCtx.restore();
    } else {
      this.gens.forEach((g, i) => {
        const d = g.dabs, from = this.drawn[i];
        if (d.count <= from) return;
        let set: DabSet | Float32Array = d.data;
        if (this.mixing) { this.colorize(i, g, from, this.mixers[i], this.tracks[i]); set = { dabs: d.data, count: d.count, colors: this.tracks[i].data }; }
        this.painter.drawDabs(buffers.bufCtx, this.preset, this.inkColor(), set, from, d.count, M, dpr, this.painter.contentAlpha(this.preset), this.tool === 'eraser');
        this.painter.dabsRect(d.data, from, d.count, M, dpr, this.rect);
        this.drawn[i] = d.count;
      });
    }
    this.dirty = true;
  }

  /** Recompone la capa y dibuja el tramo provisional. Llamar una vez por fotograma. */
  frame() {
    if (this.dirty) { this.composite(this.rect); this.dirty = false; }
    const { overlay, M, dpr, paperColor } = this.surf;
    if (this.smooth.length) { this.smooth.forEach(r => r.drawLive()); return; }
    if (this.mixing) return; // el color de la punta depende del lienzo: sin vista provisional
    const color = this.tool === 'eraser' ? paperColor : this.color;
    for (const g of this.gens) {
      g.previewTail(this.tail);
      if (!this.tail.count) continue;
      this.painter.drawDabs(overlay, this.preset, color, this.tail.data, 0, this.tail.count, M, dpr,
        this.painter.contentAlpha(this.preset) * this.painter.compositeAlpha(this.preset));
    }
  }

  private clampToTarget(r: Rect): Rect {
    const t = this.surf.target;
    return { x0: Math.max(0, Math.floor(r.x0)), y0: Math.max(0, Math.floor(r.y0)), x1: Math.min(t.canvas.width, Math.ceil(r.x1)), y1: Math.min(t.canvas.height, Math.ceil(r.y1)) };
  }

  private restore(r: Rect) {
    const t = this.surf.target, snap = this.surf.buffers.snap;
    const w = r.x1 - r.x0, h = r.y1 - r.y0;
    t.save();
    t.setTransform(1, 0, 0, 1, 0, 0);
    t.globalCompositeOperation = 'source-over';
    t.globalAlpha = 1;
    t.clearRect(r.x0, r.y0, w, h);
    t.drawImage(snap, r.x0, r.y0, w, h, r.x0, r.y0, w, h);
    t.restore();
  }

  private composite(rIn: Rect) {
    const t = this.surf.target, b = this.surf.buffers;
    const r = this.clampToTarget(rIn);
    if (rectEmpty(r)) return;
    this.restore(r);
    const p = this.preset;
    const w = r.x1 - r.x0, h = r.y1 - r.y0;
    const fixedGrain = p.grain.enabled && p.grain.mode === 'fixed';
    const clip = this.surf.clip;
    if (!clip && !this.painter.usesBuffer(p, this.tool)) {
      t.save(); t.setTransform(1, 0, 0, 1, 0, 0);
      t.drawImage(b.buf, r.x0, r.y0, w, h, r.x0, r.y0, w, h);
      t.restore();
      return;
    }
    let src = b.buf;
    if (fixedGrain || clip) {
      b.tmpCtx.setTransform(1, 0, 0, 1, 0, 0);
      b.tmpCtx.globalCompositeOperation = 'copy';
      b.tmpCtx.drawImage(b.buf, r.x0, r.y0, w, h, r.x0, r.y0, w, h);
      b.tmpCtx.globalCompositeOperation = 'source-over';
      if (fixedGrain) this.painter.applyFixedGrain(b.tmpCtx, p, this.surf.M, this.surf.dpr, r);
      if (clip) this.painter.applyClip(b.tmpCtx, clip, r);
      src = b.tmp;
    }
    this.painter.composite(t, src, r, p, this.tool);
  }

  /** Termina el trazo y lo pinta en su forma final. */
  end(): FinishedStroke {
    const sets: DabSet[] = [];
    let total = 0;
    this.gens.forEach((g, i) => {
      g.finish();
      if (i === 0) total = g.length;
      const final = new DabGenerator(this.preset, this.seed + i * 7919, { totalLength: g.length });
      for (const p of this.docPts) final.push(this.mirrorPoint(p, i));
      final.finish();
      const set: DabSet = { dabs: final.dabs.trimmed(), count: final.dabs.count };
      if (this.mixing && this.sampler) {
        const mixer = new ColorMixer(this.preset.mix, this.color, this.sampler), track = new ColorTrack();
        this.colorize(i, final, 0, mixer, track);
        set.colors = track.data.slice(0, final.dabs.count * 4);
      }
      sets.push(set);
    });
    const stroke: FinishedStroke = {
      preset: this.preset, color: this.color, tool: this.tool, seed: this.seed, sets,
      points: this.docPts, total, mirrors: this.mirrors.length ? this.mirrors : undefined,
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    };
    stroke.bounds = strokeBounds(stroke);
    const { target, M, dpr, buffers } = this.surf;
    const fr = this.painter.strokeRect(stroke, M, dpr, target.canvas.width, target.canvas.height);
    const rc = this.clampToTarget(unionRect({ ...this.rect }, fr));
    if (!rectEmpty(rc)) this.restore(rc);
    this.painter.paint(target, stroke, M, dpr, buffers.bufCtx, this.surf.clip);
    return stroke;
  }

  cancel() {
    const t = this.surf.target;
    this.restore({ x0: 0, y0: 0, x1: t.canvas.width, y1: t.canvas.height });
  }
}

/**
 * Trazo terminado sin pintarlo (mismos sellos que `BrushStrokeSession.end`):
 * para aplicar un trazo cuando su capa aún se está repintando. No vale para
 * pinceles que mezclan color (necesitan leer el lienzo).
 */
export function finishStrokeOffline(preset: BrushPreset, color: string, tool: StrokeTool, seed: number, docPts: StrokePoint[], mirrors: Mat[]): FinishedStroke {
  const sets: DabSet[] = [];
  let total = 0;
  [null, ...mirrors].forEach((m, i) => {
    const pts = m ? docPts.map(p => ({ ...p, ...applyMat(m, p.x, p.y) })) : docPts;
    const a = new DabGenerator(preset, seed + i * 7919);
    for (const p of pts) a.push(p);
    a.finish();
    if (i === 0) total = a.length;
    const b = new DabGenerator(preset, seed + i * 7919, { totalLength: a.length });
    for (const p of pts) b.push(p);
    b.finish();
    sets.push({ dabs: b.dabs.trimmed(), count: b.dabs.count });
  });
  const stroke: FinishedStroke = { preset, color, tool, seed, sets, points: docPts, total, mirrors: mirrors.length ? mirrors : undefined, bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } };
  stroke.bounds = strokeBounds(stroke);
  return stroke;
}

/** Caja envolvente en coordenadas de documento. */
export function strokeBounds(s: PaintStroke): AABB {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (x: number, y: number, r: number) => { minX = Math.min(minX, x - r); minY = Math.min(minY, y - r); maxX = Math.max(maxX, x + r); maxY = Math.max(maxY, y + r); };
  if (s.preset.render.mode === 'smooth' || s.sets.every(st => !st.count)) {
    const r = s.preset.size.size * 2 + 2;
    for (const p of s.points) grow(p.x, p.y, r);
    for (const m of s.mirrors ?? []) for (const p of s.points) { const q = applyMat(m, p.x, p.y); grow(q.x, q.y, r); }
  } else {
    for (const set of s.sets) for (let i = 0; i < set.count; i++) {
      const o = i * DAB_STRIDE;
      grow(set.dabs[o], set.dabs[o + 1], set.dabs[o + 2] * 0.75 + 1);
    }
  }
  return { minX, minY, maxX, maxY };
}

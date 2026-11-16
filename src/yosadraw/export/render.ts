import { ClipComposer } from '../doc/clip';
import { blendOp, ItemRenderer } from '../doc/ItemRenderer';
import { drawSelectionMask, selectionBounds } from '../doc/Selection';
import type { CanvasEngine } from '../engine';
import type { Mat } from '../engine/ViewTransform';
import { transformAABB } from '../engine/ViewTransform';
import type { RasterJob } from './pipeline';
import { MAX_PIXELS, MAX_SIDE, type ExportOptions } from './types';

export interface ExportRegion { x: number; y: number; w: number; h: number }

/** Zona del documento que se exporta (lienzo completo o caja de la selección). */
export function exportRegion(engine: CanvasEngine, o: ExportOptions): ExportRegion {
  const d = engine.doc;
  if (o.scope === 'selection' && d.selection) {
    const b = selectionBounds(d.selection);
    if (b) {
      const x = Math.max(0, Math.floor(b.minX)), y = Math.max(0, Math.floor(b.minY));
      const w = Math.min(d.width, Math.ceil(b.maxX)) - x, h = Math.min(d.height, Math.ceil(b.maxY)) - y;
      if (w > 0 && h > 0) return { x, y, w, h };
    }
  }
  return { x: 0, y: 0, w: d.width, h: d.height };
}

export function outputSize(r: ExportRegion, scale: number) {
  return { width: Math.max(1, Math.round(r.w * scale)), height: Math.max(1, Math.round(r.h * scale)) };
}

/** Comprueba que el tamaño cabe en memoria; devuelve el motivo si no. */
export function sizeProblem(width: number, height: number): string | null {
  if (width > MAX_SIDE || height > MAX_SIDE) return `El lado máximo es ${MAX_SIDE.toLocaleString('es')} px`;
  if (width * height > MAX_PIXELS) return `Máximo ${(MAX_PIXELS / 1e6).toFixed(0)} megapíxeles por imagen`;
  return null;
}

const nextFrame = () => new Promise<void>(r => setTimeout(r, 0));

/**
 * Rasteriza el documento para exportar. Nunca modifica el documento ni la
 * vista: usa un renderizador propio a la escala de salida, así los trazos y
 * formas vectoriales salen nítidos a cualquier resolución.
 */
export async function renderForExport(engine: CanvasEngine, o: ExportOptions, onProgress: (f: number) => void, maxSide?: number,
  tile?: { x: number; y: number; w: number; h: number }): Promise<RasterJob> {
  const doc = engine.doc;
  const full = exportRegion(engine, o);
  let s = o.scale;
  if (maxSide) s = Math.min(s, maxSide / Math.max(full.w, full.h));
  // `tile`: trozo de la salida (en píxeles de salida) para estimar el tamaño a resolución real.
  const r = tile ? { x: full.x + tile.x / s, y: full.y + tile.y / s, w: tile.w / s, h: tile.h / s } : full;
  const { width, height } = tile ? { width: tile.w, height: tile.h } : outputSize(r, s);
  const problem = sizeProblem(width, height);
  if (problem) throw new Error(problem);
  const V: Mat = [s, 0, 0, s, -r.x * s, -r.y * s];
  const renderer = new ItemRenderer(engine.painter, doc.width, doc.height);
  renderer.smoothBitmaps = o.antialias;

  const mask = o.scope === 'selection' && doc.selection ? document.createElement('canvas') : null;
  if (mask && doc.selection) { mask.width = width; mask.height = height; drawSelectionMask(mask.getContext('2d')!, doc.selection, V); }

  const psdLayers = o.format === 'psd' && o.psdLayers && !maxSide && !tile;
  const needed = doc.layers.filter(l => l.visible || psdLayers);
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const comp = document.createElement('canvas');
  comp.width = width; comp.height = height;
  const cctx = comp.getContext('2d', { willReadFrequently: true })!;

  const job: RasterJob = { width, height, composite: new Uint8ClampedArray(0), layers: [], individual: [] };
  const clips = new ClipComposer(doc.layers.filter(l => l.visible || psdLayers));
  for (let i = 0; i < needed.length; i++) {
    const layer = needed[i];
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.setTransform(V[0], V[1], V[2], V[3], V[4], V[5]);
    ctx.beginPath(); ctx.rect(0, 0, doc.width, doc.height); ctx.clip();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    renderer.renderItems(ctx, layer.items, V, 1);
    ctx.restore();
    if (mask) { ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(mask, 0, 0); ctx.globalCompositeOperation = 'source-over'; }
    // Máscara de recorte: la capa queda recortada a su base (también en la capa del PSD).
    const showClip = clips.prepare(layer, ctx);
    if (layer.visible && showClip) {
      cctx.globalAlpha = layer.opacity;
      cctx.globalCompositeOperation = blendOp(layer.blend);
      cctx.drawImage(canvas, 0, 0);
      cctx.globalAlpha = 1;
      cctx.globalCompositeOperation = 'source-over';
    }
    if (psdLayers) {
      // Recorte al contenido para no guardar píxeles vacíos.
      const content = layer.items.filter(it => it.kind !== 'clear').map(it => transformAABB(V, it.bounds));
      let x0 = width, y0 = height, x1 = 0, y1 = 0;
      for (const b of content) { x0 = Math.min(x0, Math.floor(b.minX)); y0 = Math.min(y0, Math.floor(b.minY)); x1 = Math.max(x1, Math.ceil(b.maxX)); y1 = Math.max(y1, Math.ceil(b.maxY)); }
      x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(width, x1); y1 = Math.min(height, y1);
      const empty = x1 <= x0 || y1 <= y0;
      const lw = empty ? 1 : x1 - x0, lh = empty ? 1 : y1 - y0;
      job.layers.push({
        name: layer.name, opacity: layer.opacity, blend: layer.blend, hidden: !layer.visible, alphaLock: layer.alphaLock,
        data: empty ? new Uint8ClampedArray(4) : ctx.getImageData(x0, y0, lw, lh).data, left: empty ? 0 : x0, top: empty ? 0 : y0, width: lw, height: lh,
      });
    } else if (o.layers === 'individual' && !maxSide && !tile && layer.visible) {
      job.individual.push({ name: layer.name, data: ctx.getImageData(0, 0, width, height).data });
    }
    onProgress((i + 1) / needed.length);
    await nextFrame();
  }
  job.composite = cctx.getImageData(0, 0, width, height).data;
  return job;
}

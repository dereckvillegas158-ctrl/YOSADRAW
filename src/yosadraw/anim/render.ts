import type { StrokePainter } from '../brush/StrokePainter';
import type { Document, Layer } from '../doc/Document';
import { blendOp, ItemRenderer } from '../doc/ItemRenderer';
import type { Item } from '../doc/items';
import { capture, celAt, effectiveVisible, groupOf } from './model';

/** Imagen de un dibujo recortada a su contenido (x, y = posición en el fotograma a esa escala). */
interface Entry { canvas: HTMLCanvasElement | null; x: number; y: number; items: Item[]; bytes: number; used: number }

/**
 * Render de fotogramas para el reproductor y la exportación.
 *
 * Se cachea por *cel* (no por fotograma): un dibujo que se mantiene 6 fotogramas
 * se rasteriza una vez, y las capas estáticas una sola vez en toda la animación.
 * Componer un fotograma es dibujar esas imágenes con la opacidad y fusión de cada
 * capa (y los grupos aislados con la suya). La caché tiene un presupuesto de
 * memoria y descarta lo menos usado: nunca hay toda la animación en memoria.
 */
export class FrameRenderer {
  private cache = new Map<string, Entry>();
  private bytes = 0;
  private tick = 0;
  private renderer: ItemRenderer;
  private tmp: HTMLCanvasElement[] = [];

  constructor(private painter: StrokePainter, private doc: Document, public budget = 512 * 1024 * 1024) {
    this.renderer = new ItemRenderer(painter, doc.width, doc.height);
  }

  /** Otro renderizador para el mismo documento con su propia caché (exportación). */
  fork(budget: number) { return new FrameRenderer(this.painter, this.doc, budget); }

  /** El documento cambió de tamaño o se abrió otro. */
  reset(doc: Document) {
    this.doc = doc;
    this.renderer = new ItemRenderer(this.painter, doc.width, doc.height);
    this.clear();
  }
  clear() { this.cache.clear(); this.bytes = 0; }
  get memory() { return this.bytes; }

  size(scale: number) { return { w: Math.max(1, Math.round(this.doc.width * scale)), h: Math.max(1, Math.round(this.doc.height * scale)) }; }

  /** Capas que se ven en un fotograma (con su lista de elementos). */
  private visible(f: number, includeReference: boolean): { l: Layer; items: Item[]; key: string }[] {
    const out = [];
    for (const l of this.doc.layers) {
      if (!effectiveVisible(this.doc, l) || (l.reference && !includeReference)) continue;
      if (l.cels) {
        const c = celAt(l, f);
        if (c && c.content.items.length) out.push({ l, items: c.content.items, key: `${l.id}|${c.id}` });
      } else if (l.items.length) out.push({ l, items: l.items, key: `${l.id}|static` });
    }
    return out;
  }

  /** ¿Cabe todavía algo más en la caché? (para precalentar sin desalojar lo útil). */
  get roomy() { return this.bytes < this.budget * 0.85; }

  /** ¿Están ya en caché todos los dibujos del fotograma a esta escala? */
  ready(f: number, scale: number, includeReference = true) {
    return this.visible(f, includeReference).every(v => this.cache.get(`${v.key}|${scale}`)?.items === v.items);
  }

  private layerImage(key: string, items: Item[], scale: number): Entry {
    const k = `${key}|${scale}`;
    const hit = this.cache.get(k);
    if (hit && hit.items === items) { hit.used = ++this.tick; return hit; }
    if (hit) { this.bytes -= hit.bytes; this.cache.delete(k); }
    // Sólo se rasteriza (y se guarda) la caja que ocupa el dibujo: un personaje en una
    // esquina de un lienzo Full HD ocupa una fracción de la memoria.
    const { w: W, h: H } = this.size(scale);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const it of items) { minX = Math.min(minX, it.bounds.minX); minY = Math.min(minY, it.bounds.minY); maxX = Math.max(maxX, it.bounds.maxX); maxY = Math.max(maxY, it.bounds.maxY); }
    const x0 = Math.max(0, Math.floor(minX * scale) - 2), y0 = Math.max(0, Math.floor(minY * scale) - 2);
    const x1 = Math.min(W, Math.ceil(maxX * scale) + 2), y1 = Math.min(H, Math.ceil(maxY * scale) + 2);
    let c: HTMLCanvasElement | null = null;
    if (x1 > x0 && y1 > y0) {
      c = document.createElement('canvas');
      c.width = x1 - x0; c.height = y1 - y0;
      this.renderer.renderItems(c.getContext('2d')!, items, [scale, 0, 0, scale, -x0, -y0], 1);
    }
    const e: Entry = { canvas: c, x: x0, y: y0, items, bytes: c ? c.width * c.height * 4 : 0, used: ++this.tick };
    this.cache.set(k, e);
    this.bytes += e.bytes;
    this.evict();
    return e;
  }

  private evict() {
    if (this.bytes <= this.budget) return;
    const list = [...this.cache.entries()].sort((a, b) => a[1].used - b[1].used);
    for (const [k, e] of list) {
      if (this.bytes <= this.budget * 0.8) break;
      if (e.used === this.tick) continue;
      this.cache.delete(k);
      this.bytes -= e.bytes;
      if (e.canvas) e.canvas.width = e.canvas.height = 0;
    }
  }

  /** Rasteriza por adelantado los dibujos de un fotograma (para reproducir sin saltos). Devuelve ms empleados. */
  prepare(f: number, scale: number, includeReference = true, budgetMs = Infinity): number {
    const t0 = performance.now();
    for (const v of this.visible(f, includeReference)) {
      if (performance.now() - t0 > budgetMs) break;
      this.layerImage(v.key, v.items, scale);
    }
    return performance.now() - t0;
  }

  private scratch(i: number, w: number, h: number) {
    let c = this.tmp[i];
    if (!c) { c = document.createElement('canvas'); this.tmp[i] = c; }
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const g = c.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, w, h);
    return { c, g };
  }

  /**
   * Compone el fotograma `f` a `scale` px por px de documento en `out` (que se
   * redimensiona). `background` = pintar el color del papel; `includeReference` = pistas de referencia.
   */
  renderFrame(f: number, scale: number, out: HTMLCanvasElement, o: { background: boolean; includeReference: boolean } = { background: true, includeReference: false }): HTMLCanvasElement {
    capture(this.doc);
    const { w, h } = this.size(scale);
    if (out.width !== w || out.height !== h) { out.width = w; out.height = h; }
    const g = out.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, w, h);
    if (o.background && this.doc.settings.background) { g.fillStyle = this.doc.settings.background; g.fillRect(0, 0, w, h); }
    const vis = this.visible(f, o.includeReference);
    let i = 0;
    while (i < vis.length) {
      const grp = groupOf(this.doc, vis[i].l);
      if (!grp) {
        const v = vis[i++];
        const img = this.layerImage(v.key, v.items, scale);
        if (!img.canvas) continue;
        g.globalAlpha = v.l.opacity;
        g.globalCompositeOperation = blendOp(v.l.blend);
        g.drawImage(img.canvas, img.x, img.y);
        continue;
      }
      // Grupo aislado: sus capas se componen aparte y el resultado entra con la opacidad del grupo.
      const s = this.scratch(0, w, h);
      while (i < vis.length && groupOf(this.doc, vis[i].l) === grp) {
        const v = vis[i++];
        const img = this.layerImage(v.key, v.items, scale);
        if (!img.canvas) continue;
        s.g.globalAlpha = v.l.opacity;
        s.g.globalCompositeOperation = blendOp(v.l.blend);
        s.g.drawImage(img.canvas, img.x, img.y);
      }
      g.globalAlpha = grp.opacity;
      g.globalCompositeOperation = 'source-over';
      g.drawImage(s.c, 0, 0);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    return out;
  }
}

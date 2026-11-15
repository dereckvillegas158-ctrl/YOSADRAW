import { zipSync } from 'fflate';
import { desktopBridge } from '../brush/storage';
import type { CanvasEngine } from '../engine';
import ExportWorker from './export.worker?worker&inline';
import type { EncodedFile, RasterJob } from './pipeline';
import { exportRegion, outputSize, renderForExport } from './render';
import { FORMATS, safeFileName, type ExportOptions } from './types';

export interface PreviewResult { width: number; height: number; pixels: Uint8ClampedArray; bytes: number; estimate: number; estimateKind: 'exact' | 'approx' | 'max'; files: number }
export interface SaveResult { mode: 'desktop' | 'download'; paths: string[]; folder?: string; total: number; names: string[] }

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; progress?: (f: number, label: string) => void };

/**
 * Orquesta la exportación: rasteriza en el hilo principal (sin tocar el
 * documento), codifica en un worker y guarda en disco o descarga.
 */
export class Exporter {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, Pending>();

  constructor(private engine: CanvasEngine) {}

  private w(): Worker {
    if (this.worker) return this.worker;
    const w = new ExportWorker();
    w.onmessage = (e: MessageEvent) => {
      const m = e.data, p = this.pending.get(m.id);
      if (!p) return;
      if (m.type === 'progress') { p.progress?.(m.progress, m.label); return; }
      this.pending.delete(m.id);
      if (m.type === 'error') p.reject(new Error(m.message)); else p.resolve(m);
    };
    w.onerror = e => { for (const p of this.pending.values()) p.reject(new Error(e.message || 'Error en el codificador')); this.pending.clear(); this.worker = null; };
    this.worker = w;
    return w;
  }

  private call<T>(msg: Record<string, unknown>, transfer: Transferable[], progress?: Pending['progress']): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, progress });
      this.w().postMessage({ ...msg, id }, transfer);
    });
  }

  /** Número de archivos y dimensiones finales. */
  plan(o: ExportOptions) {
    const r = exportRegion(this.engine, o);
    const { width, height } = outputSize(r, o.scale);
    const visible = this.engine.doc.layers.filter(l => l.visible).length;
    const files = o.format === 'psd' || o.format === 'pdf' ? 1 : o.layers === 'individual' ? Math.max(1, visible) : 1;
    const pages = o.format === 'pdf' && o.layers === 'individual' ? Math.max(1, visible) : 1;
    return { region: r, width, height, files, pages };
  }

  private encodeSize(o: ExportOptions, data: Uint8ClampedArray, w: number, h: number) {
    return this.call<{ bytes: number; pixels: Uint8ClampedArray }>({ kind: 'preview', opts: o, width: w, height: h, data }, [data.buffer]);
  }

  /**
   * Estima el tamaño codificando 8 franjas horizontales del ancho completo a
   * resolución real (los compresores trabajan por filas: las muestras
   * cuadradas subestiman), descontando las cabeceras fijas.
   */
  private async estimateBytes(o: ExportOptions, W: number, H: number): Promise<number> {
    // WebP sin pérdida predice en 2D: muestras cuadradas. El resto: franjas.
    const square = o.format === 'webp' && o.webpLossless;
    const N = 8, rows = Math.max(8, Math.min(48, Math.round(2_000_000 / (N * W))));
    const T = 256, G = 4;
    if (square ? W * H <= T * T * G * G * 2 : H <= N * rows * 1.5) {
      const job = await renderForExport(this.engine, o, () => {});
      return (await this.encodeSize(o, job.composite, W, H)).bytes;
    }
    const fixed = (await this.encodeSize(o, new Uint8ClampedArray(4), 1, 1)).bytes;
    const samples: { x: number; y: number; w: number; h: number }[] = [];
    if (square) {
      const tw = Math.min(T, W), th = Math.min(T, H);
      for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) samples.push({ x: Math.round(((i + 0.5) / G) * (W - tw)), y: Math.round(((j + 0.5) / G) * (H - th)), w: tw, h: th });
    } else {
      for (let i = 0; i < N; i++) samples.push({ x: 0, y: Math.max(0, Math.min(H - rows, Math.round(((i + 0.5) / N) * H - rows / 2))), w: W, h: rows });
    }
    let bytes = 0, px = 0;
    for (const t of samples) {
      const job = await renderForExport(this.engine, o, () => {}, undefined, t);
      bytes += Math.max(0, (await this.encodeSize(o, job.composite, t.w, t.h)).bytes - fixed);
      px += t.w * t.h;
    }
    return fixed + (bytes / px) * W * H;
  }

  /** Vista previa con la misma codificación a tamaño reducido, y tamaño estimado. */
  async preview(o: ExportOptions, maxSide = 520): Promise<PreviewResult> {
    const job = await renderForExport(this.engine, o, () => {}, maxSide);
    const m = await this.encodeSize(o, job.composite, job.width, job.height);
    const plan = this.plan(o), full = plan.width * plan.height;
    const info = FORMATS[o.format];
    let estimate = await this.estimateBytes(o, plan.width, plan.height), kind: PreviewResult['estimateKind'] = 'approx';
    const alpha = o.transparent && info.alpha;
    const spp = (o.profile === 'gray' && info.nativeGray ? 1 : 3) + (alpha ? 1 : 0);
    if (o.format === 'bmp') { const bpp = alpha && o.bmpDepth === 32 ? 4 : 3; estimate = 138 + Math.ceil((plan.width * bpp) / 4) * 4 * plan.height; kind = 'exact'; }
    else if (o.format === 'tiff' && o.tiffCompression === 'none') { estimate = full * spp + 4096; kind = 'exact'; }
    else if (o.format === 'psd' && o.psdLayers) {
      // La muestra es capa + composición: cada capa adicional cuesta como mucho otra imagen.
      estimate = (estimate / 2) * (1 + this.engine.doc.layers.length);
    }
    estimate *= o.format === 'pdf' ? plan.pages : plan.files;
    return { width: job.width, height: job.height, pixels: m.pixels, bytes: m.bytes, estimate, estimateKind: kind, files: plan.files };
  }

  /** Genera los archivos (no los guarda). */
  async export(o: ExportOptions, progress: (f: number, label: string) => void): Promise<EncodedFile[]> {
    progress(0, 'Preparando el lienzo');
    const job: RasterJob = await renderForExport(this.engine, o, f => progress(f * 0.35, 'Renderizando capas'));
    const transfer = [job.composite.buffer, ...job.layers.map(l => l.data.buffer), ...job.individual.map(l => l.data.buffer)] as Transferable[];
    const res = await this.call<{ files: EncodedFile[] }>({ kind: 'export', opts: o, job }, transfer, (f, label) => progress(0.35 + f * 0.6, label));
    progress(1, 'Listo');
    return res.files;
  }

  /** Guarda en la carpeta elegida (escritorio) o descarga (navegador; varios archivos van en un ZIP). */
  async save(files: EncodedFile[], o: ExportOptions, folder: string | null, overwrite: boolean): Promise<SaveResult> {
    const total = files.reduce((n, f) => n + f.data.length, 0);
    const bridge = desktopBridge();
    if (bridge?.writeExport && folder) {
      const paths: string[] = [];
      for (const f of files) paths.push(await bridge.writeExport(folder, f.name, f.data, overwrite));
      return { mode: 'desktop', paths, folder, total, names: paths.map(p => p.split(/[\\/]/).pop()!) };
    }
    let blob: Blob, name: string;
    if (files.length === 1) { blob = new Blob([files[0].data as Uint8Array<ArrayBuffer>], { type: files[0].mime }); name = files[0].name; }
    else {
      const zip = zipSync(Object.fromEntries(files.map(f => [f.name, f.data])), { level: 0 });
      blob = new Blob([zip as Uint8Array<ArrayBuffer>], { type: 'application/zip' }); name = `${safeFileName(o.name)}.zip`;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.style.display = 'none';
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return { mode: 'download', paths: [], total, names: [name] };
  }
}

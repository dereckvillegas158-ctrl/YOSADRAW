/// <reference lib="webworker" />
import { encodeWebP } from './encoders/webpWasm';
import { encodeExport, encodeImage, processPixels, keepsAlpha, type CanvasEncoder, type Codecs, type RasterJob } from './pipeline';
import type { ExportOptions } from './types';

/**
 * Hilo de codificación: la interfaz sigue respondiendo y la barra de
 * progreso avanza mientras se filtran, comprimen y escriben los archivos.
 */
const canvasEncode: CanvasEncoder = async (rgba, w, h, mime, quality) => {
  const c = new OffscreenCanvas(w, h);
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
  const blob = await c.convertToBlob({ type: mime, quality });
  return new Uint8Array(await blob.arrayBuffer());
};

const codecs: Codecs = { canvas: canvasEncode, webp: encodeWebP };

export type WorkerRequest =
  | { id: number; kind: 'export'; opts: ExportOptions; job: RasterJob }
  | { id: number; kind: 'preview'; opts: ExportOptions; width: number; height: number; data: Uint8ClampedArray };

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  try {
    if (req.kind === 'export') {
      const files = await encodeExport(req.job, req.opts, codecs, (progress, label) => self.postMessage({ id: req.id, type: 'progress', progress, label }));
      self.postMessage({ id: req.id, type: 'done', files }, files.map(f => f.data.buffer as ArrayBuffer));
    } else {
      // Vista previa: misma codificación a tamaño reducido; los formatos con pérdida se decodifican para ver sus artefactos.
      const o = req.opts;
      let size: number;
      let bytes: Uint8Array;
      if (o.format === 'pdf' || o.format === 'psd') {
        // Tamaño con el codificador real (una imagen; PSD = capa + composición).
        const files = await encodeExport({ width: req.width, height: req.height, composite: req.data, layers: [], individual: [] }, { ...o, layers: 'merged', psdLayers: false }, codecs, () => {});
        size = files[0].data.length;
        bytes = o.format === 'pdf' && o.pdfCompression === 'jpeg' ? await encodeImage(req.data, req.width, req.height, { ...o, format: 'jpeg' }, codecs) : files[0].data;
      } else {
        bytes = await encodeImage(req.data, req.width, req.height, o, codecs);
        size = bytes.length;
      }
      let shown: Uint8ClampedArray;
      if ((o.format === 'jpeg' || (o.format === 'webp' && !o.webpLossless) || (o.format === 'pdf' && o.pdfCompression === 'jpeg'))) {
        const bmp = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>]));
        const c = new OffscreenCanvas(req.width, req.height), g = c.getContext('2d')!;
        g.drawImage(bmp, 0, 0);
        shown = g.getImageData(0, 0, req.width, req.height).data;
        if (o.format === 'pdf' && keepsAlpha(o)) { const a = processPixels(req.data, o); for (let i = 3; i < shown.length; i += 4) shown[i] = a[i]; }
      } else shown = processPixels(req.data, o);
      self.postMessage({ id: req.id, type: 'preview', bytes: size, pixels: shown }, [shown.buffer as ArrayBuffer]);
    }
  } catch (err) {
    self.postMessage({ id: req.id, type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};

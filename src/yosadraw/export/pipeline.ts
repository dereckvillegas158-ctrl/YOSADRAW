import { flatten, hardEdges, hexRgb, packChannels, toDisplayP3, toGray } from './color';
import { encodeBMP } from './encoders/bmp';
import { jpegWithMeta } from './encoders/jpegMeta';
import { encodePDF, type PdfPage } from './encoders/pdf';
import { encodePNG } from './encoders/png';
import { encodePSD, type PsdLayerInput } from './encoders/psd';
import { encodeTIFF } from './encoders/tiff';
import { webpWithIcc } from './encoders/webpMeta';
import { makeIccProfile, PROFILE_NAMES } from './icc';
import { FORMATS, safeFileName, type ColorProfile, type ExportOptions } from './types';

/** Imágenes ya rasterizadas (RGBA sin premultiplicar) que hay que codificar. */
export interface RasterJob {
  width: number;
  height: number;
  /** Capas visibles combinadas. */
  composite: Uint8ClampedArray;
  /** Capas recortadas a su contenido (para PSD con capas). */
  layers: PsdLayerInput[];
  /** Capas a tamaño completo (exportación de capas individuales). */
  individual: { name: string; data: Uint8ClampedArray }[];
}

export interface EncodedFile { name: string; mime: string; data: Uint8Array }

/** Codificación nativa del navegador (JPEG) sobre RGBA. */
export type CanvasEncoder = (rgba: Uint8ClampedArray, w: number, h: number, mime: string, quality: number) => Promise<Uint8Array>;
/** Codificador WebP (libwebp). */
export type WebpEncoder = (rgba: Uint8ClampedArray, w: number, h: number, o: { quality: number; lossless: boolean }) => Promise<Uint8Array>;
export interface Codecs { canvas: CanvasEncoder; webp: WebpEncoder }

/** Perfil que se incrusta (o null). Si el formato no guarda gris nativo, el gris va en RGB con perfil sRGB. */
export function profileFor(o: ExportOptions): ColorProfile | null {
  if (!o.embedProfile) return null;
  if (o.profile === 'gray' && !FORMATS[o.format].nativeGray) return 'srgb';
  return o.profile;
}

/** ¿El archivo final tiene canal alfa? */
export const keepsAlpha = (o: ExportOptions) => o.transparent && FORMATS[o.format].alpha && !(o.format === 'bmp' && o.bmpDepth === 24);

/** Ajustes de píxeles comunes a todos los formatos (sobre una copia). */
export function processPixels(src: Uint8ClampedArray, o: ExportOptions, alpha = keepsAlpha(o)): Uint8ClampedArray {
  const px = new Uint8ClampedArray(src);
  if (!o.antialias) hardEdges(px);
  if (o.profile === 'p3') toDisplayP3(px);
  else if (o.profile === 'gray') toGray(px);
  if (!alpha) flatten(px, hexRgb(o.background));
  return px;
}

const alphaOf = (px: Uint8ClampedArray) => { const a = new Uint8Array(px.length / 4); for (let i = 0; i < a.length; i++) a[i] = px[i * 4 + 3]; return a; };
const opaqueCopy = (px: Uint8ClampedArray) => { const c = new Uint8ClampedArray(px); for (let i = 3; i < c.length; i += 4) c[i] = 255; return c; };

/** Codifica una imagen en el formato pedido. */
export async function encodeImage(px0: Uint8ClampedArray, w: number, h: number, o: ExportOptions, codecs: Codecs, onProgress?: (f: number) => void): Promise<Uint8Array> {
  const alpha = keepsAlpha(o);
  const px = processPixels(px0, o, alpha);
  const kind = profileFor(o);
  const icc = kind ? makeIccProfile(kind) : undefined;
  const gray = o.profile === 'gray' && FORMATS[o.format].nativeGray;
  switch (o.format) {
    case 'png':
      return encodePNG(packChannels(px, gray, alpha), w, h, {
        channels: ((gray ? 1 : 3) + (alpha ? 1 : 0)) as 1 | 2 | 3 | 4, level: o.pngLevel, dpi: o.dpi,
        icc: icc && kind ? { name: PROFILE_NAMES[kind], data: icc } : undefined, srgb: !icc && o.profile === 'srgb', onProgress,
      });
    case 'jpeg':
      return jpegWithMeta(await codecs.canvas(px, w, h, 'image/jpeg', o.quality), { dpi: o.dpi, icc });
    case 'webp': {
      const data = await codecs.webp(px, w, h, { quality: o.quality, lossless: o.webpLossless });
      return icc ? webpWithIcc(data, icc) : data;
    }
    case 'bmp':
      return encodeBMP(px, w, h, { depth: alpha ? 32 : 24, dpi: o.dpi, icc });
    case 'tiff':
      return encodeTIFF(packChannels(px, gray, alpha), w, h, { channels: ((gray ? 1 : 3) + (alpha ? 1 : 0)) as 1 | 2 | 3 | 4, compression: o.tiffCompression, dpi: o.dpi, icc, onProgress });
    default:
      throw new Error(`Formato sin codificador de imagen única: ${o.format}`);
  }
}

async function pdfPage(px0: Uint8ClampedArray, w: number, h: number, o: ExportOptions, codecs: Codecs): Promise<PdfPage> {
  const alpha = keepsAlpha(o);
  const px = processPixels(px0, o, alpha);
  const gray = o.profile === 'gray';
  const page: PdfPage = { width: w, height: h, channels: gray ? 1 : 3, alpha: alpha ? alphaOf(px) : undefined };
  if (o.pdfCompression === 'jpeg' && !gray) page.jpeg = await codecs.canvas(opaqueCopy(px), w, h, 'image/jpeg', o.quality);
  else page.pixels = packChannels(px, gray, false);
  return page;
}

/** Ejecuta la exportación completa. Devuelve uno o varios archivos. */
export async function encodeExport(job: RasterJob, o: ExportOptions, codecs: Codecs, progress: (f: number, label: string) => void): Promise<EncodedFile[]> {
  const info = FORMATS[o.format];
  const base = safeFileName(o.name);
  const file = (suffix: string, data: Uint8Array): EncodedFile => ({ name: `${base}${suffix}.${info.ext}`, mime: info.mime, data });

  if (o.format === 'psd') {
    progress(0.1, 'Preparando capas');
    const composite = processPixels(job.composite, o);
    const layers = o.psdLayers
      ? job.layers.map(l => ({ ...l, data: processPixels(l.data, o, true) }))
      : [{ name: 'Imagen', opacity: 1, blend: 'normal', hidden: false, data: composite, left: 0, top: 0, width: job.width, height: job.height }];
    progress(0.4, 'Escribiendo PSD');
    const kind = profileFor(o);
    return [file('', encodePSD(job.width, job.height, composite, layers, { dpi: o.dpi, icc: kind ? makeIccProfile(kind) : undefined, compress: o.psdCompress }))];
  }

  const sources = o.layers === 'individual' && job.individual.length ? job.individual : [{ name: '', data: job.composite }];
  if (o.format === 'pdf') {
    const pages: PdfPage[] = [];
    for (let i = 0; i < sources.length; i++) {
      progress(i / sources.length * 0.8, `Página ${i + 1} de ${sources.length}`);
      pages.push(await pdfPage(sources[i].data, job.width, job.height, o, codecs));
    }
    progress(0.85, 'Escribiendo PDF');
    const kind = profileFor(o);
    return [file('', encodePDF(pages, { dpi: o.dpi, title: base, icc: kind ? makeIccProfile(kind) : undefined }))];
  }

  const out: EncodedFile[] = [];
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    const label = sources.length > 1 ? `Capa «${s.name}» (${i + 1} de ${sources.length})` : `Codificando ${info.label}`;
    const data = await encodeImage(s.data, job.width, job.height, o, codecs, f => progress((i + f) / sources.length, label));
    out.push(file(s.name ? ` - ${safeFileName(s.name)}` : '', data));
    progress((i + 1) / sources.length, label);
  }
  return out;
}

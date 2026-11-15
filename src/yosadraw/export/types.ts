/** Formatos y opciones de exportación (sin dependencias de DOM). */
export type ExportFormat = 'png' | 'jpeg' | 'webp' | 'bmp' | 'tiff' | 'psd' | 'pdf';
export type ColorProfile = 'srgb' | 'p3' | 'gray';

export interface ExportOptions {
  format: ExportFormat;
  /** Nombre del archivo sin extensión. */
  name: string;
  scope: 'canvas' | 'selection';
  /** merged = capas visibles combinadas · individual = un archivo (o página) por capa visible. */
  layers: 'merged' | 'individual';
  /** Escala respecto al documento (1 = 100 %). */
  scale: number;
  /** Puntos por pulgada guardados en el archivo (y tamaño de página del PDF). */
  dpi: number;
  transparent: boolean;
  /** Fondo cuando no hay transparencia (#rrggbb). */
  background: string;
  /** Calidad 0..1 para JPEG, WebP con pérdida y PDF con JPEG. */
  quality: number;
  webpLossless: boolean;
  /** Nivel de compresión PNG 0..9. */
  pngLevel: number;
  tiffCompression: 'none' | 'lzw' | 'deflate';
  pdfCompression: 'flate' | 'jpeg';
  bmpDepth: 24 | 32;
  psdCompress: boolean;
  /** PSD: conservar capas (si no, una sola capa con la imagen combinada). */
  psdLayers: boolean;
  profile: ColorProfile;
  embedProfile: boolean;
  /** false = bordes duros (alfa al 50 %) y escalado sin suavizar. */
  antialias: boolean;
}

export interface FormatInfo {
  label: string;
  ext: string;
  mime: string;
  /** Admite transparencia. */
  alpha: boolean;
  lossy: boolean;
  /** Guarda PPP en el archivo. */
  dpi: boolean;
  /** Permite incrustar perfil ICC. */
  icc: boolean;
  /** Guarda escala de grises como canal único. */
  nativeGray: boolean;
  description: string;
}

export const FORMATS: Record<ExportFormat, FormatInfo> = {
  png: { label: 'PNG', ext: 'png', mime: 'image/png', alpha: true, lossy: false, dpi: true, icc: true, nativeGray: true, description: 'Sin pérdida, con transparencia. Ideal para web y retoque.' },
  jpeg: { label: 'JPG', ext: 'jpg', mime: 'image/jpeg', alpha: false, lossy: true, dpi: true, icc: true, nativeGray: false, description: 'Con pérdida y calidad ajustable. Fotos y archivos ligeros.' },
  webp: { label: 'WEBP', ext: 'webp', mime: 'image/webp', alpha: true, lossy: true, dpi: false, icc: true, nativeGray: false, description: 'Moderno y ligero; con o sin pérdida y con transparencia.' },
  bmp: { label: 'BMP', ext: 'bmp', mime: 'image/bmp', alpha: true, lossy: false, dpi: true, icc: true, nativeGray: false, description: 'Mapa de bits sin comprimir (32 bits con alfa o 24 bits).' },
  tiff: { label: 'TIFF', ext: 'tif', mime: 'image/tiff', alpha: true, lossy: false, dpi: true, icc: true, nativeGray: true, description: 'Sin pérdida para imprenta y archivo (LZW o Deflate).' },
  psd: { label: 'PSD', ext: 'psd', mime: 'image/vnd.adobe.photoshop', alpha: true, lossy: false, dpi: true, icc: true, nativeGray: false, description: 'Photoshop con capas, nombres, opacidad y modos de fusión.' },
  pdf: { label: 'PDF', ext: 'pdf', mime: 'application/pdf', alpha: true, lossy: false, dpi: true, icc: true, nativeGray: true, description: 'Documento a tamaño de impresión según los PPP.' },
};

export const DEFAULT_OPTIONS: ExportOptions = {
  format: 'png', name: 'Dibujo', scope: 'canvas', layers: 'merged', scale: 1, dpi: 300,
  transparent: true, background: '#ffffff', quality: 0.92, webpLossless: false, pngLevel: 6,
  tiffCompression: 'lzw', pdfCompression: 'flate', bmpDepth: 32, psdCompress: false, psdLayers: true,
  profile: 'srgb', embedProfile: true, antialias: true,
};

/** Límites para no agotar la memoria del navegador. */
export const MAX_SIDE = 16384;
export const MAX_PIXELS = 100_000_000;

export function normalizeOptions(v: unknown): ExportOptions {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<ExportOptions>;
  const d = DEFAULT_OPTIONS;
  const n = (x: unknown, def: number, lo: number, hi: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : def);
  const pick = <T extends string>(x: unknown, list: readonly T[], def: T) => (list.includes(x as T) ? (x as T) : def);
  return {
    format: pick(o.format, Object.keys(FORMATS) as ExportFormat[], d.format),
    name: typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 120) : d.name,
    scope: pick(o.scope, ['canvas', 'selection'] as const, d.scope),
    layers: pick(o.layers, ['merged', 'individual'] as const, d.layers),
    scale: n(o.scale, d.scale, 0.01, 16), dpi: n(o.dpi, d.dpi, 1, 2400),
    transparent: typeof o.transparent === 'boolean' ? o.transparent : d.transparent,
    background: typeof o.background === 'string' && /^#[0-9a-f]{6}$/i.test(o.background) ? o.background : d.background,
    quality: n(o.quality, d.quality, 0.01, 1), webpLossless: !!o.webpLossless, pngLevel: Math.round(n(o.pngLevel, d.pngLevel, 0, 9)),
    tiffCompression: pick(o.tiffCompression, ['none', 'lzw', 'deflate'] as const, d.tiffCompression),
    pdfCompression: pick(o.pdfCompression, ['flate', 'jpeg'] as const, d.pdfCompression),
    bmpDepth: o.bmpDepth === 24 ? 24 : 32, psdCompress: !!o.psdCompress, psdLayers: o.psdLayers !== false,
    profile: pick(o.profile, ['srgb', 'p3', 'gray'] as const, d.profile),
    embedProfile: o.embedProfile !== false, antialias: o.antialias !== false,
  };
}

export const safeFileName = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Dibujo';

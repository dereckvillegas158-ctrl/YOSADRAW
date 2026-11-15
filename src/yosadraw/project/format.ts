import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import type { FinishedStroke } from '../brush/BrushStrokeSession';
import type { BrushPreset } from '../brush/BrushPreset';
import { DAB_STRIDE } from '../brush/DabGenerator';
import type { DabSet } from '../brush/StrokePainter';
import { Document, type DocProfile, type DocSettings, type Layer } from '../doc/Document';
import type { Item, LayerBlend } from '../doc/items';
import type { SelShape, Selection } from '../doc/Selection';
import type { AABB, Mat, ViewState } from '../engine/ViewTransform';

/**
 * Formato nativo de YOSADRAW (.yosa).
 *
 * Es un ZIP con:
 *   mimetype            "application/x-yosadraw" (primera entrada, sin comprimir)
 *   project.json        metadatos, capas, elementos editables, selección, vista y pinceles
 *   bin/N.bin           sellos, colores y puntos de los trazos (Float32/Float64/Uint8, little-endian)
 *   img/N.png           mapas de bits (relleno, selección levantada) y máscaras de selección
 *   thumb.png           miniatura para la galería
 *
 * Todo sigue siendo editable al reabrir: los trazos conservan su pincel congelado,
 * puntos y sellos; las formas y degradados, sus parámetros; las capas, su
 * opacidad, fusión, visibilidad y bloqueo; los recortes, sus máscaras.
 */
export const PROJECT_MIME = 'application/x-yosadraw';
export const PROJECT_EXT = 'yosa';
export const FORMAT_ID = 'yosadraw-project';
export const FORMAT_VERSION = 1;

/** Límites de documento: más grande agota la memoria en teléfonos. */
export const MAX_DOC_SIDE = 8192;
export const MAX_DOC_PIXELS = 50_000_000;
export const MIN_DOC_SIDE = 16;

export interface ProjectMeta {
  id: string;
  name: string;
  width: number;
  height: number;
  dpi: number;
  background: string | null;
  profile: DocProfile;
  /** ms desde 1970. */
  created: number;
  modified: number;
  layers: number;
  /** Formato de origen (yosa, png, jpeg, webp) si se creó importando. */
  source: string;
  /** Guardados realizados (detecta que otra ventana guardó antes: no se sobrescribe sin preguntar). */
  rev: number;
  app: string;
}

export interface ProjectFile { meta: ProjectMeta; doc: Document; view: ViewState | null; thumb: Uint8Array | null }

/** Codifica y decodifica imágenes (en el navegador, PNG con canvas; en pruebas, uno falso). */
export interface ImageCodec {
  encode(img: CanvasImageSource): Promise<Uint8Array>;
  decode(png: Uint8Array): Promise<CanvasImageSource>;
}

export class ProjectFormatError extends Error {}

// ---------------------------------------------------------------- escritura

type J = Record<string, unknown>;

class Writer {
  files: Zippable = {};
  private n = 0;
  private presets = new Map<BrushPreset, string>();
  private presetJson = new Map<string, string>();
  presetTable: Record<string, BrushPreset> = {};
  private jobs: Promise<void>[] = [];
  constructor(private codec: ImageCodec, private cache: WeakMap<object, Uint8Array>) {}

  bin(data: ArrayBufferView): string {
    const name = `bin/${++this.n}.bin`;
    this.files[name] = [new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)), { level: 1 }];
    return name;
  }

  img(src: CanvasImageSource): string {
    const name = `img/${++this.n}.png`;
    const key = src as unknown as object;
    const cached = this.cache.get(key);
    if (cached) this.files[name] = [cached, { level: 0 }];
    else this.jobs.push(this.codec.encode(src).then(png => { this.cache.set(key, png); this.files[name] = [png, { level: 0 }]; }));
    return name;
  }

  preset(p: BrushPreset): string {
    let id = this.presets.get(p);
    if (id) return id;
    const json = JSON.stringify(p);
    id = this.presetJson.get(json);
    if (!id) { id = `p${this.presetJson.size + 1}`; this.presetJson.set(json, id); this.presetTable[id] = JSON.parse(json); }
    this.presets.set(p, id);
    return id;
  }

  async done() { await Promise.all(this.jobs); }
}

function writeSelection(w: Writer, sel: Selection | null): unknown {
  if (!sel) return null;
  return { ops: sel.ops.map(op => ({ mode: op.mode, shape: writeShape(w, op.shape) })) };
}

function writeShape(w: Writer, s: SelShape): unknown {
  if (s.type === 'sel') return { type: 'sel', sel: writeSelection(w, s.sel) };
  if (s.type === 'mask') return { type: 'mask', x: s.x, y: s.y, w: s.w, h: s.h, m: s.m ?? null, canvas: w.img(s.canvas) };
  return { ...s };
}

function writeStroke(w: Writer, st: FinishedStroke): J {
  const pts = new Float64Array(st.points.length * 6);
  st.points.forEach((p, i) => { pts.set([p.x, p.y, p.pressure, p.tiltX, p.tiltY, p.t], i * 6); });
  return {
    preset: w.preset(st.preset), color: st.color, tool: st.tool, seed: st.seed, total: st.total, bounds: st.bounds,
    mirrors: st.mirrors ?? null, points: w.bin(pts),
    sets: st.sets.map(set => ({ count: set.count, dabs: w.bin(set.dabs.subarray(0, set.count * DAB_STRIDE)), colors: set.colors ? w.bin(set.colors) : null })),
  };
}

function writeItem(w: Writer, it: Item): J {
  const base: J = { id: it.id, kind: it.kind, m: it.m, clip: writeSelection(w, it.clip), local: it.local, bounds: it.bounds };
  switch (it.kind) {
    case 'stroke': return { ...base, stroke: writeStroke(w, it.stroke) };
    case 'shape': return { ...base, shape: it.shape };
    case 'gradient': return { ...base, grad: it.grad };
    case 'bitmap': return { ...base, image: w.img(it.image), x: it.x, y: it.y, w: it.w, h: it.h };
    case 'clear': return base;
    case 'group': return { ...base, opacity: it.opacity, blend: it.blend, items: it.items.map(i => writeItem(w, i)) };
  }
}

/** Serializa el documento a un archivo .yosa. `cache` reutiliza los PNG ya codificados entre guardados. */
export async function writeProject(doc: Document, meta: ProjectMeta, o: { codec: ImageCodec; cache?: WeakMap<object, Uint8Array>; thumb?: Uint8Array | null; view?: ViewState | null }): Promise<Uint8Array> {
  const w = new Writer(o.codec, o.cache ?? new WeakMap());
  const layers = doc.layers.map(l => ({ id: l.id, name: l.name, visible: l.visible, locked: l.locked, opacity: l.opacity, blend: l.blend, items: l.items.map(i => writeItem(w, i)) }));
  const selection = writeSelection(w, doc.selection);
  await w.done();
  const project = {
    format: FORMAT_ID, version: FORMAT_VERSION,
    meta: { ...meta, width: doc.width, height: doc.height, dpi: doc.settings.dpi, background: doc.settings.background, profile: doc.settings.profile, layers: doc.layers.length },
    document: { activeId: doc.activeId, counters: doc.counters, layers, selection },
    presets: w.presetTable,
    view: o.view ?? null,
  };
  const files: Zippable = {
    mimetype: [strToU8(PROJECT_MIME), { level: 0 }],
    'project.json': [strToU8(JSON.stringify(project)), { level: 6 }],
    ...w.files,
  };
  if (o.thumb) files['thumb.png'] = [o.thumb, { level: 0 }];
  return zipSync(files);
}

// ---------------------------------------------------------------- lectura

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);
const mat = (v: unknown): Mat | null => (Array.isArray(v) && v.length === 6 && v.every(x => typeof x === 'number' && Number.isFinite(x)) ? (v as Mat) : null);
const aabb = (v: unknown): AABB => { const o = (v ?? {}) as J; return { minX: num(o.minX), minY: num(o.minY), maxX: num(o.maxX), maxY: num(o.maxY) }; };
const BLENDS: LayerBlend[] = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-burn', 'color-dodge', 'soft-light', 'hard-light', 'difference'];
const blend = (v: unknown): LayerBlend => (BLENDS.includes(v as LayerBlend) ? (v as LayerBlend) : 'normal');

class Reader {
  private images = new Map<string, Promise<CanvasImageSource>>();
  private resolved = new Map<string, CanvasImageSource>();
  constructor(private files: Record<string, Uint8Array>, private codec: ImageCodec, private presets: Record<string, BrushPreset>) {}

  entry(name: unknown): Uint8Array {
    const f = typeof name === 'string' ? this.files[name] : undefined;
    if (!f) throw new ProjectFormatError(`Falta ${String(name)} en el proyecto`);
    return f;
  }
  f32(name: unknown) { const b = this.entry(name); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); }
  f64(name: unknown) { const b = this.entry(name); return new Float64Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); }
  u8c(name: unknown) { const b = this.entry(name); return new Uint8ClampedArray(b.slice()); }
  preset(id: unknown): BrushPreset {
    const p = typeof id === 'string' ? this.presets[id] : undefined;
    if (!p) throw new ProjectFormatError(`Falta el pincel ${String(id)}`);
    return p;
  }
  /** Primera pasada: pide todas las imágenes; segunda: las usa ya decodificadas. */
  want(name: unknown) { const n = String(name); if (!this.images.has(n)) this.images.set(n, this.codec.decode(this.entry(n)).then(i => { this.resolved.set(n, i); return i; })); }
  async loadImages() { await Promise.all(this.images.values()); }
  image(name: unknown): CanvasImageSource { const i = this.resolved.get(String(name)); if (!i) throw new ProjectFormatError(`Imagen ${String(name)} no válida`); return i; }
}

function collectImages(r: Reader, v: unknown) {
  if (!v || typeof v !== 'object') return;
  const o = v as J;
  if ((o.type === 'mask' && typeof o.canvas === 'string')) r.want(o.canvas);
  if (o.kind === 'bitmap' && typeof o.image === 'string') r.want(o.image);
  for (const x of Object.values(o)) if (x && typeof x === 'object') collectImages(r, x);
}

function readSelection(r: Reader, v: unknown): Selection | null {
  if (!v || typeof v !== 'object' || !Array.isArray((v as J).ops)) return null;
  return {
    ops: ((v as J).ops as J[]).map(op => ({ mode: (['add', 'subtract', 'intersect', 'replace'].includes(op.mode as string) ? op.mode : 'add') as Selection['ops'][number]['mode'], shape: readShape(r, op.shape as J) })),
  };
}

function readShape(r: Reader, s: J): SelShape {
  const m = mat(s.m) ?? undefined;
  switch (s.type) {
    case 'rect': return { type: 'rect', x: num(s.x), y: num(s.y), w: num(s.w), h: num(s.h), m };
    case 'ellipse': return { type: 'ellipse', cx: num(s.cx), cy: num(s.cy), rx: num(s.rx), ry: num(s.ry), m };
    case 'poly': return { type: 'poly', pts: Array.isArray(s.pts) ? (s.pts as unknown[]).map(x => num(x)) : [], m };
    case 'mask': return { type: 'mask', x: num(s.x), y: num(s.y), w: num(s.w), h: num(s.h), canvas: r.image(s.canvas), m };
    case 'sel': return { type: 'sel', sel: readSelection(r, s.sel) ?? { ops: [] } };
    default: throw new ProjectFormatError(`Selección desconocida: ${String(s.type)}`);
  }
}

function readStroke(r: Reader, s: J): FinishedStroke {
  const pts = r.f64(s.points);
  const points = [];
  for (let i = 0; i + 5 < pts.length; i += 6) points.push({ x: pts[i], y: pts[i + 1], pressure: pts[i + 2], tiltX: pts[i + 3], tiltY: pts[i + 4], t: pts[i + 5] });
  const sets: DabSet[] = (Array.isArray(s.sets) ? s.sets as J[] : []).map(set => {
    const dabs = r.f32(set.dabs);
    const out: DabSet = { dabs, count: Math.min(num(set.count), Math.floor(dabs.length / DAB_STRIDE)) };
    if (set.colors) out.colors = r.u8c(set.colors);
    return out;
  });
  const mirrors = Array.isArray(s.mirrors) ? (s.mirrors as unknown[]).map(mat).filter((m): m is Mat => !!m) : undefined;
  return {
    preset: r.preset(s.preset), color: str(s.color, '#000000'), tool: s.tool === 'eraser' ? 'eraser' : 'brush', seed: num(s.seed) >>> 0,
    sets, points, total: num(s.total), mirrors: mirrors?.length ? mirrors : undefined, bounds: aabb(s.bounds),
  };
}

function readItem(r: Reader, o: J): Item {
  const base = { id: Math.max(1, Math.floor(num(o.id, 1))), m: mat(o.m), clip: readSelection(r, o.clip), local: aabb(o.local), bounds: aabb(o.bounds) };
  switch (o.kind) {
    case 'stroke': return { ...base, kind: 'stroke', stroke: readStroke(r, o.stroke as J) };
    case 'shape': return { ...base, kind: 'shape', shape: o.shape as never };
    case 'gradient': return { ...base, kind: 'gradient', grad: o.grad as never };
    case 'bitmap': return { ...base, kind: 'bitmap', image: r.image(o.image), x: num(o.x), y: num(o.y), w: num(o.w), h: num(o.h) };
    case 'clear': return { ...base, kind: 'clear' };
    case 'group': return { ...base, kind: 'group', opacity: num(o.opacity, 1), blend: blend(o.blend), items: (Array.isArray(o.items) ? o.items as J[] : []).map(i => readItem(r, i)) };
    default: throw new ProjectFormatError(`Elemento desconocido: ${String(o.kind)}`);
  }
}

function unzip(bytes: Uint8Array, filter?: (name: string) => boolean): Record<string, Uint8Array> {
  try { return unzipSync(bytes, filter ? { filter: f => filter(f.name) } : undefined); }
  catch { throw new ProjectFormatError('El archivo no es un proyecto de YOSADRAW o está dañado'); }
}

function parseProject(files: Record<string, Uint8Array>): J {
  const mime = files.mimetype ? strFromU8(files.mimetype) : '';
  if (mime !== PROJECT_MIME || !files['project.json']) throw new ProjectFormatError('El archivo no es un proyecto de YOSADRAW');
  let p: J;
  try { p = JSON.parse(strFromU8(files['project.json'])); } catch { throw new ProjectFormatError('project.json dañado'); }
  if (p.format !== FORMAT_ID) throw new ProjectFormatError('Formato de proyecto desconocido');
  if (num(p.version) > FORMAT_VERSION) throw new ProjectFormatError('El proyecto se creó con una versión más nueva de YOSADRAW');
  return p;
}

export function normalizeMeta(v: unknown, fallbackId = ''): ProjectMeta {
  const o = (v ?? {}) as J;
  const profile = (['srgb', 'p3', 'gray'].includes(o.profile as string) ? o.profile : 'srgb') as DocProfile;
  const bg = o.background === null ? null : typeof o.background === 'string' && /^#[0-9a-f]{6}$/i.test(o.background) ? o.background : '#ffffff';
  const now = Date.now();
  return {
    id: str(o.id, fallbackId) || fallbackId,
    name: str(o.name, 'Sin título').slice(0, 120) || 'Sin título',
    width: Math.round(num(o.width, 2048)), height: Math.round(num(o.height, 2048)),
    dpi: Math.min(2400, Math.max(1, Math.round(num(o.dpi, 300)))),
    background: bg, profile,
    created: num(o.created, now), modified: num(o.modified, now),
    layers: num(o.layers, 1), source: str(o.source, 'yosa'), rev: num(o.rev, 0), app: str(o.app, ''),
  };
}

/** Lee sólo los metadatos y la miniatura (rápido: no decodifica capas). */
export function readProjectInfo(bytes: Uint8Array): { meta: ProjectMeta; thumb: Uint8Array | null } {
  const files = unzip(bytes, n => n === 'mimetype' || n === 'project.json' || n === 'thumb.png');
  const p = parseProject(files);
  return { meta: normalizeMeta(p.meta), thumb: files['thumb.png'] ?? null };
}

/** Abre un archivo .yosa completo. */
export async function readProject(bytes: Uint8Array, codec: ImageCodec): Promise<ProjectFile> {
  const files = unzip(bytes);
  const p = parseProject(files);
  const meta = normalizeMeta(p.meta);
  if (meta.width < MIN_DOC_SIDE || meta.height < MIN_DOC_SIDE || meta.width > MAX_DOC_SIDE || meta.height > MAX_DOC_SIDE) throw new ProjectFormatError(`Tamaño de lienzo no válido (${meta.width} × ${meta.height})`);
  const d = (p.document ?? {}) as J;
  const r = new Reader(files, codec, (p.presets ?? {}) as Record<string, BrushPreset>);
  collectImages(r, d.layers);
  collectImages(r, d.selection);
  await r.loadImages();
  const settings: DocSettings = { background: meta.background, dpi: meta.dpi, profile: meta.profile };
  const doc = new Document(meta.width, meta.height, settings);
  const layers: Layer[] = (Array.isArray(d.layers) ? d.layers as J[] : []).map((l, i) => ({
    id: str(l.id, `L${i + 1}_r`), name: str(l.name, `Capa ${i + 1}`), visible: l.visible !== false, locked: l.locked === true,
    opacity: Math.min(1, Math.max(0, num(l.opacity, 1))), blend: blend(l.blend),
    items: (Array.isArray(l.items) ? l.items as J[] : []).map(it => readItem(r, it)),
  }));
  const counters = (d.counters ?? {}) as J;
  doc.restore(layers, str(d.activeId), readSelection(r, d.selection), { nextItem: num(counters.nextItem, 1), nextLayer: num(counters.nextLayer, 1) });
  const v = p.view as J | null;
  const view = v && num(v.scale) > 0 ? { scale: num(v.scale), rotation: num(v.rotation), x: num(v.x), y: num(v.y) } : null;
  return { meta: { ...meta, layers: layers.length }, doc, view, thumb: files['thumb.png'] ?? null };
}

/** Códec de imágenes del navegador: PNG sin pérdidas y vuelta a un canvas editable. */
export const browserImageCodec: ImageCodec = {
  async encode(img) {
    const src = img as HTMLCanvasElement;
    const w = (src as { width: number }).width, h = (src as { height: number }).height;
    let canvas: HTMLCanvasElement = src;
    if (!(src instanceof HTMLCanvasElement)) {
      canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d')!.drawImage(img, 0, 0);
    }
    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/png'));
    if (!blob) throw new Error('No se pudo codificar una imagen del proyecto');
    return new Uint8Array(await blob.arrayBuffer());
  },
  async decode(png) {
    const bmp = await createImageBitmap(new Blob([png as Uint8Array<ArrayBuffer>], { type: 'image/png' }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    c.getContext('2d')!.drawImage(bmp, 0, 0);
    bmp.close();
    return c;
  },
};

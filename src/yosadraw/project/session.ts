import { Document, type DocProfile } from '../doc/Document';
import type { CanvasEngine } from '../engine';
import { blendOp, ItemRenderer } from '../doc/ItemRenderer';
import type { Mat } from '../engine/ViewTransform';
import { Emitter } from '../engine/Emitter';
import { browserImageCodec, MAX_DOC_PIXELS, MAX_DOC_SIDE, MIN_DOC_SIDE, normalizeMeta, readProject, writeProject, type ImageCodec, type ProjectMeta } from './format';
import { ConflictError, newId, type ProjectEntry, type ProjectLibrary } from './library';

/** Versión de la app que escribe los proyectos. */
export const APP_VERSION = '1.1.1';

export interface NewProjectSpec {
  name: string;
  width: number;
  height: number;
  dpi: number;
  background: string | null;
  profile: DocProfile;
}

export interface SessionState {
  entry: ProjectEntry | null;
  dirty: boolean;
  saving: boolean;
  /** Última copia de recuperación escrita (ms) o 0. */
  recoveredAt: number;
  lastSaved: number;
}

export interface SessionPrefs {
  /** Guardar en el proyecto automáticamente (además de la copia de recuperación). */
  autoSave: boolean;
  /** Minutos entre guardados automáticos. */
  autoSaveMinutes: number;
}

export const DEFAULT_SESSION_PREFS: SessionPrefs = { autoSave: true, autoSaveMinutes: 2 };

/** Comprueba un tamaño de lienzo nuevo. Devuelve el problema o null. */
export function docSizeProblem(w: number, h: number): string | null {
  if (!Number.isFinite(w) || !Number.isFinite(h)) return 'Escribe el ancho y el alto en píxeles.';
  if (w < MIN_DOC_SIDE || h < MIN_DOC_SIDE) return `El lienzo debe medir al menos ${MIN_DOC_SIDE} px por lado.`;
  if (w > MAX_DOC_SIDE || h > MAX_DOC_SIDE) return `Máximo ${MAX_DOC_SIDE} px por lado.`;
  if (w * h > MAX_DOC_PIXELS) return `Máximo ${MAX_DOC_PIXELS / 1e6} megapíxeles (${w} × ${h} son ${(w * h / 1e6).toFixed(1)} MP).`;
  return null;
}

/**
 * Une el motor de dibujo con la galería: abre, crea, guarda, «guardar como»,
 * guardado automático y copias de recuperación. El motor no sabe nada de
 * archivos; la sesión sólo lee y sustituye su documento.
 */
export class ProjectSession extends Emitter<{ state: SessionState }> {
  entry: ProjectEntry | null = null;
  prefs: SessionPrefs = { ...DEFAULT_SESSION_PREFS };
  private savedRevision = 0;
  private recoveryRevision = -1;
  private lastChange = 0;
  private lastRecovery = 0;
  private lastSave = 0;
  /** Fecha del último guardado real (para mostrarla). */
  private savedAt = 0;
  private saving: Promise<unknown> | null = null;
  private imageCache = new WeakMap<object, Uint8Array>();
  private timer = 0;

  constructor(readonly engine: CanvasEngine, readonly library: ProjectLibrary, private codec: ImageCodec = browserImageCodec, private notify: (m: string, k?: 'info' | 'ok' | 'error') => void = () => undefined) {
    super();
    engine.on('history', () => { this.lastChange = performance.now(); this.changed(); });
    this.timer = window.setInterval(() => void this.tick(), 3000);
  }

  get dirty() { return !!this.entry && this.engine.revision !== this.savedRevision; }
  get state(): SessionState { return { entry: this.entry, dirty: this.dirty, saving: !!this.saving, recoveredAt: this.lastRecovery, lastSaved: this.savedAt }; }
  private changed() { this.emit('state', this.state); }
  /** Vuelve a avisar del estado (tras renombrar desde fuera). */
  refresh() { if (this.entry) this.entry = this.library.get(this.entry.id) ?? this.entry; this.changed(); }

  // ---------------------------------------------------------------- abrir y crear

  /** Abre un proyecto de la galería; `recovery` usa la copia de recuperación (cambios sin guardar). */
  async open(id: string, o: { recovery?: boolean } = {}) {
    const e = this.library.get(id);
    if (!e) throw new Error('El proyecto no existe');
    const bytes = o.recovery ? await this.library.readRecovery(id) : await this.library.read(id);
    if (!bytes) throw new Error('No hay copia de recuperación');
    const file = await readProject(bytes, this.codec);
    this.load(file.doc, e);
    if (o.recovery) { this.savedRevision = -1; this.recoveryRevision = this.engine.revision; }
    await this.library.update(id, { opened: Date.now() });
    this.changed();
  }

  /** Carga una versión anterior en el proyecto abierto (queda como cambios sin guardar). */
  async openVersion(id: string, key: string) {
    const e = this.library.get(id);
    if (!e) throw new Error('El proyecto no existe');
    const file = await readProject(await this.library.readVersion(key), this.codec);
    this.load(file.doc, e);
    this.savedRevision = -1;
    this.changed();
  }

  /** La app lo usa para que la herramienta activa cierre lo pendiente antes de cambiar de documento. */
  beforeLoad: (() => void) | null = null;

  private load(doc: Document, e: ProjectEntry) {
    this.beforeLoad?.();
    // Primero el proyecto y luego el documento: quien escucha «document» ya ve el nombre correcto.
    this.entry = e;
    this.engine.loadDocument(doc);
    this.savedRevision = this.engine.revision;
    this.recoveryRevision = this.engine.revision;
    // El reloj del guardado automático empieza al abrir (no salta nada más hacer el primer trazo).
    this.lastSave = Date.now();
    this.savedAt = e.modified;
    this.lastVersion = 0;
    this.lastRecovery = 0;
    this.imageCache = new WeakMap();
  }

  async create(spec: NewProjectSpec, folder: string | null = null): Promise<ProjectEntry> {
    const problem = docSizeProblem(spec.width, spec.height);
    if (problem) throw new Error(problem);
    const doc = new Document(Math.round(spec.width), Math.round(spec.height), { background: spec.background, dpi: spec.dpi, profile: spec.profile });
    const name = this.library.uniqueName(spec.name.trim() || 'Sin título');
    const meta = normalizeMeta({ id: newId(), name, width: doc.width, height: doc.height, dpi: spec.dpi, background: spec.background, profile: spec.profile, source: 'yosa', app: APP_VERSION });
    const e = await this.library.create(meta, m => this.serialize(doc, m), { folder });
    this.load(doc, e);
    this.changed();
    return e;
  }

  /** Proyecto nuevo a partir de una imagen (PNG, JPEG, WebP): la imagen queda como capa editable. */
  async createFromImage(file: File, folder: string | null = null, open = true): Promise<ProjectEntry> {
    const bmp = await createImageBitmap(file, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }).catch(() => { throw new Error('No se pudo leer la imagen'); });
    let w = bmp.width, h = bmp.height;
    const k = Math.min(1, MAX_DOC_SIDE / Math.max(w, h), Math.sqrt(MAX_DOC_PIXELS / (w * h)));
    w = Math.max(MIN_DOC_SIDE, Math.round(w * k)); h = Math.max(MIN_DOC_SIDE, Math.round(h * k));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const source = (file.type.split('/')[1] || file.name.split('.').pop() || 'imagen').toLowerCase().replace('jpg', 'jpeg');
    const doc = new Document(w, h, { background: null, dpi: 72, profile: 'srgb' });
    doc.layers[0].name = file.name.replace(/\.[^.]+$/, '').slice(0, 60) || 'Imagen';
    doc.layers[0].items.push(doc.item({ kind: 'bitmap', image: c, x: 0, y: 0, w, h }));
    const name = this.library.uniqueName(file.name.replace(/\.[^.]+$/, '') || 'Imagen');
    const meta = normalizeMeta({ id: newId(), name, width: w, height: h, dpi: 72, background: null, profile: 'srgb', source, app: APP_VERSION });
    const e = await this.library.create(meta, m => this.serialize(doc, m), { folder });
    if (open) { this.load(doc, e); this.changed(); }
    return e;
  }

  /** Cierra el proyecto (la galería ya decidió qué hacer con los cambios). */
  close() {
    this.entry = null;
    this.changed();
  }

  // ---------------------------------------------------------------- guardar

  /** Cuánto tardó la última serialización (ms): sirve para espaciar las copias automáticas. */
  private lastSerializeMs = 0;

  private async serialize(doc: Document, meta: ProjectMeta, withThumb = true) {
    const t = performance.now();
    // La miniatura repinta todo el documento: sólo hace falta al guardar, no en la copia de recuperación.
    const thumb = withThumb ? await this.thumbnail(doc) : null;
    const bytes = await writeProject(doc, { ...meta, width: doc.width, height: doc.height, layers: doc.layers.length }, { codec: this.codec, cache: this.imageCache, thumb });
    this.lastSerializeMs = performance.now() - t;
    return { bytes, thumb, meta: { layers: doc.layers.length } };
  }

  /** Guarda en el proyecto abierto. Si otra ventana lo guardó antes, lanza ConflictError (salvo `force`). */
  /** Último momento en que se conservó una versión (los guardados automáticos crean como mucho una cada 15 min). */
  private lastVersion = 0;

  async save(force = false, auto = false): Promise<boolean> {
    const e = this.entry;
    if (!e) return false;
    if (this.saving) await this.saving.catch(() => undefined);
    const revAtStart = this.engine.revision;
    const doc = this.engine.doc;
    const keepVersion = !auto || Date.now() - this.lastVersion > 15 * 60_000;
    if (keepVersion) this.lastVersion = Date.now();
    const job = this.library.save(e.id, e.rev, m => this.serialize(doc, m), force, keepVersion);
    this.saving = job;
    this.changed();
    try {
      this.entry = await job;
      this.savedRevision = revAtStart;
      this.recoveryRevision = revAtStart;
      this.lastSave = this.savedAt = Date.now();
      return true;
    } finally {
      this.saving = null;
      this.changed();
    }
  }

  /** Guarda una copia con otro nombre y sigue trabajando en la copia (el original no cambia). */
  async saveAs(name: string): Promise<ProjectEntry> {
    const cur = this.entry;
    const doc = this.engine.doc;
    const revAtStart = this.engine.revision;
    const meta = normalizeMeta({
      id: newId(), name: this.library.uniqueName(name.trim() || 'Sin título'), width: doc.width, height: doc.height,
      dpi: doc.settings.dpi, background: doc.settings.background, profile: doc.settings.profile, source: cur?.source ?? 'yosa', app: APP_VERSION,
    });
    const e = await this.library.create(meta, m => this.serialize(doc, m), { folder: cur?.folder ?? null });
    // La recuperación pendiente era del original: ya no hace falta.
    if (cur) await this.library.discardRecovery(cur.id);
    this.entry = e;
    this.savedRevision = revAtStart;
    this.recoveryRevision = revAtStart;
    this.lastSave = this.savedAt = Date.now();
    this.changed();
    return e;
  }

  /** Descarta los cambios: borra la copia de recuperación (el proyecto guardado no cambia). */
  async discardChanges() {
    if (this.entry) await this.library.discardRecovery(this.entry.id);
    this.savedRevision = this.engine.revision;
    this.changed();
  }

  // ---------------------------------------------------------------- automático

  /** Copia de recuperación inmediata (al pasar la app a segundo plano o cerrar). */
  private recovering: Promise<void> | null = null;
  flushRecovery(): Promise<void> {
    // Nunca dos copias a la vez (pausa de Android + temporizador): la segunda espera a la primera.
    if (this.recovering) return this.recovering;
    this.recovering = this.writeRecoveryNow().finally(() => { this.recovering = null; });
    return this.recovering;
  }
  private async writeRecoveryNow() {
    const e = this.entry;
    if (!e || !this.dirty || this.engine.revision === this.recoveryRevision || this.engine.isDrawing) return;
    const rev = this.engine.revision;
    const { bytes } = await this.serialize(this.engine.doc, { ...e, modified: Date.now() }, false);
    if (this.entry?.id !== e.id) return;
    await this.library.writeRecovery(e.id, bytes);
    this.recoveryRevision = rev;
    this.lastRecovery = Date.now();
    this.changed();
  }

  private busy = false;
  private async tick() {
    if (this.busy || !this.entry || !this.dirty || this.saving || this.engine.isDrawing) return;
    const idle = performance.now() - this.lastChange;
    if (idle < 1500) return; // no interrumpir mientras se dibuja seguido
    this.busy = true;
    try {
      const now = Date.now();
      if (this.prefs.autoSave && now - this.lastSave > this.prefs.autoSaveMinutes * 60_000 && this.savedRevision !== -1) {
        await this.save(false, true);
      } else if (this.engine.revision !== this.recoveryRevision && now - this.lastRecovery > Math.max(12_000, this.lastSerializeMs * 25)) {
        await this.flushRecovery();
      }
    } catch (err) {
      if (err instanceof ConflictError) { this.prefs.autoSave = false; this.notify('Guardado automático en pausa: el proyecto cambió en otra ventana. Usa Guardar para decidir.', 'error'); }
      else this.notify(`No se pudo guardar automáticamente: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally { this.busy = false; }
  }

  // ---------------------------------------------------------------- miniaturas

  /** PNG de hasta 640 px con las capas visibles sobre el papel (o transparente). */
  async thumbnail(doc: Document = this.engine.doc, max = 640): Promise<Uint8Array> {
    const k = Math.min(1, max / Math.max(doc.width, doc.height));
    const W = Math.max(1, Math.round(doc.width * k)), H = Math.max(1, Math.round(doc.height * k));
    // Lo más barato: componer lo que ya está pintado en pantalla (sin repintar un solo sello).
    if (this.engine.doc === doc) { const snap = this.engine.snapshotFromView(W, H); if (snap) return browserImageCodec.encode(snap); }
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d')!;
    if (doc.settings.background) { g.fillStyle = doc.settings.background; g.fillRect(0, 0, W, H); }
    // Si no, se rasteriza elemento a elemento cediendo el hilo cada ~10 ms: guardar no congela la interfaz.
    const renderer = new ItemRenderer(this.engine.painter, doc.width, doc.height);
    const tmp = document.createElement('canvas');
    tmp.width = W; tmp.height = H;
    const t = tmp.getContext('2d')!;
    const V: Mat = [k, 0, 0, k, 0, 0];
    let slice = performance.now();
    for (const l of doc.layers) {
      if (!l.visible || !l.items.length) continue;
      t.setTransform(1, 0, 0, 1, 0, 0);
      t.clearRect(0, 0, W, H);
      for (const it of l.items) {
        renderer.renderItem(t, it, V, 1);
        if (performance.now() - slice > 10) { await new Promise(r => setTimeout(r, 0)); slice = performance.now(); }
      }
      g.globalAlpha = l.opacity;
      g.globalCompositeOperation = blendOp(l.blend);
      g.drawImage(tmp, 0, 0);
    }
    return browserImageCodec.encode(c);
  }

  dispose() { clearInterval(this.timer); }
}

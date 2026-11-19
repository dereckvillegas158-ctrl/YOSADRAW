import { strFromU8, strToU8, type Zippable } from 'fflate';
import { unzipAsync, zipAsync } from './zip';
import { Emitter } from '../engine/Emitter';
import { normalizeMeta, ProjectFormatError, readProjectInfo, type ProjectMeta } from './format';
import type { BlobStore } from './store';

export interface ProjectEntry extends ProjectMeta {
  favorite: boolean;
  folder: string | null;
  /** Cuándo se envió a la papelera (null = no está en la papelera). */
  trashed: number | null;
  /** Última vez que se abrió. */
  opened: number;
  /** Tamaño del archivo .yosa en bytes. */
  size: number;
  /** Hay una copia de recuperación más nueva que lo guardado (cambios sin guardar). */
  recovery: number | null;
}

export interface Folder { id: string; name: string; created: number }
export interface VersionInfo { key: string; time: number; size: number }

/** Otra ventana o pestaña guardó el proyecto después de abrirlo: no se sobrescribe sin preguntar. */
export class ConflictError extends Error {
  constructor(readonly current: ProjectEntry) { super(`«${current.name}» se guardó desde otra ventana después de abrirlo`); }
}

export const MAX_VERSIONS = 15;
export const TRASH_DAYS = 30;
const INDEX_KEY = 'meta/index.json';
const DAY = 86_400_000;

export const newId = (prefix = 'y') => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const pKey = (id: string) => `p/${id}.yosa`, tKey = (id: string) => `t/${id}.png`, rKey = (id: string) => `r/${id}.yosa`;
const vPrefix = (id: string) => `v/${id}~`;

/** Cambia metadatos dentro de un .yosa sin decodificar sus capas (renombrar, duplicar, importar). */
export async function patchProjectMeta(bytes: Uint8Array, patch: Partial<ProjectMeta>): Promise<Uint8Array> {
  let files: Record<string, Uint8Array>;
  try { files = await unzipAsync(bytes); } catch { throw new ProjectFormatError('El proyecto está dañado'); }
  if (!files['project.json']) throw new ProjectFormatError('El proyecto está dañado');
  const p = JSON.parse(strFromU8(files['project.json']));
  p.meta = { ...p.meta, ...patch };
  const out: Zippable = {};
  out.mimetype = [files.mimetype, { level: 0 }];
  for (const [name, data] of Object.entries(files)) {
    if (name === 'mimetype') continue;
    out[name] = name === 'project.json' ? [strToU8(JSON.stringify(p)), { level: 6 }] : [data, { level: name.endsWith('.png') ? 0 : 1 }];
  }
  return zipAsync(out);
}

/**
 * Proyecto de vídeo portátil («recopilar medios»): añade al .yosa los archivos de
 * todos sus medios (`media/m/…`), que al abrirlo en otro equipo pasan a su almacén.
 * Los proxies no se incluyen (se pueden volver a crear).
 */
export async function collectMedia(bytes: Uint8Array, store: BlobStore): Promise<{ bytes: Uint8Array; count: number; missing: string[] }> {
  let files: Record<string, Uint8Array>;
  try { files = await unzipAsync(bytes); } catch { throw new ProjectFormatError('El proyecto está dañado'); }
  const p = JSON.parse(strFromU8(files['project.json']));
  const media = (p.document?.motion?.media ?? []) as { id: string; name: string; kind: string }[];
  if (!media.length) return { bytes, count: 0, missing: [] };
  const all = await store.list('m/');
  const out: Zippable = { mimetype: [files.mimetype, { level: 0 }] };
  for (const [name, data] of Object.entries(files)) if (name !== 'mimetype' && !name.startsWith('media/')) out[name] = [data, { level: name.endsWith('.png') || name.startsWith('audio/') ? 0 : 6 }];
  let count = 0;
  const missing: string[] = [];
  for (const m of media) {
    if (m.kind === 'drawing' || m.kind === 'anim') continue; // citan proyectos de la galería
    const keys = all.filter(k => (k === `m/${m.id}` || k.startsWith(`m/${m.id}.`)) && !k.endsWith('.proxy'));
    if (!keys.length) { missing.push(m.name); continue; }
    for (const k of keys) { const d = await store.get(k); if (d) { out[`media/${k}`] = [d, { level: 0 }]; count++; } }
  }
  return { bytes: await zipAsync(out), count, missing };
}

/**
 * Galería de proyectos sobre un `BlobStore`.
 * - Guardar nunca escribe a medias (el almacén es atómico) y antes conserva lo
 *   anterior como versión (hasta MAX_VERSIONS por proyecto).
 * - Cada guardado sube `rev`; si el proyecto cambió en el almacén desde que se
 *   abrió (otra pestaña o ventana), `save` lanza ConflictError en vez de sobrescribir.
 * - Borrar manda a la papelera (30 días); sólo «Eliminar definitivamente» borra.
 * - El índice se puede reconstruir: los metadatos viven también dentro de cada .yosa.
 */
export class ProjectLibrary extends Emitter<{ change: void }> {
  private projects = new Map<string, ProjectEntry>();
  folders: Folder[] = [];
  private queue: Promise<void> = Promise.resolve();

  private constructor(readonly store: BlobStore) { super(); }

  static async open(store: BlobStore): Promise<ProjectLibrary> {
    const lib = new ProjectLibrary(store);
    await lib.init();
    return lib;
  }

  // ---------------------------------------------------------------- índice

  private async init() {
    let index: { projects?: Record<string, unknown>; folders?: unknown } = {};
    try { const raw = await this.store.get(INDEX_KEY); if (raw) index = JSON.parse(strFromU8(raw)); } catch { index = {}; }
    if (Array.isArray(index.folders)) this.folders = (index.folders as Folder[]).filter(f => f && typeof f.id === 'string' && typeof f.name === 'string');
    for (const [id, v] of Object.entries(index.projects ?? {})) this.projects.set(id, this.entry(v, id));
    // Reconciliar con los archivos reales: proyectos sin índice (índice perdido o de otra versión) y entradas huérfanas.
    const files = new Set((await this.store.list('p/')).map(k => k.slice(2, -5)));
    let changed = false;
    for (const id of files) {
      if (this.projects.has(id)) continue;
      try {
        const bytes = await this.store.get(pKey(id));
        if (!bytes) continue;
        const info = readProjectInfo(bytes);
        this.projects.set(id, this.entry({ ...info.meta, id, size: bytes.length }, id));
        if (info.thumb && !(await this.store.get(tKey(id)))) await this.store.put(tKey(id), info.thumb);
        changed = true;
      } catch { /* archivo dañado: se ignora en la galería */ }
    }
    for (const id of [...this.projects.keys()]) if (!files.has(id)) { this.projects.delete(id); changed = true; }
    const rec = new Set((await this.store.list('r/')).map(k => k.slice(2, -5)));
    for (const e of this.projects.values()) {
      if (rec.has(e.id) && !e.recovery) { e.recovery = e.modified + 1; changed = true; }
      if (!rec.has(e.id) && e.recovery) { e.recovery = null; changed = true; }
    }
    // Papelera: lo que lleva más de 30 días se borra.
    const now = Date.now();
    for (const e of [...this.projects.values()]) if (e.trashed && now - e.trashed > TRASH_DAYS * DAY) { await this.purge(e.id); changed = true; }
    if (changed) await this.writeIndex();
  }

  private entry(v: unknown, id: string): ProjectEntry {
    const o = (v ?? {}) as Partial<ProjectEntry>;
    return {
      ...normalizeMeta(o, id), id,
      favorite: o.favorite === true, folder: typeof o.folder === 'string' ? o.folder : null,
      trashed: typeof o.trashed === 'number' ? o.trashed : null, opened: typeof o.opened === 'number' ? o.opened : 0,
      size: typeof o.size === 'number' ? o.size : 0, recovery: typeof o.recovery === 'number' ? o.recovery : null,
    };
  }

  /** Escribe el índice en orden (nunca dos escrituras a la vez). */
  private writeIndex(): Promise<void> {
    this.queue = this.queue.catch(() => undefined).then(() => this.store.put(INDEX_KEY, strToU8(JSON.stringify({ format: 'yosadraw-gallery', version: 1, projects: Object.fromEntries(this.projects), folders: this.folders }))));
    this.emit('change', undefined);
    return this.queue;
  }

  list(): ProjectEntry[] { return [...this.projects.values()]; }
  get(id: string): ProjectEntry | undefined { return this.projects.get(id); }
  get storeKind() { return this.store.kind; }
  /** Almacén de bloques (YOSADRAW MOTION guarda ahí sus medios, `m/<id>`). */
  get blobStore() { return this.store; }

  // ---------------------------------------------------------------- lectura

  async read(id: string): Promise<Uint8Array> {
    const b = await this.store.get(pKey(id));
    if (!b) throw new Error('El archivo del proyecto no existe');
    return b;
  }
  thumb(id: string) { return this.store.get(tKey(id)); }

  // ---------------------------------------------------------------- crear y guardar

  /** Crea un proyecto nuevo con su primer guardado. */
  async create(meta: ProjectMeta, build: (meta: ProjectMeta) => Promise<{ bytes: Uint8Array; thumb: Uint8Array | null }>, extra: Partial<ProjectEntry> = {}): Promise<ProjectEntry> {
    const now = Date.now();
    const m: ProjectMeta = { ...meta, id: meta.id || newId(), created: now, modified: now, rev: 1 };
    const { bytes, thumb } = await build(m);
    await this.store.put(pKey(m.id), bytes);
    if (thumb) await this.store.put(tKey(m.id), thumb);
    const e = this.entry({ ...m, size: bytes.length, opened: now, folder: null, ...extra }, m.id);
    this.projects.set(m.id, e);
    await this.writeIndex();
    return e;
  }

  /**
   * Guarda sobre el proyecto `id`. `baseRev` es la revisión que se abrió: si en el
   * almacén hay otra, lanza ConflictError (salvo `force`). Lo anterior pasa al historial.
   */
  async save(id: string, baseRev: number, build: (meta: ProjectMeta) => Promise<{ bytes: Uint8Array; thumb: Uint8Array | null; meta: Partial<ProjectMeta> }>, force = false, keepVersion = true): Promise<ProjectEntry> {
    const cur = this.projects.get(id);
    if (!cur) throw new Error('El proyecto ya no existe en la galería; usa «Guardar como».');
    // La revisión de verdad es la del archivo (otra pestaña o ventana pudo guardar sin que este índice lo sepa).
    const prev = await this.store.get(pKey(id));
    let stored = { rev: cur.rev, modified: cur.modified };
    let prevValid = false;
    if (prev) { try { const m = readProjectInfo(prev).meta; stored = { rev: m.rev, modified: m.modified }; prevValid = true; } catch { /* archivo dañado: se sustituye */ } }
    if ((stored.rev !== baseRev || cur.rev !== baseRev) && !force) throw new ConflictError({ ...cur, ...stored });
    // `keepVersion` = false en los guardados automáticos seguidos: no llenan el historial.
    // Al historial sólo pasa una copia legible (nunca se guarda como versión algo dañado).
    if (prev && prevValid && keepVersion) {
      await this.store.put(`${vPrefix(id)}${stored.modified}.yosa`, prev);
      await this.pruneVersions(id);
    }
    const now = Date.now();
    const base: ProjectMeta = { ...cur, rev: Math.max(stored.rev, cur.rev) + 1, modified: now };
    const { bytes, thumb, meta } = await build(base);
    await this.store.put(pKey(id), bytes);
    if (thumb) await this.store.put(tKey(id), thumb);
    await this.store.delete(rKey(id));
    const e: ProjectEntry = { ...cur, ...normalizeMeta({ ...base, ...meta, id, created: cur.created, rev: base.rev, modified: now }, id), size: bytes.length, recovery: null, trashed: null };
    this.projects.set(id, e);
    await this.writeIndex();
    return e;
  }

  // ---------------------------------------------------------------- recuperación (guardado temporal)

  async writeRecovery(id: string, bytes: Uint8Array) {
    const e = this.projects.get(id);
    if (!e) return;
    await this.store.put(rKey(id), bytes);
    e.recovery = Date.now();
    await this.writeIndex();
  }
  readRecovery(id: string) { return this.store.get(rKey(id)); }
  async discardRecovery(id: string) {
    await this.store.delete(rKey(id));
    const e = this.projects.get(id);
    if (e?.recovery) { e.recovery = null; await this.writeIndex(); }
  }

  // ---------------------------------------------------------------- historial de versiones

  async versions(id: string): Promise<VersionInfo[]> {
    const keys = await this.store.list(vPrefix(id));
    const out: VersionInfo[] = [];
    for (const key of keys) {
      const time = Number(key.slice(vPrefix(id).length, -5));
      if (Number.isFinite(time)) out.push({ key, time, size: 0 });
    }
    return out.sort((a, b) => b.time - a.time);
  }
  async readVersion(key: string) {
    if (!key.startsWith('v/')) throw new Error('Versión no válida');
    const b = await this.store.get(key);
    if (!b) throw new Error('La versión ya no existe');
    return b;
  }
  deleteVersion(key: string) { if (!key.startsWith('v/')) throw new Error('Versión no válida'); return this.store.delete(key); }
  private async pruneVersions(id: string) {
    const v = await this.versions(id);
    for (const old of v.slice(MAX_VERSIONS)) await this.store.delete(old.key);
  }

  // ---------------------------------------------------------------- gestión

  async rename(id: string, name: string) {
    const e = this.projects.get(id);
    name = name.trim().slice(0, 120);
    if (!e || !name || name === e.name) return;
    await this.store.put(pKey(id), await patchProjectMeta(await this.read(id), { name }));
    e.name = name;
    await this.writeIndex();
  }

  /** Copia independiente (nuevo identificador; no hereda historial ni recuperación). */
  async duplicate(id: string, name?: string): Promise<ProjectEntry> {
    const e = this.projects.get(id);
    if (!e) throw new Error('El proyecto no existe');
    const copyName = name ?? this.uniqueName(`${e.name} copia`);
    const thumb = await this.thumb(id);
    const src = await this.read(id);
    return this.create({ ...e, id: newId(), name: copyName }, async m => ({ bytes: await patchProjectMeta(src, { id: m.id, name: m.name, created: m.created, modified: m.modified, rev: m.rev }), thumb }), { folder: e.folder, favorite: false });
  }

  /** Importa un archivo .yosa como proyecto nuevo (nunca sustituye a uno existente). */
  async importFile(bytes: Uint8Array, folder: string | null = null): Promise<ProjectEntry> {
    const info = readProjectInfo(bytes);
    return this.create({ ...info.meta, id: newId(), name: this.uniqueName(info.meta.name) }, async m => ({ bytes: await patchProjectMeta(bytes, { id: m.id, name: m.name, created: m.created, modified: m.modified, rev: m.rev }), thumb: info.thumb }), { folder });
  }

  /** Nombre que no repite el de otro proyecto: «Dibujo», «Dibujo (2)»… */
  uniqueName(name: string, except?: string) {
    const taken = new Set(this.list().filter(e => e.id !== except && !e.trashed).map(e => e.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    const base = name.replace(/ \(\d+\)$/, '');
    for (let n = 2; ; n++) if (!taken.has(`${base} (${n})`.toLowerCase())) return `${base} (${n})`;
  }

  async update(id: string, patch: Partial<Pick<ProjectEntry, 'favorite' | 'folder' | 'opened'>>) {
    const e = this.projects.get(id);
    if (!e) return;
    Object.assign(e, patch);
    await this.writeIndex();
  }

  async trash(id: string) { const e = this.projects.get(id); if (e) { e.trashed = Date.now(); await this.writeIndex(); } }
  async restore(id: string) { const e = this.projects.get(id); if (e) { e.trashed = null; await this.writeIndex(); } }

  /** Borra para siempre el proyecto, su miniatura, sus versiones y su recuperación. */
  async deleteForever(id: string) { await this.purge(id); await this.writeIndex(); }
  async emptyTrash() { for (const e of this.list()) if (e.trashed) await this.purge(e.id); await this.writeIndex(); }
  private async purge(id: string) {
    for (const v of await this.versions(id)) await this.store.delete(v.key);
    await this.store.delete(rKey(id));
    await this.store.delete(tKey(id));
    await this.store.delete(pKey(id));
    this.projects.delete(id);
  }

  // ---------------------------------------------------------------- carpetas

  async createFolder(name: string): Promise<Folder> {
    const f = { id: newId('f'), name: name.trim().slice(0, 80) || 'Carpeta', created: Date.now() };
    this.folders.push(f);
    await this.writeIndex();
    return f;
  }
  async renameFolder(id: string, name: string) { const f = this.folders.find(x => x.id === id); if (f && name.trim()) { f.name = name.trim().slice(0, 80); await this.writeIndex(); } }
  /** Borra la carpeta; sus proyectos vuelven a «Todos» (no se borran). */
  async deleteFolder(id: string) {
    this.folders = this.folders.filter(f => f.id !== id);
    for (const e of this.projects.values()) if (e.folder === id) e.folder = null;
    await this.writeIndex();
  }
}

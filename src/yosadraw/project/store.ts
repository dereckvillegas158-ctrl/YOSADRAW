import { desktopBridge } from '../brush/storage';

/**
 * Almacén de bloques binarios con claves «carpeta/nombre». Toda escritura es
 * atómica: o queda el contenido nuevo completo o el anterior (nunca a medias).
 *   p/<id>.yosa        proyecto guardado
 *   t/<id>.png         miniatura
 *   v/<id>~<ms>.yosa   versión anterior (historial)
 *   r/<id>.yosa        copia de recuperación (guardado temporal)
 *   meta/index.json    índice de la galería (se puede reconstruir desde p/)
 */
export interface BlobStore {
  readonly kind: 'desktop' | 'android' | 'browser' | 'memory';
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, data: Uint8Array): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
  /** Dónde están los datos (para mostrarlo en Información). */
  location(): Promise<string>;
}

export const KEY_RE = /^(p|t|v|r|meta)\/[A-Za-z0-9._~-]{1,140}$/;
function check(key: string) { if (!KEY_RE.test(key) || key.includes('..')) throw new Error(`Clave no válida: ${key}`); }

/** Escritorio (Electron) y Android: el puente nativo escribe en archivos con fsync + renombrado. */
class BridgeStore implements BlobStore {
  constructor(readonly kind: 'desktop' | 'android', private b: Required<Pick<NonNullable<ReturnType<typeof desktopBridge>>, 'storeGet' | 'storePut' | 'storeDelete' | 'storeList'>> & { storeLocation?: () => Promise<string> }) {}
  get(key: string) { check(key); return this.b.storeGet(key); }
  put(key: string, data: Uint8Array) { check(key); return this.b.storePut(key, data); }
  delete(key: string) { check(key); return this.b.storeDelete(key); }
  list(prefix: string) { return this.b.storeList(prefix); }
  async location() { return (await this.b.storeLocation?.()) ?? ''; }
}

/** Navegador: IndexedDB (cada `put` es una transacción: atómica). */
class IdbStore implements BlobStore {
  readonly kind = 'browser' as const;
  private db: Promise<IDBDatabase>;
  constructor(name = 'yosadraw-projects') {
    this.db = new Promise((res, rej) => {
      const r = indexedDB.open(name, 1);
      r.onupgradeneeded = () => r.result.createObjectStore('blobs');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error ?? new Error('IndexedDB no disponible'));
    });
    // Pide almacenamiento persistente para que el navegador no borre los proyectos por falta de espacio.
    void navigator.storage?.persist?.().catch(() => undefined);
  }
  private async tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.db;
    return new Promise((res, rej) => {
      const t = db.transaction('blobs', mode);
      const req = fn(t.objectStore('blobs'));
      t.oncomplete = () => res(req.result);
      t.onerror = () => rej(t.error ?? new Error('Error de almacenamiento'));
      t.onabort = () => rej(t.error ?? new Error('No hay espacio para guardar el proyecto'));
    });
  }
  async get(key: string) { check(key); const v = await this.tx('readonly', s => s.get(key)); return v instanceof Uint8Array ? v : v ? new Uint8Array(v as ArrayBuffer) : null; }
  async put(key: string, data: Uint8Array) { check(key); await this.tx('readwrite', s => s.put(data.slice(), key)); }
  async delete(key: string) { check(key); await this.tx('readwrite', s => s.delete(key)); }
  async list(prefix: string) { return (await this.tx('readonly', s => s.getAllKeys(IDBKeyRange.bound(prefix, `${prefix}￿`)))).map(String); }
  async location() { return 'almacenamiento del navegador (IndexedDB)'; }
}

/** En memoria (pruebas, o si el navegador bloquea el almacenamiento). */
export class MemoryBlobStore implements BlobStore {
  readonly kind = 'memory' as const;
  readonly map = new Map<string, Uint8Array>();
  async get(key: string) { check(key); return this.map.get(key)?.slice() ?? null; }
  async put(key: string, data: Uint8Array) { check(key); this.map.set(key, data.slice()); }
  async delete(key: string) { this.map.delete(key); }
  async list(prefix: string) { return [...this.map.keys()].filter(k => k.startsWith(prefix)).sort(); }
  async location() { return 'memoria (no se conserva al cerrar)'; }
}

export async function defaultBlobStore(): Promise<BlobStore> {
  const b = desktopBridge();
  if (b?.storeGet && b.storePut && b.storeDelete && b.storeList) {
    return new BridgeStore(b.platform === 'android' ? 'android' : 'desktop', { storeGet: b.storeGet, storePut: b.storePut, storeDelete: b.storeDelete, storeList: b.storeList, storeLocation: b.storeLocation });
  }
  try {
    const s = new IdbStore();
    await s.list('meta/');
    return s;
  } catch {
    return new MemoryBlobStore();
  }
}

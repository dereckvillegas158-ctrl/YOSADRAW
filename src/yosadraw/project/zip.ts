import { unzipSync, zipSync, type Zippable } from 'fflate';

/**
 * ZIP en un hilo aparte (Web Worker): guardar o abrir un proyecto grande no
 * congela la interfaz. Si no hay Worker (pruebas en Node) o el navegador no
 * deja arrancarlo (páginas file://, iframes aislados), se hace aquí mismo:
 * guardar nunca falla por culpa del worker.
 */
type Op = { op: 'zip'; files: Zippable } | { op: 'unzip'; bytes: Uint8Array };
type Pending = { op: Op; resolve: (v: unknown) => void; reject: (e: Error) => void };
let worker: Worker | null = null;
let broken = false;
/** El worker ya respondió alguna vez: desde entonces se pueden transferir búferes sin copiarlos. */
let workerOk = false;
let seq = 0;
const pending = new Map<number, Pending>();

function runSync(op: Op): unknown {
  return op.op === 'zip' ? { bytes: zipSync(op.files) } : { files: unzipSync(op.bytes) };
}

async function getWorker(): Promise<Worker | null> {
  if (broken || typeof Worker === 'undefined' || typeof window === 'undefined') return null;
  if (worker) return worker;
  try {
    const { default: ZipWorker } = await import('./zip.worker?worker&inline');
    worker = new ZipWorker();
    worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; error?: string }>) => {
      workerOk = true;
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data); else p.reject(new Error(e.data.error ?? 'Error al comprimir'));
    };
    // El worker no pudo cargarse: se marca roto y lo pendiente se hace en este hilo.
    worker.onerror = () => {
      broken = true;
      worker = null;
      for (const [id, p] of pending) { pending.delete(id); try { p.resolve(runSync(p.op)); } catch (err) { p.reject(err instanceof Error ? err : new Error(String(err))); } }
    };
    return worker;
  } catch { broken = true; return null; }
}

async function run<T>(op: Op, transfer: Transferable[] = []): Promise<T> {
  const w = await getWorker();
  if (!w) return runSync(op) as T;
  return new Promise<T>((resolve, reject) => {
    const id = ++seq;
    // Sin transferir si el worker podría fallar al arrancar: haría falta el original para reintentar.
    pending.set(id, { op, resolve: resolve as (v: unknown) => void, reject });
    try { w.postMessage({ ...op, id }, transfer); } catch (err) { pending.delete(id); try { resolve(runSync(op) as T); } catch { reject(err as Error); } }
  });
}

/** `transfer`: búferes que se pueden ceder al hilo una vez se sabe que el worker funciona. */
export async function zipAsync(files: Zippable, transfer: ArrayBuffer[] = []): Promise<Uint8Array> {
  return (await run<{ bytes: Uint8Array }>({ op: 'zip', files }, workerOk ? transfer : [])).bytes;
}

export async function unzipAsync(bytes: Uint8Array): Promise<Record<string, Uint8Array>> {
  return (await run<{ files: Record<string, Uint8Array> }>({ op: 'unzip', bytes })).files;
}

/// <reference lib="webworker" />
import { unzipSync, zipSync, type Zippable } from 'fflate';

/** Comprime y descomprime proyectos fuera del hilo de la interfaz. */
self.onmessage = (e: MessageEvent<{ id: number; op: 'zip' | 'unzip'; files?: Zippable; bytes?: Uint8Array }>) => {
  const { id, op } = e.data;
  try {
    if (op === 'zip') {
      const out = zipSync(e.data.files!);
      (self as unknown as Worker).postMessage({ id, ok: true, bytes: out }, [out.buffer]);
    } else {
      const files = unzipSync(e.data.bytes!);
      (self as unknown as Worker).postMessage({ id, ok: true, files }, Object.values(files).map(f => f.buffer));
    }
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};

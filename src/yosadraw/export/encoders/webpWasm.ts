import factory from '@jsquash/webp/codec/enc/webp_enc.js';
import wasmBase64 from '@jsquash/webp/codec/enc/webp_enc.wasm?base64';
import { defaultOptions } from '@jsquash/webp/meta.js';
import { initEmscriptenModule } from '@jsquash/webp/utils.js';

type Module = Awaited<ReturnType<typeof factory>>;
let mod: Promise<Module> | null = null;

/** libwebp (WebAssembly) incrustado: no depende de archivos sueltos ni del navegador. */
function load(): Promise<Module> {
  if (!mod) {
    mod = (async () => {
      const bin = atob(wasmBase64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const compiled = await WebAssembly.compile(bytes);
      // locateFile evita que libwebp resuelva su .wasm contra la URL blob: del worker (no se descarga nada).
      return initEmscriptenModule(factory, compiled, { locateFile: (p: string) => p }) as Promise<Module>;
    })();
  }
  return mod;
}

/**
 * WebP con libwebp: con pérdida (calidad 0..100) o sin pérdida real (VP8L).
 * `exact` conserva el color de los píxeles transparentes.
 */
export async function encodeWebP(rgba: Uint8ClampedArray, width: number, height: number, o: { quality: number; lossless: boolean }): Promise<Uint8Array> {
  const m = await load();
  const out = m.encode(rgba, width, height, { ...defaultOptions, quality: Math.round(o.quality * 100), lossless: o.lossless ? 1 : 0, exact: 1, method: o.lossless ? 4 : 4, alpha_quality: 100 });
  if (!out) throw new Error('libwebp no pudo codificar la imagen');
  return new Uint8Array(out);
}

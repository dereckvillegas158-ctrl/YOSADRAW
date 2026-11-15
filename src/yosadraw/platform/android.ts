import { Capacitor, registerPlugin } from '@capacitor/core';
import type { DesktopBridge } from '../brush/storage';

/** Plugin nativo (android/app/src/main/java/com/yosadraw/app/YosaFilesPlugin.java). */
interface YosaFiles {
  readText(o: { name: string }): Promise<{ data: string | null }>;
  writeText(o: { name: string; data: string }): Promise<void>;
  beginExport(): Promise<{ id: string }>;
  appendExport(o: { id: string; data: string }): Promise<void>;
  abortExport(o: { id: string }): Promise<void>;
  finishExport(o: { id: string; name: string; mime: string }): Promise<{ uri: string; path: string; name: string }>;
  open(o: { uri: string; mime: string }): Promise<void>;
  share(o: { uri: string; mime: string }): Promise<void>;
}

export const isAndroidApp = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', bmp: 'image/bmp',
  tif: 'image/tiff', tiff: 'image/tiff', psd: 'image/vnd.adobe.photoshop', pdf: 'application/pdf',
  zip: 'application/zip', json: 'application/json',
};
export const mimeOf = (name: string) => MIME[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';

/** Base64 de un trozo de bytes sin desbordar la pila (String.fromCharCode por bloques). */
function toBase64(bytes: Uint8Array) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as unknown as number[]);
  return btoa(s);
}

/**
 * Puente de Android con la misma forma que el de Electron, para que biblioteca,
 * preferencias y exportación usen el mismo camino que la app de escritorio.
 * Las rutas que devuelve `writeExport` son URIs content:// (para abrir o compartir).
 */
export function installAndroidBridge() {
  if (!isAndroidApp()) return;
  const files = registerPlugin<YosaFiles>('YosaFiles');
  const saved = new Map<string, { name: string; path: string }>();

  async function saveBytes(name: string, data: Uint8Array) {
    const { id } = await files.beginExport();
    try {
      // Trozos de 1,5 MB: el puente JS ↔ Java pasa cadenas y no conviene enviar decenas de MB de golpe.
      const CHUNK = 1536 * 1024;
      for (let i = 0; i < data.length; i += CHUNK) await files.appendExport({ id, data: toBase64(data.subarray(i, i + CHUNK)) });
      const r = await files.finishExport({ id, name, mime: mimeOf(name) });
      saved.set(r.uri, { name: r.name, path: r.path });
      return r;
    } catch (e) {
      void files.abortExport({ id }).catch(() => undefined);
      throw e instanceof Error ? e : new Error(String((e as { message?: string })?.message ?? e));
    }
  }

  const bridge: DesktopBridge = {
    platform: 'android',
    version: '1.0.0',
    loadLibrary: async () => (await files.readText({ name: 'library.json' })).data,
    saveLibrary: json => files.writeText({ name: 'library.json', data: json }),
    loadSettings: async () => (await files.readText({ name: 'settings.json' })).data,
    saveSettings: json => files.writeText({ name: 'settings.json', data: json }),
    exportFolder: async () => 'Imágenes/YOSADRAW',
    writeExport: async (_folder, name, data) => (await saveBytes(name, data)).uri,
    revealFile: uri => files.open({ uri, mime: mimeOf(saved.get(uri)?.name ?? '') }),
    shareFile: uri => files.share({ uri, mime: mimeOf(saved.get(uri)?.name ?? '') }),
    describe: uri => saved.get(uri) ?? { name: uri, path: uri },
    async exportFile(defaultName, content) {
      const r = await saveBytes(defaultName, new TextEncoder().encode(content));
      lastSaved = r.path;
      return true;
    },
    // El WebView abre el selector de archivos de Android con un <input type="file">.
    importFiles: () => new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file'; input.multiple = true; input.accept = '.json,application/json';
      input.style.display = 'none';
      input.addEventListener('change', async () => {
        const list = [...(input.files ?? [])];
        input.remove();
        resolve(await Promise.all(list.map(async f => ({ name: f.name, content: await f.text() }))));
      });
      document.body.append(input);
      input.click();
    }),
  };
  (globalThis as unknown as { yosadraw: DesktopBridge }).yosadraw = bridge;
  document.documentElement.classList.add('android');
}

let lastSaved = '';
/** Ruta visible del último archivo de texto guardado (pinceles exportados). */
export const lastSavedPath = () => lastSaved;

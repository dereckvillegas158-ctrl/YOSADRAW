import type { BrushPreset } from './BrushPreset';

export interface LibraryData {
  format: 'yosadraw-library';
  version: 1;
  presets: BrushPreset[];
  activeBrushId: string;
  activeEraserId: string;
  /** Pincel activo de cada herramienta de pincel. */
  slots?: Record<string, string>;
  /** Versión del juego de fábrica con que se guardó (para migrar). */
  factory?: number;
  color?: string;
}

/** Preferencias de la app: atajos, barra de herramientas, ajustes de cada herramienta, colores. */
export interface SettingsStorage {
  load(): Promise<Record<string, unknown> | null>;
  save(data: Record<string, unknown>): Promise<void>;
}

/** Dónde se guarda la biblioteca. La app de escritorio usa archivos; el navegador, localStorage. */
export interface LibraryStorage {
  readonly kind: 'desktop' | 'browser' | 'memory';
  load(): Promise<LibraryData | null>;
  save(data: LibraryData): Promise<void>;
}

/** Puente que expone el preload de Electron (desktop/preload.cjs). */
export interface DesktopBridge {
  platform: string;
  version: string;
  loadLibrary(): Promise<string | null>;
  saveLibrary(json: string): Promise<void>;
  loadSettings?(): Promise<string | null>;
  saveSettings?(json: string): Promise<void>;
  /** Exportación: carpeta por defecto/última, elegir carpeta, escribir y mostrar en el explorador. */
  exportFolder?(): Promise<string>;
  chooseFolder?(current: string): Promise<string | null>;
  writeExport?(folder: string, name: string, data: Uint8Array, overwrite: boolean): Promise<string>;
  revealFile?(path: string): Promise<void>;
  /** Android: compartir el archivo exportado con otra app. */
  shareFile?(path: string): Promise<void>;
  /** Android: nombre y ruta visibles de un archivo guardado (las rutas reales son URIs content://). */
  describe?(path: string): { name: string; path: string };
  exportFile(defaultName: string, content: string): Promise<boolean>;
  importFiles(): Promise<{ name: string; content: string }[]>;
}

export function desktopBridge(): DesktopBridge | null {
  return (globalThis as unknown as { yosadraw?: DesktopBridge }).yosadraw ?? null;
}

class DesktopStorage implements LibraryStorage {
  readonly kind = 'desktop' as const;
  constructor(private bridge: DesktopBridge) {}
  async load() { const s = await this.bridge.loadLibrary(); return s ? (JSON.parse(s) as LibraryData) : null; }
  async save(d: LibraryData) { await this.bridge.saveLibrary(JSON.stringify(d)); }
}

class BrowserStorage implements LibraryStorage {
  readonly kind = 'browser' as const;
  private key = 'yosadraw.library.v1';
  async load() {
    try { const s = localStorage.getItem(this.key); return s ? (JSON.parse(s) as LibraryData) : null; } catch { return null; }
  }
  async save(d: LibraryData) {
    try { localStorage.setItem(this.key, JSON.stringify(d)); }
    catch { throw new Error('El navegador no permite guardar más datos (espacio lleno o almacenamiento bloqueado).'); }
  }
}

export class MemoryStorage implements LibraryStorage {
  readonly kind = 'memory' as const;
  data: LibraryData | null = null;
  async load() { return this.data ? (JSON.parse(JSON.stringify(this.data)) as LibraryData) : null; }
  async save(d: LibraryData) { this.data = JSON.parse(JSON.stringify(d)); }
}

export function defaultStorage(): LibraryStorage {
  const b = desktopBridge();
  if (b) return new DesktopStorage(b);
  try { localStorage.getItem('x'); return new BrowserStorage(); } catch { return new MemoryStorage(); }
}

/** Preferencias: archivo settings.json en escritorio, localStorage en el navegador. */
export function defaultSettingsStorage(): SettingsStorage {
  const b = desktopBridge();
  if (b?.loadSettings && b.saveSettings) {
    const bridge = b;
    return {
      load: async () => { const s = await bridge.loadSettings!(); return s ? JSON.parse(s) : null; },
      save: async d => { await bridge.saveSettings!(JSON.stringify(d)); },
    };
  }
  const key = 'yosadraw.settings.v1';
  return {
    load: async () => { try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : null; } catch { return null; } },
    save: async d => { try { localStorage.setItem(key, JSON.stringify(d)); } catch { /* sin almacenamiento */ } },
  };
}

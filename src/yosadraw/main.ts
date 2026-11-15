import '@fontsource/outfit/latin-600.css';
import '@fontsource/outfit/latin-800.css';
import '@fontsource/instrument-sans/latin-400.css';
import '@fontsource/instrument-sans/latin-500.css';
import '@fontsource/instrument-sans/latin-600.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import './ui/yosadraw.css';
import './ui/mobile.css';
import { BrushLibrary } from './brush/BrushLibrary';
import { GrainCache } from './brush/GrainCache';
import { ImageStore } from './brush/ImageStore';
import { defaultSettingsStorage, defaultStorage } from './brush/storage';
import { StrokePainter } from './brush/StrokePainter';
import { TipCache } from './brush/TipCache';
import { CanvasEngine } from './engine';
import { mountApp } from './ui/App';
import { App } from '@capacitor/app';
import { installAndroidBridge, isAndroidApp } from './platform/android';

async function main() {
  // En la app de Android, el puente nativo sustituye al de Electron (guardar, exportar, compartir).
  installAndroidBridge();
  const images = new ImageStore();
  const painter = new StrokePainter(new TipCache(images), new GrainCache(images));
  const settings = defaultSettingsStorage();
  const [lib, saved] = await Promise.all([BrushLibrary.open(defaultStorage()), settings.load().catch(() => null)]);
  /** Documento de alta resolución: 4096 × 3072 px. */
  const engine = new CanvasEngine(document.getElementById('canvas-host')!, {
    width: 4096, height: 3072, painter, brush: lib.activeFor('pen', ['Plumas']), color: lib.color,
  });
  const app = mountApp({ engine, lib, painter, settings, saved });
  document.body.classList.add('ready');
  if (isAndroidApp()) {
    // Atrás: cierra diálogos, menús y paneles; sin nada abierto, envía la app al fondo (no pierde el dibujo).
    void App.addListener('backButton', () => { if (!app.closeTopOverlay()) void App.minimizeApp(); });
    // Al irse al fondo se guardan biblioteca y preferencias (Android puede cerrar la app después).
    void App.addListener('pause', () => { void lib.saveNow(); window.dispatchEvent(new Event('yosadraw:persist')); });
  }
  // Sólo en desarrollo: acceso desde la consola y para las pruebas e2e.
  if (import.meta.env.DEV) Object.assign(window, { __yosadraw: { engine, lib, painter, ...app } });
}

main().catch(err => {
  console.error(err);
  const p = document.createElement('p');
  p.className = 'fatal';
  p.textContent = `YOSADRAW no pudo iniciarse: ${String(err?.message ?? err)}`;
  document.body.append(p);
});

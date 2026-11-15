import '@fontsource/outfit/latin-600.css';
import '@fontsource/outfit/latin-800.css';
import '@fontsource/instrument-sans/latin-400.css';
import '@fontsource/instrument-sans/latin-500.css';
import '@fontsource/instrument-sans/latin-600.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import './ui/yosadraw.css';
import { BrushLibrary } from './brush/BrushLibrary';
import { GrainCache } from './brush/GrainCache';
import { ImageStore } from './brush/ImageStore';
import { defaultSettingsStorage, defaultStorage } from './brush/storage';
import { StrokePainter } from './brush/StrokePainter';
import { TipCache } from './brush/TipCache';
import { CanvasEngine } from './engine';
import { mountApp } from './ui/App';

async function main() {
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

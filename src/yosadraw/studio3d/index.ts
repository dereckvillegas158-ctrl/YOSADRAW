import type { CanvasEngine } from '../engine';
import type { ProjectLibrary } from '../project/library';
import { Studio3D, type Prefs3 } from './Studio3D';
import { UI3D, type UI3Deps } from './ui/UI3D';
import { canvasPng } from './io';

/**
 * Punto de entrada de YOSADRAW 3D Studio. Se carga bajo demanda (import dinámico) la
 * primera vez que se abre un proyecto 3D: dibujar no paga el peso de Three.js.
 */
export function createStudio3D(o: { engine: CanvasEngine; projects: ProjectLibrary; prefs: Prefs3; persist: () => void; ui: UI3Deps }) {
  const studio = new Studio3D({ engine: o.engine, projects: o.projects, prefs: o.prefs, persist: o.persist });
  const ui = new UI3D(studio, o.ui);
  /** Miniatura para la galería: render de la escena con su cámara. */
  const thumbnail = async () => {
    if (!studio.active) return null;
    const c = ui.view.renderImage(480, 270, { quality: 1, shadows: 1 });
    return canvasPng(c);
  };
  return { studio, ui, thumbnail };
}

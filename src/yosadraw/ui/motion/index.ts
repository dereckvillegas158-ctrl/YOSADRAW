import type { CanvasEngine } from '../../engine';
import type { StrokePainter } from '../../brush/StrokePainter';
import type { ProjectLibrary } from '../../project/library';
import { MExport, normalizeMotionExport, type MotionExportPrefs } from './MExport';
import { MotionStudio } from './MotionStudio';
import { MotionUI, type MotionUIDeps } from './MotionUI';
import type { MotionPrefs } from './prefs';

/**
 * Punto de entrada de YOSADRAW MOTION. Se carga bajo demanda (import dinámico) la
 * primera vez que se abre un proyecto de vídeo: dibujar no paga el peso del editor.
 */
export function createMotion(o: {
  engine: CanvasEngine; projects: ProjectLibrary; painter: StrokePainter; prefs: MotionPrefs; persist: () => void;
  saveExportPrefs: (p: MotionExportPrefs) => void; ui: Omit<MotionUIDeps, 'exportVideo'>; name: () => string;
}) {
  const motion = new MotionStudio({ engine: o.engine, projects: o.projects, painter: o.painter, prefs: o.prefs, persist: o.persist });
  const exp = new MExport(motion, normalizeMotionExport(o.prefs.export), o.saveExportPrefs, o.name);
  const ui = new MotionUI(motion, { ...o.ui, exportVideo: () => void exp.show() });
  return { motion, exp, ui };
}

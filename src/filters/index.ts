import { StrokePipeline } from '../core/Pipeline';
import { InputSmoothing } from './InputSmoothing';
import { MotionFilter } from './MotionFilter';
import { Stabilization } from './Stabilization';
import { StreamLine } from './StreamLine';

export { InputSmoothing, MotionFilter, Stabilization, StreamLine };

export interface EngineSettings {
  /** Todos en 0..100 (%). */
  streamLine: number;
  stabilization: number;
  motionFiltering: number;
  /** Suavizado de presión e inclinación (0..100). Opcional: 0 si no se indica. */
  pressureSmoothing?: number;
}

export interface StrokeEngine {
  pipeline: StrokePipeline;
  motion: MotionFilter;
  stabilization: Stabilization;
  streamLine: StreamLine;
  inputSmoothing: InputSmoothing;
  apply(s: EngineSettings): void;
}

/**
 * Orden: Pressure & Tilt Smoothing → Motion Filtering → Stabilization → StreamLine.
 * La primera etapa sólo toca presión e inclinación, nunca la posición.
 * Primero se eliminan anomalías (picos), luego el temblor, y por último se
 * da forma a la trayectoria. Cada etapa es reemplazable de forma independiente.
 */
export function createEngine(): StrokeEngine {
  const motion = new MotionFilter();
  const stabilization = new Stabilization();
  const streamLine = new StreamLine();
  const inputSmoothing = new InputSmoothing();
  const pipeline = new StrokePipeline([inputSmoothing, motion, stabilization, streamLine]);
  return {
    pipeline, motion, stabilization, streamLine, inputSmoothing,
    apply(s) {
      inputSmoothing.amount = (s.pressureSmoothing ?? 0) / 100;
      motion.amount = s.motionFiltering / 100;
      stabilization.amount = s.stabilization / 100;
      streamLine.amount = s.streamLine / 100;
    },
  };
}

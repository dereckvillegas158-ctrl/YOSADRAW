/**
 * Muestra de entrada/salida del motor. Todas las etapas consumen y producen
 * este mismo tipo, lo que permite encadenarlas en cualquier orden.
 */
export interface StrokePoint {
  /** Posición en píxeles CSS. */
  x: number;
  y: number;
  /** Presión normalizada 0..1 (1 para ratón / dedo sin sensor). */
  pressure: number;
  /** Inclinación del lápiz en grados (-90..90). */
  tiltX: number;
  tiltY: number;
  /** Marca de tiempo en milisegundos (alta resolución). */
  t: number;
}

/**
 * Contrato de una etapa del pipeline.
 *
 * - `amount` es la intensidad 0..1 (los deslizadores 0..100% se mapean aquí).
 * - Con `amount === 0` la etapa es un bypass exacto (la salida es la entrada).
 * - Una etapa puede emitir 0, 1 o N puntos por cada punto recibido
 *   (retener para mirar adelante, interpolar, alcanzar al lápiz...).
 * - `end` se llama al levantar el lápiz para vaciar el estado interno.
 * - Las etapas nunca mutan los puntos recibidos.
 */
export interface StrokeStage {
  readonly name: string;
  amount: number;
  begin(p: StrokePoint, out: StrokePoint[]): void;
  push(p: StrokePoint, out: StrokePoint[]): void;
  end(out: StrokePoint[]): void;
}

import type { BrushPreset } from './BrushPreset';
import { lookup } from './PressureCurve';

/** Inclinación del lápiz → grados desde la vertical (0..90) y acimut (rad). */
export function tiltInfo(tiltX: number, tiltY: number): { tilt: number; azimuth: number } {
  if (!tiltX && !tiltY) return { tilt: 0, azimuth: 0 };
  const tx = Math.tan((Math.max(-89, Math.min(89, tiltX)) * Math.PI) / 180);
  const ty = Math.tan((Math.max(-89, Math.min(89, tiltY)) * Math.PI) / 180);
  const altitude = Math.atan(1 / Math.hypot(tx, ty)); // rad desde la superficie
  return { tilt: 90 - (altitude * 180) / Math.PI, azimuth: Math.atan2(ty, tx) };
}

const smooth = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };

export interface DynamicsInput {
  pressure: number;
  tiltX: number;
  tiltY: number;
  /** Velocidad en px de documento por ms. */
  speed: number;
  /** Distancia recorrida desde el inicio del trazo. */
  s: number;
  /** Longitud total (Infinity mientras se dibuja: aún no se conoce el final). */
  total: number;
}

export interface DynamicsOutput {
  /** Factor de tamaño sin variación aleatoria (0..~2). */
  size: number;
  /** Factor de flujo sin variación aleatoria (0..1). */
  flow: number;
  /** 0..1: cuánto está inclinado el lápiz por encima del umbral. */
  tilt: number;
  azimuth: number;
  taper: number;
}

/**
 * Combina presión (con su curva), inclinación, velocidad y afilado en factores
 * de tamaño y flujo. Lo comparten el modo por sellos y el modo de línea lisa.
 */
export function evalDynamics(p: BrushPreset, lut: Float32Array, i: DynamicsInput, o: DynamicsOutput): DynamicsOutput {
  const pm = lookup(lut, i.pressure);
  const ti = tiltInfo(i.tiltX, i.tiltY);
  const th = p.tilt.threshold;
  const tt = ti.tilt <= th ? 0 : Math.min(1, (ti.tilt - th) / Math.max(1, 90 - th));
  const sp = Math.min(1, i.speed / 3);

  let size = 1 - p.pressure.size * (1 - pm);
  size *= Math.max(0.05, 1 + p.tilt.size * tt);
  size *= Math.max(0.05, 1 + p.size.speed * sp);

  let taper = 1;
  if (p.size.taperStart > 0) taper = Math.min(taper, smooth(i.s / p.size.taperStart));
  if (p.size.taperEnd > 0 && Number.isFinite(i.total)) taper = Math.min(taper, smooth((i.total - i.s) / p.size.taperEnd));
  taper = p.size.taperMin + (1 - p.size.taperMin) * taper;
  size *= taper;
  size = Math.max(p.size.minPercent, size);

  let flow = p.opacity.flow * (1 - p.pressure.opacity * (1 - pm));
  flow *= Math.min(1, Math.max(0, 1 + p.tilt.opacity * tt));
  flow *= Math.min(1, Math.max(0, 1 + p.opacity.speed * sp));
  if (p.opacity.taperOpacity) flow *= taper;

  o.size = size; o.flow = flow; o.tilt = tt; o.azimuth = ti.azimuth; o.taper = taper;
  return o;
}

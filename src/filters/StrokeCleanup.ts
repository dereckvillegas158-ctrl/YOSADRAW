import type { StrokePoint } from '../core/types';

/**
 * Limpieza de los extremos de un trazo terminado (se aplica una vez, al soltar,
 * sobre los puntos ya estabilizados: no añade latencia al dibujar).
 *
 * - Inicio: al apoyar el dedo, el centro del contacto «baila» unos milímetros
 *   antes de que empiece el gesto; esos primeros puntos forman un pequeño
 *   garabato. Los que quedan cerca del primero durante `startMs` se descartan.
 * - Final: al levantar el dedo (o el lápiz), las últimas muestras saltan al
 *   encogerse el contacto, y el estabilizador «persigue» ese salto dibujando un
 *   gancho. Si la cola de `endMs` es corta (< `endPx`) y gira más de
 *   `endAngle` respecto a la dirección del trazo, se elimina.
 */
export interface CleanupOptions {
  startMs: number;
  /** Distancia (en las unidades de los puntos) por debajo de la cual el inicio es temblor. */
  startPx: number;
  endMs: number;
  endPx: number;
  /** Grados. */
  endAngle: number;
}

export function cleanStroke(pts: readonly StrokePoint[], o: CleanupOptions): StrokePoint[] {
  let out = pts.slice();
  if (out.length < 6) return out;

  // ---- inicio
  const p0 = out[0];
  let k = 0;
  for (let i = 1; i < out.length - 3; i++) {
    const q = out[i];
    if (q.t - p0.t > o.startMs || Math.hypot(q.x - p0.x, q.y - p0.y) > o.startPx) break;
    k = i;
  }
  if (k > 0) out = [p0, ...out.slice(k + 1)];

  // ---- final: el gancho es la cola corta que gira bruscamente respecto a la dirección del trazo.
  if (out.length >= 6) {
    const n = out.length, last = out[n - 1];
    let j = n - 1;
    while (j > 1 && last.t - out[j - 1].t <= o.endMs) j--;
    const a = out[Math.max(0, j - 1)];
    let b = Math.max(0, j - 2);
    while (b > 0 && Math.hypot(a.x - out[b].x, a.y - out[b].y) < o.endPx) b--;
    const dx = a.x - out[b].x, dy = a.y - out[b].y, dl = Math.hypot(dx, dy);
    if (dl > 1e-6) {
      const ux = dx / dl, uy = dy / dl;
      // El gancho empieza donde el trazo gira de golpe (el siguiente tramo forma más de `endAngle`
      // con la dirección del trazo) y lo que queda hasta el final es corto.
      const angOf = (x: number, y: number) => (Math.acos(Math.max(-1, Math.min(1, (x * ux + y * uy) / Math.hypot(x, y)))) * 180) / Math.PI;
      for (let h = j - 1; h < n - 1; h++) {
        let k2 = h + 1;
        while (k2 < n - 1 && Math.hypot(out[k2].x - out[h].x, out[k2].y - out[h].y) < 1e-6) k2++;
        const sx = out[k2].x - out[h].x, sy = out[k2].y - out[h].y;
        if (Math.hypot(sx, sy) < 1e-6 || angOf(sx, sy) <= o.endAngle) continue;
        if (Math.hypot(last.x - out[h].x, last.y - out[h].y) < o.endPx) out = out.slice(0, h + 1);
        break;
      }
    }
  }
  return out;
}

/** Valores por tipo de entrada (en px de pantalla; el motor los pasa a px de documento). */
export const CLEANUP_TOUCH: CleanupOptions = { startMs: 70, startPx: 5, endMs: 45, endPx: 14, endAngle: 55 };
export const CLEANUP_PEN: CleanupOptions = { startMs: 30, startPx: 2.5, endMs: 25, endPx: 8, endAngle: 65 };

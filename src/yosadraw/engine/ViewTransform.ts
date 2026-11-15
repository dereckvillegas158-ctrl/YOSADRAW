/**
 * Transformación documento → pantalla (similitud: escala uniforme + rotación + traslación).
 *   pantalla = R(θ) · s · doc + (x, y)
 * Lógica pura, sin DOM: se prueba de forma aislada.
 */
export type Mat = [number, number, number, number, number, number]; // a b c d e f (convención canvas/CSS)

export interface ViewState { scale: number; rotation: number; x: number; y: number }
export interface AABB { minX: number; minY: number; maxX: number; maxY: number }

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 64;

export function multiply(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

export function applyMat(m: Mat, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

/** Escala de una matriz: media geométrica (área) y valor singular máximo. */
export function matScale(m: Mat): { mean: number; max: number } {
  const det = Math.abs(m[0] * m[3] - m[1] * m[2]);
  const t = m[0] * m[0] + m[1] * m[1] + m[2] * m[2] + m[3] * m[3];
  return { mean: Math.sqrt(det), max: Math.sqrt((t + Math.sqrt(Math.max(0, t * t - 4 * det * det))) / 2) };
}

/** Caja envolvente de una caja transformada por m. */
export function transformAABB(m: Mat, b: AABB): AABB {
  const pts = [applyMat(m, b.minX, b.minY), applyMat(m, b.maxX, b.minY), applyMat(m, b.minX, b.maxY), applyMat(m, b.maxX, b.maxY)];
  return {
    minX: Math.min(...pts.map(p => p.x)), minY: Math.min(...pts.map(p => p.y)),
    maxX: Math.max(...pts.map(p => p.x)), maxY: Math.max(...pts.map(p => p.y)),
  };
}

export const translateMat = (x: number, y: number): Mat => [1, 0, 0, 1, x, y];
export const scaleMat = (sx: number, sy: number, cx = 0, cy = 0): Mat => [sx, 0, 0, sy, cx - sx * cx, cy - sy * cy];
export function rotateMat(rad: number, cx = 0, cy = 0): Mat {
  const c = Math.cos(rad), s = Math.sin(rad);
  return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
}

export function invert(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2];
  const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

const normAngle = (r: number) => Math.atan2(Math.sin(r), Math.cos(r));

export class ViewTransform implements ViewState {
  scale = 1;
  rotation = 0; // radianes
  x = 0;
  y = 0;

  clone(): ViewTransform { const v = new ViewTransform(); v.set(this); return v; }
  set(s: ViewState): this { this.scale = s.scale; this.rotation = s.rotation; this.x = s.x; this.y = s.y; return this; }
  equals(s: ViewState): boolean { return s.scale === this.scale && s.rotation === this.rotation && s.x === this.x && s.y === this.y; }

  matrix(): Mat {
    const c = Math.cos(this.rotation) * this.scale, s = Math.sin(this.rotation) * this.scale;
    return [c, s, -s, c, this.x, this.y];
  }

  toScreen(px: number, py: number): { x: number; y: number } {
    const c = Math.cos(this.rotation) * this.scale, s = Math.sin(this.rotation) * this.scale;
    return { x: c * px - s * py + this.x, y: s * px + c * py + this.y };
  }

  toDoc(sx: number, sy: number): { x: number; y: number } {
    const dx = sx - this.x, dy = sy - this.y;
    const c = Math.cos(this.rotation) / this.scale, s = Math.sin(this.rotation) / this.scale;
    return { x: c * dx + s * dy, y: -s * dx + c * dy };
  }

  /** Coloca el punto de documento (dx, dy) en la posición de pantalla (sx, sy). */
  /** Coloca el punto del documento (dx, dy) en el punto de pantalla (sx, sy). */
  pin(dx: number, dy: number, sx: number, sy: number) {
    const c = Math.cos(this.rotation) * this.scale, s = Math.sin(this.rotation) * this.scale;
    this.x = sx - (c * dx - s * dy);
    this.y = sy - (s * dx + c * dy);
  }

  /** Cambia la escala manteniendo fijo el punto de pantalla (sx, sy). */
  setScaleAt(scale: number, sx: number, sy: number): this {
    const d = this.toDoc(sx, sy);
    this.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
    this.pin(d.x, d.y, sx, sy);
    return this;
  }
  zoomAt(factor: number, sx: number, sy: number): this { return this.setScaleAt(this.scale * factor, sx, sy); }

  setRotationAt(rad: number, sx: number, sy: number): this {
    const d = this.toDoc(sx, sy);
    this.rotation = normAngle(rad);
    this.pin(d.x, d.y, sx, sy);
    return this;
  }
  rotateAt(delta: number, sx: number, sy: number): this { return this.setRotationAt(this.rotation + delta, sx, sy); }

  panBy(dx: number, dy: number): this { this.x += dx; this.y += dy; return this; }

  /**
   * Gesto de dos dedos: la vista que deja los puntos de documento dA y dB
   * exactamente bajo los dedos sA y sB (zoom + giro + desplazamiento a la vez).
   */
  fromPointPairs(dA: { x: number; y: number }, dB: { x: number; y: number }, sA: { x: number; y: number }, sB: { x: number; y: number }): this {
    const dvx = dB.x - dA.x, dvy = dB.y - dA.y, svx = sB.x - sA.x, svy = sB.y - sA.y;
    const dl = Math.hypot(dvx, dvy), sl = Math.hypot(svx, svy);
    if (dl < 1e-6 || sl < 1e-6) return this;
    this.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, sl / dl));
    this.rotation = normAngle(Math.atan2(svy, svx) - Math.atan2(dvy, dvx));
    // Ancla en el punto medio para que el límite de escala no desplace el gesto.
    this.pin((dA.x + dB.x) / 2, (dA.y + dB.y) / 2, (sA.x + sB.x) / 2, (sA.y + sB.y) / 2);
    return this;
  }

  /** Encaja el documento (con la rotación actual) en el área visible. */
  fit(vw: number, vh: number, dw: number, dh: number, margin = 32): this {
    const c = Math.abs(Math.cos(this.rotation)), s = Math.abs(Math.sin(this.rotation));
    const bw = dw * c + dh * s, bh = dw * s + dh * c;
    const scale = Math.min((vw - 2 * margin) / bw, (vh - 2 * margin) / bh);
    this.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
    this.pin(dw / 2, dh / 2, vw / 2, vh / 2);
    return this;
  }

  /** Rectángulo (en coordenadas de documento) que cubre todo el área visible. */
  visibleDocBounds(vw: number, vh: number): AABB {
    const pts = [this.toDoc(0, 0), this.toDoc(vw, 0), this.toDoc(0, vh), this.toDoc(vw, vh)];
    return {
      minX: Math.min(...pts.map(p => p.x)), minY: Math.min(...pts.map(p => p.y)),
      maxX: Math.max(...pts.map(p => p.x)), maxY: Math.max(...pts.map(p => p.y)),
    };
  }
}

/** Interpolación entre dos vistas manteniendo estable el punto central de pantalla. */
export function interpolateView(from: ViewState, to: ViewState, t: number, vw: number, vh: number): ViewState {
  const a = new ViewTransform().set(from), b = new ViewTransform().set(to);
  const ca = a.toDoc(vw / 2, vh / 2), cb = b.toDoc(vw / 2, vh / 2);
  const v = new ViewTransform();
  v.scale = a.scale * Math.pow(b.scale / a.scale, t);
  v.rotation = a.rotation + normAngle(b.rotation - a.rotation) * t;
  const cx = ca.x + (cb.x - ca.x) * t, cy = ca.y + (cb.y - ca.y) * t;
  const c = Math.cos(v.rotation) * v.scale, s = Math.sin(v.rotation) * v.scale;
  v.x = vw / 2 - (c * cx - s * cy);
  v.y = vh / 2 - (s * cx + c * cy);
  return v;
}

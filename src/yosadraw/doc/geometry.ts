import { applyMat, type Mat } from '../engine/ViewTransform';

export interface Pt { x: number; y: number }

/* ---------------- Formas ---------------- */

export type ShapeType = 'rect' | 'ellipse' | 'line' | 'polygon' | 'star' | 'arrow';

export interface ShapeSpec {
  type: ShapeType;
  /** Caja (o extremos para línea y flecha) en coordenadas de documento. */
  x0: number; y0: number; x1: number; y1: number;
  /** Lados del polígono o puntas de la estrella (3..24). */
  sides: number;
  /** Radio interior de la estrella (0.1..0.95). */
  inner: number;
  /** Radio de las esquinas del rectángulo (px). */
  radius: number;
  fill: string | null;
  stroke: string | null;
  /** Grosor del contorno (px de documento). */
  width: number;
  opacity: number;
}

/** Vértices de un polígono regular o estrella inscritos en la caja. */
export function regularPoints(s: ShapeSpec): Pt[] {
  const cx = (s.x0 + s.x1) / 2, cy = (s.y0 + s.y1) / 2, rx = Math.abs(s.x1 - s.x0) / 2, ry = Math.abs(s.y1 - s.y0) / 2;
  const n = Math.max(3, Math.min(24, Math.round(s.sides)));
  const pts: Pt[] = [];
  const count = s.type === 'star' ? n * 2 : n;
  for (let i = 0; i < count; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / count;
    const k = s.type === 'star' && i % 2 ? s.inner : 1;
    pts.push({ x: cx + Math.cos(a) * rx * k, y: cy + Math.sin(a) * ry * k });
  }
  return pts;
}

/** Polígono de la flecha (cuerpo + punta) entre (x0,y0) y (x1,y1). */
export function arrowPoints(s: ShapeSpec): Pt[] {
  const dx = s.x1 - s.x0, dy = s.y1 - s.y0, len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
  const head = Math.min(len * 0.45, Math.max(s.width * 4, 18)), hw = head * 0.6, bw = Math.max(s.width, 2) / 2;
  const bx = s.x1 - ux * head, by = s.y1 - uy * head;
  return [
    { x: s.x0 + nx * bw, y: s.y0 + ny * bw }, { x: bx + nx * bw, y: by + ny * bw }, { x: bx + nx * hw, y: by + ny * hw },
    { x: s.x1, y: s.y1 },
    { x: bx - nx * hw, y: by - ny * hw }, { x: bx - nx * bw, y: by - ny * bw }, { x: s.x0 - nx * bw, y: s.y0 - ny * bw },
  ];
}

/** Ajusta el arrastre: Mayús = proporción 1:1 (o ángulos de 15° en líneas), Alt = desde el centro. */
export function constrainDrag(type: ShapeType, a: Pt, b: Pt, keepRatio: boolean, fromCenter: boolean): { x0: number; y0: number; x1: number; y1: number } {
  let { x, y } = b;
  if (type === 'line' || type === 'arrow') {
    if (keepRatio) {
      const ang = Math.round(Math.atan2(y - a.y, x - a.x) / (Math.PI / 12)) * (Math.PI / 12), len = Math.hypot(x - a.x, y - a.y);
      x = a.x + Math.cos(ang) * len; y = a.y + Math.sin(ang) * len;
    }
    return { x0: a.x, y0: a.y, x1: x, y1: y };
  }
  if (keepRatio) {
    const d = Math.max(Math.abs(x - a.x), Math.abs(y - a.y));
    x = a.x + Math.sign(x - a.x || 1) * d; y = a.y + Math.sign(y - a.y || 1) * d;
  }
  if (fromCenter) return { x0: 2 * a.x - x, y0: 2 * a.y - y, x1: x, y1: y };
  return { x0: a.x, y0: a.y, x1: x, y1: y };
}

/* ---------------- Simetría ---------------- */

export type SymmetryMode = 'vertical' | 'horizontal' | 'quadrant' | 'radial' | 'mandala';
export interface Symmetry { enabled: boolean; mode: SymmetryMode; cx: number; cy: number; count: number }

const reflect = (cx: number, cy: number, angle: number): Mat => {
  // Reflexión respecto a la recta que pasa por (cx,cy) con ese ángulo.
  const c = Math.cos(2 * angle), s = Math.sin(2 * angle);
  return [c, s, s, -c, cx - c * cx - s * cy, cy - s * cx + c * cy];
};
const rotation = (cx: number, cy: number, a: number): Mat => {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
};

/** Matrices de las copias de simetría (sin la identidad). */
export function symmetryMatrices(s: Symmetry): Mat[] {
  if (!s.enabled) return [];
  const { cx, cy } = s;
  const n = Math.max(2, Math.min(16, Math.round(s.count)));
  switch (s.mode) {
    case 'vertical': return [reflect(cx, cy, Math.PI / 2)];
    case 'horizontal': return [reflect(cx, cy, 0)];
    case 'quadrant': return [reflect(cx, cy, Math.PI / 2), reflect(cx, cy, 0), rotation(cx, cy, Math.PI)];
    case 'radial': return Array.from({ length: n - 1 }, (_, i) => rotation(cx, cy, ((i + 1) * 2 * Math.PI) / n));
    case 'mandala': {
      const out: Mat[] = [];
      for (let i = 0; i < n; i++) {
        if (i) out.push(rotation(cx, cy, (i * 2 * Math.PI) / n));
        out.push(reflect(cx, cy, Math.PI / 2 + (i * Math.PI) / n));
      }
      return out;
    }
  }
}

/* ---------------- Regla ---------------- */

export interface Ruler { enabled: boolean; x0: number; y0: number; x1: number; y1: number }

/** Proyección de p sobre la recta de la regla. */
export function projectOnRuler(r: Ruler, p: Pt): Pt {
  const dx = r.x1 - r.x0, dy = r.y1 - r.y0, len2 = dx * dx + dy * dy || 1;
  const t = ((p.x - r.x0) * dx + (p.y - r.y0) * dy) / len2;
  return { x: r.x0 + dx * t, y: r.y0 + dy * t };
}
export function distanceToRuler(r: Ruler, p: Pt): number {
  const q = projectOnRuler(r, p);
  return Math.hypot(p.x - q.x, p.y - q.y);
}

export const transformPts = (m: Mat, pts: Pt[]) => pts.map(p => applyMat(m, p.x, p.y));

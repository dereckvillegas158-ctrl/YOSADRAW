import type { SymmetryMode } from '../../doc/geometry';
import type { ActiveHandler, ToolContext } from '../types';

/**
 * Regla: arrastra para trazarla; arrastra sus extremos o la línea para
 * moverla. Con la regla activa, los trazos que empiezan cerca se ajustan a ella.
 */
export function rulerHandler(ctx: ToolContext): ActiveHandler {
  let drag: { kind: 'p0' | 'p1' | 'move' | 'new'; sx: number; sy: number; r0: typeof ctx.engine.ruler } | null = null;
  const r = () => ctx.engine.ruler;
  return {
    cursor: 'crosshair',
    activate() { r().enabled = true; ctx.engine.requestOverlay(); ctx.refreshProps(); },
    down(e) {
      const v = ctx.engine.view, a = v.toScreen(r().x0, r().y0), b = v.toScreen(r().x1, r().y1);
      const d0 = Math.hypot(e.sx - a.x, e.sy - a.y), d1 = Math.hypot(e.sx - b.x, e.sy - b.y);
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const t = ((e.sx - a.x) * (b.x - a.x) + (e.sy - a.y) * (b.y - a.y)) / (len * len);
      const dLine = Math.abs((e.sx - a.x) * (b.y - a.y) - (e.sy - a.y) * (b.x - a.x)) / len;
      const kind = d0 < 12 ? 'p0' : d1 < 12 ? 'p1' : r().enabled && dLine < 8 && t > 0 && t < 1 ? 'move' : 'new';
      drag = { kind, sx: e.x, sy: e.y, r0: { ...r() } };
      if (kind === 'new') Object.assign(r(), { enabled: true, x0: e.x, y0: e.y, x1: e.x, y1: e.y });
    },
    move(e) {
      if (!drag) return;
      const R = r();
      const snap = (ox: number, oy: number, x: number, y: number) => {
        if (!e.shift) return { x, y };
        const ang = Math.round(Math.atan2(y - oy, x - ox) / (Math.PI / 12)) * (Math.PI / 12), len = Math.hypot(x - ox, y - oy);
        return { x: ox + Math.cos(ang) * len, y: oy + Math.sin(ang) * len };
      };
      if (drag.kind === 'move') {
        const dx = e.x - drag.sx, dy = e.y - drag.sy;
        Object.assign(R, { x0: drag.r0.x0 + dx, y0: drag.r0.y0 + dy, x1: drag.r0.x1 + dx, y1: drag.r0.y1 + dy });
      } else if (drag.kind === 'p0') { const p = snap(R.x1, R.y1, e.x, e.y); R.x0 = p.x; R.y0 = p.y; }
      else { const p = snap(R.x0, R.y0, e.x, e.y); R.x1 = p.x; R.y1 = p.y; }
      ctx.engine.requestOverlay();
    },
    up() {
      const R = r();
      if (drag?.kind === 'new' && Math.hypot(R.x1 - R.x0, R.y1 - R.y0) * ctx.engine.view.scale < 10) Object.assign(R, drag.r0);
      drag = null;
      ctx.refreshProps();
    },
    cancel() { if (drag) Object.assign(r(), drag.r0); drag = null; },
  };
}

/** Simetría: arrastra para mover el centro. Los trazos de pincel y borrador se repiten en espejo. */
export function symmetryHandler(ctx: ToolContext): ActiveHandler {
  let dragging = false;
  const s = () => ctx.engine.symmetry;
  return {
    cursor: 'move',
    activate() { s().enabled = true; ctx.engine.requestOverlay(); ctx.refreshProps(); },
    down(e) { dragging = true; s().cx = e.x; s().cy = e.y; ctx.engine.requestOverlay(); },
    move(e) {
      if (!dragging) return;
      let { x, y } = e;
      if (e.shift) { // ajusta al centro del lienzo si está cerca
        const d = ctx.engine.doc;
        if (Math.abs(x - d.width / 2) * ctx.engine.view.scale < 12) x = d.width / 2;
        if (Math.abs(y - d.height / 2) * ctx.engine.view.scale < 12) y = d.height / 2;
      }
      s().cx = x; s().cy = y;
      ctx.engine.requestOverlay();
    },
    up() { dragging = false; },
  };
}

export const SYMMETRY_MODES: { value: SymmetryMode; label: string }[] = [
  { value: 'vertical', label: 'Vertical' }, { value: 'horizontal', label: 'Horizontal' }, { value: 'quadrant', label: 'Cuadrantes' },
  { value: 'radial', label: 'Radial' }, { value: 'mandala', label: 'Mandala' },
];

/** Cuentagotas: toma el color bajo el puntero como color principal. */
export function eyedropperHandler(ctx: ToolContext, tool: string): ActiveHandler {
  let at: { sx: number; sy: number; color: string; before: string } | null = null;
  const sample = (sx: number, sy: number) => {
    const [r, g, b, a] = ctx.engine.sampleColor(sx, sy, ctx.setting<'all' | 'layer'>(tool, 'sample'), ctx.setting<number>(tool, 'size'));
    if (a <= 0) return null;
    return `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`;
  };
  return {
    cursor: 'crosshair',
    down(e) { const c = sample(e.sx, e.sy); at = { sx: e.sx, sy: e.sy, color: c ?? ctx.primary, before: ctx.primary }; },
    move(e) { if (!at) return; const c = sample(e.sx, e.sy); at = { ...at, sx: e.sx, sy: e.sy, color: c ?? at.color }; ctx.engine.requestOverlay(); },
    up() { if (at) ctx.setPrimary(at.color); at = null; ctx.engine.requestOverlay(); },
    cancel() { at = null; },
    overlay(g) {
      if (!at) return;
      const { sx, sy } = at, R = 34;
      g.save();
      g.lineWidth = 10;
      g.beginPath(); g.arc(sx, sy - R - 10, R, Math.PI, 0); g.strokeStyle = at.color; g.stroke();
      g.beginPath(); g.arc(sx, sy - R - 10, R, 0, Math.PI); g.strokeStyle = at.before; g.stroke();
      g.lineWidth = 1; g.strokeStyle = 'rgba(255,255,255,0.8)';
      g.beginPath(); g.arc(sx, sy - R - 10, R + 5, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.arc(sx, sy - R - 10, R - 5, 0, Math.PI * 2); g.stroke();
      g.restore();
    },
  };
}

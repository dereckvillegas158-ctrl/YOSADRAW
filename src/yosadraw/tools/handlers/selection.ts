import { floodFill, softenEdges } from '../../doc/flood';
import type { SelShape } from '../../doc/Selection';
import type { ToolEvent } from '../../engine';
import { applySelection, selMode } from '../selectionOps';
import type { ActiveHandler, ToolContext } from '../types';

type Pt = { x: number; y: number };

/** Selección rectangular o elíptica. Mayús al arrastrar = proporción 1:1 (si ya empezó), Alt = desde el centro. */
export function marqueeHandler(ctx: ToolContext, tool: string, kind: 'rect' | 'ellipse'): ActiveHandler {
  let a: Pt | null = null, b: Pt | null = null, mode = selMode(ctx, tool, { shift: false, alt: false }), center = false, square = false;
  const box = () => {
    if (!a || !b) return null;
    let dx = b.x - a.x, dy = b.y - a.y;
    if (square) { const m = Math.max(Math.abs(dx), Math.abs(dy)); dx = Math.sign(dx || 1) * m; dy = Math.sign(dy || 1) * m; }
    return center ? { x: a.x - dx, y: a.y - dy, w: dx * 2, h: dy * 2 } : { x: a.x, y: a.y, w: dx, h: dy };
  };
  return {
    cursor: 'crosshair',
    down(e) { a = { x: e.x, y: e.y }; b = a; mode = selMode(ctx, tool, e); center = false; square = false; },
    move(e) { b = { x: e.x, y: e.y }; center = e.alt && mode !== 'subtract'; square = e.shift && mode !== 'add'; ctx.engine.requestOverlay(); },
    up() {
      const r = box();
      a = b = null;
      if (!r) return;
      const minPx = 3 / ctx.engine.view.scale;
      if (Math.abs(r.w) < minPx || Math.abs(r.h) < minPx) {
        if (mode === 'replace' && ctx.engine.doc.selection) ctx.engine.exec(ctx.engine.doc.cmdSelection(null, 'Deseleccionar'));
        return;
      }
      const x = Math.min(r.x, r.x + r.w), y = Math.min(r.y, r.y + r.h), w = Math.abs(r.w), h = Math.abs(r.h);
      const shape: SelShape = kind === 'rect' ? { type: 'rect', x, y, w, h } : { type: 'ellipse', cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2 };
      applySelection(ctx, mode, shape, kind === 'rect' ? 'Selección rectangular' : 'Selección elíptica');
    },
    cancel() { a = b = null; ctx.engine.requestOverlay(); },
    overlay(g) {
      const r = box();
      if (!r) return;
      const V = ctx.engine.V;
      g.save();
      g.setTransform(ctx.engine.dprValue * V[0], ctx.engine.dprValue * V[1], ctx.engine.dprValue * V[2], ctx.engine.dprValue * V[3], ctx.engine.dprValue * V[4], ctx.engine.dprValue * V[5]);
      g.beginPath();
      if (kind === 'rect') g.rect(r.x, r.y, r.w, r.h);
      else g.ellipse(r.x + r.w / 2, r.y + r.h / 2, Math.abs(r.w / 2), Math.abs(r.h / 2), 0, 0, Math.PI * 2);
      g.restore();
      g.setLineDash([5, 4]);
      g.lineWidth = 1;
      g.strokeStyle = '#fff'; g.stroke();
      g.lineDashOffset = 5; g.strokeStyle = '#1b1530'; g.stroke();
    },
  };
}

/** Lazo: a mano alzada (arrastrar) o poligonal (clic por vértice, doble clic / Intro para cerrar). */
export function lassoHandler(ctx: ToolContext, tool: string): ActiveHandler {
  let pts: Pt[] = [], hoverPt: Pt | null = null, mode = selMode(ctx, tool, { shift: false, alt: false }), lastClick = 0;
  const polygonal = () => ctx.setting<string>(tool, 'style') === 'polygonal';
  const finish = () => {
    const p = pts;
    pts = []; hoverPt = null;
    ctx.engine.requestOverlay();
    if (p.length < 3) return;
    applySelection(ctx, mode, { type: 'poly', pts: p.flatMap(q => [q.x, q.y]) }, 'Selección con lazo');
  };
  const nearStart = (e: ToolEvent) => {
    if (pts.length < 3) return false;
    const s = ctx.engine.view.toScreen(pts[0].x, pts[0].y);
    return Math.hypot(s.x - e.sx, s.y - e.sy) < 10;
  };
  return {
    cursor: 'crosshair',
    down(e) {
      if (!pts.length) mode = selMode(ctx, tool, e);
      if (polygonal()) {
        const now = performance.now();
        if (nearStart(e) || (now - lastClick < 300 && pts.length >= 3)) { finish(); return; }
        lastClick = now;
        pts.push({ x: e.x, y: e.y });
      } else pts = [{ x: e.x, y: e.y }];
      ctx.engine.requestOverlay();
    },
    move(e) {
      if (polygonal()) { hoverPt = { x: e.x, y: e.y }; return; }
      const last = pts[pts.length - 1], s = ctx.engine.view.scale;
      if (!last || Math.hypot(e.x - last.x, e.y - last.y) * s > 2) pts.push({ x: e.x, y: e.y });
      ctx.engine.requestOverlay();
    },
    hover(e) { if (polygonal() && pts.length) { hoverPt = { x: e.x, y: e.y }; ctx.engine.requestOverlay(); } },
    up() { if (!polygonal()) finish(); },
    cancel() { if (!polygonal()) { pts = []; ctx.engine.requestOverlay(); } },
    deactivate() { pts = []; hoverPt = null; },
    key(e) {
      if (!pts.length) return false;
      if (e.key === 'Enter') { finish(); return true; }
      if (e.key === 'Escape') { pts = []; hoverPt = null; ctx.engine.requestOverlay(); return true; }
      if (e.key === 'Backspace') { pts.pop(); ctx.engine.requestOverlay(); return true; }
      return false;
    },
    overlay(g) {
      if (!pts.length) return;
      const v = ctx.engine.view;
      g.beginPath();
      pts.forEach((p, i) => { const s = v.toScreen(p.x, p.y); if (i) g.lineTo(s.x, s.y); else g.moveTo(s.x, s.y); });
      if (hoverPt && polygonal()) { const s = v.toScreen(hoverPt.x, hoverPt.y); g.lineTo(s.x, s.y); }
      g.lineWidth = 1;
      g.setLineDash([5, 4]);
      g.strokeStyle = '#fff'; g.stroke();
      g.lineDashOffset = 5; g.strokeStyle = '#1b1530'; g.stroke();
      if (polygonal()) {
        g.setLineDash([]);
        const s = v.toScreen(pts[0].x, pts[0].y);
        g.beginPath(); g.arc(s.x, s.y, 5, 0, Math.PI * 2); g.fillStyle = '#9d6bff'; g.fill();
      }
    },
  };
}

/** Varita mágica: selecciona el área de color parecido bajo el puntero. */
export function wandHandler(ctx: ToolContext, tool: string): ActiveHandler {
  return {
    cursor: 'crosshair',
    down(e) {
      const { engine } = ctx, doc = engine.doc;
      const x = Math.floor(e.x), y = Math.floor(e.y);
      if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) { ctx.notify('Haz clic dentro del lienzo'); return; }
      const all = ctx.setting<string>(tool, 'sample') === 'all';
      const raster = engine.rasterize(all ? doc.layers.filter(l => l.visible) : [doc.active]);
      const img = raster.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, raster.width, raster.height);
      let m = floodFill(img.data, img.width, img.height, x, y, ctx.setting<number>(tool, 'tolerance') * 2.55, ctx.setting<boolean>(tool, 'contiguous'));
      if (!m.count) return;
      if (ctx.setting<boolean>(tool, 'antialias')) m = softenEdges(m, img.width, img.height);
      const w = m.x1 - m.x0 + 1, h = m.y1 - m.y0 + 1;
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d')!;
      const out = g.createImageData(w, h);
      for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
        const a = m.mask[(yy + m.y0) * img.width + xx + m.x0];
        if (!a) continue;
        const o = (yy * w + xx) * 4;
        out.data[o] = out.data[o + 1] = out.data[o + 2] = 255; out.data[o + 3] = a;
      }
      g.putImageData(out, 0, 0);
      applySelection(ctx, selMode(ctx, tool, e), { type: 'mask', x: m.x0, y: m.y0, w, h, canvas: c }, 'Varita mágica');
    },
  };
}

import { parseHex } from '../../brush/ColorMixer';
import { dilate, floodFill, maskToRGBA, softenEdges } from '../../doc/flood';
import { constrainDrag, type ShapeSpec, type ShapeType } from '../../doc/geometry';
import { drawGradient, drawShape } from '../../doc/ItemRenderer';
import type { GradientSpec } from '../../doc/items';
import type { ActiveHandler, ToolContext } from '../types';

type Pt = { x: number; y: number };

/** Bote de pintura: rellena el área cerrada bajo el puntero (a resolución del documento). */
export function bucketHandler(ctx: ToolContext, tool: string): ActiveHandler {
  return {
    cursor: 'crosshair',
    down(e) {
      const { engine } = ctx, doc = engine.doc;
      const layer = engine.editableLayer();
      if (!layer) return;
      const x = Math.floor(e.x), y = Math.floor(e.y);
      if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) { ctx.notify('Haz clic dentro del lienzo'); return; }
      const all = ctx.setting<string>(tool, 'sample') === 'all';
      const raster = engine.rasterize(all ? doc.layers.filter(l => l.visible) : [layer]);
      const img = raster.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, raster.width, raster.height);
      let m = floodFill(img.data, img.width, img.height, x, y, ctx.setting<number>(tool, 'tolerance') * 2.55, ctx.setting<boolean>(tool, 'contiguous'));
      if (!m.count) return;
      m = dilate(m, img.width, img.height, ctx.setting<number>(tool, 'expand'));
      if (ctx.setting<boolean>(tool, 'antialias')) m = softenEdges(m, img.width, img.height);
      const { data, w, h } = maskToRGBA(m, img.width, parseHex(ctx.primary));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d')!, id = g.createImageData(w, h);
      id.data.set(data);
      g.putImageData(id, 0, 0);
      const opacity = ctx.setting<number>(tool, 'opacity');
      const item = doc.item({ kind: 'bitmap', image: c, x: m.x0, y: m.y0, w, h }, { clip: doc.selection });
      const items = opacity < 1 ? [doc.item({ kind: 'group', items: [item], opacity, blend: 'normal' })] : [item];
      engine.exec(doc.cmdAddItems(layer.id, items, 'Relleno'));
    },
  };
}

/** Degradado lineal o radial entre dos puntos; respeta la selección. */
export function gradientHandler(ctx: ToolContext, tool: string): ActiveHandler {
  let a: Pt | null = null, b: Pt | null = null;
  const spec = (): GradientSpec | null => {
    if (!a || !b) return null;
    const toTransparent = ctx.setting<string>(tool, 'colors') === 'transparent';
    let c0 = ctx.primary, c1 = toTransparent ? ctx.primary : ctx.secondary, a0 = 1, a1 = toTransparent ? 0 : 1;
    if (ctx.setting<boolean>(tool, 'reverse')) [c0, c1, a0, a1] = [c1, c0, a1, a0];
    return { type: ctx.setting<'linear' | 'radial'>(tool, 'type'), x0: a.x, y0: a.y, x1: b.x, y1: b.y, c0, c1, a0, a1, opacity: ctx.setting<number>(tool, 'opacity') };
  };
  return {
    cursor: 'crosshair',
    down(e) { if (!ctx.engine.editableLayer()) return; a = { x: e.x, y: e.y }; b = a; },
    move(e) {
      if (!a) return;
      b = { x: e.x, y: e.y };
      if (e.shift) {
        const ang = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / (Math.PI / 12)) * (Math.PI / 12), len = Math.hypot(b.x - a.x, b.y - a.y);
        b = { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len };
      }
      ctx.engine.requestOverlay();
    },
    up() {
      const g = spec();
      const ok = a && b && Math.hypot(b.x - a.x, b.y - a.y) * ctx.engine.view.scale > 3;
      a = b = null;
      ctx.engine.requestOverlay();
      if (!g || !ok) return;
      const { engine } = ctx, doc = engine.doc, layer = engine.editableLayer();
      if (!layer) return;
      engine.exec(doc.cmdAddItems(layer.id, [doc.item({ kind: 'gradient', grad: g }, { clip: doc.selection })], 'Degradado'));
    },
    cancel() { a = b = null; },
    overlay(g) {
      const s = spec();
      if (!s) return;
      const { engine } = ctx, d = engine.dprValue, V = engine.V;
      g.save();
      g.setTransform(d * V[0], d * V[1], d * V[2], d * V[3], d * V[4], d * V[5]);
      g.beginPath(); g.rect(0, 0, engine.doc.width, engine.doc.height); g.clip();
      g.globalAlpha = 0.85;
      drawGradient(g, s, [d * V[0], d * V[1], d * V[2], d * V[3], d * V[4], d * V[5]], engine.doc.width, engine.doc.height);
      g.restore();
      const p0 = engine.view.toScreen(s.x0, s.y0), p1 = engine.view.toScreen(s.x1, s.y1);
      g.lineWidth = 1.5; g.strokeStyle = '#fff';
      g.beginPath(); g.moveTo(p0.x, p0.y); g.lineTo(p1.x, p1.y); g.stroke();
      for (const p of [p0, p1]) { g.beginPath(); g.arc(p.x, p.y, 5, 0, Math.PI * 2); g.fillStyle = '#9d6bff'; g.fill(); g.stroke(); }
    },
  };
}

/** Formas geométricas vectoriales. Mayús = proporción 1:1 (o ángulos de 15°), Alt = desde el centro. */
export function shapesHandler(ctx: ToolContext, tool: string): ActiveHandler {
  let a: Pt | null = null, box: { x0: number; y0: number; x1: number; y1: number } | null = null;
  const spec = (): ShapeSpec | null => {
    if (!box) return null;
    const type = ctx.setting<ShapeType>(tool, 'shape'), style = ctx.setting<string>(tool, 'style');
    const isLine = type === 'line' || type === 'arrow';
    return {
      type, ...box,
      sides: ctx.setting<number>(tool, 'sides'), inner: ctx.setting<number>(tool, 'inner'), radius: ctx.setting<number>(tool, 'radius'),
      fill: isLine || style === 'stroke' ? null : ctx.primary,
      stroke: isLine ? ctx.primary : style === 'fill' ? null : style === 'both' ? ctx.secondary : ctx.primary,
      width: ctx.setting<number>(tool, 'width'), opacity: ctx.setting<number>(tool, 'opacity'),
    };
  };
  return {
    cursor: 'crosshair',
    down(e) { if (!ctx.engine.editableLayer()) return; a = { x: e.x, y: e.y }; box = { x0: e.x, y0: e.y, x1: e.x, y1: e.y }; },
    move(e) {
      if (!a) return;
      box = constrainDrag(ctx.setting<ShapeType>(tool, 'shape'), a, { x: e.x, y: e.y }, e.shift, e.alt);
      ctx.engine.requestOverlay();
    },
    up() {
      const s = spec();
      a = null; box = null;
      ctx.engine.requestOverlay();
      if (!s) return;
      const minPx = 2 / ctx.engine.view.scale;
      if (Math.abs(s.x1 - s.x0) < minPx && Math.abs(s.y1 - s.y0) < minPx) return;
      const { engine } = ctx, doc = engine.doc, layer = engine.editableLayer();
      if (!layer) return;
      engine.exec(doc.cmdAddItems(layer.id, [doc.item({ kind: 'shape', shape: s }, { clip: doc.selection })], 'Forma'));
    },
    cancel() { a = null; box = null; },
    overlay(g) {
      const s = spec();
      if (!s) return;
      const d = ctx.engine.dprValue, V = ctx.engine.V;
      g.save();
      g.globalAlpha = s.opacity;
      drawShape(g, s, [d * V[0], d * V[1], d * V[2], d * V[3], d * V[4], d * V[5]]);
      g.restore();
    },
  };
}

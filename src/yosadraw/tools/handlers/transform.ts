import { Document } from '../../doc/Document';
import type { Item } from '../../doc/items';
import { drawSelectionMask, selectionBounds, transformSelection, type Selection } from '../../doc/Selection';
import type { ToolEvent } from '../../engine';
import { applyMat, IDENTITY, invert, multiply, rotateMat, scaleMat, translateMat, type AABB, type Mat } from '../../engine/ViewTransform';
import type { ActiveHandler, ToolContext } from '../types';

interface Session {
  layerId: string;
  mode: 'layer' | 'selection';
  box: AABB;
  T: Mat;
  patch?: { canvas: HTMLCanvasElement; x: number; y: number; w: number; h: number };
  sel?: Selection;
  items?: Item[];
}

type Drag =
  | { kind: 'move'; T0: Mat; x: number; y: number }
  | { kind: 'scale'; T0: Mat; handle: number }
  | { kind: 'rotate'; T0: Mat; c: { x: number; y: number }; a0: number };

const isIdentity = (m: Mat) => m.every((v, i) => Math.abs(v - IDENTITY[i]) < 1e-9);

/** Puntos de control en coordenadas locales: 0 sup-izq, 1 sup, 2 sup-der, 3 der, 4 inf-der, 5 inf, 6 inf-izq, 7 izq. */
function handles(b: AABB) {
  const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
  return [
    { x: b.minX, y: b.minY }, { x: cx, y: b.minY }, { x: b.maxX, y: b.minY }, { x: b.maxX, y: cy },
    { x: b.maxX, y: b.maxY }, { x: cx, y: b.maxY }, { x: b.minX, y: b.maxY }, { x: b.minX, y: cy },
  ];
}

export interface TransformTool extends ActiveHandler {
  readonly active: boolean;
  readonly mode: 'layer' | 'selection' | null;
  apply(): void;
  discard(): void;
  flip(axis: 'h' | 'v'): void;
  rotate90(dir: 1 | -1): void;
  reset(): void;
}

/**
 * Transformar: sin selección, transforma la capa activa completa (cada
 * elemento guarda la matriz: los trazos y formas siguen siendo vectoriales);
 * con selección, levanta lo seleccionado y lo transforma como imagen.
 * Arrastrar dentro mueve, los tiradores escalan (Mayús = proporción,
 * Alt = desde el centro), fuera o el tirador superior giran (Mayús = 15°).
 */
export function transformHandler(ctx: ToolContext, tool: string): TransformTool {
  let s: Session | null = null;
  let drag: Drag | null = null;
  const { engine } = ctx;

  const preview = () => {
    if (s?.mode === 'layer') engine.previewLayerTransform(s.layerId, s.T);
    engine.requestOverlay();
  };

  function begin(): boolean {
    const layer = engine.editableLayer();
    if (!layer) return false;
    const doc = engine.doc, sel = doc.selection;
    if (sel) {
      const b = selectionBounds(sel);
      if (!b) return false;
      const x = Math.max(0, Math.floor(b.minX)), y = Math.max(0, Math.floor(b.minY));
      const w = Math.min(doc.width, Math.ceil(b.maxX)) - x, h = Math.min(doc.height, Math.ceil(b.maxY)) - y;
      if (w <= 0 || h <= 0) { ctx.notify('La selección está fuera del lienzo'); return false; }
      const raster = engine.rasterize([layer]);
      const patch = document.createElement('canvas');
      patch.width = w; patch.height = h;
      const g = patch.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(raster, x, y, w, h, 0, 0, w, h);
      const mask = document.createElement('canvas');
      mask.width = w; mask.height = h;
      drawSelectionMask(mask.getContext('2d')!, sel, translateMat(-x, -y));
      g.globalCompositeOperation = 'destination-in';
      g.drawImage(mask, 0, 0);
      const px = g.getImageData(0, 0, w, h).data;
      let any = false;
      for (let i = 3; i < px.length; i += 4) if (px[i]) { any = true; break; }
      if (!any) { ctx.notify('No hay nada seleccionado en esta capa'); return false; }
      // Elementos de la capa que tocan la selección (en orden: los borrados también cuentan).
      const items = layer.items.filter(it => !(it.bounds.maxX < b.minX || it.bounds.minX > b.maxX || it.bounds.maxY < b.minY || it.bounds.minY > b.maxY));
      engine.exec(doc.cmdAddItems(layer.id, [doc.item({ kind: 'clear' }, { clip: sel })], 'Levantar selección'));
      s = { layerId: layer.id, mode: 'selection', box: { minX: x, minY: y, maxX: x + w, maxY: y + h }, T: IDENTITY, patch: { canvas: patch, x, y, w, h }, sel, items };
    } else {
      const b = doc.contentBounds(layer.id);
      if (!b) { ctx.notify('La capa activa está vacía'); return false; }
      s = { layerId: layer.id, mode: 'layer', box: b, T: IDENTITY };
    }
    ctx.refreshProps();
    preview();
    return true;
  }

  const screenPts = (m: Mat, pts: { x: number; y: number }[]) => pts.map(p => { const q = applyMat(m, p.x, p.y); return engine.view.toScreen(q.x, q.y); });
  function rotateHandle(): { x: number; y: number } | null {
    if (!s) return null;
    const [tl, , tr] = screenPts(s.T, handles(s.box));
    const [bl] = screenPts(s.T, [handles(s.box)[6]]);
    const mid = { x: (tl.x + tr.x) / 2, y: (tl.y + tr.y) / 2 };
    const ux = tl.x - bl.x, uy = tl.y - bl.y, len = Math.hypot(ux, uy) || 1;
    return { x: mid.x + (ux / len) * 28, y: mid.y + (uy / len) * 28 };
  }

  function inside(e: ToolEvent): boolean {
    if (!s) return false;
    const p = applyMat(invert(s.T), e.x, e.y);
    return p.x >= s.box.minX && p.x <= s.box.maxX && p.y >= s.box.minY && p.y <= s.box.maxY;
  }

  const center = (b: AABB) => ({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 });

  const h: TransformTool = {
    cursor: 'move',
    get active() { return s !== null; },
    get mode() { return s?.mode ?? null; },
    activate() { if (!s) begin(); },
    deactivate() { h.apply(); },
    down(e) {
      if (!s && !begin()) return;
      const hs = screenPts(s!.T, handles(s!.box));
      const k = hs.findIndex(p => Math.hypot(p.x - e.sx, p.y - e.sy) < 11);
      const rh = rotateHandle();
      if (k >= 0) drag = { kind: 'scale', T0: s!.T, handle: k };
      else if ((rh && Math.hypot(rh.x - e.sx, rh.y - e.sy) < 11) || !inside(e)) {
        const c = applyMat(s!.T, center(s!.box).x, center(s!.box).y);
        drag = { kind: 'rotate', T0: s!.T, c, a0: Math.atan2(e.y - c.y, e.x - c.x) };
      } else drag = { kind: 'move', T0: s!.T, x: e.x, y: e.y };
    },
    move(e) {
      if (!s || !drag) return;
      if (drag.kind === 'move') s.T = multiply(translateMat(e.x - drag.x, e.y - drag.y), drag.T0);
      else if (drag.kind === 'rotate') {
        let a = Math.atan2(e.y - drag.c.y, e.x - drag.c.x) - drag.a0;
        if (e.shift) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
        s.T = multiply(rotateMat(a, drag.c.x, drag.c.y), drag.T0);
      } else {
        const hs = handles(s.box), k = drag.handle;
        const anchor = e.alt ? center(s.box) : hs[(k + 4) % 8];
        const p = applyMat(invert(drag.T0), e.x, e.y), hk = hs[k];
        const affectsX = k !== 1 && k !== 5, affectsY = k !== 3 && k !== 7;
        let sx = affectsX ? (p.x - anchor.x) / (hk.x - anchor.x || 1) : 1;
        let sy = affectsY ? (p.y - anchor.y) / (hk.y - anchor.y || 1) : 1;
        const keep = e.shift || ctx.setting<boolean>(tool, 'proportional');
        if (keep) {
          const m = affectsX && affectsY ? Math.max(Math.abs(sx), Math.abs(sy)) : affectsX ? Math.abs(sx) : Math.abs(sy);
          sx = Math.sign(sx || 1) * m; sy = Math.sign(sy || 1) * m;
        }
        const clampS = (v: number) => (Math.abs(v) < 0.01 ? Math.sign(v || 1) * 0.01 : v);
        s.T = multiply(drag.T0, scaleMat(clampS(sx), clampS(sy), anchor.x, anchor.y));
      }
      preview();
    },
    up() { drag = null; },
    cancel() { if (drag && s) { s.T = drag.T0; preview(); } drag = null; },
    hover(e) {
      if (!s) { h.cursor = 'move'; return; }
      const hs = screenPts(s.T, handles(s.box));
      const rh = rotateHandle();
      const next = hs.some(p => Math.hypot(p.x - e.sx, p.y - e.sy) < 11) ? 'nwse-resize'
        : (rh && Math.hypot(rh.x - e.sx, rh.y - e.sy) < 11) || !inside(e) ? 'alias' : 'move';
      if (next !== h.cursor) { h.cursor = next; engine.refreshCursor(); }
    },
    key(e) {
      if (!s) return false;
      if (e.key === 'Enter') { h.apply(); return true; }
      if (e.key === 'Escape') { h.discard(); return true; }
      return false;
    },
    overlay(g) {
      if (!s) return;
      const d = engine.dprValue, V = engine.V;
      if (s.mode === 'selection' && s.patch) {
        const M = multiply(V, s.T);
        g.save();
        g.setTransform(d * M[0], d * M[1], d * M[2], d * M[3], d * M[4], d * M[5]);
        g.imageSmoothingQuality = 'high';
        g.drawImage(s.patch.canvas, s.patch.x, s.patch.y, s.patch.w, s.patch.h);
        g.restore();
      }
      const hs = screenPts(s.T, handles(s.box));
      g.lineWidth = 1;
      g.strokeStyle = '#9d6bff';
      g.beginPath();
      [0, 2, 4, 6].forEach((i, n) => (n ? g.lineTo(hs[i].x, hs[i].y) : g.moveTo(hs[i].x, hs[i].y)));
      g.closePath(); g.stroke();
      const rh = rotateHandle()!;
      g.beginPath(); g.moveTo((hs[0].x + hs[2].x) / 2, (hs[0].y + hs[2].y) / 2); g.lineTo(rh.x, rh.y); g.stroke();
      for (const p of hs) { g.fillStyle = '#fff'; g.fillRect(p.x - 4.5, p.y - 4.5, 9, 9); g.strokeRect(p.x - 4.5, p.y - 4.5, 9, 9); }
      g.beginPath(); g.arc(rh.x, rh.y, 5.5, 0, Math.PI * 2); g.fillStyle = '#9d6bff'; g.fill(); g.strokeStyle = '#fff'; g.stroke();
    },
    apply() {
      if (!s) return;
      const cur = s;
      s = null; drag = null;
      const doc = engine.doc;
      if (cur.mode === 'layer') {
        if (isIdentity(cur.T)) engine.previewLayerTransform(cur.layerId, null);
        else engine.exec(doc.cmdTransformLayer(cur.layerId, cur.T));
      } else if (cur.patch && cur.sel) {
        // Sin cambios: se deshace «Levantar selección» (no queda ninguna marca en el borde).
        if (isIdentity(cur.T)) { engine.undo(); ctx.refreshProps(); engine.requestOverlay(); return; }
        // Lo levantado sigue siendo lo que era (trazos, formas, imágenes a su resolución),
        // recortado por la selección y transformado: no pierde calidad al escalar o girar.
        const inner = doc.item({ kind: 'group', items: cur.items ?? [], opacity: 1, blend: 'normal' }, { clip: cur.sel });
        const item = doc.item({ kind: 'group', items: [inner], opacity: 1, blend: 'normal' }, { m: cur.T });
        engine.exec(Document.group('Transformar selección', [
          doc.cmdAddItems(cur.layerId, [item], 'Pegar'),
          doc.cmdSelection(transformSelection(cur.sel, cur.T)),
        ]));
      }
      ctx.refreshProps();
      engine.requestOverlay();
    },
    discard() {
      if (!s) return;
      const cur = s;
      s = null; drag = null;
      if (cur.mode === 'layer') engine.previewLayerTransform(cur.layerId, null);
      else engine.undo(); // deshace "Levantar selección"
      ctx.refreshProps();
      engine.requestOverlay();
    },
    flip(axis) {
      if (!s && !begin()) return;
      const c = center(s!.box);
      s!.T = multiply(s!.T, axis === 'h' ? scaleMat(-1, 1, c.x, c.y) : scaleMat(1, -1, c.x, c.y));
      preview();
    },
    rotate90(dir) {
      if (!s && !begin()) return;
      const c = applyMat(s!.T, center(s!.box).x, center(s!.box).y);
      s!.T = multiply(rotateMat((dir * Math.PI) / 2, c.x, c.y), s!.T);
      preview();
    },
    reset() { if (s) { s.T = IDENTITY; preview(); } },
  };
  return h;
}

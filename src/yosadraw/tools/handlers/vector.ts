import { applyMat, invert } from '../../engine/ViewTransform';
import { itemMatrix, transformItem } from '../../doc/items';
import { dragNode, hitVector, nodeIndices, simplifyStroke, smoothStroke, withStroke } from '../../doc/vector';
import type { StrokeItem } from '../../doc/items';
import type { ActiveHandler, Prop, ToolContext } from '../types';

export interface VectorTool extends ActiveHandler {
  readonly selected: StrokeItem | null;
  recolor(): void;
  setWidth(px: number, commit: boolean): void;
  setOpacity(v: number, commit: boolean): void;
  smooth(): void;
  simplify(): void;
  remove(): void;
  duplicate(): void;
}

/**
 * Editar vector (capas vectoriales): toca un trazo para elegirlo; arrastra un nodo
 * para deformar la línea (los vecinos le siguen con suavidad según «Influencia»),
 * o arrastra el trazo para moverlo. El panel cambia color, grosor y opacidad,
 * suaviza, simplifica, duplica o elimina. Supr elimina, Esc deselecciona.
 */
export function vectorHandler(ctx: ToolContext, id: string): VectorTool {
  const e = () => ctx.engine;
  let selId: number | null = null;
  let drag: { kind: 'node' | 'move'; idx: number; x0: number; y0: number; orig: StrokeItem; preview: StrokeItem } | null = null;
  const layer = () => e().doc.active;
  const sel = (): StrokeItem | null => { const it = layer().items.find(i => i.id === selId); return it && it.kind === 'stroke' ? it : null; };
  const replace = (next: StrokeItem, label: string) => {
    const l = layer();
    e().exec(e().doc.cmdSetItems(l.id, l.items.map(i => (i.id === next.id ? next : i)), label));
    ctx.refreshProps();
  };
  const step = () => Math.max(6, 36 / e().view.scale);
  const canEdit = () => {
    const l = layer();
    if (!l.vector) { ctx.notify('Esta herramienta edita capas vectoriales (Capas → Nueva capa vectorial).'); return false; }
    return !!e().editableLayer();
  };
  let pendingPreset: { width?: number; opacity?: number } = {};
  const tool: VectorTool = {
    cursor: 'default',
    get selected() { return sel(); },
    activate() { ctx.refreshProps(); },
    deactivate() { selId = null; drag = null; e().requestOverlay(); },
    down(ev) {
      if (!canEdit()) return;
      const s = sel();
      const tol = 8 / e().view.scale;
      if (s) {
        const M = itemMatrix(s);
        for (const i of nodeIndices(s.stroke.points, step())) {
          const p = applyMat(M, s.stroke.points[i].x, s.stroke.points[i].y), q = e().view.toScreen(p.x, p.y);
          if (Math.hypot(q.x - ev.sx, q.y - ev.sy) < 10) { drag = { kind: 'node', idx: i, x0: ev.x, y0: ev.y, orig: s, preview: s }; return; }
        }
      }
      const hit = hitVector(layer().items, ev.x, ev.y, tol);
      selId = hit?.id ?? null;
      if (hit) drag = { kind: 'move', idx: -1, x0: ev.x, y0: ev.y, orig: hit, preview: hit };
      ctx.refreshProps();
      e().requestOverlay();
    },
    move(ev) {
      if (!drag) return;
      const falloff = ctx.setting<number>(id, 'falloff');
      if (drag.kind === 'node') {
        const inv = invert(itemMatrix(drag.orig));
        const a = applyMat(inv, drag.x0, drag.y0), b = applyMat(inv, ev.x, ev.y);
        drag.preview = withStroke(drag.orig, { points: dragNode(drag.orig.stroke.points, drag.idx, b.x - a.x, b.y - a.y, falloff) });
      } else drag.preview = transformItem(drag.orig, [1, 0, 0, 1, ev.x - drag.x0, ev.y - drag.y0]) as StrokeItem;
      e().requestOverlay();
    },
    up() {
      const d = drag;
      drag = null;
      if (!d || d.preview === d.orig) { e().requestOverlay(); return; }
      replace(d.preview, d.kind === 'node' ? 'Editar nodo' : 'Mover trazo');
    },
    cancel() { drag = null; e().requestOverlay(); },
    key(ev) {
      if ((ev.key === 'Delete' || ev.key === 'Backspace') && sel()) { tool.remove(); return true; }
      if (ev.key === 'Escape' && selId !== null) { selId = null; ctx.refreshProps(); e().requestOverlay(); return true; }
      return false;
    },
    overlay(g) {
      const s = drag?.preview ?? sel();
      if (!s) return;
      const M = itemMatrix(s), v = e().view;
      const pts = s.stroke.points.map(p => { const q = applyMat(M, p.x, p.y); return v.toScreen(q.x, q.y); });
      g.strokeStyle = '#9d6bff'; g.lineWidth = 1.5; g.setLineDash(drag ? [] : [4, 3]);
      g.beginPath(); pts.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y))); g.stroke(); g.setLineDash([]);
      for (const i of nodeIndices(s.stroke.points, step())) {
        const q = pts[i];
        g.fillStyle = drag?.kind === 'node' && drag.idx === i ? '#9d6bff' : '#fff'; g.strokeStyle = '#6d3fe0';
        g.beginPath(); g.arc(q.x, q.y, i === 0 || i === pts.length - 1 ? 5 : 4, 0, Math.PI * 2); g.fill(); g.stroke();
      }
    },
    recolor() { const s = sel(); if (s) replace(withStroke(s, { color: ctx.primary }), 'Color del trazo'); },
    setWidth(px, commit) {
      const s = sel(); if (!s) return;
      pendingPreset.width = px;
      if (!commit) return;
      replace(withStroke(s, { preset: { ...s.stroke.preset, size: { ...s.stroke.preset.size, size: px } } }), 'Grosor del trazo');
      pendingPreset = {};
    },
    setOpacity(v, commit) {
      const s = sel(); if (!s || !commit) return;
      replace(withStroke(s, { preset: { ...s.stroke.preset, opacity: { ...s.stroke.preset.opacity, opacity: v } } }), 'Opacidad del trazo');
    },
    smooth() { const s = sel(); if (s) replace(withStroke(s, { points: smoothStroke(s.stroke.points, 3) }), 'Suavizar trazo'); },
    simplify() { const s = sel(); if (s) { const before = s.stroke.points.length; const pts = simplifyStroke(s.stroke.points, 0.6 / Math.max(0.2, e().view.scale)); replace(withStroke(s, { points: pts }), 'Simplificar trazo'); ctx.notify(`${before} → ${pts.length} puntos`, 'ok'); } },
    remove() { const s = sel(); if (!s) return; const l = layer(); e().exec(e().doc.cmdSetItems(l.id, l.items.filter(i => i.id !== s.id), 'Eliminar trazo')); selId = null; ctx.refreshProps(); e().requestOverlay(); },
    duplicate() {
      const s = sel(); if (!s) return;
      const l = layer();
      const copy = transformItem(e().doc.item({ kind: 'stroke', stroke: s.stroke }, { m: s.m, clip: s.clip }), [1, 0, 0, 1, 12 / e().view.scale, 12 / e().view.scale]);
      e().exec(e().doc.cmdAddItems(l.id, [copy], 'Duplicar trazo'));
      selId = copy.id; ctx.refreshProps();
    },
  };
  return tool;
}

/** Panel de la herramienta. */
export function vectorProps(ctx: ToolContext, id: string, t: VectorTool | null): Prop[] {
  const s = t?.selected ?? null;
  const out: Prop[] = [
    { type: 'slider', label: 'Influencia', min: 2, max: 400, step: 1, unit: 'px', log: true, value: ctx.setting<number>(id, 'falloff'), onInput: v => ctx.setSetting(id, 'falloff', v) },
  ];
  if (!ctx.engine.doc.active.vector) out.push({ type: 'note', text: 'Elige una capa vectorial (o crea una en Capas).' });
  else if (!s) out.push({ type: 'note', text: 'Toca un trazo para editarlo · arrastra sus nodos o el trazo entero' });
  else {
    out.push(
      { type: 'slider', label: 'Grosor', min: 0.5, max: 400, step: 0.5, unit: 'px', log: true, value: s.stroke.preset.size.size, onInput: v => t!.setWidth(v, false), onChange: v => t!.setWidth(v, true) },
      { type: 'slider', label: 'Opacidad', min: 0.05, max: 1, step: 0.01, unit: '%', display: 100, value: s.stroke.preset.opacity.opacity, onInput: () => undefined, onChange: v => t!.setOpacity(v, true) },
      { type: 'button', label: 'Usar el color actual', onClick: () => t!.recolor() },
      { type: 'button', label: 'Suavizar', onClick: () => t!.smooth() },
      { type: 'button', label: 'Simplificar', onClick: () => t!.simplify() },
      { type: 'button', label: 'Duplicar', onClick: () => t!.duplicate() },
      { type: 'button', label: 'Eliminar', title: 'Supr', onClick: () => t!.remove() },
    );
  }
  return out;
}

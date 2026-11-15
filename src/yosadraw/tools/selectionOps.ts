import { parseHex } from '../brush/ColorMixer';
import { Document } from '../doc/Document';
import { combine, invertSelection, selectAll, selectionBounds, type SelMode, type SelShape } from '../doc/Selection';
import type { Prop, ToolContext } from './types';

/** Modo de combinación según el control y las teclas (Mayús = añadir, Alt = restar, ambas = intersecar). */
export function selMode(ctx: ToolContext, tool: string, e: { shift: boolean; alt: boolean }): SelMode {
  if (e.shift && e.alt) return 'intersect';
  if (e.shift) return 'add';
  if (e.alt) return 'subtract';
  return ctx.setting<SelMode>(tool, 'mode');
}

export function applySelection(ctx: ToolContext, mode: SelMode, shape: SelShape, label: string) {
  const { engine } = ctx;
  const next = combine(engine.doc.selection, mode, shape);
  engine.exec(engine.doc.cmdSelection(next, label));
}

export const selectionActions = {
  deselect(ctx: ToolContext) { if (ctx.engine.doc.selection) ctx.engine.exec(ctx.engine.doc.cmdSelection(null, 'Deseleccionar')); },
  selectAll(ctx: ToolContext) { const d = ctx.engine.doc; ctx.engine.exec(d.cmdSelection(selectAll(d.width, d.height), 'Seleccionar todo')); },
  invert(ctx: ToolContext) { const d = ctx.engine.doc; ctx.engine.exec(d.cmdSelection(invertSelection(d.selection, d.width, d.height), 'Invertir selección')); },
  /** Borra el contenido seleccionado de la capa activa. */
  clear(ctx: ToolContext) {
    const { engine } = ctx, d = engine.doc, sel = d.selection;
    if (!sel) { ctx.notify('Selecciona primero el área que quieres borrar'); return; }
    const layer = engine.editableLayer();
    if (!layer) return;
    engine.exec(d.cmdAddItems(layer.id, [d.item({ kind: 'clear' }, { clip: sel })], 'Borrar selección'));
  },
  /** Rellena la selección con el color principal en la capa activa. */
  fill(ctx: ToolContext) {
    const { engine } = ctx, d = engine.doc, sel = d.selection;
    if (!sel) { ctx.notify('Selecciona primero el área que quieres rellenar'); return; }
    const layer = engine.editableLayer();
    const b = selectionBounds(sel);
    if (!layer || !b) return;
    const shape = d.item({ kind: 'shape', shape: { type: 'rect', x0: b.minX, y0: b.minY, x1: b.maxX, y1: b.maxY, sides: 4, inner: 0.5, radius: 0, fill: ctx.primary, stroke: null, width: 0, opacity: 1 } }, { clip: sel });
    engine.exec(d.cmdAddItems(layer.id, [shape], 'Rellenar selección'));
  },
};

export function selectionProps(ctx: ToolContext, tool: string): Prop[] {
  const has = !!ctx.engine.doc.selection;
  return [
    { type: 'segmented', label: 'Modo', value: ctx.setting<string>(tool, 'mode'), onChange: v => ctx.setSetting(tool, 'mode', v), options: [
      { value: 'replace', label: 'Nueva' }, { value: 'add', label: 'Añadir' }, { value: 'subtract', label: 'Restar' }, { value: 'intersect', label: 'Intersecar' },
    ] },
    { type: 'sep' },
    { type: 'button', label: 'Todo', title: 'Seleccionar todo (Ctrl+A)', onClick: () => selectionActions.selectAll(ctx) },
    { type: 'button', label: 'Invertir', title: 'Invertir selección (Ctrl+Mayús+I)', onClick: () => selectionActions.invert(ctx) },
    { type: 'button', label: 'Deseleccionar', title: 'Ctrl+D', disabled: !has, onClick: () => selectionActions.deselect(ctx) },
    { type: 'button', label: 'Borrar contenido', title: 'Supr', disabled: !has, onClick: () => selectionActions.clear(ctx) },
    { type: 'button', label: 'Rellenar', title: 'Rellenar con el color principal (Alt+Retroceso)', disabled: !has, onClick: () => selectionActions.fill(ctx) },
  ];
}

/** RGB del color principal (para rellenos). */
export const rgbOf = (hex: string) => parseHex(hex);
export { Document };

import { clonePreset, type BrushPreset } from '../brush/BrushPreset';
import type { ShapeType } from '../doc/geometry';
import { bucketHandler, gradientHandler, shapesHandler } from './handlers/paint';
import { eyedropperHandler, rulerHandler, SYMMETRY_MODES, symmetryHandler } from './handlers/guides';
import { lassoHandler, marqueeHandler, wandHandler } from './handlers/selection';
import { transformHandler, type TransformTool } from './handlers/transform';
import { vectorHandler, vectorProps, type VectorTool } from './handlers/vector';
import { OPTION_ICONS, TOOL_ICONS } from './icons';
import { selectionProps } from './selectionOps';
import type { CategoryId, Prop, ToolContext, ToolDef } from './types';

/* ---------------- Herramientas de pincel ---------------- */

function updatePreset(ctx: ToolContext, slot: string, cats: string[], mutate: (p: BrushPreset) => void, commit: boolean) {
  const p = clonePreset(ctx.lib.activeFor(slot, cats));
  mutate(p);
  if (commit) ctx.lib.update(p); else ctx.engine.setBrushPreset(p);
}

function brushProps(ctx: ToolContext, slot: string, cats: string[]): Prop[] {
  const p = ctx.lib.activeFor(slot, cats);
  const u = (m: (p: BrushPreset) => void) => ({ onInput: () => updatePreset(ctx, slot, cats, m, false), onChange: () => updatePreset(ctx, slot, cats, m, true) });
  const slider = (label: string, value: number, min: number, max: number, set: (p: BrushPreset, v: number) => void, extra: Partial<Extract<Prop, { type: 'slider' }>> = {}): Prop => {
    let v = value;
    const handlers = u(q => set(q, v));
    return { type: 'slider', label, value, min, max, ...extra, onInput: x => { v = x; handlers.onInput(); }, onChange: x => { v = x; handlers.onChange(); } };
  };
  const props: Prop[] = [
    { type: 'preset', slot, categories: cats },
    slider('Tamaño', p.size.size, 0.5, 1000, (q, v) => { q.size.size = v; }, { log: true, unit: 'px', step: 0.1 }),
    slider('Opacidad', p.opacity.opacity, 0.01, 1, (q, v) => { q.opacity.opacity = v; }, { unit: '%', display: 100, step: 0.01 }),
    slider('Flujo', p.opacity.flow, 0.01, 1, (q, v) => { q.opacity.flow = v; }, { unit: '%', display: 100, step: 0.01 }),
  ];
  if (p.mix.mode !== 'none') {
    props.push(slider('Recoger color', p.mix.pickup, 0, 1, (q, v) => { q.mix.pickup = v; }, { unit: '%', display: 100, step: 0.01 }));
    props.push(slider('Persistencia', p.mix.persistence, 0, 1, (q, v) => { q.mix.persistence = v; }, { unit: '%', display: 100, step: 0.01 }));
  }
  props.push(slider('StreamLine', p.stabilizer.streamLine, 0, 100, (q, v) => { q.stabilizer.streamLine = v; }, { unit: '%', step: 1 }));
  props.push({ type: 'button', label: 'Editar pincel…', title: 'Abrir en Brush Studio (Intro)', onClick: () => ctx.openBrushStudio(ctx.lib.activeFor(slot, cats)) });
  return props;
}

function brushTool(id: string, label: string, category: CategoryId, shortcut: string[], hint: string, cats: string[], kind: 'brush' | 'eraser' = 'brush'): ToolDef {
  return { id, label, category, icon: TOOL_ICONS[id], shortcut, hint, kind, brushCategories: cats, props: ctx => brushProps(ctx, id, cats) };
}

/* ---------------- Utilidades de propiedades ---------------- */

const pct = (ctx: ToolContext, tool: string, key: string, label: string): Prop => ({
  type: 'slider', label, min: 0, max: 1, step: 0.01, unit: '%', display: 100, value: ctx.setting<number>(tool, key),
  onInput: v => ctx.setSetting(tool, key, v),
});
const toggle = (ctx: ToolContext, tool: string, key: string, label: string): Prop => ({ type: 'toggle', label, value: ctx.setting<boolean>(tool, key), onChange: v => ctx.setSetting(tool, key, v) });
const SAMPLE = [{ value: 'layer', label: 'Capa actual' }, { value: 'all', label: 'Todas las capas' }];

/** La herramienta Transformar se crea una vez para que el panel pueda llamar a sus acciones. */
let transformTool: TransformTool | null = null;
let vectorTool: VectorTool | null = null;

export const TOOLS: ToolDef[] = [
  /* Dibujo */
  brushTool('pencil', 'Lápiz', 'draw', ['N'], 'Grafito y lápices de color con textura de papel', ['Lápices']),
  brushTool('pen', 'Pluma', 'draw', ['P'], 'Entintado: plumillas, tinta técnica, línea lisa y caligrafía', ['Plumas', 'Caligrafía']),
  brushTool('marker', 'Marcador', 'draw', ['K'], 'Rotuladores translúcidos que se oscurecen al superponerse', ['Marcadores']),
  brushTool('brush', 'Pincel', 'draw', ['B'], 'Pinceles redondos, planos y secos, y pinceles de efectos', ['Pinceles', 'Efectos']),

  /* Pintura */
  brushTool('airbrush', 'Aerógrafo', 'paint', ['A'], 'Pintura difusa que se acumula al insistir', ['Aerógrafos']),
  brushTool('watercolor', 'Acuarela', 'paint', ['Q'], 'Veladuras translúcidas; la acuarela húmeda mezcla con lo que hay debajo', ['Acuarelas']),
  brushTool('oil', 'Óleo', 'paint', ['O'], 'Pintura opaca que se mezcla con el color húmedo de la capa', ['Óleos']),
  {
    id: 'bucket', label: 'Bote de pintura', category: 'paint', icon: TOOL_ICONS.bucket, shortcut: ['G'], kind: 'custom',
    hint: 'Rellena el área cerrada con el color principal', defaults: { tolerance: 12, sample: 'all', expand: 1, antialias: true, contiguous: true, opacity: 1 },
    props: ctx => [
      { type: 'slider', label: 'Tolerancia', min: 0, max: 100, step: 1, unit: '%', value: ctx.setting('bucket', 'tolerance'), onInput: v => ctx.setSetting('bucket', 'tolerance', v) },
      { type: 'slider', label: 'Expandir', min: 0, max: 8, step: 1, unit: 'px', value: ctx.setting('bucket', 'expand'), onInput: v => ctx.setSetting('bucket', 'expand', v) },
      pct(ctx, 'bucket', 'opacity', 'Opacidad'),
      { type: 'select', label: 'Muestra', options: SAMPLE, value: ctx.setting('bucket', 'sample'), onChange: v => ctx.setSetting('bucket', 'sample', v) },
      toggle(ctx, 'bucket', 'contiguous', 'Contiguo'), toggle(ctx, 'bucket', 'antialias', 'Bordes suaves'),
    ],
    create: ctx => bucketHandler(ctx, 'bucket'),
  },
  {
    id: 'gradient', label: 'Degradado', category: 'paint', icon: TOOL_ICONS.gradient, shortcut: ['Shift+G'], kind: 'custom',
    hint: 'Arrastra para crear un degradado (Mayús: ángulos de 15°)', defaults: { type: 'linear', colors: 'secondary', opacity: 1, reverse: false },
    props: ctx => [
      { type: 'segmented', label: 'Tipo', value: ctx.setting('gradient', 'type'), onChange: v => ctx.setSetting('gradient', 'type', v), options: [{ value: 'linear', label: 'Lineal' }, { value: 'radial', label: 'Radial' }] },
      { type: 'select', label: 'Colores', value: ctx.setting('gradient', 'colors'), onChange: v => ctx.setSetting('gradient', 'colors', v), options: [{ value: 'secondary', label: 'Principal → secundario' }, { value: 'transparent', label: 'Principal → transparente' }] },
      pct(ctx, 'gradient', 'opacity', 'Opacidad'), toggle(ctx, 'gradient', 'reverse', 'Invertir'),
    ],
    create: ctx => gradientHandler(ctx, 'gradient'),
  },

  /* Edición */
  brushTool('eraser', 'Borrador', 'edit', ['E'], 'Borra con la forma de cualquier pincel', ['Borradores'], 'eraser'),
  brushTool('smudge', 'Difuminador', 'edit', ['S'], 'Arrastra y funde el color que ya hay en la capa', ['Difuminadores']),
  {
    id: 'vector-edit', label: 'Editar vector', category: 'edit', icon: TOOL_ICONS['vector-edit'], shortcut: ['Shift+V'], kind: 'custom',
    hint: 'Capas vectoriales: toca un trazo, arrastra sus nodos (los vecinos siguen con suavidad) o el trazo entero · Supr elimina',
    defaults: { falloff: 60 },
    props: ctx => vectorProps(ctx, 'vector-edit', vectorTool),
    create: ctx => (vectorTool = vectorHandler(ctx, 'vector-edit')),
  },

  /* Selección */
  { id: 'select-rect', label: 'Selección rectangular', category: 'select', icon: TOOL_ICONS['select-rect'], shortcut: ['M'], kind: 'custom', hint: 'Arrastra · Mayús: añadir o cuadrado · Alt: restar o desde el centro', defaults: { mode: 'replace' }, props: ctx => selectionProps(ctx, 'select-rect'), create: ctx => marqueeHandler(ctx, 'select-rect', 'rect') },
  { id: 'select-ellipse', label: 'Selección elíptica', category: 'select', icon: TOOL_ICONS['select-ellipse'], shortcut: ['Shift+M'], kind: 'custom', hint: 'Arrastra · Mayús: añadir o círculo · Alt: restar o desde el centro', defaults: { mode: 'replace' }, props: ctx => selectionProps(ctx, 'select-ellipse'), create: ctx => marqueeHandler(ctx, 'select-ellipse', 'ellipse') },
  {
    id: 'lasso', label: 'Lazo', category: 'select', icon: TOOL_ICONS.lasso, shortcut: ['L'], kind: 'custom', hint: 'A mano alzada o poligonal (clic por vértice; doble clic o Intro para cerrar)', defaults: { mode: 'replace', style: 'free' },
    props: ctx => [{ type: 'segmented', label: 'Trazado', value: ctx.setting('lasso', 'style'), onChange: v => ctx.setSetting('lasso', 'style', v), options: [{ value: 'free', label: 'Libre' }, { value: 'polygonal', label: 'Poligonal' }] }, ...selectionProps(ctx, 'lasso')],
    create: ctx => lassoHandler(ctx, 'lasso'),
  },
  {
    id: 'wand', label: 'Varita mágica', category: 'select', icon: TOOL_ICONS.wand, shortcut: ['W'], kind: 'custom', hint: 'Selecciona el área de color parecido', defaults: { mode: 'replace', tolerance: 15, sample: 'layer', contiguous: true, antialias: true },
    props: ctx => [
      { type: 'slider', label: 'Tolerancia', min: 0, max: 100, step: 1, unit: '%', value: ctx.setting('wand', 'tolerance'), onInput: v => ctx.setSetting('wand', 'tolerance', v) },
      { type: 'select', label: 'Muestra', options: SAMPLE, value: ctx.setting('wand', 'sample'), onChange: v => ctx.setSetting('wand', 'sample', v) },
      toggle(ctx, 'wand', 'contiguous', 'Contiguo'), toggle(ctx, 'wand', 'antialias', 'Bordes suaves'),
      ...selectionProps(ctx, 'wand'),
    ],
    create: ctx => wandHandler(ctx, 'wand'),
  },

  /* Geometría */
  {
    id: 'shapes', label: 'Formas', category: 'geometry', icon: TOOL_ICONS.shapes, shortcut: ['U'], kind: 'custom', hint: 'Mayús: proporción 1:1 o ángulos de 15° · Alt: desde el centro',
    defaults: { shape: 'rect', style: 'fill', width: 6, sides: 6, inner: 0.45, radius: 0, opacity: 1 },
    props: ctx => {
      const shape = ctx.setting<ShapeType>('shapes', 'shape');
      const isLine = shape === 'line' || shape === 'arrow';
      const out: Prop[] = [
        { type: 'segmented', value: shape, onChange: v => ctx.setSetting('shapes', 'shape', v), options: (['rect', 'ellipse', 'line', 'polygon', 'star', 'arrow'] as const).map(v => ({ value: v, label: { rect: 'Rectángulo', ellipse: 'Elipse', line: 'Línea', polygon: 'Polígono', star: 'Estrella', arrow: 'Flecha' }[v], icon: OPTION_ICONS[v] })) },
      ];
      if (!isLine) out.push({ type: 'segmented', label: 'Estilo', value: ctx.setting('shapes', 'style'), onChange: v => ctx.setSetting('shapes', 'style', v), options: [{ value: 'fill', label: 'Relleno' }, { value: 'stroke', label: 'Contorno' }, { value: 'both', label: 'Ambos' }] });
      out.push({ type: 'slider', label: 'Grosor', min: 0.5, max: 200, step: 0.5, unit: 'px', log: true, value: ctx.setting('shapes', 'width'), onInput: v => ctx.setSetting('shapes', 'width', v) });
      if (shape === 'polygon' || shape === 'star') out.push({ type: 'slider', label: shape === 'star' ? 'Puntas' : 'Lados', min: 3, max: 24, step: 1, value: ctx.setting('shapes', 'sides'), onInput: v => ctx.setSetting('shapes', 'sides', v) });
      if (shape === 'star') out.push(pct(ctx, 'shapes', 'inner', 'Radio interior'));
      if (shape === 'rect') out.push({ type: 'slider', label: 'Esquinas', min: 0, max: 400, step: 1, unit: 'px', value: ctx.setting('shapes', 'radius'), onInput: v => ctx.setSetting('shapes', 'radius', v) });
      out.push(pct(ctx, 'shapes', 'opacity', 'Opacidad'));
      out.push({ type: 'note', text: ctx.setting('shapes', 'style') === 'both' && !isLine ? 'Relleno: color principal · Contorno: secundario' : 'Usa el color principal' });
      return out;
    },
    create: ctx => shapesHandler(ctx, 'shapes'),
  },
  {
    id: 'ruler', label: 'Regla', category: 'geometry', icon: TOOL_ICONS.ruler, shortcut: ['J'], kind: 'custom', hint: 'Arrastra para colocarla · los trazos que empiecen cerca siguen la regla',
    props: ctx => {
      const r = ctx.engine.ruler;
      const set = (patch: Partial<typeof r>) => { Object.assign(r, patch); ctx.engine.requestOverlay(); ctx.refreshProps(); };
      const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2, half = Math.max(50, Math.hypot(r.x1 - r.x0, r.y1 - r.y0) / 2);
      return [
        { type: 'toggle', label: 'Usar regla', value: r.enabled, onChange: v => set({ enabled: v }) },
        { type: 'slider', label: 'Enganche', min: 10, max: 200, step: 1, unit: 'px', value: ctx.engine.rulerSnap, onInput: v => { ctx.engine.rulerSnap = v; } },
        { type: 'button', label: 'Horizontal', onClick: () => set({ x0: cx - half, y0: cy, x1: cx + half, y1: cy, enabled: true }) },
        { type: 'button', label: 'Vertical', onClick: () => set({ x0: cx, y0: cy - half, x1: cx, y1: cy + half, enabled: true }) },
        { type: 'note', text: 'Mayús al arrastrar un extremo: ángulos de 15°' },
      ];
    },
    create: ctx => rulerHandler(ctx),
  },
  {
    id: 'symmetry', label: 'Simetría', category: 'geometry', icon: TOOL_ICONS.symmetry, shortcut: ['Y'], kind: 'custom', hint: 'Arrastra para mover el centro (Mayús: ajusta al centro del lienzo)',
    props: ctx => {
      const s = ctx.engine.symmetry;
      const set = (patch: Partial<typeof s>) => { Object.assign(s, patch); ctx.engine.requestOverlay(); ctx.refreshProps(); };
      const out: Prop[] = [
        { type: 'toggle', label: 'Usar simetría', value: s.enabled, onChange: v => set({ enabled: v }) },
        { type: 'segmented', value: s.mode, onChange: v => set({ mode: v as typeof s.mode, enabled: true }), options: SYMMETRY_MODES },
      ];
      if (s.mode === 'radial' || s.mode === 'mandala') out.push({ type: 'slider', label: 'Copias', min: 2, max: 16, step: 1, value: s.count, onInput: v => set({ count: v }) });
      out.push({ type: 'button', label: 'Centrar', onClick: () => set({ cx: ctx.engine.doc.width / 2, cy: ctx.engine.doc.height / 2 }) });
      out.push({ type: 'note', text: 'Afecta a todos los pinceles y al borrador' });
      return out;
    },
    create: ctx => symmetryHandler(ctx),
  },

  /* Transformación */
  {
    id: 'transform', label: 'Transformar', category: 'transform', icon: TOOL_ICONS.transform, shortcut: ['V', 'Ctrl+T'], kind: 'custom',
    hint: 'Dentro: mover · tiradores: escalar (Mayús proporción, Alt desde el centro) · fuera: girar · Intro aplica, Esc cancela', defaults: { proportional: false },
    props: ctx => {
      const t = transformTool;
      const active = !!t?.active;
      return [
        { type: 'note', text: !active ? 'Sin contenido que transformar' : t!.mode === 'selection' ? 'Selección levantada (se transforma como imagen)' : 'Capa completa (sigue siendo vectorial)' },
        toggle(ctx, 'transform', 'proportional', 'Proporcional'),
        { type: 'button', label: 'Voltear H', onClick: () => t?.flip('h') },
        { type: 'button', label: 'Voltear V', onClick: () => t?.flip('v') },
        { type: 'button', label: '↺ 90°', onClick: () => t?.rotate90(-1) },
        { type: 'button', label: '↻ 90°', onClick: () => t?.rotate90(1) },
        { type: 'button', label: 'Restablecer', disabled: !active, onClick: () => t?.reset() },
        { type: 'sep' },
        { type: 'button', label: 'Cancelar', disabled: !active, title: 'Esc', onClick: () => t?.discard() },
        { type: 'button', label: 'Aplicar', primary: true, disabled: !active, title: 'Intro', onClick: () => t?.apply() },
      ];
    },
    create: ctx => (transformTool = transformHandler(ctx, 'transform')),
  },

  /* Color */
  {
    id: 'eyedropper', label: 'Cuentagotas', category: 'color', icon: TOOL_ICONS.eyedropper, shortcut: ['I'], kind: 'custom',
    hint: 'Toma un color del lienzo (con cualquier pincel: Alt + clic)', defaults: { sample: 'all', size: 3 },
    props: ctx => [
      { type: 'select', label: 'Muestra', options: SAMPLE, value: ctx.setting('eyedropper', 'sample'), onChange: v => ctx.setSetting('eyedropper', 'sample', v) },
      { type: 'segmented', label: 'Promedio', value: String(ctx.setting('eyedropper', 'size')), onChange: v => ctx.setSetting('eyedropper', 'size', Number(v)), options: [{ value: '1', label: '1 px' }, { value: '3', label: '3×3' }, { value: '5', label: '5×5' }, { value: '11', label: '11×11' }] },
    ],
    create: ctx => eyedropperHandler(ctx, 'eyedropper'),
  },

  /* Vista (herramientas de navegación existentes) */
  { id: 'hand', label: 'Mano', category: 'view', icon: TOOL_ICONS.hand, shortcut: ['H'], kind: 'pan', hint: 'Desplaza el lienzo (también: mantener Espacio, rueda o dos dedos)' },
  { id: 'rotate-view', label: 'Rotar vista', category: 'view', icon: TOOL_ICONS['rotate-view'], shortcut: ['R'], kind: 'rotate', hint: 'Gira la vista (Mayús: 15°; Mayús+R endereza)' },
];

import { clonePreset, DEFAULT_PRESET, normalizePreset, type BrushPreset, type CurvePoint } from './BrushPreset';

type DeepPartial<T> = { [K in keyof T]?: T[K] extends (infer U)[] ? U[] : T[K] extends object ? DeepPartial<T[K]> : T[K] };

function merge<T>(base: T, over: DeepPartial<T>): T {
  const out = clonePreset(base as unknown as BrushPreset) as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = merge(out[k], v as never);
    else out[k] = v;
  }
  return out as T;
}

const SOFT_IN: CurvePoint[] = [[0, 0], [0.4, 0.18], [0.75, 0.55], [1, 1]];
const FIRM: CurvePoint[] = [[0, 0.1], [0.25, 0.45], [0.6, 0.82], [1, 1]];

function mk(builtinId: string, name: string, category: string, over: DeepPartial<BrushPreset>): BrushPreset {
  return normalizePreset(merge(DEFAULT_PRESET, { ...over, id: `builtin-${builtinId}`, builtinId, name, category, revision: 1 }));
}

/** Pinceles de fábrica. Cada uno usa los parámetros de forma distinta. */
export const BUILTIN_PRESETS: BrushPreset[] = [
  mk('pencil-hb', 'Lápiz HB', 'Lápices', {
    tip: { shape: 'round', hardness: 0.75 },
    grain: { enabled: true, type: 'pencil', scale: 0.6, depth: 0.75, contrast: 1.3, mode: 'fixed' },
    spacing: { spacing: 0.06 },
    size: { size: 4, minPercent: 0.25 },
    opacity: { opacity: 0.9, flow: 0.85 },
    pressure: { size: 0.45, opacity: 0.75, curve: SOFT_IN },
    tilt: { size: 1.2, opacity: -0.3, roundness: 0.6, threshold: 25 },
    stabilizer: { streamLine: 8, stabilization: 15, motionFiltering: 10, pressureSmoothing: 30 },
  }),
  mk('graphite-6b', 'Grafito 6B', 'Lápices', {
    tip: { shape: 'rough', hardness: 0.55 },
    grain: { enabled: true, type: 'paper', scale: 0.8, depth: 0.85, contrast: 1.5, mode: 'fixed' },
    spacing: { spacing: 0.08 },
    size: { size: 10, minPercent: 0.3 },
    opacity: { opacity: 0.85, flow: 0.55 },
    pressure: { size: 0.4, opacity: 0.9, curve: SOFT_IN },
    tilt: { size: 1.6, roundness: 0.7, threshold: 20 },
    rotation: { mode: 'direction', jitter: 0.05 },
    render: { accumulation: 'buildup' },
    stabilizer: { streamLine: 5, stabilization: 12, motionFiltering: 10, pressureSmoothing: 25 },
  }),
  mk('technical-pen', 'Tinta técnica', 'Plumas', {
    tip: { shape: 'round', hardness: 1 },
    spacing: { spacing: 0.05 },
    size: { size: 4, minPercent: 1 },
    pressure: { size: 0, opacity: 0 },
    stabilizer: { streamLine: 45, stabilization: 35, motionFiltering: 20, pressureSmoothing: 30 },
  }),
  mk('inking-nib', 'Plumilla de entintado', 'Plumas', {
    tip: { shape: 'round', hardness: 1 },
    spacing: { spacing: 0.05 },
    size: { size: 9, minPercent: 0.04, taperStart: 30, taperEnd: 45, taperMin: 0.05 },
    pressure: { size: 0.95, curve: SOFT_IN },
    stabilizer: { streamLine: 40, stabilization: 30, motionFiltering: 20, pressureSmoothing: 40 },
  }),
  mk('smooth-line', 'Línea lisa vectorial', 'Plumas', {
    render: { mode: 'smooth' },
    size: { size: 6, minPercent: 0.18 },
    pressure: { size: 0.82 },
    stabilizer: { streamLine: 40, stabilization: 35, motionFiltering: 20, pressureSmoothing: 30 },
  }),
  mk('marker', 'Rotulador', 'Marcadores', {
    tip: { shape: 'round', hardness: 0.92, roundness: 0.85, angle: 30 },
    spacing: { spacing: 0.04 },
    size: { size: 18, minPercent: 0.7 },
    opacity: { opacity: 0.7, flow: 1 },
    pressure: { size: 0.25, opacity: 0 },
    render: { blend: 'multiply', accumulation: 'glaze' },
    stabilizer: { streamLine: 20, stabilization: 20, motionFiltering: 10, pressureSmoothing: 20 },
  }),
  mk('calligraphy', 'Pincel caligráfico', 'Caligrafía', {
    tip: { shape: 'round', hardness: 0.98, roundness: 0.16, angle: 40 },
    spacing: { spacing: 0.03 },
    size: { size: 28, minPercent: 0.2, taperStart: 20, taperEnd: 30, taperMin: 0.3 },
    pressure: { size: 0.75, curve: FIRM },
    rotation: { mode: 'fixed' },
    stabilizer: { streamLine: 55, stabilization: 30, motionFiltering: 20, pressureSmoothing: 35 },
  }),
  mk('lettering', 'Lettering monolínea', 'Caligrafía', {
    tip: { shape: 'round', hardness: 1 },
    spacing: { spacing: 0.04 },
    size: { size: 14, minPercent: 0.12 },
    pressure: { size: 0.9, curve: FIRM },
    stabilizer: { streamLine: 70, stabilization: 30, motionFiltering: 15, pressureSmoothing: 40 },
  }),
  mk('airbrush', 'Aerógrafo suave', 'Aerógrafos', {
    tip: { shape: 'round', hardness: 0 },
    spacing: { spacing: 0.06 },
    size: { size: 120, minPercent: 0.6 },
    opacity: { opacity: 1, flow: 0.07 },
    pressure: { size: 0.2, opacity: 1 },
    render: { accumulation: 'buildup' },
    stabilizer: { streamLine: 15, stabilization: 25, motionFiltering: 10, pressureSmoothing: 30 },
  }),
  mk('watercolor', 'Acuarela', 'Acuarelas', {
    tip: { shape: 'round', hardness: 0.25 },
    grain: { enabled: true, type: 'paper', scale: 2, depth: 0.4, contrast: 1.2, mode: 'fixed' },
    spacing: { spacing: 0.06 },
    size: { size: 60, minPercent: 0.4 },
    opacity: { opacity: 0.45, flow: 0.3 },
    pressure: { size: 0.4, opacity: 0.6 },
    render: { blend: 'multiply', accumulation: 'glaze' },
    stabilizer: { streamLine: 30, stabilization: 25, motionFiltering: 10, pressureSmoothing: 30 },
  }),
  mk('dry-brush', 'Pincel seco', 'Pinceles', {
    tip: { shape: 'rough', hardness: 0.7, roundness: 0.8 },
    grain: { enabled: true, type: 'canvas', scale: 0.9, depth: 0.75, contrast: 1.25, mode: 'fixed' },
    spacing: { spacing: 0.1, jitter: 0.3 },
    scatter: { amount: 0.12, count: 2 },
    rotation: { mode: 'direction', jitter: 0.15 },
    size: { size: 38, minPercent: 0.3, jitter: 0.15 },
    opacity: { opacity: 1, flow: 0.7, flowJitter: 0.3 },
    pressure: { size: 0.6, opacity: 0.4 },
    stabilizer: { streamLine: 15, stabilization: 20, motionFiltering: 15, pressureSmoothing: 30 },
  }),
  mk('charcoal', 'Carboncillo', 'Lápices', {
    tip: { shape: 'rough', hardness: 0.6 },
    grain: { enabled: true, type: 'paper', scale: 1.4, depth: 0.9, contrast: 1.7, mode: 'fixed' },
    spacing: { spacing: 0.07 },
    rotation: { mode: 'direction', jitter: 0.3 },
    size: { size: 22, minPercent: 0.3, speed: -0.3 },
    opacity: { opacity: 1, flow: 0.55 },
    pressure: { size: 0.5, opacity: 0.8 },
    tilt: { size: 0.8, roundness: 0.5 },
    render: { accumulation: 'buildup' },
    stabilizer: { streamLine: 5, stabilization: 15, motionFiltering: 15, pressureSmoothing: 25 },
  }),
  mk('spray', 'Spray', 'Aerógrafos', {
    tip: { shape: 'spray' },
    spacing: { spacing: 0.3, jitter: 0.4 },
    scatter: { amount: 0.35, count: 3, countJitter: 0.5, bothAxes: true },
    rotation: { mode: 'random', jitter: 1 },
    size: { size: 70, minPercent: 0.5, jitter: 0.2 },
    opacity: { opacity: 1, flow: 0.75, flowJitter: 0.4 },
    pressure: { size: 0.25, opacity: 0.8 },
    stabilizer: { streamLine: 0, stabilization: 10, motionFiltering: 0, pressureSmoothing: 20 },
  }),
  mk('stars', 'Confeti de estrellas', 'Efectos', {
    tip: { shape: 'star', hardness: 0.95 },
    spacing: { spacing: 1.6, jitter: 0.5 },
    scatter: { amount: 1.1, count: 2, countJitter: 0.5, bothAxes: true },
    rotation: { mode: 'random', jitter: 1 },
    size: { size: 26, minPercent: 0.2, jitter: 0.6 },
    opacity: { opacity: 1, flow: 1, flowJitter: 0.45 },
    pressure: { size: 0.4 },
    stabilizer: { streamLine: 0, stabilization: 0, motionFiltering: 0, pressureSmoothing: 0 },
  }),
  mk('color-pencil', 'Lápiz de color', 'Lápices', {
    tip: { shape: 'round', hardness: 0.6 },
    grain: { enabled: true, type: 'paper', scale: 0.7, depth: 0.7, contrast: 1.4, mode: 'fixed' },
    spacing: { spacing: 0.07 },
    size: { size: 7, minPercent: 0.35 },
    opacity: { opacity: 0.85, flow: 0.7 },
    pressure: { size: 0.35, opacity: 0.85, curve: SOFT_IN },
    tilt: { size: 1.3, roundness: 0.55, threshold: 25 },
    render: { accumulation: 'buildup' },
    stabilizer: { streamLine: 6, stabilization: 12, motionFiltering: 10, pressureSmoothing: 30 },
  }),
  mk('chisel-marker', 'Marcador biselado', 'Marcadores', {
    tip: { shape: 'square', hardness: 0.9, roundness: 0.32, angle: 45 },
    spacing: { spacing: 0.03 },
    size: { size: 26, minPercent: 0.85 },
    opacity: { opacity: 0.75, flow: 1 },
    pressure: { size: 0.1, opacity: 0 },
    render: { blend: 'multiply', accumulation: 'glaze' },
    stabilizer: { streamLine: 25, stabilization: 15, motionFiltering: 10, pressureSmoothing: 20 },
  }),
  mk('fineliner', 'Rotulador fino', 'Marcadores', {
    tip: { shape: 'round', hardness: 0.97 },
    spacing: { spacing: 0.04 },
    size: { size: 3, minPercent: 0.8 },
    opacity: { opacity: 0.92, flow: 1 },
    pressure: { size: 0.15, opacity: 0 },
    render: { blend: 'multiply' },
    stabilizer: { streamLine: 35, stabilization: 25, motionFiltering: 15, pressureSmoothing: 20 },
  }),
  mk('round-brush', 'Pincel redondo', 'Pinceles', {
    tip: { shape: 'round', hardness: 0.8 },
    spacing: { spacing: 0.04 },
    size: { size: 22, minPercent: 0.08, taperStart: 25, taperEnd: 35, taperMin: 0.15 },
    opacity: { opacity: 1, flow: 0.95 },
    pressure: { size: 0.9, opacity: 0.25, curve: SOFT_IN },
    stabilizer: { streamLine: 20, stabilization: 20, motionFiltering: 10, pressureSmoothing: 30 },
  }),
  mk('flat-brush', 'Pincel plano', 'Pinceles', {
    tip: { shape: 'rough', hardness: 0.75, roundness: 0.3 },
    spacing: { spacing: 0.05 },
    rotation: { mode: 'direction', jitter: 0.03 },
    size: { size: 34, minPercent: 0.4 },
    opacity: { opacity: 1, flow: 0.85, flowJitter: 0.15 },
    pressure: { size: 0.5, opacity: 0.5 },
    stabilizer: { streamLine: 15, stabilization: 20, motionFiltering: 10, pressureSmoothing: 30 },
  }),
  mk('hard-airbrush', 'Aerógrafo duro', 'Aerógrafos', {
    tip: { shape: 'round', hardness: 0.7 },
    spacing: { spacing: 0.05 },
    size: { size: 60, minPercent: 0.5 },
    opacity: { opacity: 1, flow: 0.12 },
    pressure: { size: 0.3, opacity: 1 },
    render: { accumulation: 'buildup' },
    stabilizer: { streamLine: 10, stabilization: 20, motionFiltering: 10, pressureSmoothing: 30 },
  }),
  mk('wet-watercolor', 'Acuarela húmeda', 'Acuarelas', {
    tip: { shape: 'round', hardness: 0.35 },
    grain: { enabled: true, type: 'paper', scale: 1.6, depth: 0.35, contrast: 1.1, mode: 'fixed' },
    spacing: { spacing: 0.06 },
    size: { size: 50, minPercent: 0.4 },
    opacity: { opacity: 0.55, flow: 0.4 },
    pressure: { size: 0.4, opacity: 0.6 },
    mix: { mode: 'wet', pickup: 0.55, persistence: 0.75, paint: 0.6 },
    render: { blend: 'multiply', accumulation: 'glaze' },
    stabilizer: { streamLine: 25, stabilization: 25, motionFiltering: 10, pressureSmoothing: 30 },
  }),
  mk('wash', 'Lavado de acuarela', 'Acuarelas', {
    tip: { shape: 'round', hardness: 0.1 },
    grain: { enabled: true, type: 'paper', scale: 2.4, depth: 0.25, contrast: 1, mode: 'fixed' },
    spacing: { spacing: 0.08 },
    size: { size: 160, minPercent: 0.6 },
    opacity: { opacity: 0.32, flow: 0.18 },
    pressure: { size: 0.2, opacity: 0.6 },
    render: { blend: 'multiply', accumulation: 'glaze' },
    stabilizer: { streamLine: 20, stabilization: 20, motionFiltering: 10, pressureSmoothing: 30 },
  }),
  mk('oil-round', 'Óleo redondo', 'Óleos', {
    tip: { shape: 'rough', hardness: 0.85 },
    grain: { enabled: true, type: 'canvas', scale: 0.8, depth: 0.3, contrast: 1.1, mode: 'fixed' },
    spacing: { spacing: 0.05 },
    size: { size: 30, minPercent: 0.35 },
    opacity: { opacity: 1, flow: 0.95 },
    pressure: { size: 0.6, opacity: 0.2 },
    mix: { mode: 'wet', pickup: 0.6, persistence: 0.7, paint: 0.55 },
    stabilizer: { streamLine: 10, stabilization: 15, motionFiltering: 10, pressureSmoothing: 30 },
  }),
  mk('oil-impasto', 'Óleo plano (empaste)', 'Óleos', {
    tip: { shape: 'rough', hardness: 0.9, roundness: 0.38 },
    spacing: { spacing: 0.04 },
    rotation: { mode: 'direction', jitter: 0.04 },
    size: { size: 42, minPercent: 0.5 },
    opacity: { opacity: 1, flow: 1 },
    pressure: { size: 0.45, opacity: 0.1 },
    mix: { mode: 'wet', pickup: 0.45, persistence: 0.8, paint: 0.65 },
    stabilizer: { streamLine: 12, stabilization: 15, motionFiltering: 10, pressureSmoothing: 30 },
  }),
  mk('smudge-soft', 'Difuminador suave', 'Difuminadores', {
    tip: { shape: 'round', hardness: 0.1 },
    spacing: { spacing: 0.05 },
    size: { size: 45, minPercent: 0.5 },
    opacity: { opacity: 1, flow: 0.6 },
    pressure: { size: 0.3, opacity: 0.8 },
    mix: { mode: 'smudge', pickup: 0.9, persistence: 0.85, paint: 0 },
    stabilizer: { streamLine: 10, stabilization: 15, motionFiltering: 5, pressureSmoothing: 30 },
  }),
  mk('smudge-texture', 'Difuminador de textura', 'Difuminadores', {
    tip: { shape: 'rough', hardness: 0.6 },
    grain: { enabled: true, type: 'paper', scale: 1.2, depth: 0.6, contrast: 1.3, mode: 'fixed' },
    spacing: { spacing: 0.06 },
    size: { size: 35, minPercent: 0.5 },
    opacity: { opacity: 1, flow: 0.7 },
    pressure: { size: 0.3, opacity: 0.7 },
    mix: { mode: 'smudge', pickup: 0.8, persistence: 0.7, paint: 0 },
    stabilizer: { streamLine: 10, stabilization: 15, motionFiltering: 5, pressureSmoothing: 30 },
  }),
  mk('eraser-hard', 'Borrador duro', 'Borradores', {
    tip: { shape: 'round', hardness: 0.95 },
    spacing: { spacing: 0.06 },
    size: { size: 30, minPercent: 0.6 },
    pressure: { size: 0.3, opacity: 0 },
    stabilizer: { streamLine: 5, stabilization: 10, motionFiltering: 5, pressureSmoothing: 20 },
  }),
  mk('eraser-soft', 'Borrador suave', 'Borradores', {
    tip: { shape: 'round', hardness: 0 },
    spacing: { spacing: 0.06 },
    size: { size: 90, minPercent: 0.6 },
    opacity: { opacity: 1, flow: 0.25 },
    pressure: { size: 0.2, opacity: 0.8 },
    render: { accumulation: 'buildup' },
    stabilizer: { streamLine: 5, stabilization: 10, motionFiltering: 5, pressureSmoothing: 20 },
  }),
];

export const DEFAULT_BRUSH_ID = 'builtin-inking-nib';
export const DEFAULT_ERASER_ID = 'builtin-eraser-hard';
export const CATEGORY_ORDER = ['Lápices', 'Plumas', 'Caligrafía', 'Marcadores', 'Pinceles', 'Aerógrafos', 'Acuarelas', 'Óleos', 'Difuminadores', 'Efectos', 'Borradores'];

/** Versión del juego de fábrica. Al subirla, las bibliotecas guardadas reciben los pinceles nuevos. */
export const FACTORY_VERSION = 2;
/** Categorías de la versión 1 de cada pincel de fábrica (para migrar bibliotecas guardadas). */
export const LEGACY_CATEGORY: Record<string, string> = {
  'pencil-hb': 'Bocetos', 'graphite-6b': 'Bocetos', 'technical-pen': 'Entintado', 'inking-nib': 'Entintado', 'smooth-line': 'Entintado',
  marker: 'Entintado', airbrush: 'Pintura', watercolor: 'Pintura', 'dry-brush': 'Pintura', charcoal: 'Texturas', spray: 'Texturas',
};

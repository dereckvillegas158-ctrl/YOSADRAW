/**
 * Formato de preset de pincel de YOSADRAW (versión 1).
 *
 * Todo el comportamiento del pincel sale de aquí: el generador de sellos y el
 * renderizador sólo leen estos valores. Para añadir un parámetro nuevo:
 *   1) añadirlo al tipo y a DEFAULT_PRESET,
 *   2) darle rango en `normalizePreset` (validación de importaciones),
 *   3) usarlo en DabGenerator / StrokePainter,
 *   4) describir su control en `schema.ts` (la interfaz se genera sola).
 */
export type TipShape = 'round' | 'square' | 'diamond' | 'triangle' | 'star' | 'rough' | 'spray' | 'image';
export type GrainType = 'paper' | 'noise' | 'canvas' | 'pencil' | 'stipple' | 'image';
export type RotationMode = 'fixed' | 'direction' | 'azimuth' | 'random';
export type RenderMode = 'stamp' | 'smooth';
export type BlendMode = 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'color-burn' | 'soft-light';
export type Accumulation = 'glaze' | 'buildup';
export type CurvePoint = [number, number];
export type MixMode = 'none' | 'wet' | 'smudge';
/** Borde del trazo: tal cual · suave (antialiasing que suaviza el borde) · duro (contorno vectorial limpio, sellos por dentro). */
export type EdgeMode = 'normal' | 'soft' | 'hard';

export interface BrushPreset {
  format: 'yosadraw-brush';
  version: 1;
  id: string;
  name: string;
  category: string;
  /** Si viene de fábrica: permite "Restablecer". */
  builtinId?: string;
  /** Se incrementa en cada guardado (invalida miniaturas en caché). */
  revision: number;

  tip: {
    shape: TipShape;
    /** 0 = borde muy difuso, 1 = borde duro. */
    hardness: number;
    /** 0.05..1: 1 = círculo, valores bajos = punta plana. */
    roundness: number;
    /** Grados. */
    angle: number;
    flipX: boolean;
    flipY: boolean;
    /** Imagen de forma (data URL PNG) cuando shape = 'image'. */
    image?: string;
    /** Para imágenes: true = lo claro pinta; false = lo oscuro pinta. */
    invert: boolean;
  };
  grain: {
    enabled: boolean;
    type: GrainType;
    /** Escala del patrón (×). */
    scale: number;
    /** 0..1: cuánto se nota el grano. */
    depth: number;
    /** 0.2..3. */
    contrast: number;
    invert: boolean;
    /** fixed = el grano pertenece al papel; moving = viaja con cada sello. */
    mode: 'fixed' | 'moving';
    image?: string;
  };
  spacing: {
    /** Fracción del diámetro entre sellos (0.01..3). */
    spacing: number;
    /** 0..1. */
    jitter: number;
  };
  scatter: {
    /** Desplazamiento máximo en diámetros (0..5). */
    amount: number;
    /** Sellos por paso (1..16). */
    count: number;
    countJitter: number;
    /** false = sólo perpendicular al trazo. */
    bothAxes: boolean;
  };
  rotation: {
    mode: RotationMode;
    /** 0..1 (fracción de ±180°). */
    jitter: number;
  };
  size: {
    /** Diámetro base en píxeles del documento (0.5..1000). */
    size: number;
    /** Tamaño mínimo como fracción del base (0..1). */
    minPercent: number;
    jitter: number;
    /** -1..1: negativo adelgaza al ir rápido, positivo engrosa. */
    speed: number;
    /** Longitud de afilado al inicio y al final (px de documento). */
    taperStart: number;
    taperEnd: number;
    /** Tamaño en la punta del afilado (0..1). */
    taperMin: number;
  };
  opacity: {
    /** Opacidad máxima del trazo (0..1). */
    opacity: number;
    /** Opacidad de cada sello (0..1). */
    flow: number;
    flowJitter: number;
    /** -1..1. */
    speed: number;
    /** El afilado también aclara. */
    taperOpacity: boolean;
  };
  pressure: {
    /** Influencia de la presión en el tamaño (0..1). */
    size: number;
    /** Influencia de la presión en el flujo (0..1). */
    opacity: number;
    /** Curva de respuesta: puntos (x,y) en 0..1, x creciente. */
    curve: CurvePoint[];
    /** Con ratón (sin sensor), simula la presión con la velocidad. */
    simulateMouse: boolean;
  };
  tilt: {
    /** -1..1: efecto de la inclinación en el tamaño. */
    size: number;
    /** -1..1: efecto en el flujo. */
    opacity: number;
    /** 0..1: aplana la punta al inclinar (sombreado con lápiz). */
    roundness: number;
    /** Grados desde la vertical a partir de los que actúa (0..80). */
    threshold: number;
  };
  render: {
    mode: RenderMode;
    blend: BlendMode;
    accumulation: Accumulation;
    edge: EdgeMode;
    /** Intensidad del borde suave (0..1) o grosor del contorno duro respecto al sello (0..1). */
    edgeAmount: number;
  };
  /** Dinámica de color: cada sello (o cada trazo) varía el color elegido. */
  color: {
    /** Variación de tono, saturación y luminosidad (0..1). */
    hue: number;
    sat: number;
    light: number;
    /** true = una variación por trazo; false = por sello. */
    perStroke: boolean;
  };
  /**
   * Mezcla de color con lo que ya hay en la capa (óleo, acuarela húmeda,
   * difuminador). El color de cada sello se calcula al dibujar y se guarda
   * con el trazo, así el resultado no cambia al repintar.
   */
  mix: {
    /** none = color puro · wet = mezcla con la pintura húmeda · smudge = arrastra el color sin añadir. */
    mode: MixMode;
    /** Cuánto color del lienzo recoge cada sello (0..1). */
    pickup: number;
    /** Cuánto dura el color recogido a lo largo del trazo (0..1). */
    persistence: number;
    /** Cuánta pintura nueva aporta el pincel en modo húmedo (0..1). */
    paint: number;
  };
  /** Ajustes del estabilizador para este pincel (0..100). */
  stabilizer: {
    streamLine: number;
    stabilization: number;
    motionFiltering: number;
    pressureSmoothing: number;
  };
}

export const LINEAR_CURVE: CurvePoint[] = [[0, 0], [0.33, 0.33], [0.67, 0.67], [1, 1]];

export const DEFAULT_PRESET: BrushPreset = {
  format: 'yosadraw-brush', version: 1, id: '', name: 'Pincel nuevo', category: 'Mis pinceles', revision: 1,
  tip: { shape: 'round', hardness: 0.85, roundness: 1, angle: 0, flipX: false, flipY: false, invert: false },
  grain: { enabled: false, type: 'paper', scale: 1, depth: 0.6, contrast: 1, invert: false, mode: 'fixed' },
  spacing: { spacing: 0.08, jitter: 0 },
  scatter: { amount: 0, count: 1, countJitter: 0, bothAxes: false },
  rotation: { mode: 'fixed', jitter: 0 },
  size: { size: 12, minPercent: 0.05, jitter: 0, speed: 0, taperStart: 0, taperEnd: 0, taperMin: 0.1 },
  opacity: { opacity: 1, flow: 1, flowJitter: 0, speed: 0, taperOpacity: false },
  pressure: { size: 0.8, opacity: 0, curve: LINEAR_CURVE.map(p => [...p] as CurvePoint), simulateMouse: false },
  tilt: { size: 0, opacity: 0, roundness: 0, threshold: 20 },
  render: { mode: 'stamp', blend: 'normal', accumulation: 'glaze', edge: 'normal', edgeAmount: 0.5 },
  color: { hue: 0, sat: 0, light: 0, perStroke: false },
  mix: { mode: 'none', pickup: 0.5, persistence: 0.6, paint: 0.7 },
  stabilizer: { streamLine: 25, stabilization: 20, motionFiltering: 10, pressureSmoothing: 30 },
};

const SHAPES: TipShape[] = ['round', 'square', 'diamond', 'triangle', 'star', 'rough', 'spray', 'image'];
const GRAINS: GrainType[] = ['paper', 'noise', 'canvas', 'pencil', 'stipple', 'image'];
const ROTS: RotationMode[] = ['fixed', 'direction', 'azimuth', 'random'];
const BLENDS: BlendMode[] = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-burn', 'soft-light'];

export function newId(): string {
  const r = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return 'b_' + r.replace(/-/g, '').slice(0, 16);
}

export function clonePreset<T extends BrushPreset>(p: T): T {
  return JSON.parse(JSON.stringify(p));
}

/* ---------- Validación ---------- */
const num = (v: unknown, def: number, lo: number, hi: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def;
const bool = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def);
const pick = <T extends string>(v: unknown, list: readonly T[], def: T): T => (list.includes(v as T) ? (v as T) : def);
const str = (v: unknown, def: string, max = 80) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : def);
const img = (v: unknown) => (typeof v === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(v) && v.length < 3_000_000 ? v : undefined);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

export function normalizeCurve(v: unknown): CurvePoint[] {
  if (!Array.isArray(v)) return LINEAR_CURVE.map(p => [...p] as CurvePoint);
  const pts = v
    .filter((p): p is [number, number] => Array.isArray(p) && p.length === 2 && p.every(n => typeof n === 'number' && Number.isFinite(n)))
    .map(([x, y]) => [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))] as CurvePoint)
    .sort((a, b) => a[0] - b[0]);
  if (pts.length < 2) return LINEAR_CURVE.map(p => [...p] as CurvePoint);
  pts[0][0] = 0;
  pts[pts.length - 1][0] = 1;
  return pts.slice(0, 8);
}

/**
 * Convierte cualquier objeto (p. ej. un archivo importado) en un preset válido:
 * rellena lo que falte con valores por defecto y limita cada número a su rango.
 */
export function normalizePreset(input: unknown): BrushPreset {
  const i = obj(input), d = DEFAULT_PRESET;
  const tip = obj(i.tip), grain = obj(i.grain), spacing = obj(i.spacing), scatter = obj(i.scatter), rotation = obj(i.rotation);
  const size = obj(i.size), opacity = obj(i.opacity), pressure = obj(i.pressure), tilt = obj(i.tilt), render = obj(i.render), stab = obj(i.stabilizer), mix = obj(i.mix), color = obj(i.color);
  const tipImage = img(tip.image), grainImage = img(grain.image);
  return {
    format: 'yosadraw-brush', version: 1,
    id: typeof i.id === 'string' && /^[\w-]{3,40}$/.test(i.id) ? i.id : newId(),
    name: str(i.name, d.name), category: str(i.category, d.category, 40),
    builtinId: typeof i.builtinId === 'string' ? i.builtinId.slice(0, 40) : undefined,
    revision: num(i.revision, 1, 1, 1e9),
    tip: {
      shape: (() => { const s = pick(tip.shape, SHAPES, d.tip.shape); return s === 'image' && !tipImage ? 'round' : s; })(),
      hardness: num(tip.hardness, d.tip.hardness, 0, 1), roundness: num(tip.roundness, d.tip.roundness, 0.05, 1),
      angle: num(tip.angle, d.tip.angle, -360, 360), flipX: bool(tip.flipX, false), flipY: bool(tip.flipY, false),
      image: tipImage, invert: bool(tip.invert, false),
    },
    grain: {
      enabled: bool(grain.enabled, d.grain.enabled),
      type: (() => { const t = pick(grain.type, GRAINS, d.grain.type); return t === 'image' && !grainImage ? 'paper' : t; })(),
      scale: num(grain.scale, d.grain.scale, 0.1, 6), depth: num(grain.depth, d.grain.depth, 0, 1),
      contrast: num(grain.contrast, d.grain.contrast, 0.2, 3), invert: bool(grain.invert, false),
      mode: pick(grain.mode, ['fixed', 'moving'] as const, d.grain.mode), image: grainImage,
    },
    spacing: { spacing: num(spacing.spacing, d.spacing.spacing, 0.01, 3), jitter: num(spacing.jitter, 0, 0, 1) },
    scatter: {
      amount: num(scatter.amount, 0, 0, 5), count: Math.round(num(scatter.count, 1, 1, 16)),
      countJitter: num(scatter.countJitter, 0, 0, 1), bothAxes: bool(scatter.bothAxes, false),
    },
    rotation: { mode: pick(rotation.mode, ROTS, d.rotation.mode), jitter: num(rotation.jitter, 0, 0, 1) },
    size: {
      size: num(size.size, d.size.size, 0.5, 1000), minPercent: num(size.minPercent, d.size.minPercent, 0, 1),
      jitter: num(size.jitter, 0, 0, 1), speed: num(size.speed, 0, -1, 1),
      taperStart: num(size.taperStart, 0, 0, 2000), taperEnd: num(size.taperEnd, 0, 0, 2000), taperMin: num(size.taperMin, d.size.taperMin, 0, 1),
    },
    opacity: {
      opacity: num(opacity.opacity, 1, 0.01, 1), flow: num(opacity.flow, 1, 0.01, 1),
      flowJitter: num(opacity.flowJitter, 0, 0, 1), speed: num(opacity.speed, 0, -1, 1), taperOpacity: bool(opacity.taperOpacity, false),
    },
    pressure: {
      size: num(pressure.size, d.pressure.size, 0, 1), opacity: num(pressure.opacity, d.pressure.opacity, 0, 1),
      curve: normalizeCurve(pressure.curve), simulateMouse: bool(pressure.simulateMouse, false),
    },
    tilt: {
      size: num(tilt.size, 0, -1, 1), opacity: num(tilt.opacity, 0, -1, 1),
      roundness: num(tilt.roundness, 0, 0, 1), threshold: num(tilt.threshold, d.tilt.threshold, 0, 80),
    },
    render: {
      mode: pick(render.mode, ['stamp', 'smooth'] as const, d.render.mode),
      blend: pick(render.blend, BLENDS, d.render.blend),
      accumulation: pick(render.accumulation, ['glaze', 'buildup'] as const, d.render.accumulation),
      edge: pick(render.edge, ['normal', 'soft', 'hard'] as const, 'normal'), edgeAmount: num(render.edgeAmount, d.render.edgeAmount, 0, 1),
    },
    color: { hue: num(color.hue, 0, 0, 1), sat: num(color.sat, 0, 0, 1), light: num(color.light, 0, 0, 1), perStroke: bool(color.perStroke, false) },
    mix: {
      mode: pick(mix.mode, ['none', 'wet', 'smudge'] as const, d.mix.mode),
      pickup: num(mix.pickup, d.mix.pickup, 0, 1), persistence: num(mix.persistence, d.mix.persistence, 0, 1), paint: num(mix.paint, d.mix.paint, 0, 1),
    },
    stabilizer: {
      streamLine: num(stab.streamLine, d.stabilizer.streamLine, 0, 100), stabilization: num(stab.stabilization, d.stabilizer.stabilization, 0, 100),
      motionFiltering: num(stab.motionFiltering, d.stabilizer.motionFiltering, 0, 100), pressureSmoothing: num(stab.pressureSmoothing, d.stabilizer.pressureSmoothing, 0, 100),
    },
  };
}

/** Lee/escribe un valor por ruta ("size.size"), usado por el editor generado desde el esquema. */
export function getPath(p: BrushPreset, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], p);
}
export function setPath(p: BrushPreset, path: string, value: unknown): void {
  const keys = path.split('.');
  const last = keys.pop()!;
  const target = keys.reduce<Record<string, unknown>>((o, k) => o[k] as Record<string, unknown>, p as unknown as Record<string, unknown>);
  target[last] = value;
}

import type { BrushPreset } from './BrushPreset';

/**
 * Descripción declarativa del editor de pinceles. El Brush Studio genera sus
 * controles a partir de esta lista: para exponer un parámetro nuevo basta con
 * añadir una entrada (y usarlo en el motor).
 */
export type Unit = '%' | 'px' | '°' | '×' | '';

export type Control =
  | { type: 'slider'; path: string; label: string; min: number; max: number; step?: number; unit?: Unit; display?: number; log?: boolean; signed?: boolean; help?: string; when?: (p: BrushPreset) => boolean }
  | { type: 'select'; path: string; label: string; options: { value: string; label: string }[]; help?: string; when?: (p: BrushPreset) => boolean }
  | { type: 'segmented'; path: string; label: string; options: { value: string; label: string }[]; help?: string; when?: (p: BrushPreset) => boolean }
  | { type: 'toggle'; path: string; label: string; help?: string; when?: (p: BrushPreset) => boolean }
  | { type: 'curve'; path: string; label: string; help?: string; when?: (p: BrushPreset) => boolean }
  | { type: 'image'; path: string; label: string; help?: string; when?: (p: BrushPreset) => boolean }
  | { type: 'shapes'; path: string; label: string; when?: (p: BrushPreset) => boolean }
  | { type: 'grains'; path: string; label: string; when?: (p: BrushPreset) => boolean }
  | { type: 'text'; path: string; label: string; max: number; list?: 'categories' }
  | { type: 'styles'; path: string; label: string; help?: string };

export interface Section { id: string; title: string; subtitle: string; controls: Control[] }

const grainOn = (p: BrushPreset) => p.grain.enabled;

export const SHAPE_OPTIONS: { value: BrushPreset['tip']['shape']; label: string }[] = [
  { value: 'round', label: 'Redonda' }, { value: 'square', label: 'Cuadrada' }, { value: 'diamond', label: 'Rombo' },
  { value: 'triangle', label: 'Triángulo' }, { value: 'star', label: 'Estrella' }, { value: 'rough', label: 'Irregular' },
  { value: 'spray', label: 'Partículas' }, { value: 'image', label: 'Imagen' },
];
export const GRAIN_OPTIONS: { value: BrushPreset['grain']['type']; label: string }[] = [
  { value: 'paper', label: 'Papel' }, { value: 'pencil', label: 'Grafito' }, { value: 'canvas', label: 'Lienzo' },
  { value: 'noise', label: 'Ruido fino' }, { value: 'stipple', label: 'Punteado' }, { value: 'image', label: 'Imagen' },
];

/**
 * Estilos rápidos: cambian de una vez el carácter del pincel (punta, textura,
 * dinámicas y borde) sin tocar su tamaño, nombre ni color. Después se puede afinar.
 */
export const BRUSH_STYLES: { id: string; label: string; patch: Record<string, unknown> }[] = [
  { id: 'pencil', label: 'Lápiz', patch: { 'tip.shape': 'round', 'tip.hardness': 0.7, 'grain.enabled': true, 'grain.type': 'pencil', 'grain.mode': 'fixed', 'grain.depth': 0.7, 'spacing.spacing': 0.06, 'pressure.size': 0.4, 'pressure.opacity': 0.8, 'opacity.flow': 0.7, 'render.mode': 'stamp', 'render.edge': 'normal', 'mix.mode': 'none', 'size.taperStart': 0, 'size.taperEnd': 0 } },
  { id: 'ink', label: 'Tinta', patch: { 'tip.shape': 'round', 'tip.hardness': 0.95, 'grain.enabled': false, 'spacing.spacing': 0.05, 'pressure.size': 0.9, 'pressure.opacity': 0, 'opacity.flow': 1, 'opacity.opacity': 1, 'render.mode': 'stamp', 'render.edge': 'hard', 'render.edgeAmount': 0.6, 'mix.mode': 'none', 'size.taperStart': 30, 'size.taperEnd': 40, 'size.minPercent': 0.05 } },
  { id: 'marker', label: 'Rotulador', patch: { 'tip.shape': 'round', 'tip.hardness': 0.9, 'tip.roundness': 0.55, 'tip.angle': 35, 'grain.enabled': false, 'spacing.spacing': 0.04, 'pressure.size': 0.1, 'pressure.opacity': 0, 'opacity.opacity': 0.8, 'opacity.flow': 1, 'render.accumulation': 'glaze', 'render.blend': 'multiply', 'render.mode': 'stamp', 'render.edge': 'soft', 'render.edgeAmount': 0.3, 'mix.mode': 'none' } },
  { id: 'soft', label: 'Pincel suave', patch: { 'tip.shape': 'round', 'tip.hardness': 0.2, 'grain.enabled': false, 'spacing.spacing': 0.06, 'pressure.size': 0.6, 'pressure.opacity': 0.6, 'opacity.flow': 0.35, 'render.mode': 'stamp', 'render.edge': 'normal', 'mix.mode': 'none' } },
  { id: 'airbrush', label: 'Aerógrafo', patch: { 'tip.shape': 'round', 'tip.hardness': 0, 'grain.enabled': false, 'spacing.spacing': 0.04, 'pressure.size': 0, 'pressure.opacity': 0.9, 'opacity.flow': 0.08, 'render.accumulation': 'buildup', 'render.mode': 'stamp', 'render.edge': 'normal', 'mix.mode': 'none' } },
  { id: 'watercolor', label: 'Acuarela', patch: { 'tip.shape': 'rough', 'tip.hardness': 0.4, 'grain.enabled': true, 'grain.type': 'paper', 'grain.mode': 'fixed', 'grain.depth': 0.45, 'spacing.spacing': 0.08, 'pressure.opacity': 0.7, 'opacity.flow': 0.4, 'mix.mode': 'wet', 'mix.pickup': 0.4, 'mix.paint': 0.6, 'render.mode': 'stamp', 'render.edge': 'soft', 'render.edgeAmount': 0.6, 'color.light': 0.08 } },
  { id: 'oil', label: 'Óleo', patch: { 'tip.shape': 'rough', 'tip.hardness': 0.85, 'grain.enabled': true, 'grain.type': 'canvas', 'grain.mode': 'moving', 'spacing.spacing': 0.05, 'pressure.size': 0.5, 'opacity.flow': 0.9, 'mix.mode': 'wet', 'mix.pickup': 0.6, 'mix.paint': 0.8, 'rotation.mode': 'direction', 'render.mode': 'stamp', 'render.edge': 'hard', 'render.edgeAmount': 0.8 } },
  { id: 'charcoal', label: 'Carboncillo', patch: { 'tip.shape': 'rough', 'tip.hardness': 0.6, 'grain.enabled': true, 'grain.type': 'paper', 'grain.mode': 'fixed', 'grain.depth': 0.85, 'grain.contrast': 1.6, 'spacing.spacing': 0.05, 'pressure.opacity': 0.9, 'opacity.flow': 0.6, 'mix.mode': 'none', 'render.mode': 'stamp', 'render.edge': 'normal' } },
  { id: 'smooth', label: 'Línea lisa', patch: { 'render.mode': 'smooth', 'pressure.size': 0.9, 'size.taperStart': 20, 'size.taperEnd': 30, 'mix.mode': 'none', 'grain.enabled': false } },
  { id: 'sparkle', label: 'Confeti de color', patch: { 'tip.shape': 'star', 'tip.hardness': 0.9, 'spacing.spacing': 1.2, 'scatter.amount': 1.5, 'scatter.count': 2, 'size.jitter': 0.6, 'rotation.mode': 'random', 'color.hue': 0.35, 'color.light': 0.3, 'color.perStroke': false, 'mix.mode': 'none', 'render.mode': 'stamp', 'render.edge': 'normal' } },
];

export const SECTIONS: Section[] = [
  {
    id: 'basic', title: 'Básico', subtitle: 'Lo esencial', controls: [
      { type: 'styles', path: 'tip.shape', label: 'Estilo rápido', help: 'Cambia el carácter del pincel de una vez (no toca el tamaño ni el nombre). Luego ajusta lo que quieras.' },
      { type: 'slider', path: 'size.size', label: 'Tamaño', min: 0.5, max: 1000, step: 0.1, unit: 'px', log: true },
      { type: 'slider', path: 'opacity.opacity', label: 'Opacidad', min: 0.01, max: 1, step: 0.01, unit: '%', display: 100 },
      { type: 'slider', path: 'opacity.flow', label: 'Flujo', min: 0.01, max: 1, step: 0.01, unit: '%', display: 100 },
      { type: 'slider', path: 'tip.hardness', label: 'Dureza', min: 0, max: 1, step: 0.01, unit: '%', display: 100, when: p => p.tip.shape !== 'spray' && p.tip.shape !== 'image' && p.render.mode !== 'smooth' },
      { type: 'slider', path: 'spacing.spacing', label: 'Espaciado', min: 0.01, max: 3, step: 0.01, unit: '%', display: 100, log: true, when: p => p.render.mode !== 'smooth' },
      { type: 'slider', path: 'pressure.size', label: 'Presión → tamaño', min: 0, max: 1, step: 0.01, unit: '%', display: 100 },
      { type: 'slider', path: 'pressure.opacity', label: 'Presión → flujo', min: 0, max: 1, step: 0.01, unit: '%', display: 100 },
      { type: 'slider', path: 'size.taperStart', label: 'Afilado al inicio', min: 0, max: 400, step: 1, unit: 'px' },
      { type: 'slider', path: 'size.taperEnd', label: 'Afilado al final', min: 0, max: 400, step: 1, unit: 'px' },
      { type: 'segmented', path: 'render.edge', label: 'Borde (antialiasing)', options: [{ value: 'normal', label: 'Normal' }, { value: 'soft', label: 'Suave' }, { value: 'hard', label: 'Duro' }], help: 'Suave: los bordes se ven suavizados. Duro: contorno limpio y nítido por fuera (como un vector) y los sellos con su textura por dentro.', when: p => p.render.mode !== 'smooth' },
      { type: 'slider', path: 'render.edgeAmount', label: 'Intensidad del borde', min: 0, max: 1, step: 0.01, unit: '%', display: 100, when: p => p.render.mode !== 'smooth' && p.render.edge !== 'normal' },
      { type: 'slider', path: 'stabilizer.streamLine', label: 'Estabilización (StreamLine)', min: 0, max: 100, step: 1, unit: '%' },
    ],
  },
  {
    id: 'tip', title: 'Forma de la punta', subtitle: 'Brush Tip Shape', controls: [
      { type: 'shapes', path: 'tip.shape', label: 'Forma' },
      { type: 'image', path: 'tip.image', label: 'Imagen de la punta', help: 'PNG o JPG. Por defecto pinta lo oscuro.', when: p => p.tip.shape === 'image' },
      { type: 'toggle', path: 'tip.invert', label: 'Pintar con lo claro de la imagen', when: p => p.tip.shape === 'image' },
      { type: 'slider', path: 'tip.hardness', label: 'Dureza', min: 0, max: 1, step: 0.01, unit: '%', display: 100, when: p => p.tip.shape !== 'spray' && p.tip.shape !== 'image' },
      { type: 'slider', path: 'tip.roundness', label: 'Redondez', min: 0.05, max: 1, step: 0.01, unit: '%', display: 100, help: 'Valores bajos dan una punta plana, como un pincel caligráfico.' },
      { type: 'slider', path: 'tip.angle', label: 'Ángulo', min: -180, max: 180, step: 1, unit: '°', signed: true },
      { type: 'toggle', path: 'tip.flipX', label: 'Voltear en horizontal' },
      { type: 'toggle', path: 'tip.flipY', label: 'Voltear en vertical' },
    ],
  },
  {
    id: 'grain', title: 'Textura y grano', subtitle: 'Texture and Grain', controls: [
      { type: 'toggle', path: 'grain.enabled', label: 'Usar grano' },
      { type: 'grains', path: 'grain.type', label: 'Textura', when: grainOn },
      { type: 'image', path: 'grain.image', label: 'Imagen de textura', help: 'Se repite en mosaico; lo claro deja pasar la pintura.', when: p => grainOn(p) && p.grain.type === 'image' },
      { type: 'segmented', path: 'grain.mode', label: 'Comportamiento', when: grainOn, options: [{ value: 'fixed', label: 'Fijo al papel' }, { value: 'moving', label: 'Viaja con el pincel' }], help: 'Fijo: la textura pertenece al papel y los trazos la revelan. Móvil: cada sello lleva su textura.' },
      { type: 'slider', path: 'grain.scale', label: 'Escala', min: 0.1, max: 6, step: 0.05, unit: '×', log: true, when: grainOn },
      { type: 'slider', path: 'grain.depth', label: 'Profundidad', min: 0, max: 1, step: 0.01, unit: '%', display: 100, when: grainOn },
      { type: 'slider', path: 'grain.contrast', label: 'Contraste', min: 0.2, max: 3, step: 0.05, unit: '×', when: grainOn },
      { type: 'toggle', path: 'grain.invert', label: 'Invertir textura', when: grainOn },
    ],
  },
  {
    id: 'spacing', title: 'Espaciado', subtitle: 'Spacing', controls: [
      { type: 'slider', path: 'spacing.spacing', label: 'Espaciado', min: 0.01, max: 3, step: 0.01, unit: '%', display: 100, log: true, help: 'Distancia entre sellos, en porcentaje del diámetro. Bajo = línea continua; alto = sellos sueltos.' },
      { type: 'slider', path: 'spacing.jitter', label: 'Variación del espaciado', min: 0, max: 1, step: 0.01, unit: '%', display: 100 },
    ],
  },
  {
    id: 'scatter', title: 'Dispersión', subtitle: 'Scatter', controls: [
      { type: 'slider', path: 'scatter.amount', label: 'Dispersión', min: 0, max: 5, step: 0.01, unit: '%', display: 100, help: 'Desplazamiento aleatorio, en porcentaje del diámetro.' },
      { type: 'toggle', path: 'scatter.bothAxes', label: 'Dispersar también a lo largo del trazo' },
      { type: 'slider', path: 'scatter.count', label: 'Sellos por paso', min: 1, max: 16, step: 1 },
      { type: 'slider', path: 'scatter.countJitter', label: 'Variación de la cantidad', min: 0, max: 1, step: 0.01, unit: '%', display: 100 },
    ],
  },
  {
    id: 'rotation', title: 'Rotación', subtitle: 'Rotation', controls: [
      { type: 'segmented', path: 'rotation.mode', label: 'La punta gira según', options: [
        { value: 'fixed', label: 'Fija' }, { value: 'direction', label: 'Dirección' }, { value: 'azimuth', label: 'Lápiz' }, { value: 'random', label: 'Aleatoria' },
      ], help: 'Dirección: sigue el trazo. Lápiz: sigue hacia dónde apunta el lápiz inclinado.' },
      { type: 'slider', path: 'tip.angle', label: 'Ángulo base', min: -180, max: 180, step: 1, unit: '°', signed: true },
      { type: 'slider', path: 'rotation.jitter', label: 'Variación del ángulo', min: 0, max: 1, step: 0.01, unit: '%', display: 100 },
    ],
  },
  {
    id: 'size', title: 'Dinámica de tamaño', subtitle: 'Size Dynamics', controls: [
      { type: 'slider', path: 'size.size', label: 'Tamaño', min: 0.5, max: 1000, step: 0.1, unit: 'px', log: true },
      { type: 'slider', path: 'size.minPercent', label: 'Tamaño mínimo', min: 0, max: 1, step: 0.01, unit: '%', display: 100 },
      { type: 'slider', path: 'size.jitter', label: 'Variación del tamaño', min: 0, max: 1, step: 0.01, unit: '%', display: 100 },
      { type: 'slider', path: 'size.speed', label: 'Velocidad → tamaño', min: -1, max: 1, step: 0.01, unit: '%', display: 100, signed: true, help: 'Negativo: más fino al ir rápido.' },
      { type: 'slider', path: 'size.taperStart', label: 'Afilado al inicio', min: 0, max: 400, step: 1, unit: 'px' },
      { type: 'slider', path: 'size.taperEnd', label: 'Afilado al final', min: 0, max: 400, step: 1, unit: 'px' },
      { type: 'slider', path: 'size.taperMin', label: 'Grosor en la punta del afilado', min: 0, max: 1, step: 0.01, unit: '%', display: 100 },
    ],
  },
  {
    id: 'opacity', title: 'Dinámica de opacidad', subtitle: 'Opacity Dynamics', controls: [
      { type: 'slider', path: 'opacity.opacity', label: 'Opacidad', min: 0.01, max: 1, step: 0.01, unit: '%', display: 100 },
      { type: 'slider', path: 'opacity.flow', label: 'Flujo', min: 0.01, max: 1, step: 0.01, unit: '%', display: 100, help: 'Cuánta pintura deja cada sello.' },
      { type: 'slider', path: 'opacity.flowJitter', label: 'Variación del flujo', min: 0, max: 1, step: 0.01, unit: '%', display: 100 },
      { type: 'slider', path: 'opacity.speed', label: 'Velocidad → opacidad', min: -1, max: 1, step: 0.01, unit: '%', display: 100, signed: true },
      { type: 'toggle', path: 'opacity.taperOpacity', label: 'El afilado también aclara' },
    ],
  },
  {
    id: 'pressure', title: 'Sensibilidad a la presión', subtitle: 'Pressure Sensitivity', controls: [
      { type: 'curve', path: 'pressure.curve', label: 'Curva de presión', help: 'Arrastra los puntos. Doble clic sobre un punto central para quitarlo; doble clic en la curva para añadir uno.' },
      { type: 'slider', path: 'pressure.size', label: 'Presión → tamaño', min: 0, max: 1, step: 0.01, unit: '%', display: 100 },
      { type: 'slider', path: 'pressure.opacity', label: 'Presión → flujo', min: 0, max: 1, step: 0.01, unit: '%', display: 100 },
      { type: 'toggle', path: 'pressure.simulateMouse', label: 'Con ratón, simular presión con la velocidad' },
    ],
  },
  {
    id: 'tilt', title: 'Dinámica de inclinación', subtitle: 'Tilt Dynamics', controls: [
      { type: 'slider', path: 'tilt.threshold', label: 'Umbral de inclinación', min: 0, max: 80, step: 1, unit: '°', help: 'Por debajo de este ángulo el lápiz se trata como vertical.' },
      { type: 'slider', path: 'tilt.size', label: 'Inclinación → tamaño', min: -1, max: 1, step: 0.01, unit: '%', display: 100, signed: true },
      { type: 'slider', path: 'tilt.opacity', label: 'Inclinación → flujo', min: -1, max: 1, step: 0.01, unit: '%', display: 100, signed: true },
      { type: 'slider', path: 'tilt.roundness', label: 'Inclinación → aplanar punta', min: 0, max: 1, step: 0.01, unit: '%', display: 100, help: 'Para sombrear de lado, como con un lápiz real.' },
    ],
  },
  {
    id: 'render', title: 'Renderizado del trazo', subtitle: 'Stroke Rendering', controls: [
      { type: 'segmented', path: 'render.mode', label: 'Motor', options: [{ value: 'stamp', label: 'Sellos' }, { value: 'smooth', label: 'Línea lisa' }], help: 'Línea lisa: trazo vectorial continuo (usa tamaño, presión, afilado, opacidad y grano fijo).' },
      { type: 'segmented', path: 'render.accumulation', label: 'Acumulación', options: [{ value: 'glaze', label: 'Veladura' }, { value: 'buildup', label: 'Acumulativa' }], help: 'Veladura: el trazo no supera su opacidad aunque se cruce. Acumulativa: cada sello suma pintura.' },
      { type: 'segmented', path: 'render.edge', label: 'Borde (antialiasing)', options: [{ value: 'normal', label: 'Normal' }, { value: 'soft', label: 'Suave' }, { value: 'hard', label: 'Duro' }], help: 'Suave: antialiasing que suaviza el borde hacia fuera sin perder nitidez dentro. Duro: el contorno se recorta con una silueta vectorial suavizada (limpio por fuera) y por dentro quedan los sellos (textura, grano).', when: p => p.render.mode !== 'smooth' },
      { type: 'slider', path: 'render.edgeAmount', label: 'Intensidad del borde', min: 0, max: 1, step: 0.01, unit: '%', display: 100, help: 'Suave: cuánto se suaviza. Duro: dónde se recorta el contorno (bajo = más fino, alto = casi el sello entero).', when: p => p.render.mode !== 'smooth' && p.render.edge !== 'normal' },
      { type: 'select', path: 'render.blend', label: 'Modo de fusión', options: [
        { value: 'normal', label: 'Normal' }, { value: 'multiply', label: 'Multiplicar' }, { value: 'screen', label: 'Trama' },
        { value: 'overlay', label: 'Superponer' }, { value: 'darken', label: 'Oscurecer' }, { value: 'lighten', label: 'Aclarar' },
        { value: 'color-burn', label: 'Subexponer color' }, { value: 'soft-light', label: 'Luz suave' },
      ] },
    ],
  },
  {
    id: 'colordyn', title: 'Dinámica de color', subtitle: 'Color Dynamics', controls: [
      { type: 'slider', path: 'color.hue', label: 'Variación de tono', min: 0, max: 1, step: 0.01, unit: '%', display: 100, help: 'Cada sello (o cada trazo) toma un tono cercano al color elegido.' },
      { type: 'slider', path: 'color.sat', label: 'Variación de saturación', min: 0, max: 1, step: 0.01, unit: '%', display: 100 },
      { type: 'slider', path: 'color.light', label: 'Variación de luminosidad', min: 0, max: 1, step: 0.01, unit: '%', display: 100 },
      { type: 'toggle', path: 'color.perStroke', label: 'Variar por trazo (no por sello)' },
    ],
  },
  {
    id: 'mix', title: 'Mezcla de color', subtitle: 'Color Mixing', controls: [
      { type: 'segmented', path: 'mix.mode', label: 'Comportamiento', options: [{ value: 'none', label: 'Color puro' }, { value: 'wet', label: 'Húmedo (óleo)' }, { value: 'smudge', label: 'Difuminar' }], help: 'Húmedo: mezcla el color del pincel con la pintura de la capa. Difuminar: arrastra el color que ya hay sin añadir pintura.' },
      { type: 'slider', path: 'mix.pickup', label: 'Recoger color', min: 0, max: 1, step: 0.01, unit: '%', display: 100, when: p => p.mix.mode !== 'none' },
      { type: 'slider', path: 'mix.persistence', label: 'Persistencia', min: 0, max: 1, step: 0.01, unit: '%', display: 100, help: 'Cuánto dura a lo largo del trazo el color recogido.', when: p => p.mix.mode !== 'none' },
      { type: 'slider', path: 'mix.paint', label: 'Pintura nueva', min: 0, max: 1, step: 0.01, unit: '%', display: 100, help: 'Cuánto color del pincel se añade en cada sello.', when: p => p.mix.mode === 'wet' },
    ],
  },
  {
    id: 'stabilizer', title: 'Estabilización', subtitle: 'Stabilizer', controls: [
      { type: 'slider', path: 'stabilizer.streamLine', label: 'StreamLine', min: 0, max: 100, step: 1, unit: '%', help: 'Suaviza la trayectoria y conserva las esquinas.' },
      { type: 'slider', path: 'stabilizer.stabilization', label: 'Stabilization', min: 0, max: 100, step: 1, unit: '%', help: 'Elimina el temblor; actúa más cuanto más lento dibujas.' },
      { type: 'slider', path: 'stabilizer.motionFiltering', label: 'Motion Filtering', min: 0, max: 100, step: 1, unit: '%', help: 'Filtra sacudidas y saltos bruscos.' },
      { type: 'slider', path: 'stabilizer.pressureSmoothing', label: 'Suavizado de presión e inclinación', min: 0, max: 100, step: 1, unit: '%', help: 'Quita el ruido del sensor sin mover la línea.' },
    ],
  },
  {
    id: 'info', title: 'Información', subtitle: 'Brush Properties', controls: [
      { type: 'text', path: 'name', label: 'Nombre', max: 60 },
      { type: 'text', path: 'category', label: 'Categoría', max: 40, list: 'categories' },
    ],
  },
];

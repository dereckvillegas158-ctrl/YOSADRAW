import type { Mesh, V3 } from './mesh';
import { DEFAULT_MODEL, REAL_MODELS, type RealModel } from './realGuns';
import type { PartRole, WeaponKind } from './model';

/**
 * Armas por piezas separadas (armazón, corredera, cañón, gatillo, martillo,
 * cargador…): cada pieza móvil es un objeto con su punto de giro y su recorrido, así
 * se animan como las reales. Los modelos (de armas reales) están en `realGuns.ts`.
 * Medidas en metros; el cañón apunta a +Z, Y arriba y la ventana de expulsión a la
 * derecha (−X).
 */

export type WMat = 'polymer' | 'steel' | 'blued' | 'alloy' | 'wood' | 'rubber' | 'brass' | 'dark';
export const WMATS: Record<WMat, { name: string; color: string; rough: number; metal: number }> = {
  polymer: { name: 'Arma · polímero', color: '#1c1d20', rough: 0.72, metal: 0 },
  steel: { name: 'Arma · acero', color: '#6a6e75', rough: 0.32, metal: 0.92 },
  blued: { name: 'Arma · acero pavonado', color: '#26292f', rough: 0.3, metal: 0.85 },
  alloy: { name: 'Arma · aluminio anodizado', color: '#2f3237', rough: 0.48, metal: 0.6 },
  wood: { name: 'Arma · madera', color: '#6b3f22', rough: 0.58, metal: 0 },
  rubber: { name: 'Arma · goma', color: '#111111', rough: 0.95, metal: 0 },
  brass: { name: 'Arma · latón', color: '#c9a24a', rough: 0.3, metal: 0.95 },
  dark: { name: 'Arma · interior', color: '#0b0b0c', rough: 0.8, metal: 0.2 },
};
export interface GenPart {
  name: string; role: PartRole | null;
  /** Otra pieza de la que cuelga (p. ej. la manija del cerrojo). */
  parent?: string;
  pos: V3; rot?: V3;
  mesh: Mesh; mats: WMat[];
  /** Movimiento en su posición máxima (v = 1): desplazamiento (m) y giro (grados). */
  move?: V3; rotMove?: V3;
}
export interface GenWeapon { name: string; parts: GenPart[]; muzzle: V3; eject: V3; ejectDir: V3 }

/** Arma de serie de un tipo: el modelo real que le corresponde (Glock 17, M4A1, MP5…). */
export function generateWeapon(kind: Exclude<WeaponKind, 'custom'>): GenWeapon { return REAL_MODELS[DEFAULT_MODEL[kind]].gen(); }
export function generateModel(model: RealModel): GenWeapon { return REAL_MODELS[model].gen(); }

/** Adivina el papel de una pieza de un modelo importado por su nombre (español e inglés). */
export function guessRole(name: string): PartRole | null {
  const n = name.toLowerCase();
  const has = (...w: string[]) => w.some(x => n.includes(x));
  if (has('slide', 'corredera')) return 'slide';
  if (has('mag', 'cargador', 'clip')) return 'mag';
  if (has('trigger', 'gatillo')) return 'trigger';
  if (has('hammer', 'martillo')) return 'hammer';
  if (has('cylinder', 'tambor', 'drum')) return 'cylinder';
  if (has('pump', 'forend', 'foregrip', 'bombeo')) return 'pump';
  if (has('charging', 'handle', 'manija', 'palanca', 'lever')) return 'handle';
  if (has('bolt', 'cerrojo', 'carrier')) return 'bolt';
  if (has('dust', 'cover', 'tapa')) return 'cover';
  return null;
}
/** Recorrido típico de cada papel (para modelos importados): desplazamiento y giro en v = 1. */
export function roleMotion(role: PartRole, size: number): { move: V3; rot: V3 } {
  const k = Math.max(0.02, size);
  switch (role) {
    case 'slide': return { move: [0, 0, -0.16 * k], rot: [0, 0, 0] };
    case 'bolt': return { move: [0, 0, -0.1 * k], rot: [0, 0, 0] };
    case 'handle': return { move: [0, 0, -0.08 * k], rot: [0, 0, 0] };
    case 'pump': return { move: [0, 0, -0.12 * k], rot: [0, 0, 0] };
    case 'mag': return { move: [0, -0.6 * k, 0], rot: [0, 0, 0] };
    case 'trigger': return { move: [0, 0, 0], rot: [14, 0, 0] };
    case 'hammer': return { move: [0, 0, 0], rot: [-38, 0, 0] };
    case 'cylinder': return { move: [0, 0, 0], rot: [0, 0, 60] };
    case 'cover': return { move: [0, 0, 0], rot: [0, 0, -100] };
    default: return { move: [0, 0, 0], rot: [0, 0, 0] };
  }
}

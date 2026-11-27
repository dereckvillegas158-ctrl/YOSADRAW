/**
 * YOSADRAW 3D — modelo del proyecto 3D (independiente del dibujo y del vídeo).
 *
 * Un proyecto tiene escenas (cada una con su jerarquía de objetos, cámara activa,
 * entorno y duración de animación), materiales compartidos y texturas. Los objetos
 * son mallas editables, grupos/carpetas, luces y cámaras; todas sus propiedades
 * animables son `Prop` (el mismo sistema de keyframes y curvas de YOSADRAW MOTION,
 * pero con sus propios datos: animar en 3D no toca las animaciones 2D).
 */
import { setValue, valueAt, type Prop } from '../motion/keys';
import { generate, genDefaults, type GenType } from './generators';
import { box, capsule, cone, cylinder, plane, pyramid, sphere, torus, type Mesh } from './mesh';

export const S3D_VERSION = 1;
export type PrimType = 'box' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'plane' | 'capsule' | 'pyramid';
export type ObjKind = 'mesh' | 'group' | 'light' | 'camera';
export type LightType = 'dir' | 'point' | 'spot' | 'amb' | 'hemi';

export interface Tf3 { px: Prop; py: Prop; pz: Prop; rx: Prop; ry: Prop; rz: Prop; sx: Prop; sy: Prop; sz: Prop }
export interface Obj3 {
  id: string; name: string; kind: ObjKind; parent: string | null;
  visible: boolean; locked: boolean;
  /** Carpeta (sólo organiza: no transforma). */
  folder?: boolean;
  tf: Tf3;
  opacity: Prop;
  /** Malla editable y materiales por ranura. */
  mesh?: Mesh; mats?: string[]; smooth?: boolean;
  /** Primitiva con medidas editables (hasta editar sus vértices). */
  prim?: { type: PrimType; p: Record<string, number> };
  /** Generador con parámetros editables (hasta convertirlo en editable). */
  gen?: { type: GenType; p: Record<string, number> };
  light?: { type: LightType; color: Prop<string>; intensity: Prop; dist: number; angle: Prop; shadow: boolean; ground: string };
  cam?: { fov: Prop; near: number; far: number };
  castShadow?: boolean;
  /** Física en el modo En vivo. */
  phys?: Phys3;
  /** Personaje controlable (dirección, velocidad, comportamiento). */
  ctrl?: Ctrl3;
  /** Dibujo en 3D: cartel que mira a la cámara (sólo gira en Y). */
  card?: {
    billboard: boolean; /** Grosor (volumen 3D del dibujo, en m; 0 = plano). */ depth?: number;
    /** Poses: otros dibujos que se cambian en vivo con una tecla y una transición. */
    poses?: Pose3[];
    /** Tecla que vuelve al dibujo original; tecla que pasa a la siguiente pose. */
    baseKey?: string; nextKey?: string;
    /** Transición al cambiar de pose. */
    trans?: { type: TransType; dur: number };
    /** PNGTuber: boca, parpadeo y reacción al audio. */
    tuber?: Tuber3;
  };
  /** Parte de un personaje (hijo de otro dibujo): balanceo secundario. */
  part?: Part3;
  /** Emisor de líquido (sangre, agua, lava…) en el modo En vivo. */
  fluid?: Fluid3;
  /** Emisor de partículas (chispas, fogonazo, órganos, humo…) en el modo En vivo. */
  particles?: Particles3;
  /** Arma (raíz de un grupo con sus piezas): dispara, expulsa casquillos, retrocede, recarga, se inspecciona. */
  weapon?: Weapon3;
  /** Estilo propio (shaders) sólo para este objeto: se ve en los modos Materiales y Render, en vivo y en los renders. */
  style?: ObjStyle;
  /** Comportamiento de una luz en vivo. */
  lightFx?: 'none' | 'flicker' | 'pulse' | 'orbit';
}
/** Líquidos del modo En vivo. */
export type LiquidType = 'blood' | 'water' | 'lava' | 'slime' | 'paint' | 'ink';
export type LiquidStyle = 'real' | 'cel' | 'cartoon' | 'ink' | 'neon';
/**
 * Emisor de líquido: qué líquido y con qué estilo se dibuja, cuánto sale (caudal
 * continuo y chorros), hacia dónde (eje del objeto, apertura, velocidad), cómo se
 * comporta (tamaño de gota, viscosidad, cohesión) y si deja manchas.
 */
export interface Fluid3 {
  liquid: LiquidType; style: LiquidStyle; color: string;
  /** Gotas por segundo (0 = sólo chorros con disparadores o el programa). */
  rate: number;
  /** Gotas al empezar (chorro inicial). */
  burst: number;
  speed: number; spread: number;
  /** Dirección en el objeto: +y arriba, -y abajo, +z delante… */
  dir: 'up' | 'down' | 'front' | 'back' | 'left' | 'right';
  size: number; visc: number; cohesion: number;
  /** Probabilidad de dejar mancha al tocar el suelo o algo quieto (0..1). */
  stick: number;
  /** Late como un corazón (chorros a pulsos; para la sangre). */
  pulse: boolean;
  /** Se ve el objeto emisor en vivo (si no, sólo el líquido). */
  showSource: boolean;
}
/** Líquidos listos: color, comportamiento y estilo por defecto. */
export const LIQUIDS: Record<LiquidType, { label: string; color: string; size: number; visc: number; cohesion: number; stick: number; pulse: boolean; style: LiquidStyle }> = {
  blood: { label: 'Sangre', color: '#8a0614', size: 0.045, visc: 0.35, cohesion: 0.35, stick: 0.75, pulse: true, style: 'real' },
  water: { label: 'Agua', color: '#3a8fe8', size: 0.04, visc: 0.05, cohesion: 0.15, stick: 0.25, pulse: false, style: 'real' },
  lava: { label: 'Lava', color: '#ff5a00', size: 0.07, visc: 0.85, cohesion: 0.55, stick: 0.9, pulse: false, style: 'neon' },
  slime: { label: 'Slime', color: '#5cff3a', size: 0.07, visc: 0.9, cohesion: 0.85, stick: 0.5, pulse: false, style: 'cartoon' },
  paint: { label: 'Pintura', color: '#ff3ad1', size: 0.05, visc: 0.5, cohesion: 0.45, stick: 0.95, pulse: false, style: 'cel' },
  ink: { label: 'Tinta', color: '#16101f', size: 0.04, visc: 0.25, cohesion: 0.3, stick: 0.95, pulse: false, style: 'ink' },
};
export const LIQUID_STYLES: [LiquidStyle, string][] = [['real', 'Realista'], ['cel', 'Cel shading'], ['cartoon', 'Caricatura'], ['ink', 'Tinta (manga)'], ['neon', 'Neón (brilla)']];
export const defaultFluid = (liquid: LiquidType = 'blood'): Fluid3 => {
  const L = LIQUIDS[liquid];
  return { liquid, style: L.style, color: L.color, rate: 60, burst: 0, speed: 3, spread: 18, dir: 'up', size: L.size, visc: L.visc, cohesion: L.cohesion, stick: L.stick, pulse: L.pulse, showSource: false };
};
/** Partículas del modo En vivo. */
export type PartType = 'sparks' | 'muzzle' | 'explosion' | 'embers' | 'fire' | 'smoke' | 'organs' | 'bones' | 'gibs' | 'debris' | 'confetti' | 'coins' | 'stars' | 'leaves' | 'bubbles' | 'magic' | 'casings' | 'custom';
export type PartStyle = 'real' | 'cel' | 'cartoon' | 'flat' | 'neon';
/**
 * Emisor de partículas: qué sale (forma por defecto, un objeto o modelo de la
 * escena o una imagen), cuánto (caudal y ráfagas), hacia dónde, cómo se mueve
 * (gravedad, rozamiento, giro, rebote, choques), cómo se ve (estilo, colores,
 * brillo, se desvanece) y si ilumina lo que tiene cerca (luz dinámica).
 */
export interface Particles3 {
  type: PartType; style: PartStyle;
  /** Color al nacer y al morir (blanco = los colores propios de la forma). */
  color: string; color2: string;
  /** Forma: la de serie, un objeto de la escena (también un modelo importado) o una imagen. */
  shape: 'default' | 'object' | 'texture'; shapeObj?: string; shapeTex?: string;
  /** Por segundo (0 = sólo ráfagas con disparadores o el programa) y ráfaga al empezar. */
  rate: number; burst: number;
  speed: number; spread: number;
  dir: 'up' | 'down' | 'front' | 'back' | 'left' | 'right';
  /** Tamaño (radio, m), variación (0..1) y vida (s). */
  size: number; sizeVar: number; life: number;
  /** Gravedad (1 = normal, negativa = suben), rozamiento con el aire y giro. */
  gravity: number; drag: number; spin: number;
  /** Rebote (0..1), choca con el suelo y la física, y se quedan en el suelo hasta morir. */
  bounce: number; collide: boolean; stay: boolean;
  /** Se desvanecen al final de su vida; brillo propio (0..2). */
  fade: boolean; glow: number;
  /** Luz dinámica: intensidad (0 = sin luz) y alcance (m). */
  light: number; lightRange: number; lightColor: string;
  /** Sangran al volar y al chocar (usa el líquido sangre). 0..1 */
  bleed: number;
  /** Se ve el objeto que las suelta. */
  showSource: boolean;
  /** Casquillos: calibre (forma y color). */
  caliber?: Caliber;
}
export const PART_TYPES: Record<PartType, { label: string; icon: string; p: Partial<Particles3> }> = {
  sparks: { label: 'Chispas', icon: '✦', p: { style: 'neon', color: '#fff3b0', color2: '#ff4a00', rate: 80, speed: 6, spread: 35, size: 0.025, sizeVar: 0.5, life: 0.7, gravity: 1, drag: 0.4, spin: 0, bounce: 0.45, collide: true, stay: false, fade: true, glow: 1.6, light: 1.2, lightRange: 4, lightColor: '#ffb040' } },
  muzzle: { label: 'Fogonazo (arma)', icon: '💥', p: { style: 'neon', color: '#fff6c8', color2: '#ff6a10', rate: 0, burst: 0, speed: 9, spread: 14, dir: 'front', size: 0.22, sizeVar: 0.3, life: 0.07, gravity: 0, drag: 2, spin: 0, bounce: 0.3, collide: false, stay: false, fade: true, glow: 2, light: 6, lightRange: 7, lightColor: '#ffbb55' } },
  explosion: { label: 'Explosión', icon: '💣', p: { style: 'neon', color: '#ffc860', color2: '#b21800', rate: 0, burst: 90, speed: 7, spread: 180, size: 0.35, sizeVar: 0.6, life: 0.9, gravity: -0.15, drag: 2.4, spin: 1, bounce: 0.2, collide: false, stay: false, fade: true, glow: 1.6, light: 8, lightRange: 10, lightColor: '#ff8a30' } },
  embers: { label: 'Brasas', icon: '•', p: { style: 'neon', color: '#ffd060', color2: '#ff2a00', rate: 25, speed: 1.2, spread: 40, size: 0.02, sizeVar: 0.5, life: 3, gravity: -0.12, drag: 0.8, spin: 0, bounce: 0.2, collide: false, stay: false, fade: true, glow: 1.4, light: 0.8, lightRange: 3, lightColor: '#ff7a20' } },
  fire: { label: 'Fuego', icon: '🔥', p: { style: 'neon', color: '#ffe680', color2: '#d01800', rate: 70, speed: 1.4, spread: 18, size: 0.22, sizeVar: 0.4, life: 0.9, gravity: -0.35, drag: 1.2, spin: 0.5, bounce: 0, collide: false, stay: false, fade: true, glow: 1.3, light: 2.5, lightRange: 5, lightColor: '#ff8a30' } },
  smoke: { label: 'Humo', icon: '☁', p: { style: 'flat', color: '#9a96a0', color2: '#3a3840', rate: 14, speed: 0.8, spread: 20, size: 0.3, sizeVar: 0.4, life: 3.5, gravity: -0.06, drag: 0.9, spin: 0.3, bounce: 0, collide: false, stay: false, fade: true, glow: 0, light: 0, lightRange: 3, lightColor: '#ffffff' } },
  organs: { label: 'Órganos', icon: '🫀', p: { style: 'real', color: '#ffffff', color2: '#ffffff', rate: 0, burst: 8, speed: 4.5, spread: 55, size: 0.16, sizeVar: 0.35, life: 14, gravity: 1, drag: 0.1, spin: 6, bounce: 0.25, collide: true, stay: true, fade: false, glow: 0, light: 0, lightRange: 3, lightColor: '#ffffff', bleed: 0.7 } },
  bones: { label: 'Huesos', icon: '🦴', p: { style: 'cartoon', color: '#ffffff', color2: '#ffffff', rate: 0, burst: 10, speed: 4, spread: 60, size: 0.16, sizeVar: 0.3, life: 14, gravity: 1, drag: 0.1, spin: 8, bounce: 0.35, collide: true, stay: true, fade: false, glow: 0, light: 0, lightRange: 3, lightColor: '#ffffff' } },
  gibs: { label: 'Trozos de carne', icon: '🥩', p: { style: 'real', color: '#ffffff', color2: '#ffffff', rate: 0, burst: 24, speed: 5, spread: 70, size: 0.07, sizeVar: 0.6, life: 12, gravity: 1, drag: 0.15, spin: 9, bounce: 0.2, collide: true, stay: true, fade: false, glow: 0, light: 0, lightRange: 3, lightColor: '#ffffff', bleed: 0.5 } },
  debris: { label: 'Escombros', icon: '🪨', p: { style: 'real', color: '#ffffff', color2: '#ffffff', rate: 0, burst: 30, speed: 4, spread: 70, size: 0.08, sizeVar: 0.7, life: 10, gravity: 1, drag: 0.05, spin: 7, bounce: 0.3, collide: true, stay: true, fade: false, glow: 0, light: 0, lightRange: 3, lightColor: '#ffffff' } },
  confetti: { label: 'Confeti', icon: '🎉', p: { style: 'flat', color: '#ffffff', color2: '#ffffff', rate: 60, speed: 5, spread: 40, size: 0.05, sizeVar: 0.3, life: 6, gravity: 0.35, drag: 2.2, spin: 10, bounce: 0, collide: true, stay: true, fade: false, glow: 0, light: 0, lightRange: 3, lightColor: '#ffffff' } },
  coins: { label: 'Monedas', icon: '🪙', p: { style: 'real', color: '#ffffff', color2: '#ffffff', rate: 0, burst: 20, speed: 5, spread: 40, size: 0.08, sizeVar: 0.15, life: 8, gravity: 1, drag: 0.1, spin: 10, bounce: 0.45, collide: true, stay: true, fade: false, glow: 0.2, light: 0, lightRange: 3, lightColor: '#ffd040' } },
  stars: { label: 'Estrellas', icon: '★', p: { style: 'cartoon', color: '#ffe14a', color2: '#ff9a2a', rate: 12, speed: 3, spread: 50, size: 0.09, sizeVar: 0.4, life: 1.6, gravity: 0.4, drag: 0.8, spin: 6, bounce: 0.4, collide: false, stay: false, fade: true, glow: 0.8, light: 0, lightRange: 3, lightColor: '#ffe14a' } },
  leaves: { label: 'Hojas', icon: '🍂', p: { style: 'cel', color: '#ffffff', color2: '#ffffff', rate: 6, speed: 0.6, spread: 70, size: 0.08, sizeVar: 0.4, life: 8, gravity: 0.15, drag: 2.5, spin: 3, bounce: 0, collide: true, stay: true, fade: true, glow: 0, light: 0, lightRange: 3, lightColor: '#ffffff' } },
  bubbles: { label: 'Burbujas', icon: '◯', p: { style: 'real', color: '#bfe8ff', color2: '#e6f7ff', rate: 10, speed: 0.8, spread: 30, size: 0.06, sizeVar: 0.6, life: 4, gravity: -0.12, drag: 1, spin: 0, bounce: 0, collide: false, stay: false, fade: true, glow: 0, light: 0, lightRange: 3, lightColor: '#ffffff' } },
  magic: { label: 'Magia', icon: '✨', p: { style: 'neon', color: '#b46bff', color2: '#3ae0ff', rate: 40, speed: 1, spread: 180, size: 0.05, sizeVar: 0.6, life: 1.5, gravity: -0.1, drag: 1.5, spin: 2, bounce: 0, collide: false, stay: false, fade: true, glow: 1.5, light: 1.5, lightRange: 4, lightColor: '#9a6bff' } },
  casings: { label: 'Casquillos', icon: '🔸', p: { style: 'real', color: '#ffffff', color2: '#ffffff', rate: 6, burst: 0, speed: 3, spread: 14, dir: 'right', size: 0.012, sizeVar: 0.05, life: 14, gravity: 1, drag: 0.15, spin: 22, bounce: 0.45, collide: true, stay: true, fade: false, glow: 0, light: 0, lightRange: 3, lightColor: '#ffffff' } },
  custom: { label: 'Personalizado', icon: '❖', p: { style: 'real', color: '#ffffff', color2: '#ffffff', rate: 10, speed: 3, spread: 30, size: 0.1, sizeVar: 0.3, life: 4, gravity: 1, drag: 0.2, spin: 3, bounce: 0.3, collide: true, stay: false, fade: true, glow: 0, light: 0, lightRange: 3, lightColor: '#ffffff' } },
};
export const PART_STYLES: [PartStyle, string][] = [['real', 'Realista (videojuego)'], ['cel', 'Cel shading'], ['cartoon', 'Caricatura (contorno)'], ['flat', 'Plano'], ['neon', 'Neón (brilla)']];
export const defaultParticles = (type: PartType = 'sparks'): Particles3 => ({
  type, style: 'real', color: '#ffffff', color2: '#ffffff', shape: 'default', rate: 20, burst: 0, speed: 3, spread: 30, dir: 'up',
  size: 0.1, sizeVar: 0.3, life: 2, gravity: 1, drag: 0.2, spin: 0, bounce: 0.3, collide: true, stay: false, fade: true, glow: 0,
  light: 0, lightRange: 3, lightColor: '#ffffff', bleed: 0, showSource: false, ...PART_TYPES[type].p,
});
/** Calibres de los casquillos (forma, tamaño y color). */
export type Caliber = '9mm' | '45acp' | '357' | '556' | '762' | '308' | '50bmg' | '12g';
export const CALIBERS: Record<Caliber, { label: string; size: number }> = {
  '9mm': { label: '9 mm (pistola)', size: 0.0105 }, '45acp': { label: '.45 (pistola)', size: 0.012 }, '357': { label: '.357 (revólver)', size: 0.0145 },
  '556': { label: '5,56 mm (fusil)', size: 0.0225 }, '762': { label: '7,62 × 39 (fusil)', size: 0.0195 }, '308': { label: '.308 (francotirador)', size: 0.0255 },
  '50bmg': { label: '.50 (pesada)', size: 0.05 }, '12g': { label: 'Cartucho 12 (escopeta)', size: 0.034 },
};
/** Armas: piezas con movimiento (rol → objeto y su recorrido). */
export type WeaponKind = 'pistol' | 'rifle' | 'smg' | 'shotgun' | 'revolver' | 'sniper' | 'custom';
export type WeaponAction = 'semi' | 'auto' | 'pump' | 'bolt' | 'revolver';
export type PartRole = 'slide' | 'bolt' | 'trigger' | 'hammer' | 'mag' | 'pump' | 'cylinder' | 'handle' | 'cover' | 'extra';
export const PART_ROLES: [PartRole, string][] = [['slide', 'Corredera'], ['bolt', 'Cerrojo / portacerrojo'], ['handle', 'Palanca de carga / manija'], ['trigger', 'Gatillo'], ['hammer', 'Martillo'], ['mag', 'Cargador'], ['pump', 'Guardamanos de bombeo'], ['cylinder', 'Tambor'], ['cover', 'Tapa del expulsor'], ['extra', 'Otra pieza (inspección)']];
/** Una pieza que se mueve: desplazamiento y giro (en el espacio del arma) en su posición máxima (v = 1). */
export interface WPart3 { role: PartRole; id: string; move: [number, number, number]; rot: [number, number, number]; rest: [number, number, number, number, number, number] }
export interface Weapon3 {
  kind: WeaponKind;
  /** Modelo real del que se creó (glock17, ak47…), si es uno de serie. */
  model?: string; action: WeaponAction; caliber: Caliber;
  parts: WPart3[];
  /** Boca del cañón y ventana de expulsión (en el espacio del arma) y hacia dónde salen los casquillos. */
  muzzle: [number, number, number]; eject: [number, number, number]; ejectDir: [number, number, number];
  /** Disparos por minuto en automático, balas por cargador. */
  rpm: number; ammo: number;
  /** Teclas: disparar (mantener en automático), recargar, inspeccionar. */
  fireKey: string; reloadKey: string; inspectKey: string;
  /** También dispara con clic en la escena. */
  fireClick: boolean;
  /** Retroceso (0..2), fogonazo (tamaño, 0 = sin) y su luz, casquillos (escala) y balas (impactos con física). */
  recoil: number; flash: number; flashLight: number; casingScale: number; bullets: boolean;
  /** El cargador se puede sacar y meter arrastrándolo con el ratón en vivo. */
  magDrag: boolean;
  /** Hacia dónde apunta el cañón (en el espacio del arma): retroceso y balas. */
  fwd: [number, number, number];
}
export const WEAPON_KINDS: Record<Exclude<WeaponKind, 'custom'>, { label: string; icon: string; action: WeaponAction; caliber: Caliber; rpm: number; ammo: number; recoil: number }> = {
  pistol: { label: 'Pistola', icon: '🔫', action: 'semi', caliber: '9mm', rpm: 400, ammo: 17, recoil: 1 },
  rifle: { label: 'Fusil de asalto', icon: '🪖', action: 'auto', caliber: '556', rpm: 750, ammo: 30, recoil: 0.7 },
  smg: { label: 'Subfusil', icon: '⚡', action: 'auto', caliber: '9mm', rpm: 900, ammo: 32, recoil: 0.5 },
  shotgun: { label: 'Escopeta de bombeo', icon: '💥', action: 'pump', caliber: '12g', rpm: 70, ammo: 7, recoil: 1.6 },
  revolver: { label: 'Revólver', icon: '🤠', action: 'revolver', caliber: '357', rpm: 180, ammo: 6, recoil: 1.4 },
  sniper: { label: 'Fusil de cerrojo', icon: '🎯', action: 'bolt', caliber: '308', rpm: 40, ammo: 5, recoil: 1.8 },
};
export const defaultWeapon = (kind: WeaponKind = 'custom'): Weapon3 => {
  const k = kind === 'custom' ? null : WEAPON_KINDS[kind];
  return { kind, action: k?.action ?? 'semi', caliber: k?.caliber ?? '9mm', parts: [], muzzle: [0, 0.03, 0.2], eject: [-0.015, 0.04, 0.03], ejectDir: [-1, 0.6, -0.2],
    rpm: k?.rpm ?? 400, ammo: k?.ammo ?? 15, fireKey: 'f', reloadKey: 'r', inspectKey: 'i', fireClick: false,
    recoil: k?.recoil ?? 1, flash: 1, flashLight: 1, casingScale: 1, bullets: true, magDrag: true, fwd: [0, 0, 1] };
};
const isV3 = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every(x => typeof x === 'number' && isFinite(x));
export function normalizeWeapon(v: unknown): Weapon3 | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const w = v as Partial<Weapon3>;
  const kind = (w.kind && (w.kind === 'custom' || w.kind in WEAPON_KINDS) ? w.kind : 'custom') as WeaponKind;
  const d = defaultWeapon(kind);
  const parts = Array.isArray(w.parts) ? w.parts.filter(p => p && typeof p.id === 'string' && PART_ROLES.some(r => r[0] === p.role)).map(p => ({
    role: p.role, id: p.id, move: isV3(p.move) ? p.move : [0, 0, 0] as [number, number, number], rot: isV3(p.rot) ? p.rot : [0, 0, 0] as [number, number, number],
    rest: Array.isArray(p.rest) && p.rest.length === 6 && p.rest.every(x => typeof x === 'number') ? p.rest : [0, 0, 0, 0, 0, 0] as WPart3['rest'],
  })) : [];
  return { ...d, ...w, kind, parts, muzzle: isV3(w.muzzle) ? w.muzzle : d.muzzle, eject: isV3(w.eject) ? w.eject : d.eject, ejectDir: isV3(w.ejectDir) ? w.ejectDir : d.ejectDir,
    caliber: w.caliber && w.caliber in CALIBERS ? w.caliber : d.caliber, fwd: isV3(w.fwd) ? w.fwd : d.fwd, action: (['semi', 'auto', 'pump', 'bolt', 'revolver'] as WeaponAction[]).includes(w.action as WeaponAction) ? w.action as WeaponAction : d.action };
}
/** Pose de un dibujo: textura y tecla para cambiar a ella en vivo. */
export interface Pose3 {
  id: string; name: string; tex: string; key: string;
  /** PNGTuber: la misma expresión hablando (boca abierta) y con los ojos cerrados. */
  talk?: string; blink?: string;
}
/**
 * PNGTuber: cómo se comporta un dibujo con el audio. Boca abierta y ojos cerrados
 * del dibujo original (las poses tienen los suyos), parpadeo, y rebote y aplastado
 * al hablar (se suman a la física y a las transiciones).
 */
export interface Tuber3 {
  talk?: string; blink?: string;
  /** Cada cuántos segundos parpadea (0 = nunca). */
  blinkEvery: number;
  /** Rebote al hablar (salto, 0..1) y aplastado al hablar (squash, 0..1). */
  bounce: number; squash: number;
  /** Se ilumina un poco al hablar (0..1). */
  glow: number;
}
export const defaultTuber = (): Tuber3 => ({ blinkEvery: 4, bounce: 0.35, squash: 0.25, glow: 0 });
/** Parte de un personaje (pelo, orejas, accesorios): se balancea con el movimiento de su padre. */
export interface Part3 { sway: number; /** Punto de giro (u, v de 0 a 1 desde abajo a la izquierda). */ pivot?: [number, number] }
/** Transiciones entre poses (populares en animación 2D dentro de 3D). */
export type TransType = 'squash' | 'flip' | 'spin' | 'pop' | 'fade' | 'jump' | 'shake' | 'cut';
export const TRANS_TYPES: [TransType, string][] = [['squash', 'Squash and stretch (aplastar y estirar)'], ['flip', 'Volteo (girar como una carta)'], ['spin', 'Giro'], ['pop', 'Pop (encoger y rebotar)'], ['fade', 'Fundido'], ['jump', 'Salto'], ['shake', 'Sacudida'], ['cut', 'Corte (sin transición)']];
/**
 * Cel shading (sombreado de dibujo animado): bandas de luz duras, sombra con el
 * color del ambiente o con un color propio y brillo de borde.
 */
export interface Cel3 {
  /** Número de tonos (2 = luz y sombra). */
  bands: number;
  /** Suavidad del borde entre tonos (0 = corte limpio). */
  soft: number;
  /** Sombra: «ambient» = toma el color del ambiente; «color» = color propio. */
  shade: 'ambient' | 'color';
  color: string;
  /** Brillo de borde (rim) y su color. */
  rim: number; rimColor: string;
}
export const defaultCel = (): Cel3 => ({ bands: 3, soft: 0.1, shade: 'ambient', color: '#5b4a8a', rim: 0, rimColor: '#ffffff' });
/** Lineart de caricatura: contorno con grosor en píxeles (a 1080 p) y color. */
export interface Line3 { width: number; color: string }
/** Estilo (shaders) de un objeto concreto. */
export interface ObjStyle {
  squiggle: number; squigFps: number; squigSize: number;
  ink: number; inkColor: string; posterize: number; halftone: number; pixel: number; paint: number; scan: number;
  /** Cel shading propio (anula el de la escena). */
  cel?: Cel3 | null;
  /** Lineart propio (anula el de la escena); ancho 0 = sin contorno. */
  line?: Line3 | null;
}
export const STYLE_KEYS = ['squiggle', 'ink', 'posterize', 'halftone', 'pixel', 'paint', 'scan'] as const;
export const defaultObjStyle = (): ObjStyle => ({ squiggle: 0, squigFps: 8, squigSize: 40, ink: 0, inkColor: '#1a1420', posterize: 0, halftone: 0, pixel: 0, paint: 0, scan: 0 });
/** ¿Tiene algún efecto de estilo activo? */
export const styled = (st: ObjStyle | undefined | null) => !!st && STYLE_KEYS.some(k => (st[k] ?? 0) > 0);
export type BodyType = 'none' | 'dynamic' | 'kinematic' | 'static';
export interface Phys3 {
  body: BodyType; mass: number; bounce: number; friction: number;
  shape: 'auto' | 'box' | 'sphere';
  /** Se puede agarrar y sacudir con el ratón. */
  grab: boolean;
  /** Zona (no choca: avisa cuando algo entra; sirve para disparadores). */
  zone: boolean;
  /** Gelatina: se estira y aplasta al moverlo o sacudirlo (0..1). */
  jelly: number;
  /** Balanceo: se inclina y gira según cómo lo arrastras (0..1). */
  swing: number;
  /** Flota (sin gravedad): se queda donde lo sueltas y vuelve a ponerse derecho. */
  float: boolean;
  /**
   * Al arrastrarlo: «face» = se inclina en su plano sin dejar de mirar hacia donde
   * mira (como una hoja agarrada); «free» = gira libre en 3D. Sin valor: los
   * dibujos (carteles) «face» y lo demás «free».
   */
  turn?: 'face' | 'free';
}
export type Behavior = 'walk' | 'mouse' | 'patrol' | 'idle';
export interface Ctrl3 {
  behavior: Behavior;
  /** Dirección (grados en el suelo: 0 = +X, 90 = hacia el fondo, -Z). */
  dir: number;
  speed: number; jump: number;
  /** Recorrido de la patrulla (m). */
  dist: number;
  /** Siempre de pie (no vuelca). */
  upright: boolean;
  /** Ejes bloqueados para su movimiento. */
  lock: { x: boolean; y: boolean; z: boolean };
  /** Gelatina: cuánto se estira y aplasta al moverse o sacudirlo (0..1). */
  wobble: number;
  /** Actor: teclas que lo eligen en vivo (p. ej. «1» o «1, q»); vacío = no es actor. */
  keys?: string;
  /** Actor sin control: se queda quieto o vuelve a su sitio. */
  rest?: 'stay' | 'return';
}
export const defaultPhys = (body: BodyType = 'dynamic'): Phys3 => ({ body, mass: 1, bounce: 0.2, friction: 0.4, shape: 'auto', grab: true, zone: false, jelly: 0.3, swing: 0.5, float: false });
/** Física de un dibujo (cartel): flota, se balancea y tiene gelatina al arrastrarlo. */
export const cardPhys = (): Phys3 => ({ ...defaultPhys('dynamic'), mass: 0.5, jelly: 0.6, swing: 0.8, float: true });
export const defaultCtrl = (): Ctrl3 => ({ behavior: 'walk', dir: 0, speed: 2, jump: 5, dist: 4, upright: true, lock: { x: false, y: false, z: false }, wobble: 0.4 });

/** Efectos en tiempo real de una escena (modo En vivo y vista previa). */
export interface Fx3 {
  quality: 'low' | 'medium' | 'high';
  /** Bajar la calidad sola si van pocos FPS. */
  adaptive: boolean;
  /** Ver los efectos también al editar. */
  preview: boolean;
  godrays: number; godColor: string;
  /** Conos de luz volumétrica en los focos. */
  cones: number;
  bloom: number; chroma: number; glitch: number;
  tint: string; tintAmt: number; vignette: number; grain: number;
  shadows: 0 | 1 | 2 | 3;
  /** Estilo (shaders): squiggle vision (líneas que tiemblan), tinta, posterizar, trama, píxeles, pintura, papel, TV. */
  squiggle: number; squigFps: number; squigSize: number;
  ink: number; inkColor: string; posterize: number; halftone: number; pixel: number; paint: number; paper: number; scan: number;
  gravity: number;
  /** Suelo infinito para la física (y = 0). */
  ground: boolean;
  /** Volumen: oclusión ambiental (sombras de contacto en rincones y uniones). */
  ao: number;
  /** En vivo: con un actor elegido, el clic sólo mueve al actor (no agarra objetos). */
  actorClick: boolean;
  /** Cel shading de toda la escena (null = no). */
  cel: Cel3 | null;
  /** Lineart de toda la escena (null = no). */
  line: Line3 | null;
}
export const defaultFx = (): Fx3 => ({ quality: 'medium', adaptive: true, preview: false, godrays: 0, godColor: '#ffe2b0', cones: 0, bloom: 0, chroma: 0, glitch: 0, tint: '#ffffff', tintAmt: 0, vignette: 0, grain: 0, shadows: 2, squiggle: 0, squigFps: 8, squigSize: 40, ink: 0, inkColor: '#1a1420', posterize: 0, halftone: 0, pixel: 0, paint: 0, paper: 0, scan: 0, gravity: 9.81, ground: true, ao: 0, actorClick: true, cel: null, line: null });

/** Disparador: cuando pasa algo, se hacen acciones. */
/** Sucesos: también los del audio (empieza a hablar, se calla, sonido fuerte). */
export type EventType = 'start' | 'time' | 'every' | 'key' | 'click' | 'collide' | 'enter' | 'grab' | 'release' | 'talk' | 'quiet' | 'loud';
/** Acciones: también cambiar de pose (expresión) y reproducir o parar un audio. */
export type ActType = 'impulse' | 'jump' | 'setdir' | 'speed' | 'behavior' | 'color' | 'light' | 'fx' | 'shake' | 'spawn' | 'hide' | 'show' | 'gravity' | 'slowmo' | 'stop' | 'script' | 'pose' | 'audio' | 'fluid' | 'particles' | 'weapon';
export interface Act3 { type: ActType; target: string; v?: [number, number, number]; value?: number; color?: string; param?: string; dur?: number; code?: string }
export interface Rule3 { id: string; name: string; enabled: boolean; once: boolean; on: { type: EventType; t?: number; key?: string; a?: string; b?: string }; do: Act3[] }
export interface Mat3 {
  id: string; name: string;
  color: Prop<string>; rough: Prop; metal: Prop; opacity: Prop; emissive: Prop<string>; emissiveI: Prop;
  /** Textura (imagen) y textura procedimental (madera, piedra…). */
  tex: string | null; proc: string | null; texScale: number;
  /** Estilizado (sombreado de dibujo animado). */
  toon: boolean; fav: boolean;
  /** Recorte por transparencia (dibujos: lo transparente no se ve ni hace sombra). */
  cut?: boolean;
}
export interface Tex3 { id: string; name: string; src: string; project?: { id: string; rev: number } | null }
export interface Scene3 {
  id: string; name: string; objects: Obj3[];
  camera: string | null;
  env: {
    bg: string; transparent: boolean; envLight: number; exposure: number; fog: number;
    /** Imagen de fondo (escenario dibujado), cubre todo el encuadre y no se mueve. */
    bgTex?: string | null;
    /** Sin luces: los dibujos se ven con sus colores originales (2D). */
    unlit?: boolean;
  };
  fps: number; dur: number;
  /** Modo En vivo: efectos, disparadores y programa. */
  fx?: Fx3;
  rules?: Rule3[];
  script?: string;
  /** Audio del modo En vivo (PNGTuber): pistas y micrófono. */
  audio?: Audio3;
}
/** Pista de audio importada (se guarda en el proyecto). */
export interface Track3 { id: string; name: string; src: string; auto: boolean; loop: boolean; volume: number }
/**
 * Audio de la escena: pistas, micrófono y cómo se detecta que el personaje habla
 * (umbral del nivel y cuánto aguanta la boca abierta tras callarse).
 */
export interface Audio3 { tracks: Track3[]; mic: boolean; threshold: number; hold: number; loud: number }
export const defaultAudio = (): Audio3 => ({ tracks: [], mic: false, threshold: 0.08, hold: 0.18, loud: 0.45 });
export interface RenderSet { w: number; h: number; quality: 1 | 2 | 3; shadows: 0 | 1 | 2 | 3; transparent: boolean; /** Aplicar los efectos y el estilo (shaders) de la escena al render. */ fx: boolean }
export interface Studio3 {
  version: number;
  scenes: Scene3[];
  open: string;
  materials: Mat3[];
  textures: Tex3[];
  render: RenderSet;
  time: number;
  grid: { size: number; snap: boolean; show: boolean; axes: boolean };
  /** Tipo de proyecto: 3D Studio o PNGTuber (2D, con el mismo motor). */
  kind?: 'tuber';
}

let seq = 0;
export const sid = (p: string) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
export const prop = <T>(v: T): Prop<T> => ({ v });
export const clone = <T>(v: T): T => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));
export const newTf = (x = 0, y = 0, z = 0): Tf3 => ({ px: prop(x), py: prop(y), pz: prop(z), rx: prop(0), ry: prop(0), rz: prop(0), sx: prop(1), sy: prop(1), sz: prop(1) });

// ---------------------------------------------------------------- materiales

export function newMaterial(name: string, o: Partial<{ color: string; rough: number; metal: number; opacity: number; emissive: string; emissiveI: number; proc: string | null; toon: boolean; texScale: number }> = {}): Mat3 {
  return {
    id: sid('mt'), name, color: prop(o.color ?? '#c9c4d6'), rough: prop(o.rough ?? 0.55), metal: prop(o.metal ?? 0), opacity: prop(o.opacity ?? 1),
    emissive: prop(o.emissive ?? '#000000'), emissiveI: prop(o.emissiveI ?? 0), tex: null, proc: o.proc ?? null, texScale: o.texScale ?? 1, toon: !!o.toon, fav: false,
  };
}
/** Biblioteca de materiales prediseñados. */
export const MATERIAL_PRESETS: { name: string; group: string; o: Parameters<typeof newMaterial>[1] }[] = [
  { name: 'Madera', group: 'Madera', o: { color: '#a8743f', rough: 0.7, proc: 'wood' } },
  { name: 'Madera clara', group: 'Madera', o: { color: '#d9b98a', rough: 0.65, proc: 'wood' } },
  { name: 'Madera oscura', group: 'Madera', o: { color: '#5e3b22', rough: 0.6, proc: 'wood' } },
  { name: 'Corteza', group: 'Madera', o: { color: '#5a4330', rough: 0.95, proc: 'bark' } },
  { name: 'Metal', group: 'Metal', o: { color: '#c3c7cc', rough: 0.28, metal: 1 } },
  { name: 'Acero cepillado', group: 'Metal', o: { color: '#9aa1a8', rough: 0.45, metal: 1 } },
  { name: 'Oro', group: 'Metal', o: { color: '#e5b94a', rough: 0.25, metal: 1 } },
  { name: 'Cobre', group: 'Metal', o: { color: '#c77a4a', rough: 0.3, metal: 1 } },
  { name: 'Plástico rojo', group: 'Plástico', o: { color: '#d8404a', rough: 0.35 } },
  { name: 'Plástico azul', group: 'Plástico', o: { color: '#3d6fd8', rough: 0.35 } },
  { name: 'Plástico blanco', group: 'Plástico', o: { color: '#f2f2f2', rough: 0.4 } },
  { name: 'Goma negra', group: 'Plástico', o: { color: '#222226', rough: 0.9 } },
  { name: 'Vidrio', group: 'Vidrio', o: { color: '#d6ecff', rough: 0.05, opacity: 0.25 } },
  { name: 'Vidrio esmerilado', group: 'Vidrio', o: { color: '#e9f2f8', rough: 0.5, opacity: 0.55 } },
  { name: 'Piedra', group: 'Piedra', o: { color: '#8c8780', rough: 0.95, proc: 'stone' } },
  { name: 'Ladrillo', group: 'Piedra', o: { color: '#a5533b', rough: 0.9, proc: 'brick' } },
  { name: 'Hormigón', group: 'Piedra', o: { color: '#9a9a96', rough: 0.92, proc: 'stone' } },
  { name: 'Mármol', group: 'Piedra', o: { color: '#ecebe6', rough: 0.25, proc: 'marble' } },
  { name: 'Yeso blanco', group: 'Piedra', o: { color: '#f1eee8', rough: 0.85 } },
  { name: 'Tejas', group: 'Piedra', o: { color: '#9c3a28', rough: 0.8, proc: 'tiles' } },
  { name: 'Hierba', group: 'Naturaleza', o: { color: '#5e9a3e', rough: 0.95, proc: 'grass' } },
  { name: 'Hojas', group: 'Naturaleza', o: { color: '#3f8a3a', rough: 0.8 } },
  { name: 'Tierra', group: 'Naturaleza', o: { color: '#7a5a3c', rough: 1, proc: 'stone' } },
  { name: 'Agua', group: 'Naturaleza', o: { color: '#3a8fd0', rough: 0.05, opacity: 0.6 } },
  { name: 'Tela', group: 'Tela', o: { color: '#5b6fa8', rough: 1, proc: 'fabric' } },
  { name: 'Tela roja', group: 'Tela', o: { color: '#a83b4a', rough: 1, proc: 'fabric' } },
  { name: 'Dibujo animado', group: 'Estilizado', o: { color: '#ffb347', rough: 1, toon: true } },
  { name: 'Dibujo animado azul', group: 'Estilizado', o: { color: '#5ab4ff', rough: 1, toon: true } },
  { name: 'Neón rosa', group: 'Estilizado', o: { color: '#ff4fb8', rough: 0.4, emissive: '#ff2fa8', emissiveI: 2 } },
  { name: 'Neón cian', group: 'Estilizado', o: { color: '#4ff0ff', rough: 0.4, emissive: '#2fe8ff', emissiveI: 2 } },
  { name: 'Arcilla', group: 'Estilizado', o: { color: '#d7a98c', rough: 0.9 } },
];
export const presetMaterial = (name: string) => { const p = MATERIAL_PRESETS.find(x => x.name === name); return newMaterial(name, p?.o ?? {}); };

// ---------------------------------------------------------------- objetos

export const PRIMS: { type: PrimType; label: string; p: Record<string, number> }[] = [
  { type: 'box', label: 'Cubo', p: { w: 1, h: 1, d: 1 } },
  { type: 'sphere', label: 'Esfera', p: { r: 0.5, seg: 32, rings: 16 } },
  { type: 'cylinder', label: 'Cilindro', p: { r: 0.5, h: 1, seg: 32 } },
  { type: 'cone', label: 'Cono', p: { r: 0.5, h: 1, seg: 32 } },
  { type: 'torus', label: 'Toroide', p: { R: 0.5, r: 0.18, seg: 36, tube: 16 } },
  { type: 'plane', label: 'Plano', p: { w: 2, d: 2, div: 1 } },
  { type: 'capsule', label: 'Cápsula', p: { r: 0.35, h: 1.4, seg: 24 } },
  { type: 'pyramid', label: 'Pirámide', p: { w: 1, h: 1, d: 1, sides: 4 } },
];
/** Medidas de cada primitiva (para el panel). */
export const PRIM_PARAMS: Record<PrimType, { key: string; label: string; min: number; step: number; int?: boolean }[]> = {
  box: [{ key: 'w', label: 'Ancho', min: 0.001, step: 0.1 }, { key: 'h', label: 'Alto', min: 0.001, step: 0.1 }, { key: 'd', label: 'Fondo', min: 0.001, step: 0.1 }],
  sphere: [{ key: 'r', label: 'Radio', min: 0.001, step: 0.05 }, { key: 'seg', label: 'Segmentos', min: 3, step: 1, int: true }, { key: 'rings', label: 'Anillos', min: 2, step: 1, int: true }],
  cylinder: [{ key: 'r', label: 'Radio', min: 0.001, step: 0.05 }, { key: 'h', label: 'Alto', min: 0.001, step: 0.1 }, { key: 'seg', label: 'Lados', min: 3, step: 1, int: true }],
  cone: [{ key: 'r', label: 'Radio', min: 0.001, step: 0.05 }, { key: 'h', label: 'Alto', min: 0.001, step: 0.1 }, { key: 'seg', label: 'Lados', min: 3, step: 1, int: true }],
  torus: [{ key: 'R', label: 'Radio', min: 0.01, step: 0.05 }, { key: 'r', label: 'Grosor', min: 0.001, step: 0.02 }, { key: 'seg', label: 'Segmentos', min: 3, step: 1, int: true }, { key: 'tube', label: 'Lados del tubo', min: 3, step: 1, int: true }],
  plane: [{ key: 'w', label: 'Ancho', min: 0.001, step: 0.1 }, { key: 'd', label: 'Fondo', min: 0.001, step: 0.1 }, { key: 'div', label: 'Divisiones', min: 1, step: 1, int: true }],
  capsule: [{ key: 'r', label: 'Radio', min: 0.001, step: 0.05 }, { key: 'h', label: 'Alto', min: 0.01, step: 0.1 }, { key: 'seg', label: 'Lados', min: 3, step: 1, int: true }],
  pyramid: [{ key: 'w', label: 'Ancho', min: 0.001, step: 0.1 }, { key: 'h', label: 'Alto', min: 0.001, step: 0.1 }, { key: 'd', label: 'Fondo', min: 0.001, step: 0.1 }, { key: 'sides', label: 'Lados', min: 3, step: 1, int: true }],
};

/** Malla de una primitiva (centrada; `base` = con el origen en la base). */
export function primMesh(t: PrimType, p: Record<string, number>): Mesh {
  const i = (x: number, lo: number, hi = 256) => Math.max(lo, Math.min(hi, Math.round(x)));
  switch (t) {
    case 'box': return box(p.w, p.h, p.d);
    case 'sphere': return sphere(p.r, i(p.seg, 3), i(p.rings, 2));
    case 'cylinder': return cylinder(p.r, p.h, i(p.seg, 3));
    case 'cone': return cone(p.r, p.h, i(p.seg, 3));
    case 'torus': return torus(p.R, p.r, i(p.seg, 3), i(p.tube, 3));
    case 'plane': return plane(p.w, p.d, i(p.div, 1, 128), i(p.div, 1, 128));
    case 'capsule': return capsule(p.r, Math.max(p.h, p.r * 2), i(p.seg, 3));
    case 'pyramid': return pyramid(p.w, p.h, p.d, i(p.sides, 3, 64));
  }
}
/** Altura de una primitiva (para apoyarla en el suelo). */
export function primHeight(t: PrimType, p: Record<string, number>) {
  return t === 'sphere' ? p.r * 2 : t === 'torus' ? p.r * 2 : t === 'plane' ? 0 : t === 'capsule' ? Math.max(p.h, p.r * 2) : p.h;
}

export function newObject(kind: ObjKind, name: string, at: [number, number, number] = [0, 0, 0]): Obj3 {
  return { id: sid('ob'), name, kind, parent: null, visible: true, locked: false, tf: newTf(...at), opacity: prop(1), castShadow: true };
}
export function primObject(t: PrimType, mat: string, at: [number, number, number] = [0, 0, 0], p?: Record<string, number>): Obj3 {
  const def = PRIMS.find(x => x.type === t)!;
  const pp = { ...def.p, ...(p ?? {}) };
  const o = newObject('mesh', def.label, at);
  o.prim = { type: t, p: pp };
  o.mesh = primMesh(t, pp);
  o.mats = [mat];
  o.smooth = t === 'sphere' || t === 'capsule' || t === 'torus';
  return o;
}
export function genObject(t: GenType, mats: string[], at: [number, number, number] = [0, 0, 0], p?: Record<string, number>): Obj3 {
  const o = newObject('mesh', { stairs: 'Escalera', wall: 'Pared', door: 'Puerta', window: 'Ventana', roof: 'Tejado', column: 'Columna', furniture: 'Mueble', terrain: 'Terreno', tree: 'Árbol' }[t], at);
  o.gen = { type: t, p: { ...genDefaults(t), ...(p ?? {}) } };
  o.mesh = generate(t, o.gen.p);
  o.mats = mats;
  o.smooth = t === 'tree' || t === 'terrain';
  return o;
}
export function lightObject(type: LightType, at: [number, number, number] = [3, 5, 3]): Obj3 {
  const o = newObject('light', { dir: 'Luz direccional', point: 'Luz puntual', spot: 'Foco', amb: 'Luz ambiental', hemi: 'Luz de entorno' }[type], at);
  o.light = { type, color: prop('#ffffff'), intensity: prop(type === 'dir' ? 2.5 : type === 'amb' ? 0.4 : type === 'hemi' ? 0.8 : type === 'spot' ? 30 : 20), dist: 0, angle: prop(35), shadow: type === 'dir' || type === 'spot', ground: '#6b5a48' };
  if (type === 'dir' || type === 'spot') { o.tf.rx.v = -50; o.tf.ry.v = 40; }
  return o;
}
export function cameraObject(at: [number, number, number] = [6, 4, 8]): Obj3 {
  const o = newObject('camera', 'Cámara', at);
  o.cam = { fov: prop(45), near: 0.05, far: 2000 };
  o.tf.rx.v = -20; o.tf.ry.v = 36;
  return o;
}

/** Vuelve a generar la malla de una primitiva o un generador tras cambiar sus parámetros. */
export function rebuild(o: Obj3) {
  if (o.prim) o.mesh = primMesh(o.prim.type, o.prim.p);
  else if (o.gen) o.mesh = generate(o.gen.type, o.gen.p);
}

// ---------------------------------------------------------------- escenas y proyecto

export function newScene(name: string, mats: Mat3[]): Scene3 {
  const sc: Scene3 = { id: sid('sc'), name, objects: [], camera: null, env: { bg: '#2b2838', transparent: false, envLight: 1, exposure: 1, fog: 0 }, fps: 30, dur: 5, fx: defaultFx(), rules: [], script: '' };
  const sun = lightObject('dir', [4, 8, 5]);
  sun.name = 'Sol';
  const amb = lightObject('hemi', [0, 6, 0]);
  const cam = cameraObject();
  const floor = primObject('plane', mats.find(m => m.name === 'Suelo')?.id ?? mats[0].id, [0, 0, 0], { w: 20, d: 20, div: 1 });
  floor.name = 'Suelo';
  floor.castShadow = false;
  const cube = primObject('box', mats.find(m => m.name === 'Material')?.id ?? mats[0].id, [0, 0.5, 0]);
  sc.objects.push(floor, cube, sun, amb, cam);
  sc.camera = cam.id;
  return sc;
}

/** Fondos de un proyecto PNGTuber. */
export const TUBER_BG: [string, string, string][] = [['green', 'Pantalla verde (para OBS)', '#00b140'], ['blue', 'Pantalla azul', '#0047bb'], ['magenta', 'Pantalla magenta', '#ff00ff'], ['dark', 'Escenario oscuro', '#1d1830'], ['transparent', 'Transparente (renders)', '#00b140']];
/**
 * Proyecto PNGTuber: todo en 2D. Fondo de color (pantalla verde por defecto) o
 * dibujado, sin suelo, sin luces (colores originales) y vista plana de frente; el
 * motor es el del 3D Studio (física, audio, poses, efectos y grabación).
 */
export function newTuberStudio(bg = 'green'): Studio3 {
  const st = newStudio();
  st.kind = 'tuber';
  st.grid = { ...st.grid, show: false, axes: false };
  const sc = st.scenes[0];
  sc.name = 'Escenario';
  const col = TUBER_BG.find(b => b[0] === bg)?.[2] ?? '#00b140';
  sc.env = { ...sc.env, bg: col, transparent: bg === 'transparent', unlit: true, envLight: 1 };
  // Sin suelo ni cubo; una luz suave por si se activan las luces.
  sc.objects = sc.objects.filter(o => o.kind === 'light');
  sc.camera = null;
  sc.fx = { ...defaultFx(), shadows: 0, ground: false, adaptive: true };
  sc.audio = defaultAudio();
  return st;
}

export function newStudio(): Studio3 {
  const base = newMaterial('Material', { color: '#9d8cff', rough: 0.45 });
  const floor = newMaterial('Suelo', { color: '#8a8597', rough: 0.9 });
  const st: Studio3 = {
    version: S3D_VERSION, scenes: [], open: '', materials: [base, floor], textures: [],
    render: { w: 1920, h: 1080, quality: 2, shadows: 2, transparent: false, fx: true }, time: 0,
    grid: { size: 0.25, snap: true, show: true, axes: true },
  };
  const sc = newScene('Escena 1', st.materials);
  st.scenes.push(sc);
  st.open = sc.id;
  return st;
}

export const sceneOf = (s: Studio3, id = s.open) => s.scenes.find(x => x.id === id) ?? s.scenes[0];
export const objOf = (sc: Scene3, id: string) => sc.objects.find(o => o.id === id);
export const children = (sc: Scene3, id: string | null) => sc.objects.filter(o => o.parent === id);
/** El objeto y todos sus descendientes. */
export function subtree(sc: Scene3, id: string): Obj3[] {
  const out: Obj3[] = [];
  const walk = (x: string) => { const o = objOf(sc, x); if (!o) return; out.push(o); for (const c of children(sc, x)) walk(c.id); };
  walk(id);
  return out;
}
/** ¿Visible y desbloqueado contando con sus padres? */
export function effVisible(sc: Scene3, o: Obj3): boolean { let c: Obj3 | undefined = o; while (c) { if (!c.visible) return false; c = c.parent ? objOf(sc, c.parent) : undefined; } return true; }
export function effLocked(sc: Scene3, o: Obj3): boolean { let c: Obj3 | undefined = o; while (c) { if (c.locked) return true; c = c.parent ? objOf(sc, c.parent) : undefined; } return false; }

/** Recorre todas las propiedades animables de un objeto (y de sus materiales si se pide). */
export function forEachProp3(o: Obj3, fn: (p: Prop<unknown>, path: string) => void) {
  for (const [k, p] of Object.entries(o.tf)) fn(p as Prop<unknown>, `tf.${k}`);
  fn(o.opacity as Prop<unknown>, 'opacity');
  if (o.light) { fn(o.light.color as Prop<unknown>, 'light.color'); fn(o.light.intensity as Prop<unknown>, 'light.intensity'); fn(o.light.angle as Prop<unknown>, 'light.angle'); }
  if (o.cam) fn(o.cam.fov as Prop<unknown>, 'cam.fov');
}
export function forEachMatProp(m: Mat3, fn: (p: Prop<unknown>, path: string) => void) {
  fn(m.color as Prop<unknown>, 'color'); fn(m.rough as Prop<unknown>, 'rough'); fn(m.metal as Prop<unknown>, 'metal'); fn(m.opacity as Prop<unknown>, 'opacity');
  fn(m.emissive as Prop<unknown>, 'emissive'); fn(m.emissiveI as Prop<unknown>, 'emissiveI');
}
export const PROP_LABELS: Record<string, string> = {
  'tf.px': 'Posición X', 'tf.py': 'Posición Y', 'tf.pz': 'Posición Z', 'tf.rx': 'Rotación X', 'tf.ry': 'Rotación Y', 'tf.rz': 'Rotación Z',
  'tf.sx': 'Escala X', 'tf.sy': 'Escala Y', 'tf.sz': 'Escala Z', opacity: 'Opacidad', 'light.color': 'Color de la luz', 'light.intensity': 'Intensidad',
  'light.angle': 'Apertura del foco', 'cam.fov': 'Campo de visión', color: 'Color', rough: 'Rugosidad', metal: 'Metálico', emissive: 'Emisión', emissiveI: 'Intensidad de emisión',
};
export function propByPath3(o: Obj3, path: string): Prop<unknown> | null { let r: Prop<unknown> | null = null; forEachProp3(o, (p, k) => { if (k === path) r = p; }); return r; }

/** Valor de una propiedad en el tiempo `t` y cambio (con keyframe si está animada o se fuerza). */
export const at3 = <T>(p: Prop<T>, t: number) => valueAt(p, t);
export const set3 = <T>(p: Prop<T>, t: number, v: T, key = false) => setValue(p, t, v, key);

/** Instantánea para el historial (las texturas no cambian nunca: se comparten). */
export function snapshot(s: Studio3): Studio3 { const { textures, ...rest } = s; return { ...clone(rest), textures: [...textures] }; }

// ---------------------------------------------------------------- historial

export class History3 {
  undoStack: { label: string; before: Studio3; after: Studio3 }[] = [];
  redoStack: { label: string; before: Studio3; after: Studio3 }[] = [];
  private pendingBefore: Studio3 | null = null;
  constructor(public s: Studio3, private onChange: (s: Studio3, label: string) => void, public limit = 120) {}
  edit(label: string, fn: (s: Studio3) => boolean | void): boolean {
    const before = snapshot(this.s);
    let ok: boolean | void;
    try { ok = fn(this.s); } catch (e) { this.s = before; throw e; }
    if (ok === false) { this.s = before; return false; }
    this.push(label, before);
    return true;
  }
  begin() { if (!this.pendingBefore) this.pendingBefore = snapshot(this.s); }
  get pending() { return !!this.pendingBefore; }
  commit(label: string) {
    const b = this.pendingBefore;
    this.pendingBefore = null;
    if (!b) return false;
    if (JSON.stringify({ ...b, textures: 0 }) === JSON.stringify({ ...this.s, textures: 0 })) return false;
    this.push(label, b);
    return true;
  }
  cancel() { if (this.pendingBefore) { this.s = this.pendingBefore; this.pendingBefore = null; this.onChange(this.s, ''); } }
  private push(label: string, before: Studio3) {
    this.undoStack.push({ label, before, after: snapshot(this.s) });
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
    this.onChange(this.s, label);
  }
  undo() { const c = this.undoStack.pop(); if (!c) return null; this.redoStack.push(c); this.s = keepTex(snapshot(c.before), this.s); this.onChange(this.s, `Deshacer: ${c.label}`); return c; }
  redo() { const c = this.redoStack.pop(); if (!c) return null; this.undoStack.push(c); this.s = keepTex(snapshot(c.after), this.s); this.onChange(this.s, `Rehacer: ${c.label}`); return c; }
}
/** Al deshacer se conservan todas las texturas conocidas (pueden volver a usarse). */
function keepTex(s: Studio3, cur: Studio3): Studio3 { const ids = new Set(s.textures.map(t => t.id)); s.textures = [...s.textures, ...cur.textures.filter(t => !ids.has(t.id))]; return s; }

// ---------------------------------------------------------------- validar al abrir

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const okProp = (p: unknown, def: unknown): Prop<never> => (isObj(p) && 'v' in p ? (p as unknown as Prop<never>) : prop(def as never));

/** Valida un proyecto 3D leído de un archivo (completa lo que falte; descarta lo roto). */
export function normalizeStudio(v: unknown): Studio3 | null {
  if (!isObj(v) || !Array.isArray(v.scenes)) return null;
  const s = clone(v) as unknown as Studio3;
  const base = newStudio();
  s.version = S3D_VERSION;
  if (s.kind !== 'tuber') delete s.kind;
  s.materials = Array.isArray(s.materials) ? s.materials.filter(m => isObj(m) && typeof m.id === 'string') : [];
  for (const m of s.materials) {
    const d = newMaterial(m.name ?? 'Material');
    for (const k of ['color', 'rough', 'metal', 'opacity', 'emissive', 'emissiveI'] as const) (m as unknown as Record<string, unknown>)[k] = okProp(m[k], d[k].v);
    m.tex ??= null; m.proc ??= null; m.texScale = isNum(m.texScale) ? m.texScale : 1; m.toon = !!m.toon; m.fav = !!m.fav; m.name ??= 'Material';
  }
  if (!s.materials.length) s.materials = base.materials;
  s.textures = Array.isArray(s.textures) ? s.textures.filter(t => isObj(t) && typeof t.id === 'string' && typeof t.src === 'string') : [];
  const mids = new Set(s.materials.map(m => m.id));
  s.scenes = s.scenes.filter(sc => isObj(sc) && typeof sc.id === 'string' && Array.isArray(sc.objects));
  for (const sc of s.scenes) {
    sc.name ??= 'Escena';
    sc.env = isObj(sc.env) ? { ...base.scenes[0].env, ...sc.env } : base.scenes[0].env;
    sc.fps = isNum(sc.fps) && sc.fps > 0 ? Math.min(120, sc.fps) : 30;
    sc.dur = isNum(sc.dur) && sc.dur > 0 ? sc.dur : 5;
    sc.objects = sc.objects.filter(o => isObj(o) && typeof o.id === 'string' && ['mesh', 'group', 'light', 'camera'].includes(o.kind as string));
    const ids = new Set(sc.objects.map(o => o.id));
    for (const o of sc.objects) {
      o.name ??= 'Objeto'; o.visible = o.visible !== false; o.locked = !!o.locked;
      if (!o.parent || !ids.has(o.parent) || o.parent === o.id) o.parent = null;
      const t = isObj(o.tf) ? o.tf : {};
      o.tf = Object.fromEntries((['px', 'py', 'pz', 'rx', 'ry', 'rz', 'sx', 'sy', 'sz'] as const).map(k => [k, okProp((t as Record<string, unknown>)[k], k.startsWith('s') ? 1 : 0)])) as unknown as Tf3;
      o.opacity = okProp(o.opacity, 1);
      if (o.kind === 'mesh') {
        const m = o.mesh;
        if (!isObj(m) || !Array.isArray(m.v) || !Array.isArray(m.f)) { o.mesh = box(); o.mats = [s.materials[0].id]; }
        else { const n = m.v.length / 3; m.f = m.f.filter(f => Array.isArray(f) && f.length >= 3 && f.every(i => isNum(i) && i >= 0 && i < n)); m.m = Array.isArray(m.m) ? m.m : []; while (m.m.length < m.f.length) m.m.push(0); if (m.uv && (!Array.isArray(m.uv) || m.uv.length !== m.f.length)) delete m.uv; }
        o.mats = Array.isArray(o.mats) ? o.mats.map(x => (mids.has(x) ? x : s.materials[0].id)) : [s.materials[0].id];
        if (!o.mats.length) o.mats = [s.materials[0].id];
      }
      if (o.kind === 'light') { const d = lightObject(isObj(o.light) && typeof o.light.type === 'string' ? o.light.type as LightType : 'point').light!; o.light = isObj(o.light) ? { ...d, ...o.light, color: okProp(o.light.color, d.color.v), intensity: okProp(o.light.intensity, d.intensity.v), angle: okProp(o.light.angle, d.angle.v) } : d; }
      if (o.kind === 'camera') o.cam = isObj(o.cam) ? { near: isNum(o.cam.near) ? o.cam.near : 0.05, far: isNum(o.cam.far) ? o.cam.far : 2000, fov: okProp(o.cam.fov, 45) } : { fov: prop(45), near: 0.05, far: 2000 };
    }
    sc.fx = { ...defaultFx(), ...(isObj(sc.fx) ? sc.fx : {}) };
    if (sc.fx.cel) sc.fx.cel = isObj(sc.fx.cel) ? { ...defaultCel(), ...sc.fx.cel } : null;
    if (sc.fx.line && !isObj(sc.fx.line)) sc.fx.line = null;
    sc.rules = Array.isArray(sc.rules) ? sc.rules.filter(r => isObj(r) && isObj(r.on) && Array.isArray(r.do)).map(r => ({ ...r, id: typeof r.id === 'string' ? r.id : sid('ru'), name: typeof r.name === 'string' ? r.name : 'Regla', enabled: r.enabled !== false, once: !!r.once, do: r.do.filter(isObj) as Act3[] })) : [];
    sc.script = typeof sc.script === 'string' ? sc.script : '';
    if (sc.audio !== undefined) {
      if (!isObj(sc.audio)) delete sc.audio;
      else sc.audio = { ...defaultAudio(), ...sc.audio, tracks: Array.isArray(sc.audio.tracks) ? sc.audio.tracks.filter(t => isObj(t) && typeof t.src === 'string').map(t => ({ id: typeof t.id === 'string' ? t.id : sid('au'), name: typeof t.name === 'string' ? t.name : 'Audio', src: t.src, auto: t.auto !== false, loop: !!t.loop, volume: isNum(t.volume) ? t.volume : 1 })) : [] };
    }
    for (const o of sc.objects) {
      if (o.phys !== undefined) o.phys = isObj(o.phys) ? { ...defaultPhys(), ...o.phys } : undefined;
      if (o.ctrl !== undefined) o.ctrl = isObj(o.ctrl) ? { ...defaultCtrl(), ...o.ctrl, lock: { ...defaultCtrl().lock, ...(isObj(o.ctrl.lock) ? o.ctrl.lock : {}) } } : undefined;
      if (o.style !== undefined) o.style = isObj(o.style) ? { ...defaultObjStyle(), ...o.style } : undefined;
      if (o.fluid !== undefined) { if (isObj(o.fluid) && typeof o.fluid.liquid === 'string' && o.fluid.liquid in LIQUIDS) o.fluid = { ...defaultFluid(o.fluid.liquid as LiquidType), ...o.fluid }; else delete o.fluid; }
      if (o.weapon !== undefined) { const w = normalizeWeapon(o.weapon); if (w) o.weapon = w; else delete o.weapon; }
      if (o.particles !== undefined) { if (isObj(o.particles) && typeof o.particles.type === 'string' && o.particles.type in PART_TYPES) o.particles = { ...defaultParticles(o.particles.type as PartType), ...o.particles }; else delete o.particles; }
      if (o.style?.cel) o.style.cel = isObj(o.style.cel) ? { ...defaultCel(), ...o.style.cel } : null;
      if (o.style?.line) o.style.line = isObj(o.style.line) ? { width: isNum(o.style.line.width) ? o.style.line.width : 2, color: typeof o.style.line.color === 'string' ? o.style.line.color : '#111111' } : null;
      if (o.card) {
        if (o.card.poses !== undefined) o.card.poses = Array.isArray(o.card.poses) ? o.card.poses.filter(p => isObj(p) && typeof p.tex === 'string').map(p => ({ id: typeof p.id === 'string' ? p.id : sid('ps'), name: typeof p.name === 'string' ? p.name : 'Pose', tex: p.tex, key: typeof p.key === 'string' ? p.key : '', ...(typeof p.talk === 'string' ? { talk: p.talk } : {}), ...(typeof p.blink === 'string' ? { blink: p.blink } : {}) })) : [];
        if (o.card.trans && !isObj(o.card.trans)) delete o.card.trans;
        if (o.part !== undefined && !(isObj(o.part) && isNum(o.part.sway))) delete o.part;
        if (o.card.tuber !== undefined) { if (isObj(o.card.tuber)) o.card.tuber = { ...defaultTuber(), ...o.card.tuber }; else delete o.card.tuber; }
      }
      if (o.style === undefined) delete o.style;
      if (o.phys === undefined) delete o.phys;
      if (o.ctrl === undefined) delete o.ctrl;
    }
    // Ciclos en la jerarquía: se rompen.
    for (const o of sc.objects) { let c = o.parent, k = 0; while (c && k++ < 200) { if (c === o.id) { o.parent = null; break; } c = sc.objects.find(x => x.id === c)?.parent ?? null; } }
    if (sc.camera && !sc.objects.some(o => o.id === sc.camera && o.kind === 'camera')) sc.camera = sc.objects.find(o => o.kind === 'camera')?.id ?? null;
  }
  if (!s.scenes.length) return null;
  if (!s.scenes.some(x => x.id === s.open)) s.open = s.scenes[0].id;
  s.render = isObj(s.render) ? { ...base.render, ...s.render } : base.render;
  s.grid = isObj(s.grid) ? { ...base.grid, ...s.grid } : base.grid;
  s.time = isNum(s.time) ? Math.max(0, s.time) : 0;
  return s;
}

/** Resumen para la galería. */
export const studioMeta = (s: Studio3) => ({
  scenes: s.scenes.length, objects: s.scenes.reduce((a, sc) => a + sc.objects.filter(o => o.kind === 'mesh').length, 0),
  // PNGTuber: personajes (dibujos que no son partes de otro).
  ...(s.kind === 'tuber' ? { tuber: s.scenes.reduce((a, sc) => a + sc.objects.filter(o => o.card && !o.part).length, 0) } : {}),
});

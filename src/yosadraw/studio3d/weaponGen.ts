import { box, cylinder, merge, sphere, type Mesh, type V3 } from './mesh';
import type { PartRole, WeaponKind } from './model';

/**
 * Armas originales de YOSADRAW hechas por código, por piezas separadas (armazón,
 * corredera, cañón, gatillo, martillo, cargador…). Cada pieza móvil es un objeto
 * con su punto de giro y su recorrido, así se animan como las reales: la corredera
 * retrocede, el cargador sale por su eje, el gatillo y el martillo giran, el tambor
 * gira un sexto por disparo. Medidas en metros; el cañón apunta a +Z, Y arriba y la
 * ventana de expulsión a la derecha (−X).
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

const D2R = Math.PI / 180;
/** Rotación XYZ (grados) y traslación de un punto. */
const tf = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
  const a = rx * D2R, b = ry * D2R, c = rz * D2R;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c);
  return (p: V3): V3 => {
    // Igual que Euler XYZ de three.js: v' = Rx · Ry · Rz · v
    let [px, py, pz] = p;
    let t = px * cc - py * sc; py = px * sc + py * cc; px = t;            // Rz
    t = px * cb + pz * sb; pz = -px * sb + pz * cb; px = t;               // Ry
    t = py * ca - pz * sa; pz = py * sa + pz * ca; py = t;                // Rx
    return [px + x, py + y, pz + z];
  };
};
type Piece = { mesh: Mesh; mat?: (p: V3) => V3; slot: number };
/** Caja (ancho, alto, largo) en (x, y, z) con giro. */
const B = (slot: number, w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): Piece => ({ mesh: box(w, h, d), mat: tf(x, y, z, rx, ry, rz), slot });
/** Cilindro a lo largo de Z (o de Y con `alongY`). */
const C = (slot: number, r: number, len: number, x: number, y: number, z: number, seg = 16, rTop = r, alongY = false, rx = 0): Piece => ({ mesh: cylinder(r, len, seg, rTop), mat: tf(x, y, z, alongY ? rx : 90 + rx), slot });
const S = (slot: number, r: number, x: number, y: number, z: number): Piece => ({ mesh: sphere(r, 10, 6), mat: tf(x, y, z), slot });
/** Junta piezas en una malla con sus materiales (ranura = índice en `mats`). */
const part = (name: string, role: PartRole | null, pos: V3, mats: WMat[], pieces: Piece[], extra: Partial<GenPart> = {}): GenPart => ({ name, role, pos, mats, mesh: merge(pieces), ...extra });
/** Estrías (cortes de agarre) en los dos lados. */
const serrations = (slot: number, n: number, z0: number, step: number, w: number, h: number, y: number) =>
  Array.from({ length: n }, (_, i) => [B(slot, 0.0012, h, 0.0012, w / 2 + 0.0002, y, z0 + i * step), B(slot, 0.0012, h, 0.0012, -w / 2 - 0.0002, y, z0 + i * step)]).flat();

function pistol(): GenWeapon {
  const G = 18; // ángulo de la empuñadura
  const frame = part('Armazón', null, [0, 0, 0], ['polymer', 'steel'], [
    B(0, 0.026, 0.02, 0.14, 0, 0.012, 0.035),                       // guardapolvo
    B(0, 0.028, 0.105, 0.046, 0, -0.045, -0.03, G),                   // empuñadura
    B(0, 0.03, 0.02, 0.05, 0, -0.096, -0.047, G),                     // talón
    B(0, 0.024, 0.018, 0.03, 0, 0.004, -0.058),                       // cola de castor
    B(0, 0.022, 0.005, 0.05, 0, -0.026, 0.03),                        // guardamonte (abajo)
    B(0, 0.022, 0.026, 0.006, 0, -0.012, 0.056),                      // guardamonte (delante)
    ...[0, 1, 2].map(i => B(0, 0.028, 0.003, 0.006, 0, 0.0005, 0.06 + i * 0.012)), // raíl
    ...Array.from({ length: 6 }, (_, i) => B(0, 0.0295, 0.004, 0.003, 0, -0.03 - i * 0.012, -0.03 + i * 0.004, G)), // textura de agarre
    B(1, 0.004, 0.006, 0.012, -0.012, 0.016, -0.005),                 // palanca de desarme
  ]);
  const slide = part('Corredera', 'slide', [0, 0.034, 0.03], ['blued', 'dark', 'steel'], [
    B(0, 0.025, 0.028, 0.185, 0, 0, 0),
    B(1, 0.0025, 0.014, 0.034, -0.0118, 0.006, 0.01),                 // ventana de expulsión
    B(0, 0.004, 0.005, 0.003, 0, 0.016, 0.088),                       // mira delantera
    B(0, 0.016, 0.005, 0.004, 0, 0.016, -0.085),                      // mira trasera
    ...serrations(0, 7, -0.088, 0.004, 0.025, 0.02, -0.002),
    B(2, 0.0026, 0.0026, 0.004, -0.0128, 0.006, 0.03),                // extractor
  ], { move: [0, 0, -0.03] });
  const barrel = part('Cañón', 'extra', [0, 0.034, 0.03], ['steel', 'dark'], [
    C(0, 0.0058, 0.1, 0, -0.001, 0.045, 18),
    B(0, 0.018, 0.014, 0.028, 0, 0.003, 0.008),                       // recámara (se ve por la ventana)
    C(1, 0.0045, 0.002, 0, -0.001, 0.0955, 14),                       // ánima
  ]);
  const trigger = part('Gatillo', 'trigger', [0, -0.006, 0.038], ['polymer'], [
    B(0, 0.006, 0.02, 0.005, 0, -0.01, 0, -8), B(0, 0.007, 0.006, 0.004, 0, -0.019, 0.002, -20),
  ], { rotMove: [14, 0, 0] });
  const mag = part('Cargador', 'mag', [0, -0.05, -0.028], ['polymer', 'brass', 'steel'], [
    B(2, 0.022, 0.108, 0.032, 0, 0, 0),
    B(0, 0.026, 0.012, 0.038, 0, -0.058, -0.001),                     // base
    C(1, 0.0048, 0.014, 0, 0.056, 0.004, 12),                         // bala de arriba
  ], { rot: [G, 0, 0], move: [0, -0.125 * Math.cos(G * D2R), -0.125 * Math.sin(G * D2R)] });
  return { name: 'Pistola', parts: [frame, slide, barrel, trigger, mag], muzzle: [0, 0.033, 0.124], eject: [-0.015, 0.045, 0.042], ejectDir: [-1, 0.75, -0.3] };
}

function rifle(): GenWeapon {
  const lower = part('Receptor inferior', null, [0, 0, 0], ['alloy', 'polymer'], [
    B(0, 0.025, 0.048, 0.2, 0, -0.006, 0),
    B(0, 0.029, 0.052, 0.07, 0, -0.04, 0.045),                        // brocal del cargador
    B(1, 0.028, 0.1, 0.042, 0, -0.07, -0.062, 22),                    // empuñadura
    B(0, 0.022, 0.005, 0.07, 0, -0.045, -0.012),                      // guardamonte
    C(0, 0.016, 0.2, 0, 0.022, -0.19, 20),                            // tubo del amortiguador
    B(1, 0.042, 0.1, 0.17, 0, 0.006, -0.27),                          // culata
    B(1, 0.044, 0.112, 0.014, 0, 0.002, -0.358),                      // cantonera
  ]);
  const upper = part('Receptor superior', null, [0, 0, 0], ['alloy', 'dark'], [
    B(0, 0.027, 0.04, 0.24, 0, 0.037, 0.02),
    ...Array.from({ length: 14 }, (_, i) => B(0, 0.022, 0.006, 0.008, 0, 0.06, -0.07 + i * 0.016)), // raíl superior
    B(1, 0.0024, 0.018, 0.06, -0.0136, 0.04, 0.03),                   // ventana de expulsión
    B(0, 0.008, 0.008, 0.018, -0.015, 0.046, -0.02),                  // asistente de cierre
  ]);
  const guard = part('Guardamanos', null, [0, 0.035, 0.28], ['polymer', 'alloy'], [
    C(0, 0.022, 0.28, 0, 0, 0, 12),
    ...Array.from({ length: 6 }, (_, i) => B(1, 0.046, 0.008, 0.02, 0, 0, -0.11 + i * 0.044)),
    B(1, 0.01, 0.02, 0.012, 0, 0.04, 0.16),                           // mira delantera
  ]);
  const barrel = part('Cañón', 'extra', [0, 0.035, 0.5], ['steel', 'blued'], [
    C(0, 0.0085, 0.42, 0, 0, 0, 16),
    C(1, 0.011, 0.055, 0, 0, 0.235, 12),                              // bocacha
  ]);
  const bolt = part('Portacerrojo', 'bolt', [0, 0.04, 0.03], ['steel', 'blued'], [
    B(0, 0.012, 0.016, 0.085, -0.002, 0, 0), B(1, 0.006, 0.008, 0.012, -0.008, 0.002, 0.03),
  ], { move: [0, 0, -0.075] });
  const handle = part('Palanca de carga', 'handle', [0, 0.056, -0.09], ['alloy'], [
    B(0, 0.008, 0.008, 0.06, 0, 0, 0), B(0, 0.04, 0.008, 0.01, 0, 0, -0.03),
  ], { move: [0, 0, -0.065] });
  const cover = part('Tapa del expulsor', 'cover', [-0.0145, 0.03, 0.03], ['alloy'], [
    B(0, 0.0016, 0.02, 0.062, 0, 0.01, 0),
  ], { rotMove: [0, 0, -105] });
  const trigger = part('Gatillo', 'trigger', [0, -0.026, -0.012], ['steel'], [B(0, 0.005, 0.02, 0.005, 0, -0.01, 0, -8)], { rotMove: [14, 0, 0] });
  // Cargador curvo: tramos que se van inclinando hacia delante.
  const segs: Piece[] = [];
  let y = 0, z = 0;
  for (let i = 0; i < 6; i++) { const a = -i * 4.5; segs.push(B(0, 0.022, 0.034, 0.064, 0, y, z, a)); y -= 0.033 * Math.cos(a * D2R); z += 0.033 * Math.sin(-a * D2R); }
  segs.push(B(0, 0.026, 0.012, 0.07, 0, y + 0.012, z, -27), C(1, 0.0028, 0.022, 0, 0.018, 0.01, 10));
  const mag = part('Cargador', 'mag', [0, -0.07, 0.048], ['polymer', 'brass'], segs, { move: [0, -0.2, 0] });
  return { name: 'Fusil de asalto', parts: [lower, upper, guard, barrel, bolt, handle, cover, trigger, mag], muzzle: [0, 0.035, 0.765], eject: [-0.016, 0.045, 0.03], ejectDir: [-1, 0.35, 0.2] };
}

function smg(): GenWeapon {
  const body = part('Cajón de mecanismos', null, [0, 0, 0], ['blued', 'polymer', 'dark'], [
    B(0, 0.032, 0.05, 0.26, 0, 0.022, 0.03),
    C(0, 0.018, 0.12, 0, 0.024, 0.2, 14),                             // camisa del cañón
    B(1, 0.028, 0.095, 0.04, 0, -0.04, -0.06, 15),                    // empuñadura
    B(0, 0.024, 0.005, 0.06, 0, -0.012, -0.01),                       // guardamonte
    B(0, 0.03, 0.04, 0.04, 0, -0.012, 0.07),                          // brocal
    B(0, 0.006, 0.006, 0.2, 0.012, 0.012, -0.2), B(0, 0.006, 0.006, 0.2, -0.012, 0.012, -0.2), // culata plegable
    B(1, 0.034, 0.06, 0.012, 0, 0.0, -0.3),
    B(2, 0.0024, 0.016, 0.05, -0.0162, 0.03, 0.05),                   // ventana de expulsión
  ]);
  const barrel = part('Cañón', 'extra', [0, 0.024, 0.2], ['steel'], [C(0, 0.0075, 0.15, 0, 0, 0.02, 14)]);
  const bolt = part('Cerrojo', 'bolt', [0, 0.03, 0.04], ['steel'], [B(0, 0.014, 0.018, 0.07, -0.003, 0, 0)], { move: [0, 0, -0.06] });
  const handle = part('Manija de carga', 'handle', [0.018, 0.034, 0.12], ['blued'], [B(0, 0.012, 0.008, 0.01, 0.006, 0, 0)], { move: [0, 0, -0.08] });
  const trigger = part('Gatillo', 'trigger', [0, -0.006, 0.0], ['steel'], [B(0, 0.005, 0.02, 0.005, 0, -0.01, 0, -8)], { rotMove: [14, 0, 0] });
  const mag = part('Cargador', 'mag', [0, -0.07, 0.07], ['blued', 'brass'], [
    B(0, 0.022, 0.12, 0.03, 0, -0.02, 0), B(0, 0.026, 0.01, 0.034, 0, -0.083, 0), C(1, 0.0048, 0.014, 0, 0.042, 0.004, 10),
  ], { move: [0, -0.2, 0] });
  return { name: 'Subfusil', parts: [body, barrel, bolt, handle, trigger, mag], muzzle: [0, 0.024, 0.285], eject: [-0.018, 0.035, 0.05], ejectDir: [-1, 0.6, -0.1] };
}

function shotgun(): GenWeapon {
  const recv = part('Cajón de mecanismos', null, [0, 0, 0], ['blued', 'dark', 'steel'], [
    B(0, 0.036, 0.055, 0.19, 0, 0.012, 0),
    B(1, 0.0025, 0.022, 0.06, -0.0182, 0.02, 0.03),                   // ventana de expulsión
    B(0, 0.022, 0.005, 0.06, 0, -0.022, -0.02),                       // guardamonte
    B(2, 0.01, 0.004, 0.18, 0, 0.042, 0.02),                          // mira de banda
  ]);
  const stock = part('Culata', null, [0, 0, 0], ['wood', 'rubber'], [
    B(0, 0.034, 0.07, 0.11, 0, -0.012, -0.135, 12),                   // garganta
    B(0, 0.038, 0.12, 0.2, 0, -0.03, -0.27, 4),
    B(1, 0.04, 0.13, 0.018, 0, -0.036, -0.375, 4),
  ]);
  const barrel = part('Cañón', 'extra', [0, 0.03, 0.34], ['blued', 'dark'], [C(0, 0.011, 0.5, 0, 0, 0, 18), C(1, 0.0095, 0.002, 0, 0, 0.25, 14), S(0, 0.003, 0, 0.012, 0.245)]);
  const tube = part('Depósito tubular', null, [0, 0.004, 0.29], ['blued'], [C(0, 0.011, 0.4, 0, 0, 0, 16)]);
  const pump = part('Guardamanos (bombeo)', 'pump', [0, 0.004, 0.2], ['wood'], [
    C(0, 0.018, 0.16, 0, 0, 0, 14), ...Array.from({ length: 6 }, (_, i) => C(0, 0.0195, 0.006, 0, 0, -0.06 + i * 0.024, 14)),
  ], { move: [0, 0, -0.085] });
  const bolt = part('Cerrojo', 'bolt', [0, 0.02, 0.03], ['steel'], [B(0, 0.016, 0.018, 0.06, -0.004, 0, 0)], { move: [0, 0, -0.08] });
  const trigger = part('Gatillo', 'trigger', [0, -0.008, -0.01], ['steel'], [B(0, 0.005, 0.02, 0.005, 0, -0.01, 0, -8)], { rotMove: [14, 0, 0] });
  return { name: 'Escopeta de bombeo', parts: [recv, stock, barrel, tube, pump, bolt, trigger], muzzle: [0, 0.03, 0.592], eject: [-0.02, 0.025, 0.035], ejectDir: [-1, 0.5, 0.05] };
}

function revolver(): GenWeapon {
  const frame = part('Armazón', null, [0, 0, 0], ['steel', 'wood', 'dark'], [
    B(0, 0.02, 0.045, 0.075, 0, 0.018, 0.0),                          // ventana del tambor
    B(0, 0.016, 0.012, 0.06, 0, 0.044, 0.0),                          // puente superior
    B(1, 0.03, 0.09, 0.042, 0, -0.04, -0.045, 25),                    // cachas
    B(0, 0.02, 0.005, 0.045, 0, -0.012, 0.012),                       // guardamonte
    B(0, 0.014, 0.016, 0.022, 0, 0.034, -0.046),                      // armazón trasero
  ]);
  const barrel = part('Cañón', 'extra', [0, 0.036, 0.11], ['steel', 'dark'], [C(0, 0.0078, 0.13, 0, 0, 0, 16), B(0, 0.009, 0.009, 0.13, 0, 0.008, 0), B(0, 0.003, 0.008, 0.008, 0, 0.016, 0.06), C(2, 0.0045, 0.002, 0, 0, 0.065, 12)]);
  const cyl: Piece[] = [C(0, 0.019, 0.04, 0, 0, 0, 20), C(0, 0.0045, 0.05, 0, 0, 0.004, 10)];
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; cyl.push(C(1, 0.0048, 0.0015, Math.cos(a) * 0.0115, Math.sin(a) * 0.0115, 0.0201, 10)); }
  const cylinder = part('Tambor', 'cylinder', [0, 0.02, 0.0], ['steel', 'brass'], cyl, { rotMove: [0, 0, 60] });
  const hammer = part('Martillo', 'hammer', [0, 0.034, -0.05], ['steel'], [B(0, 0.008, 0.026, 0.008, 0, 0.012, -0.002, -12), B(0, 0.012, 0.006, 0.012, 0, 0.024, -0.008)], { rotMove: [-38, 0, 0] });
  const trigger = part('Gatillo', 'trigger', [0, -0.004, 0.014], ['steel'], [B(0, 0.005, 0.02, 0.005, 0, -0.01, 0, -8)], { rotMove: [16, 0, 0] });
  return { name: 'Revólver', parts: [frame, barrel, cylinder, hammer, trigger], muzzle: [0, 0.036, 0.176], eject: [0, 0.02, 0.03], ejectDir: [0, -0.4, -1] };
}

function sniper(): GenWeapon {
  const stock = part('Culata', null, [0, 0, 0], ['polymer', 'rubber'], [
    B(0, 0.044, 0.05, 0.42, 0, 0.004, 0.11),                          // guardamanos
    B(0, 0.04, 0.085, 0.08, 0, -0.03, -0.09, 18),                     // empuñadura
    B(0, 0.044, 0.07, 0.3, 0, -0.012, -0.27, -3),
    B(0, 0.044, 0.12, 0.08, 0, -0.035, -0.39),
    B(1, 0.046, 0.13, 0.016, 0, -0.035, -0.437),
    B(0, 0.02, 0.005, 0.05, 0, -0.028, -0.01),                        // guardamonte
  ]);
  const recv = part('Cajón de mecanismos', null, [0, 0.035, 0.02], ['blued', 'dark'], [C(0, 0.016, 0.2, 0, 0, 0, 18), B(1, 0.0026, 0.012, 0.07, -0.016, 0.004, 0.0)]);
  const barrel = part('Cañón', 'extra', [0, 0.035, 0.46], ['blued', 'steel'], [C(0, 0.0115, 0.68, 0, 0, 0, 18, 0.009), C(1, 0.013, 0.05, 0, 0, 0.35, 12)]);
  const scope = part('Mira telescópica', 'extra', [0, 0.085, 0.02], ['blued', 'dark'], [
    C(0, 0.0125, 0.24, 0, 0, 0, 18), C(0, 0.022, 0.07, 0, 0, 0.14, 18, 0.0125), C(0, 0.018, 0.05, 0, 0, -0.13, 18),
    C(1, 0.0195, 0.002, 0, 0, 0.176, 16), B(0, 0.012, 0.035, 0.012, 0, -0.03, 0.06), B(0, 0.012, 0.035, 0.012, 0, -0.03, -0.06),
    C(0, 0.007, 0.02, 0, 0.018, 0, 10, 0.007, true), C(0, 0.007, 0.02, 0.018, 0, 0, 10, 0.007, true, 0),
  ]);
  const bolt = part('Cerrojo', 'bolt', [0, 0.035, -0.03], ['steel'], [C(0, 0.0085, 0.14, 0, 0, 0, 14)], { move: [0, 0, -0.1] });
  const handle = part('Manija del cerrojo', 'handle', [0, 0, -0.05], ['steel'], [B(0, 0.04, 0.006, 0.006, -0.022, 0, 0), S(0, 0.007, -0.042, 0, 0)], { parent: 'Cerrojo', rotMove: [0, 0, 65] });
  const trigger = part('Gatillo', 'trigger', [0, -0.006, -0.012], ['steel'], [B(0, 0.005, 0.02, 0.005, 0, -0.01, 0, -8)], { rotMove: [12, 0, 0] });
  const mag = part('Cargador', 'mag', [0, -0.02, 0.05], ['blued', 'brass'], [B(0, 0.024, 0.05, 0.085, 0, 0, 0), C(1, 0.006, 0.05, 0, 0.022, 0.0, 10)], { move: [0, -0.12, 0] });
  return { name: 'Fusil de cerrojo', parts: [stock, recv, barrel, scope, bolt, handle, trigger, mag], muzzle: [0, 0.035, 0.8], eject: [-0.018, 0.045, 0.0], ejectDir: [-1, 0.7, 0] };
}

export function generateWeapon(kind: Exclude<WeaponKind, 'custom'>): GenWeapon {
  switch (kind) {
    case 'pistol': return pistol();
    case 'rifle': return rifle();
    case 'smg': return smg();
    case 'shotgun': return shotgun();
    case 'revolver': return revolver();
    case 'sniper': return sniper();
  }
}

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

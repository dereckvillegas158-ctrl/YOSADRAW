import * as T from 'three';
import { fromTriangles, merge, type Mesh, type V3 } from './mesh';
import type { Caliber, PartRole, WeaponAction, WeaponKind } from './model';
import type { GenPart, GenWeapon, WMat } from './weaponGen';

/**
 * Armas de la vida real, modeladas en YOSADRAW a partir de sus medidas y su silueta
 * (vista lateral) reales: cada pieza es su contorno extruido con los bordes
 * biselados (guardamontes con su hueco, cargadores curvos, empuñaduras inclinadas,
 * culatas de madera), más cañones, bocachas y miras torneados. Las piezas móviles
 * (corredera, cerrojo, palanca, gatillo, martillo, tambor, guardamanos de bombeo,
 * cargador) van separadas, con su punto de giro y su recorrido reales.
 *
 * Se trabaja en milímetros: Z hacia la boca del cañón, Y arriba, X a la izquierda
 * (la ventana de expulsión queda a la derecha, −X). El origen del arma se pone
 * sobre el gatillo, a la altura del ánima.
 */

type P2 = [number, number] | ['q', number, number, number, number];
type Piece = { mesh: Mesh; mat?: (p: V3) => V3; slot: number };
let O: V3 = [0, 0, 0];
const toM = (p: V3): V3 => [(p[0] - O[0]) / 1000, (p[1] - O[1]) / 1000, (p[2] - O[2]) / 1000];

function piece(g: T.BufferGeometry, slot: number): Piece {
  const ng = g.index ? g.toNonIndexed() : g;
  const mesh = fromTriangles(ng.attributes.position.array as ArrayLike<number>, null, null);
  g.dispose(); if (ng !== g) ng.dispose();
  return { mesh, mat: toM, slot };
}
function shape(pts: P2[]) {
  const s = new T.Shape();
  pts.forEach((p, i) => {
    if (p[0] === 'q') s.quadraticCurveTo(p[1], p[2] as number, p[3] as number, p[4] as number);
    else if (i === 0) s.moveTo(p[0], p[1] as number);
    else s.lineTo(p[0], p[1] as number);
  });
  return s;
}
/** Contorno lateral (z, y en mm) extruido `w` mm de ancho, centrado en `x`, con bisel y huecos. */
function prof(slot: number, pts: P2[], w: number, x = 0, bevel = 1.2, holes: P2[][] = []): Piece {
  const sh = shape(pts);
  for (const h of holes) { const p = new T.Path(); h.forEach((q, i) => (q[0] === 'q' ? p.quadraticCurveTo(q[1], q[2] as number, q[3] as number, q[4] as number) : i === 0 ? p.moveTo(q[0], q[1] as number) : p.lineTo(q[0], q[1] as number))); sh.holes.push(p); }
  const b = Math.max(0, Math.min(bevel, w / 2 - 0.2));
  const g = new T.ExtrudeGeometry(sh, { depth: Math.max(0.2, w - 2 * b), bevelEnabled: b > 0, bevelThickness: b, bevelSize: b * 0.9, bevelSegments: 2, curveSegments: 10 });
  g.translate(0, 0, -Math.max(0.2, w - 2 * b) / 2);
  g.rotateY(-Math.PI / 2);
  g.translate(x, 0, 0);
  return piece(g, slot);
}
/** Cilindro a lo largo de Z (radio atrás → radio delante). */
function cyl(slot: number, rBack: number, z0: number, z1: number, y = 0, x = 0, seg = 22, rFront = rBack): Piece {
  const g = new T.CylinderGeometry(rFront, rBack, z1 - z0, seg);
  g.rotateX(Math.PI / 2); g.translate(x, y, (z0 + z1) / 2);
  return piece(g, slot);
}
/** Pieza torneada a lo largo de Z: perfil [radio, z]. */
function lathe(slot: number, pts: [number, number][], y = 0, x = 0, seg = 22): Piece {
  const g = new T.LatheGeometry(pts.map(([r, z]) => new T.Vector2(Math.max(0.01, r), z)), seg);
  g.rotateX(Math.PI / 2); g.translate(x, y, 0);
  return piece(g, slot);
}
function bx(slot: number, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Piece {
  const g = new T.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return piece(g, slot);
}
function ring(slot: number, R: number, r: number, z: number, y = 0, x = 0): Piece {
  const g = new T.TorusGeometry(R, r, 8, 24); g.translate(x, y, z);
  return piece(g, slot);
}
/** Ranuras (estrías) verticales a ambos lados. */
const grooves = (slot: number, n: number, z0: number, step: number, y0: number, y1: number, halfW: number) =>
  Array.from({ length: n }, (_, i) => [bx(slot, halfW - 0.4, halfW + 0.3, y0, y1, z0 + i * step, z0 + i * step + 1), bx(slot, -halfW - 0.3, -halfW + 0.4, y0, y1, z0 + i * step, z0 + i * step + 1)]).flat();

/** Pieza del arma con su pivote (mm) y movimiento (mm / grados). */
function part(name: string, role: PartRole | null, pivot: V3, mats: WMat[], pieces: Piece[], o: { move?: V3; rotMove?: V3; rot?: V3; parent?: string } = {}): GenPart {
  const pv = toM(pivot);
  const mesh = merge(pieces.map(p => ({ mesh: p.mesh, slot: p.slot, mat: (q: V3) => { const r = p.mat ? p.mat(q) : q; return [r[0] - pv[0], r[1] - pv[1], r[2] - pv[2]]; } })));
  // Si cuelga de otra pieza, la posición es relativa a esa pieza (se corrige al montar).
  return { name, role, pos: pv, mats, mesh, ...(o.move ? { move: o.move.map(v => v / 1000) as V3 } : {}), ...(o.rotMove ? { rotMove: o.rotMove } : {}), ...(o.rot ? { rot: o.rot } : {}), ...(o.parent ? { parent: o.parent } : {}) };
}
const out = (name: string, parts: GenPart[], muzzle: V3, eject: V3, ejectDir: V3): GenWeapon => ({ name, parts: fixParents(parts), muzzle: toM(muzzle), eject: toM(eject), ejectDir });
/** Las piezas hijas de otra pieza: posición relativa a su padre. */
function fixParents(parts: GenPart[]) {
  for (const p of parts) if (p.parent) { const par = parts.find(x => x.name === p.parent); if (par) p.pos = [p.pos[0] - par.pos[0], p.pos[1] - par.pos[1], p.pos[2] - par.pos[2]]; }
  return parts;
}
/** Eje de la empuñadura/cargador inclinado `deg` grados (abajo y hacia atrás), `len` mm. */
const gripAxis = (deg: number, len: number): V3 => [0, -Math.cos(deg * Math.PI / 180) * len, -Math.sin(deg * Math.PI / 180) * len];

// ---------------------------------------------------------------- pistolas

/** Glock 17 (9 mm, 17 balas): corredera cuadrada, armazón de polímero, empuñadura a 22°. */
function glock17(): GenWeapon {
  O = [0, 0, 70];
  const frame = part('Armazón', null, [0, 0, 70], ['polymer', 'dark'], [
    prof(0, [[8, -11.5], [178, -11.5], [182, -15], [182, -24], [104, -26], [100, -30], [100, -49], [94, -55], [66, -55], [63, -51], [32, -128], [30, -133], [-26, -133], [-28, -128], [6, -30], [-4, -22], [-6, -15], [0, -11.5]], 28, 0, 2.2,
      [[[62, -30], [96, -30], [96, -47], [90, -51], [67, -51], [62, -45]]]),
    ...Array.from({ length: 3 }, (_, i) => bx(1, -11, 11, -26.5, -23, 130 + i * 14, 136 + i * 14)), // ranuras del raíl
    bx(1, -14.5, -13.6, -18, -13, 86, 96), bx(1, 13.6, 14.5, -18, -13, 86, 96), // palanca de desmontaje
    ...Array.from({ length: 9 }, (_, i) => { const y = -60 - i * 7.5, z = 50 - (i * 7.5) * Math.tan(22 * Math.PI / 180); return [bx(1, 14.1, 14.7, y - 2, y + 2, z - 46, z), bx(1, -14.7, -14.1, y - 2, y + 2, z - 46, z)]; }).flat(), // textura de agarre
  ]);
  const slide = part('Corredera', 'slide', [0, 3, 93], ['blued', 'dark', 'steel'], [
    prof(0, [[0, -11], [0, 14], [3, 17], [174, 17], [186, 9], [186, -11]], 25.5, 0, 1.6),
    bx(1, -13.2, -12.4, 1, 14, 58, 96),                                 // ventana de expulsión
    prof(0, [[6, 17], [18, 17], [17, 23], [8, 23]], 19, 0, 0.6),          // mira trasera
    prof(0, [[170, 17], [176, 17], [175, 22], [171, 22]], 3.6, 0, 0.3),   // mira delantera
    ...grooves(1, 8, 8, 4.2, -8, 13, 12.8),
    bx(2, -13.4, -12.6, 3, 7, 46, 58),                                  // extractor
  ], { move: [0, 0, -30] });
  const barrel = part('Cañón', 'extra', [0, 0, 120], ['steel', 'dark'], [
    cyl(0, 7, 60, 186.5, 0, 0, 24), bx(0, -11, 11, -4, 13, 58, 96), cyl(1, 4.6, 186.4, 186.8, 0, 0, 16),
  ]);
  const trigger = part('Gatillo', 'trigger', [0, -29, 79], ['polymer', 'steel'], [
    prof(0, [[76, -29], [81, -29], [83, -38], [81, -46], [77, -49], [74, -47], [77, -40]], 7, 0, 0.8),
    bx(1, -0.6, 0.6, -42, -35, 79, 82),                                 // seguro del gatillo
  ], { rotMove: [14, 0, 0] });
  const mag = part('Cargador', 'mag', [0, -80, 22], ['polymer', 'brass', 'steel'], [
    prof(2, [[58, -30], [29, -30], [-7, -126], [27, -126]].map(([z, y]) => [z, y] as P2), 21, 0, 1),
    prof(0, [[-10, -126], [31, -126], [33, -133], [31, -138], [-12, -138], [-13, -132]], 26, 0, 1.5),
    cyl(1, 4.6, 34, 52, -28, 0, 14, 3.2),                                // bala de arriba
  ], { move: gripAxis(22, 130) });
  return out('Glock 17', [frame, slide, barrel, trigger, mag], [0, 0, 186.6], [-13, 9, 77], [-1, 0.75, -0.3]);
}

/** Colt M1911 (.45 ACP, 7 balas): martillo a la vista, seguro de empuñadura y cachas de madera. */
function m1911(): GenWeapon {
  O = [0, 0, 70];
  const frame = part('Armazón', null, [0, 0, 70], ['blued', 'wood', 'dark'], [
    prof(0, [[6, -10], [150, -10], [152, -17], [112, -19], [106, -23], [106, -45], [98, -52], [72, -52], [66, -48], [37, -130], [35, -134], [-10, -134], [-12, -130], [2, -36], [-14, -21], [-17, -15], [-8, -10]], 23, 0, 1.6,
      [[[68, -23], [102, -23], [102, -41], [95, -47], [74, -47], [68, -42]]]),
    // Cachas de madera a los dos lados.
    ...[1, -1].map(sx => prof(1, [[60, -54], [35, -124], [-6, -124], [8, -42]], 3, sx * 12.8, 0.9)),
    ...[1, -1].map(sx => bx(2, sx * 14.1 - 1, sx * 14.1 + 1, -96, -92, 12, 16)), // tornillos de las cachas
    bx(0, 11.2, 13.5, -14, -9, 78, 112),                               // retén de la corredera (izquierda)
    bx(0, 11.2, 13, -10, -4, 6, 22),                                   // seguro manual
  ]);
  const slide = part('Corredera', 'slide', [0, 3, 108], ['blued', 'dark'], [
    prof(0, [[0, -10], [0, 13], [3, 16], [210, 16], [216, 10], [216, -10]], 23, 0, 1.4),
    bx(1, -12, -11.3, 1, 13, 66, 104),                                 // ventana de expulsión
    prof(0, [[8, 16], [18, 16], [17, 21], [9, 21]], 13, 0, 0.5),         // mira trasera
    prof(0, [[202, 16], [208, 16], [207, 21], [203, 21]], 3, 0, 0.3),    // mira delantera
    ...grooves(1, 10, 6, 3.4, -8, 12, 11.5),
  ], { move: [0, 0, -32] });
  const barrel = part('Cañón', 'extra', [0, 0, 130], ['steel', 'dark'], [cyl(0, 7.6, 80, 217, 0, 0, 24), lathe(0, [[9, 208], [10, 210], [10, 217], [8.5, 217]]), cyl(1, 5.7, 216.9, 217.3)]);
  const hammer = part('Martillo', 'hammer', [0, -4, 2], ['blued'], [
    prof(0, [[-1, -6], [5, -6], [6, 6], [2, 16], [-8, 18], [-12, 14], [-4, 8]], 7, 0, 0.7),
  ], { rotMove: [-40, 0, 0] });
  const trigger = part('Gatillo', 'trigger', [0, -26, 86], ['steel'], [prof(0, [[80, -26], [90, -26], [90, -38], [82, -38]], 8, 0, 0.6)], { move: [0, 0, -4] });
  const mag = part('Cargador', 'mag', [0, -80, 25], ['blued', 'brass', 'dark'], [
    prof(0, [[58, -36], [30, -36], [-4, -132], [26, -132]], 21, 0, 0.8),
    prof(2, [[-8, -132], [29, -132], [30, -138], [-9, -138]], 23, 0, 1),
    cyl(1, 5.8, 32, 54, -33, 0, 14, 4),
  ], { move: gripAxis(18, 135) });
  return out('Colt M1911', [frame, slide, barrel, hammer, trigger, mag], [0, 0, 217.2], [-12, 8, 85], [-1, 0.8, -0.25]);
}

// ---------------------------------------------------------------- fusiles

/** AK-47 (7,62 × 39, 30 balas): culata y guardamanos de madera, cargador muy curvo, tubo de gases. */
function ak47(): GenWeapon {
  O = [0, 0, 370];
  const stock = part('Culata', null, [0, 0, 370], ['wood', 'steel'], [
    prof(0, [[250, -6], [250, -52], [205, -62], [30, -150], [10, -152], [10, -36], [60, -26], [200, -12]], 38, 0, 3),
    prof(1, [[0, -34], [12, -35], [12, -153], [0, -152]], 40, 0, 1.2),  // cantonera
  ]);
  const recv = part('Cajón de mecanismos', null, [0, 0, 370], ['blued', 'dark', 'wood'], [
    prof(0, [[248, -44], [248, 6], [262, 16], [500, 18], [520, 12], [520, -44]], 28, 0, 1.4),
    prof(0, [[495, -24], [560, -16], [560, 22], [505, 24]], 30, 0, 2),   // bloque del alza
    prof(0, [[520, 24], [560, 24], [560, 34], [520, 30]], 12, 0, 1),     // alza
    bx(1, -14.4, -13.6, -2, 15, 430, 500),                              // ventana de expulsión
    prof(0, [[385, -6], [500, -2], [500, 10], [392, 8]], 3, -15.2, 0.4), // palanca selectora
    // Empuñadura de baquelita y guardamonte de acero.
    prof(2, [[330, -44], [365, -44], [348, -60], [322, -152], [292, -152], [298, -136]], 30, 0, 3),
    prof(0, [[360, -44], [432, -44], [432, -50], [410, -66], [372, -66], [360, -56]], 12, 0, 1, [[[366, -48], [426, -48], [406, -62], [374, -62], [366, -55]]]),
  ]);
  const guards = part('Guardamanos', null, [0, 0, 370], ['wood', 'blued'], [
    prof(0, [[560, -30], [560, 8], [740, 8], [740, -24], [725, -32]], 40, 0, 4),   // inferior
    prof(0, [[562, 12], [720, 12], [714, 30], [570, 30]], 30, 0, 4),               // superior (sobre el tubo de gases)
    cyl(1, 10, 560, 760, 22, 0, 18),                                                // tubo de gases
    prof(1, [[738, -12], [770, -12], [770, 32], [744, 32]], 26, 0, 2),             // bloque de gases
  ]);
  const barrel = part('Cañón', 'extra', [0, 0, 650], ['blued', 'dark'], [
    cyl(0, 9, 520, 862, 0, 0, 22),
    prof(0, [[792, -14], [828, -14], [828, 12], [818, 44], [808, 44], [798, 12]], 20, 0, 1.5), // bloque de la mira
    ring(0, 9, 2, 813, 40),                                                          // protector de la mira
    lathe(0, [[11, 858], [12, 862], [12, 880], [10, 880]]),                          // tuerca de la boca
    cyl(1, 4, 879.5, 880.2),
  ]);
  const bolt = part('Portacerrojo', 'bolt', [0, 6, 470], ['steel', 'blued'], [
    bx(0, -14.2, -8, 0, 13, 430, 520),
    cyl(1, 4.5, 505, 517, 8, -24, 12), prof(1, [[503, 2], [519, 2], [519, 14], [503, 14]], 10, -18, 0.5), // manija de carga (derecha)
  ], { move: [0, 0, -105] });
  const trigger = part('Gatillo', 'trigger', [0, -44, 395], ['blued'], [prof(0, [[392, -44], [398, -44], [400, -54], [397, -60], [392, -59], [394, -52]], 7, 0, 0.6)], { rotMove: [14, 0, 0] });
  const mag = part('Cargador', 'mag', [0, -60, 415], ['blued', 'brass'], [
    prof(0, [[393, -42], [437, -42], [437, -60], ['q', 452, -150, 520, -238], [512, -250], ['q', 440, -165, 395, -62]], 26, 0, 1.6),
    prof(0, [[506, -246], [526, -236], [530, -244], [512, -256]], 30, 0, 1),        // base
    cyl(1, 5.6, 400, 428, -40, 0, 12, 3.9),
  ], { move: [0, -200, 30] });
  return out('AK-47', [stock, recv, guards, barrel, bolt, trigger, mag], [0, 0, 880], [-15, 8, 470], [-1, 0.45, 0.25]);
}

/** M4A1 (5,56, 30 balas): culata telescópica, raíl superior, mira delantera A2, cargador STANAG. */
function m4a1(): GenWeapon {
  O = [0, 0, 330];
  const stock = part('Culata', null, [0, 0, 330], ['polymer', 'rubber', 'alloy'], [
    cyl(2, 15, 60, 262, -4, 0, 22),                                      // tubo del amortiguador
    prof(0, [[0, -78], [0, 12], [150, 14], [162, -2], [150, -24], [110, -26], [40, -88]], 44, 0, 3),
    prof(1, [[-10, -80], [0, -80], [0, 14], [-10, 12]], 46, 0, 2),
  ]);
  const lower = part('Receptor inferior', null, [0, 0, 330], ['alloy', 'polymer', 'dark'], [
    prof(0, [[250, -12], [470, -12], [470, -34], [460, -100], [392, -100], [390, -60], [300, -60], [262, -44]], 26, 0, 1.4),
    prof(1, [[300, -58], [336, -58], [318, -80], [292, -160], [262, -160], [270, -140]], 30, 0, 3), // empuñadura
    prof(0, [[330, -60], [392, -60], [392, -66], [380, -78], [342, -78], [330, -70]], 10, 0, 1, [[[336, -63], [388, -63], [377, -74], [344, -74]]]),
    prof(2, [[360, -20], [378, -20], [378, -14], [360, -14]], 3, 14, 0.3), // selector (izquierda)
  ]);
  const upper = part('Receptor superior', null, [0, 0, 330], ['alloy', 'dark'], [
    prof(0, [[250, -12], [250, 20], [530, 20], [530, -12]], 26, 0, 1.4),
    prof(0, [[252, 20], [528, 20], [528, 30], [252, 30]], 22, 0, 0.8),   // raíl Picatinny
    ...Array.from({ length: 26 }, (_, i) => bx(1, -11.5, 11.5, 26, 30.5, 258 + i * 10, 262 + i * 10)),
    bx(1, -13.6, -12.8, -4, 12, 362, 428),                              // ventana de expulsión
    cyl(0, 6, 286, 310, 8, -16, 12),                                    // asistente de cierre
    lathe(0, [[18, 530], [22, 534], [22, 540], [18, 540]], 4),          // tuerca del cañón
  ]);
  const guard = part('Guardamanos', null, [0, 0, 330], ['polymer', 'dark'], [
    lathe(0, [[22, 540], [27, 546], [27, 708], [22, 715]], 3, 0, 20),
    ...Array.from({ length: 12 }, (_, i) => ring(1, 27, 1.2, 552 + i * 13.5, 3)),
  ]);
  const barrel = part('Cañón', 'extra', [0, 0, 700], ['blued', 'dark'], [
    cyl(0, 8.5, 540, 806, 0, 0, 20, 7.5),
    prof(0, [[716, -12], [748, -12], [744, 26], [735, 72], [729, 72], [722, 26]], 20, 0, 1.5, [[[729, 34], [738, 34], [734, 62], [731, 62]]]), // mira A2
    lathe(0, [[10.5, 800], [11, 806], [11, 838], [10, 838]]),             // apagallamas
    bx(1, -0.9, 0.9, -11.6, 11.6, 812, 832), bx(1, -11.6, 11.6, -0.9, 0.9, 812, 832),          // ranuras del apagallamas
    cyl(1, 3, 837.6, 838.3),
  ]);
  const bolt = part('Portacerrojo', 'bolt', [0, 4, 395], ['steel'], [bx(0, -13.4, -6, -2, 12, 362, 440)], { move: [0, 0, -75] });
  const handle = part('Palanca de carga', 'handle', [0, 22, 262], ['alloy'], [prof(0, [[250, 18], [286, 18], [286, 26], [250, 26]], 12, 0, 1), prof(0, [[246, 18], [258, 18], [258, 26], [246, 26]], 46, 0, 1.5)], { move: [0, 0, -65] });
  const cover = part('Tapa del expulsor', 'cover', [-13.6, -5, 395], ['alloy'], [bx(0, -14.6, -13.4, -5, 13, 360, 430)], { rotMove: [0, 0, -105] });
  const trigger = part('Gatillo', 'trigger', [0, -58, 356], ['steel'], [prof(0, [[352, -58], [358, -58], [360, -68], [357, -74], [352, -73], [354, -66]], 6, 0, 0.6)], { rotMove: [14, 0, 0] });
  const mag = part('Cargador', 'mag', [0, -100, 425], ['alloy', 'brass', 'dark'], [
    prof(0, [[396, -50], [456, -50], [456, -98], ['q', 462, -170, 478, -236], [420, -244], ['q', 404, -176, 398, -98]], 22, 0, 1.4),
    prof(2, [[416, -242], [482, -234], [484, -244], [418, -252]], 26, 0, 1.2),
    cyl(1, 4.6, 404, 428, -48, 0, 12, 2.8),
  ], { move: [0, -200, 10] });
  return out('M4A1', [stock, lower, upper, guard, barrel, bolt, handle, cover, trigger, mag], [0, 0, 838], [-14, 6, 395], [-1, 0.35, 0.2]);
}

/** MP5 (9 mm, 30 balas): cajón de chapa, tubo de carga sobre el cañón, mira de túnel y cargador curvo. */
function mp5(): GenWeapon {
  O = [0, 0, 270];
  const stock = part('Culata', null, [0, 0, 270], ['polymer', 'rubber'], [
    prof(0, [[20, -112], [20, 12], [160, 14], [205, 2], [205, -30], [130, -40], [48, -116]], 40, 0, 4),
    prof(1, [[0, -112], [20, -112], [20, 14], [0, 12]], 44, 0, 2),
  ]);
  const recv = part('Cajón de mecanismos', null, [0, 0, 270], ['blued', 'polymer', 'dark'], [
    cyl(0, 19, 200, 600, 8, 0, 24),                                     // cajón (tubo)
    prof(0, [[205, -28], [470, -28], [470, 4], [205, 4]], 30, 0, 2),
    prof(0, [[356, -28], [402, -28], [402, -46], [356, -46]], 30, 0, 2), // brocal
    prof(1, [[228, -28], [296, -28], [298, -40], [276, -52], [250, -150], [218, -150], [222, -120]], 32, 0, 4), // empuñadura
    prof(1, [[270, -28], [330, -28], [330, -36], [318, -54], [286, -54], [272, -40]], 12, 0, 1.5, [[[280, -32], [324, -32], [314, -48], [288, -48]]]),
    cyl(0, 9, 400, 620, 34, 0, 16),                                     // tubo de carga
    lathe(0, [[10, 228], [18, 232], [18, 250], [10, 254]], 40, 0, 16),  // alza de tambor
    bx(2, -19.4, -18, 0, 16, 360, 404),                                 // ventana de expulsión
  ]);
  const guard = part('Guardamanos', null, [0, 0, 270], ['polymer'], [prof(0, [[450, -26], [600, -26], [606, -10], [600, 14], [450, 14]], 42, 0, 6)]);
  const barrel = part('Cañón', 'extra', [0, 0, 600], ['blued', 'dark'], [
    cyl(0, 8.5, 590, 680, 0, 0, 20),
    prof(0, [[630, 0], [660, 0], [660, 40], [630, 40]], 10, 0, 1),
    ring(0, 14, 2.6, 652, 40), ring(0, 14, 2.6, 640, 40),               // túnel de la mira
    cyl(1, 4.5, 679.6, 680.3),
  ]);
  const bolt = part('Cerrojo', 'bolt', [0, 6, 380], ['steel'], [bx(0, -19, -10, 0, 14, 358, 404)], { move: [0, 0, -60] });
  const handle = part('Manija de carga', 'handle', [16, 34, 590], ['blued'], [cyl(0, 5, 586, 596, 34, 22, 12), bx(0, 9, 20, 30, 38, 586, 596)], { move: [0, 0, -95] });
  const trigger = part('Gatillo', 'trigger', [0, -28, 300], ['steel'], [prof(0, [[297, -28], [303, -28], [305, -38], [302, -44], [297, -43], [299, -36]], 6, 0, 0.6)], { rotMove: [14, 0, 0] });
  const mag = part('Cargador', 'mag', [0, -80, 382], ['blued', 'brass'], [
    prof(0, [[362, -30], [402, -30], [402, -46], ['q', 418, -140, 472, -196], [432, -214], ['q', 380, -150, 364, -46]], 22, 0, 1.4),
    prof(0, [[428, -212], [474, -192], [478, -200], [432, -222]], 26, 0, 1),
    cyl(1, 4.6, 366, 390, -28, 0, 12, 3.2),
  ], { move: [0, -170, 25] });
  return out('MP5', [stock, recv, guard, barrel, bolt, handle, trigger, mag], [0, 0, 680], [-19, 8, 380], [-1, 0.6, -0.1]);
}

// ---------------------------------------------------------------- escopeta, revólver y fusil de cerrojo

/** Remington 870 (calibre 12, 6+1): guardamanos de bombeo estriado, culata de madera, depósito tubular. */
function r870(): GenWeapon {
  O = [0, 0, 420];
  const stock = part('Culata', null, [0, 0, 420], ['wood', 'rubber'], [
    prof(0, [[0, -40], [0, -180], [25, -178], [250, -108], [300, -96], [348, -72], [348, -20], [330, -10], [200, -26], [30, -40]], 40, 0, 4),
    prof(1, [[-16, -40], [0, -40], [0, -180], [-16, -182]], 42, 0, 2),
  ]);
  const recv = part('Cajón de mecanismos', null, [0, 0, 420], ['blued', 'dark', 'alloy'], [
    prof(0, [[345, -58], [345, 8], [360, 20], [540, 20], [548, 10], [548, -58]], 36, 0, 3),
    bx(1, -18.6, -17.6, -6, 12, 430, 500),                              // ventana de expulsión
    prof(2, [[392, -58], [472, -58], [472, -64], [455, -80], [405, -80], [392, -70]], 12, 0, 1.5, [[[398, -61], [466, -61], [452, -76], [408, -76]]]),
    prof(2, [[475, -40], [492, -40], [492, -46], [475, -46]], 4, 18.5, 0.4), // retén del cierre
  ]);
  const barrel = part('Cañón', 'extra', [0, 0, 780], ['blued', 'dark', 'brass'], [
    cyl(0, 12, 546, 1015, 0, 0, 24, 11),
    cyl(0, 11.5, 546, 945, -27, 0, 22),                                 // depósito tubular
    lathe(0, [[12, 935], [13, 940], [13, 952], [11, 955]], -27),        // tapón del depósito
    cyl(0, 6, 935, 960, -12, 0, 10),                                    // abrazadera
    { ...cyl(2, 2.2, 1006, 1010, 13, 0, 10) },                          // punto de mira
    cyl(1, 9.4, 1014.6, 1015.3),
  ]);
  const pump = part('Guardamanos (bombeo)', 'pump', [0, -27, 690], ['wood', 'dark'], [
    lathe(0, [[17, 600], [24, 610], [25, 700], [24, 770], [17, 785]], -27, 0, 18),
    ...Array.from({ length: 11 }, (_, i) => ring(1, 25, 1.4, 618 + i * 13.5, -27)),
  ], { move: [0, 0, -85] });
  const bolt = part('Cerrojo', 'bolt', [0, 2, 465], ['steel'], [bx(0, -18, -8, -6, 12, 432, 498)], { move: [0, 0, -80] });
  const trigger = part('Gatillo', 'trigger', [0, -58, 428], ['steel'], [prof(0, [[425, -58], [432, -58], [434, -68], [431, -75], [425, -74], [427, -67]], 7, 0, 0.6)], { rotMove: [14, 0, 0] });
  return out('Remington 870', [stock, recv, barrel, pump, bolt, trigger], [0, 0, 1015], [-19, 2, 465], [-1, 0.5, 0.05]);
}

/** Colt Python (.357, 6 balas, cañón de 6"): banda ventilada, cañón con faldón, tambor estriado. */
function python(): GenWeapon {
  O = [0, 0, 60];
  const frame = part('Armazón', null, [0, 0, 60], ['blued', 'wood', 'dark'], [
    prof(0, [[16, -16], [16, 20], [124, 20], [126, 12], [126, -36], [116, -40], [64, -40], [58, -46], [40, -38], [24, -26]], 22, 0, 1.4,
      [[[60, -36], [114, -36], [114, 18], [60, 18]]]),                  // ventana del tambor
    ...[1, -1].map(sx => prof(1, [[54, -44], [26, -130], [-12, -132], [-16, -120], [12, -30]], 8, sx * 11, 2)), // cachas
    prof(1, [[50, -42], [24, -128], [-10, -130], [12, -32]], 18, 0, 1),
    prof(0, [[58, -40], [96, -40], [96, -46], [88, -60], [66, -60], [58, -50]], 8, 0, 1, [[[62, -42], [92, -42], [85, -56], [68, -56]]]), // guardamonte
    bx(0, 11.5, 14, -8, 2, 18, 32),                                     // pestillo del tambor (izquierda)
  ]);
  const barrel = part('Cañón', 'extra', [0, 0, 210], ['blued', 'dark'], [
    cyl(0, 10, 122, 292, 0, 0, 26),                                                             // cañón
    prof(0, [[124, -4], [288, -4], [292, -8], [292, -19], [160, -21], [124, -26]], 15, 0, 2.5), // faldón inferior (underlug)
    prof(0, [[122, 6], [292, 6], [292, 19], [122, 19]], 9, 0, 1.2),                             // banda ventilada
    ...Array.from({ length: 7 }, (_, i) => bx(1, -4.7, 4.7, 11, 17, 140 + i * 21, 150 + i * 21)),
    prof(0, [[270, 19], [288, 19], [288, 31], [279, 31]], 4, 0, 0.6),                          // mira delantera
    cyl(1, 4.6, 291.8, 292.4),
  ]);
  const cylParts: Piece[] = [cyl(0, 20, 62, 112, -12, 0, 30)];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    cylParts.push(bx(1, Math.cos(a) * 19.4 - 2.5, Math.cos(a) * 19.4 + 2.5, -12 + Math.sin(a) * 19.4 - 2.5, -12 + Math.sin(a) * 19.4 + 2.5, 68, 104)); // estrías
    const b = a + Math.PI / 6;
    cylParts.push(cyl(2, 4.8, 111.6, 112.4, -12 + Math.sin(b) * 11.8, Math.cos(b) * 11.8, 12));               // recámaras
    cylParts.push(cyl(3, 5.6, 61.4, 62.2, -12 + Math.sin(b) * 11.8, Math.cos(b) * 11.8, 12));                  // culotes
  }
  const cylinder = part('Tambor', 'cylinder', [0, -12, 87], ['blued', 'dark', 'dark', 'brass'], cylParts, { rotMove: [0, 0, 60] });
  const hammer = part('Martillo', 'hammer', [0, -8, 22], ['blued'], [prof(0, [[16, -10], [26, -8], [24, 10], [14, 30], [2, 32], [6, 22], [14, 8]], 8, 0, 0.8)], { rotMove: [-40, 0, 0] });
  const trigger = part('Gatillo', 'trigger', [0, -38, 76], ['blued'], [prof(0, [[72, -38], [80, -38], [80, -48], [76, -56], [71, -55], [74, -47]], 7, 0, 0.6)], { rotMove: [16, 0, 0] });
  return out('Colt Python', [frame, barrel, cylinder, hammer, trigger], [0, 0, 292.2], [0, -12, 112], [0, -0.4, -1]);
}

/** M24 (.308, 5 balas): fusil de cerrojo de francotirador con culata sintética y visor. */
function m24(): GenWeapon {
  O = [0, 0, 470];
  const stock = part('Culata', null, [0, 0, 470], ['polymer', 'rubber', 'dark'], [
    prof(0, [[20, -40], [20, -150], [150, -120], [340, -88], [370, -70], [420, -150], [470, -150], [470, -60], [880, -40], [900, -30], [900, -12], [560, -6], [350, 0], [300, 4], [120, -32]], 46, 0, 4),
    prof(1, [[0, -38], [20, -40], [20, -152], [0, -150]], 48, 0, 2),
    prof(2, [[430, -56], [510, -56], [510, -62], [496, -76], [444, -76], [430, -66]], 10, 0, 1, [[[436, -59], [504, -59], [492, -72], [446, -72]]]),
  ]);
  const recv = part('Cajón de mecanismos', null, [0, 0, 470], ['blued', 'dark'], [
    cyl(0, 17, 330, 560, 0, 0, 26), bx(1, -17.6, -16.4, -4, 12, 430, 500),
    lathe(0, [[18, 556], [21, 560], [21, 572], [18, 576]]),
  ]);
  const barrel = part('Cañón', 'extra', [0, 0, 800], ['blued', 'dark'], [cyl(0, 14, 572, 1090, 0, 0, 24, 10), cyl(1, 4, 1089.6, 1090.3)]);
  const scope = part('Visor', 'extra', [0, 58, 470], ['blued', 'dark', 'alloy'], [
    lathe(0, [[20, 300], [21, 312], [15, 350], [15, 600], [24, 640], [24, 668], [22, 670]], 58, 0, 26),
    cyl(1, 21, 669, 669.6, 58), cyl(1, 19, 300.2, 300.8, 58),
    cyl(2, 9, 470, 480, 80, 0, 14), { ...cyl(2, 9, 470, 480, 58, 22, 14) },          // torretas
    bx(2, -8, 8, 17, 46, 380, 395), bx(2, -8, 8, 17, 46, 540, 555),                   // anillas
  ]);
  const bolt = part('Cerrojo', 'bolt', [0, 0, 420], ['steel'], [cyl(0, 9, 340, 470, 0, 0, 18), lathe(0, [[9, 326], [13, 330], [13, 344], [9, 346]])], { move: [0, 0, -100] });
  const handle = part('Manija del cerrojo', 'handle', [0, 0, 360], ['steel', 'polymer'], [
    prof(0, [[352, -4], [364, -4], [364, 4], [352, 4]], 44, -22, 1.5),
    { ...lathe(1, [[0.5, 340], [8, 344], [9, 356], [0.5, 360]], 0, -46, 14) },
  ], { parent: 'Cerrojo', rotMove: [0, 0, 65] });
  const trigger = part('Gatillo', 'trigger', [0, -56, 468], ['steel'], [prof(0, [[465, -56], [471, -56], [473, -64], [470, -70], [465, -69], [467, -63]], 6, 0, 0.6)], { rotMove: [12, 0, 0] });
  const mag = part('Cargador', 'mag', [0, -40, 512], ['blued', 'brass'], [prof(0, [[478, -20], [546, -20], [546, -62], [478, -62]], 26, 0, 1.4), cyl(1, 6, 486, 520, -18, 0, 12, 4)], { move: [0, -120, 0] });
  return out('M24', [stock, recv, barrel, scope, bolt, handle, trigger, mag], [0, 0, 1090], [-18, 4, 465], [-1, 0.7, 0]);
}

/** Modelos reales disponibles (con sus datos de fábrica). */
export type RealModel = 'glock17' | 'm1911' | 'ak47' | 'm4a1' | 'mp5' | 'r870' | 'python' | 'm24';
export const REAL_MODELS: Record<RealModel, { label: string; icon: string; kind: Exclude<WeaponKind, 'custom'>; action: WeaponAction; caliber: Caliber; ammo: number; rpm: number; recoil: number; gen: () => GenWeapon }> = {
  glock17: { label: 'Glock 17', icon: '🔫', kind: 'pistol', action: 'semi', caliber: '9mm', ammo: 17, rpm: 400, recoil: 0.9, gen: glock17 },
  m1911: { label: 'Colt M1911', icon: '🔫', kind: 'pistol', action: 'semi', caliber: '45acp', ammo: 7, rpm: 350, recoil: 1.2, gen: m1911 },
  ak47: { label: 'AK-47', icon: '🪖', kind: 'rifle', action: 'auto', caliber: '762', ammo: 30, rpm: 600, recoil: 0.9, gen: ak47 },
  m4a1: { label: 'M4A1', icon: '🪖', kind: 'rifle', action: 'auto', caliber: '556', ammo: 30, rpm: 800, recoil: 0.65, gen: m4a1 },
  mp5: { label: 'MP5', icon: '⚡', kind: 'smg', action: 'auto', caliber: '9mm', ammo: 30, rpm: 800, recoil: 0.45, gen: mp5 },
  r870: { label: 'Remington 870', icon: '💥', kind: 'shotgun', action: 'pump', caliber: '12g', ammo: 6, rpm: 70, recoil: 1.6, gen: r870 },
  python: { label: 'Colt Python', icon: '🤠', kind: 'revolver', action: 'revolver', caliber: '357', ammo: 6, rpm: 180, recoil: 1.4, gen: python },
  m24: { label: 'M24 (francotirador)', icon: '🎯', kind: 'sniper', action: 'bolt', caliber: '308', ammo: 5, rpm: 40, recoil: 1.8, gen: m24 },
};
/** Modelo real por defecto de cada tipo. */
export const DEFAULT_MODEL: Record<Exclude<WeaponKind, 'custom'>, RealModel> = { pistol: 'glock17', rifle: 'm4a1', smg: 'mp5', shotgun: 'r870', revolver: 'python', sniper: 'm24' };

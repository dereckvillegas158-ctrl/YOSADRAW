import * as T from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Caliber, PartType } from '../model';

/**
 * Formas de serie de las partículas, hechas por código (sin archivos): cada una
 * cabe en una esfera de radio 1 y trae sus colores por vértice (el corazón con su
 * aorta, el ojo con su iris, el hueso…), así una sola malla instanciada las dibuja
 * todas y el color de la partícula sólo las tiñe. Se crean una vez y se comparten.
 */

type Paint = (p: T.Vector3, n: T.Vector3) => string;
/** Prepara una geometría: sin índices, con normales y color por vértice. */
function finish(g: T.BufferGeometry, paint: string | Paint): T.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  if (!ng.attributes.normal) ng.computeVertexNormals();
  for (const k of Object.keys(ng.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') ng.deleteAttribute(k);
  if (!ng.attributes.uv) ng.setAttribute('uv', new T.BufferAttribute(new Float32Array((ng.attributes.position.count) * 2), 2));
  const pos = ng.attributes.position, nor = ng.attributes.normal, n = pos.count;
  const col = new Float32Array(n * 3), c = new T.Color(), p = new T.Vector3(), nn = new T.Vector3();
  if (typeof paint === 'string') c.set(paint);
  for (let i = 0; i < n; i++) {
    if (typeof paint !== 'string') { p.fromBufferAttribute(pos, i); nn.fromBufferAttribute(nor, i); c.set(paint(p, nn)); }
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  ng.setAttribute('color', new T.BufferAttribute(col, 3));
  return ng;
}
/** Desplaza cada vértice por una función (deformar esferas en órganos). */
function warp(g: T.BufferGeometry, f: (p: T.Vector3) => void) {
  const pos = g.attributes.position, p = new T.Vector3();
  for (let i = 0; i < pos.count; i++) { p.fromBufferAttribute(pos, i); f(p); pos.setXYZ(i, p.x, p.y, p.z); }
  g.computeVertexNormals();
  return g;
}
/** Une piezas y la escala para que quepa en radio 1. */
function unit(parts: T.BufferGeometry[]): T.BufferGeometry {
  const g = parts.length === 1 ? parts[0] : mergeGeometries(parts, false)!;
  g.computeBoundingSphere();
  const bs = g.boundingSphere!;
  g.translate(-bs.center.x, -bs.center.y, -bs.center.z).scale(1 / bs.radius, 1 / bs.radius, 1 / bs.radius);
  g.computeBoundingSphere(); g.computeBoundingBox();
  return g;
}
const rnd = (i: number) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

// ---------------------------------------------------------------- órganos

function heart() {
  const lobe = (x: number) => finish(new T.SphereGeometry(0.55, 20, 14).translate(x, 0.2, 0), '#8e1622');
  const tip = finish(new T.ConeGeometry(0.62, 1.05, 20, 1).rotateZ(Math.PI).translate(0, -0.42, 0).scale(1.05, 1, 0.85), '#7d121d');
  const aorta = finish(new T.CylinderGeometry(0.16, 0.18, 0.55, 12).translate(0.12, 0.85, 0), '#c8606b');
  const vein = finish(new T.CylinderGeometry(0.1, 0.12, 0.42, 10).rotateZ(0.5).translate(-0.28, 0.8, 0.05), '#4a2a6a');
  const fat = finish(new T.SphereGeometry(0.18, 10, 8).scale(1.6, 0.6, 1).translate(0, 0.45, 0.32), '#e8cf8a');
  return unit([lobe(-0.3), lobe(0.3), tip, aorta, vein, fat]);
}
function brain() {
  const g = warp(new T.SphereGeometry(1, 40, 28), p => {
    p.x *= 1.18; p.y *= 0.86;
    const fold = Math.sin(p.x * 11) * Math.sin(p.y * 13 + p.z * 4) * Math.sin(p.z * 10);
    const k = 1 + fold * 0.06 - (Math.abs(p.x) < 0.06 && p.y > -0.2 ? 0.12 : 0);
    p.multiplyScalar(k);
  });
  return unit([finish(g, p => { const f = Math.sin(p.x * 11) * Math.sin(p.y * 13 + p.z * 4) * Math.sin(p.z * 10); return f < -0.2 ? '#b8707c' : '#e8a3ad'; })]);
}
function intestine() {
  const pts: T.Vector3[] = [];
  for (let i = 0; i < 22; i++) { const a = i * 0.9; pts.push(new T.Vector3(Math.cos(a) * (0.5 + 0.08 * Math.sin(i)), (i - 11) * 0.05, Math.sin(a) * (0.5 + 0.08 * Math.cos(i)))); }
  const g = new T.TubeGeometry(new T.CatmullRomCurve3(pts), 120, 0.16, 10, false);
  return unit([finish(g, p => (Math.sin(p.y * 40) > 0.6 ? '#c97a7c' : '#df9a92'))]);
}
function lung() {
  const g = warp(new T.SphereGeometry(1, 24, 18), p => { p.x *= 0.62; p.z *= 0.5; if (p.x > 0.15) p.x = 0.15 + (p.x - 0.15) * 0.3; p.y *= 1 + (p.y < 0 ? 0.1 : -0.05); });
  const tube = finish(new T.CylinderGeometry(0.1, 0.12, 0.6, 10).translate(0.2, 0.95, 0), '#e8d8d0');
  return unit([finish(g, p => (Math.sin(p.x * 18 + p.y * 9) * Math.sin(p.z * 15) > 0.5 ? '#b5606e' : '#d98592')), tube]);
}
function liver() {
  const g = warp(new T.SphereGeometry(1, 24, 16), p => { p.y *= 0.5; p.z *= 0.7; p.x *= p.x > 0 ? 1.25 : 0.9; if (p.y < 0) p.y *= 0.6; });
  return unit([finish(g, '#5e1a1f')]);
}
function kidney() {
  const g = warp(new T.SphereGeometry(1, 22, 16), p => { p.x *= 0.6; p.z *= 0.42; const dent = Math.max(0, 0.35 - Math.abs(p.y)) * (p.x > 0 ? 1 : 0); p.x -= dent * 1.2; });
  return unit([finish(g, '#7a2a2c')]);
}
function eye() {
  const g = new T.SphereGeometry(1, 28, 20);
  const nerve = finish(new T.CylinderGeometry(0.16, 0.1, 0.7, 10).rotateX(Math.PI / 2).translate(0, 0, -1.2), '#d88a90');
  return unit([finish(g, p => (p.z > 0.93 ? '#0a0a0e' : p.z > 0.78 ? '#3a7ad8' : p.z < -0.6 && Math.sin(p.x * 30) > 0.8 ? '#c0303a' : '#f4f0ea')), nerve]);
}
function stomach() {
  const pts = [new T.Vector2(0.01, -1), new T.Vector2(0.5, -0.85), new T.Vector2(0.75, -0.4), new T.Vector2(0.7, 0.1), new T.Vector2(0.45, 0.55), new T.Vector2(0.22, 0.9), new T.Vector2(0.15, 1.1)];
  const g = warp(new T.LatheGeometry(pts, 20), p => { p.x += Math.sin(p.y * 2) * 0.25; p.z *= 0.75; });
  return unit([finish(g, '#d4848a')]);
}
// ---------------------------------------------------------------- otros

function bone() {
  const shaft = finish(new T.CylinderGeometry(0.13, 0.13, 1.5, 12), '#efe6cf');
  const knob = (x: number, y: number) => finish(new T.SphereGeometry(0.24, 12, 10).translate(x, y, 0), '#f4ecd8');
  return unit([shaft, knob(-0.16, 0.8), knob(0.16, 0.8), knob(-0.16, -0.8), knob(0.16, -0.8)]);
}
function meat(i: number) {
  const g = warp(new T.IcosahedronGeometry(1, 2), p => { p.multiplyScalar(0.8 + 0.35 * Math.sin(p.x * 3 + i) * Math.cos(p.y * 4 - i) + 0.1 * rnd(i)); p.y *= 0.7 + 0.3 * rnd(i + 3); });
  return unit([finish(g, p => (Math.sin(p.y * 9 + i) > 0.7 ? '#f0d4c4' : p.x + p.z > 0.6 ? '#b02028' : '#7e121a'))]);
}
function rock(i: number) {
  const g = warp(new T.DodecahedronGeometry(1, 0), p => { p.multiplyScalar(0.75 + 0.4 * rnd(Math.round((p.x + 2) * 7 + (p.y + 2) * 13 + (p.z + 2) * 17) + i)); p.y *= 0.7; });
  const shades = ['#6b6660', '#7d746a', '#5a5550'];
  return unit([finish(g, shades[i % shades.length])]);
}
function spark() { return unit([finish(new T.OctahedronGeometry(1, 0).scale(0.18, 1, 0.18), '#ffffff')]); }
function ember() { return unit([finish(new T.IcosahedronGeometry(1, 0), '#ffffff')]); }
function coin() {
  const g = new T.CylinderGeometry(1, 1, 0.16, 24).rotateX(Math.PI / 2);
  return unit([finish(g, p => (Math.abs(p.z) > 0.07 && Math.hypot(p.x, p.y) < 0.72 ? '#f0c040' : '#d49a18'))]);
}
function star() {
  const sh = new T.Shape();
  for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 0.42 : 1; i ? sh.lineTo(Math.cos(a) * r, Math.sin(a) * r) : sh.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
  const g = new T.ExtrudeGeometry(sh, { depth: 0.25, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.06, bevelSegments: 2 });
  return unit([finish(g, '#ffffff')]);
}
function confetti() { return unit([finish(new T.PlaneGeometry(1, 0.55), '#ffffff')]); }
function leaf(i: number) {
  const sh = new T.Shape(); sh.moveTo(0, -1); sh.quadraticCurveTo(0.75, -0.2, 0, 1); sh.quadraticCurveTo(-0.75, -0.2, 0, -1);
  const cols = ['#6aa83a', '#d88a20', '#c2441c', '#e0b52a'];
  return unit([finish(new T.ShapeGeometry(sh, 8), p => (Math.abs(p.x) < 0.03 ? '#4a3a1a' : cols[i % cols.length]))]);
}
function bubble() { return unit([finish(new T.SphereGeometry(1, 18, 12), '#ffffff')]); }
/** Tres planos cruzados a lo largo de +Z (el destello del fogonazo, de frente y de lado). */
function flash() {
  const a = new T.PlaneGeometry(1, 2.4).rotateX(Math.PI / 2).translate(0, 0, 1.1);
  const b = a.clone().rotateZ(Math.PI / 2);
  const c = new T.PlaneGeometry(1.5, 1.5);
  const g = mergeGeometries([finish(a, '#ffffff'), finish(b, '#ffffff'), finish(c, '#ffffff')], false)!;
  g.computeBoundingSphere(); g.computeBoundingBox();
  return g;
}
/**
 * Casquillo vacío de cada calibre, a lo largo de Y: latón con cuello (fusil), recto
 * (pistola, revólver) o cartucho de plástico rojo con base de latón (escopeta). Con
 * la culata, el reborde y el pistón marcados.
 */
function casing(cal: Caliber) {
  const brass = '#c9a24a', dark = '#8a6a26', primer = '#b8b0a0';
  // [radio del cuerpo, largo del cuerpo, radio del cuello, largo del cuello]
  const D: Record<Caliber, [number, number, number, number]> = {
    '9mm': [0.0049, 0.019, 0.0048, 0], '45acp': [0.006, 0.0227, 0.006, 0], '357': [0.0048, 0.033, 0.0048, 0],
    '556': [0.0048, 0.036, 0.0031, 0.0075], '762': [0.0056, 0.032, 0.0039, 0.0075], '308': [0.006, 0.041, 0.0043, 0.008],
    '50bmg': [0.0102, 0.077, 0.0071, 0.022], '12g': [0.0105, 0.07, 0.0105, 0],
  };
  const [r, L, rn, ln] = D[cal];
  const parts: T.BufferGeometry[] = [];
  if (cal === '12g') {
    parts.push(finish(new T.CylinderGeometry(r, r, L * 0.78, 16).translate(0, L * 0.39 + L * 0.22, 0), '#b0202a'));
    parts.push(finish(new T.CylinderGeometry(r * 1.02, r * 1.02, L * 0.22, 16).translate(0, L * 0.11, 0), brass));
    parts.push(finish(new T.CylinderGeometry(r * 1.1, r * 1.1, L * 0.03, 16).translate(0, L * 0.015, 0), dark));
  } else {
    const body = ln > 0 ? L - ln : L;
    parts.push(finish(new T.CylinderGeometry(r, r, body * 0.9, 14).translate(0, body * 0.45 + body * 0.1, 0), brass));
    parts.push(finish(new T.CylinderGeometry(r * 0.88, r * 0.88, body * 0.06, 14).translate(0, body * 0.07, 0), dark)); // ranura del extractor
    parts.push(finish(new T.CylinderGeometry(r * 1.02, r * 1.02, body * 0.04, 14).translate(0, body * 0.02, 0), brass)); // culote
    if (ln > 0) {
      parts.push(finish(new T.CylinderGeometry(rn, r, ln * 0.35, 14).translate(0, body + ln * 0.175, 0), brass)); // hombro
      parts.push(finish(new T.CylinderGeometry(rn, rn, ln * 0.65, 14).translate(0, body + ln * 0.35 + ln * 0.325, 0), brass)); // cuello
    }
  }
  parts.push(finish(new T.CylinderGeometry(r * 0.32, r * 0.32, 0.0006, 10).translate(0, -0.0002, 0), primer)); // pistón
  return unit(parts);
}
const quad = () => { const g = finish(new T.PlaneGeometry(2, 2), '#ffffff'); g.computeBoundingSphere(); return g; };

const cache = new Map<string, T.BufferGeometry[]>();
/** Variantes de forma de cada tipo (los órganos y escombros traen varias que salen al azar). */
export function partShapes(type: PartType | 'flash' | 'quad', caliber: Caliber = '9mm'): T.BufferGeometry[] {
  const key = type === 'casings' ? `casings:${caliber}` : type;
  let v = cache.get(key);
  if (v) return v;
  switch (type) {
    case 'organs': v = [heart(), brain(), intestine(), lung(), liver(), kidney(), eye(), stomach()]; break;
    case 'bones': v = [bone()]; break;
    case 'gibs': v = [0, 1, 2, 3].map(meat); break;
    case 'debris': v = [0, 1, 2].map(rock); break;
    case 'sparks': v = [spark()]; break;
    case 'embers': v = [ember()]; break;
    case 'coins': v = [coin()]; break;
    case 'stars': v = [star()]; break;
    case 'confetti': v = [confetti()]; break;
    case 'leaves': v = [0, 1, 2, 3].map(leaf); break;
    case 'bubbles': v = [bubble()]; break;
    case 'flash': v = [flash()]; break;
    case 'casings': v = [casing(caliber)]; break;
    case 'custom': v = [unit([finish(new T.IcosahedronGeometry(1, 1), '#ffffff')])]; break;
    default: v = [quad()]; // humo, fuego, magia, explosión, imagen: carteles que miran a la cámara
  }
  cache.set(key, v);
  return v;
}
/** Nombres de las variantes (para las pruebas y la ayuda). */
export const ORGAN_NAMES = ['corazón', 'cerebro', 'intestino', 'pulmón', 'hígado', 'riñón', 'ojo', 'estómago'];

const texCache = new Map<string, T.Texture>();
/** Texturas procedimentales de los carteles: humo suave, llama, destello del fogonazo y chispa mágica. */
export function partSprite(kind: 'soft' | 'flash' | 'twinkle' | 'smoke'): T.Texture {
  let t = texCache.get(kind);
  if (t) return t;
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d')!;
  const rg = (stops: [number, string][]) => { const r = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2); for (const [o, col] of stops) r.addColorStop(o, col); g.fillStyle = r; g.fillRect(0, 0, S, S); };
  if (kind === 'soft') rg([[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.65)'], [1, 'rgba(255,255,255,0)']]);
  else if (kind === 'smoke') {
    for (let i = 0; i < 9; i++) { const x = S / 2 + (rnd(i) - 0.5) * S * 0.4, y = S / 2 + (rnd(i + 9) - 0.5) * S * 0.4, r = S * (0.18 + rnd(i + 20) * 0.16); const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, S, S); }
  } else if (kind === 'flash') {
    rg([[0, 'rgba(255,255,255,1)'], [0.2, 'rgba(255,240,190,0.95)'], [0.55, 'rgba(255,170,60,0.35)'], [1, 'rgba(255,120,0,0)']]);
    g.globalCompositeOperation = 'lighter'; g.translate(S / 2, S / 2);
    for (let i = 0; i < 7; i++) { g.rotate((Math.PI * 2) / 7 + rnd(i) * 0.3); g.beginPath(); g.moveTo(-S * 0.05, 0); g.lineTo(0, -S * (0.3 + rnd(i + 4) * 0.2)); g.lineTo(S * 0.05, 0); g.fillStyle = 'rgba(255,230,160,0.8)'; g.fill(); }
  } else {
    rg([[0, 'rgba(255,255,255,1)'], [0.15, 'rgba(255,255,255,0.8)'], [0.4, 'rgba(255,255,255,0.15)'], [1, 'rgba(255,255,255,0)']]);
    g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillRect(S / 2 - 1.5, 4, 3, S - 8); g.fillRect(4, S / 2 - 1.5, S - 8, 3);
  }
  t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace;
  texCache.set(kind, t);
  return t;
}

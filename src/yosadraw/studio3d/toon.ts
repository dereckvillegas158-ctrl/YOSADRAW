import * as T from 'three';
import type { Cel3, Line3 } from './model';

/**
 * Cel shading y lineart de caricatura para YOSADRAW 3D.
 *
 * - Cel shading: MeshToonMaterial con una rampa de tonos generada (número de
 *   bandas y suavidad), sombra que toma el color del ambiente o un color propio, y
 *   brillo de borde. Se cachea por configuración: sin coste extra por fotograma.
 * - Lineart: contorno de «casco invertido» (la malla un poco inflada, por detrás)
 *   con grosor constante en pantalla y normales suavizadas para que no se abra en
 *   las esquinas. Una sola pasada más por objeto, sin postproceso.
 */

const ramps = new Map<string, T.DataTexture>();
/** Rampa de tonos: `bands` escalones con bordes de suavidad `soft` (0..1). */
export function celRamp(bands: number, soft: number): T.DataTexture {
  const n = Math.max(2, Math.min(8, Math.round(bands))), s = Math.max(0, Math.min(1, soft));
  const key = `${n}|${s.toFixed(2)}`;
  let tex = ramps.get(key);
  if (tex) return tex;
  const W = 256, data = new Uint8Array(W * 4);
  const w = Math.max(0.002, (s * 0.5) / n);
  for (let x = 0; x < W; x++) {
    const v = x / (W - 1);
    let k = 0;
    for (let j = 1; j < n; j++) { const b = j / n; const t = Math.min(1, Math.max(0, (v - (b - w)) / (2 * w))); k += (t * t * (3 - 2 * t)) / (n - 1); }
    const c = Math.round(Math.min(1, k) * 255);
    data.set([c, c, c, 255], x * 4);
  }
  tex = new T.DataTexture(data, W, 1, T.RGBAFormat);
  tex.minFilter = tex.magFilter = s > 0 ? T.LinearFilter : T.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  ramps.set(key, tex);
  return tex;
}
export const celKey = (c: Cel3) => `${c.bands}|${c.soft}|${c.shade}|${c.color}|${c.rim}|${c.rimColor}`;

/** Prepara un MeshToonMaterial con el cel shading (uniformes que se actualizan sin recompilar). */
export function applyCel(m: T.MeshToonMaterial, c: Cel3, ambient: T.Color) {
  m.gradientMap = celRamp(c.bands, c.soft);
  let u = m.userData.cel as Record<string, T.IUniform> | undefined;
  if (!u) {
    u = { celMode: { value: 0 }, celShadow: { value: new T.Color() }, celAmb: { value: new T.Color() }, celRim: { value: 0 }, celRimColor: { value: new T.Color() } };
    m.userData.cel = u;
    const uu = u;
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, uu);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float celMode, celRim; uniform vec3 celShadow, celAmb, celRimColor;')
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
          // Tonos sobre la luz total (también la caída con la distancia y las sombras), no sólo el ángulo.
          {
            vec3 dd = reflectedLight.directDiffuse;
            vec3 base = max(diffuseColor.rgb, vec3(1e-3));
            vec3 lc = dd / base;
            float L = max(lc.r, max(lc.g, lc.b));
            if (L > 1e-4) reflectedLight.directDiffuse = dd / L * texture2D(gradientMap, vec2(clamp(L, 0.0, 1.0), 0.5)).r * max(1.0, L * 0.25 + 0.75);
          }
          // Sombra: color propio o el del ambiente (luces ambientales + color del entorno).
          if (celMode > 0.5) reflectedLight.indirectDiffuse = celShadow * diffuseColor.rgb;
          else reflectedLight.indirectDiffuse += celAmb * diffuseColor.rgb;
          if (celRim > 0.0) {
            // Sólo en superficies curvas (en un suelo plano visto de lado no inunda todo).
            float fr = 1.0 - max(dot(normalize(normal), normalize(vViewPosition)), 0.0);
            float curv = clamp(length(fwidth(normal)) * 60.0, 0.0, 1.0);
            reflectedLight.directDiffuse += celRimColor * celRim * curv * smoothstep(0.66, 0.7, fr);
          }`);
    };
    m.customProgramCacheKey = () => 'yosa-cel';
    m.needsUpdate = true;
  }
  u.celMode.value = c.shade === 'color' ? 1 : 0;
  (u.celShadow.value as T.Color).set(c.color);
  (u.celAmb.value as T.Color).copy(ambient);
  u.celRim.value = c.rim;
  (u.celRimColor.value as T.Color).set(c.rimColor);
}

/** Normales suavizadas por posición (el contorno no se abre en las aristas duras). */
function hullNormals(g: T.BufferGeometry) {
  if (g.getAttribute('hullNormal')) return;
  const pos = g.getAttribute('position'), nor = g.getAttribute('normal');
  const acc = new Map<string, [number, number, number]>();
  const key = (i: number) => `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
  for (let i = 0; i < pos.count; i++) { const k = key(i); const a = acc.get(k) ?? [0, 0, 0]; a[0] += nor.getX(i); a[1] += nor.getY(i); a[2] += nor.getZ(i); acc.set(k, a); }
  const out = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) { const a = acc.get(key(i))!; const L = Math.hypot(a[0], a[1], a[2]) || 1; out[i * 3] = a[0] / L; out[i * 3 + 1] = a[1] / L; out[i * 3 + 2] = a[2] / L; }
  g.setAttribute('hullNormal', new T.BufferAttribute(out, 3));
}

const LINE_VERT = `attribute vec3 hullNormal; uniform float width; uniform vec2 res;
  void main(){
    vec4 c = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    vec3 n = normalize(normalMatrix * hullNormal);
    vec2 d = (projectionMatrix * vec4(n, 0.0)).xy;
    float L = length(d);
    if (L > 1e-5) c.xy += d / L * max(1.0, width * (res.y / 1080.0)) * 2.0 / res * c.w;
    gl_Position = c;
  }`;
/** Contorno de caricatura de una malla (hijo que comparte su geometría). */
export function lineMesh(g: T.BufferGeometry): T.Mesh {
  hullNormals(g);
  const mat = new T.ShaderMaterial({
    uniforms: { color: { value: new T.Color('#111111') }, width: { value: 2 }, res: { value: new T.Vector2(1920, 1080) } },
    vertexShader: LINE_VERT,
    fragmentShader: 'uniform vec3 color; void main(){ gl_FragColor = vec4(color, 1.0); }',
    side: T.BackSide,
  });
  const m = new T.Mesh(g, mat);
  m.userData.noOcclude = true; m.userData.helper = true;
  m.castShadow = false; m.receiveShadow = false;
  m.raycast = () => undefined;
  const size = new T.Vector2();
  m.onBeforeRender = r => { r.getDrawingBufferSize(size); mat.uniforms.res.value.copy(size); };
  return m;
}
export function setLine(m: T.Mesh, g: T.BufferGeometry, l: Line3) {
  if (m.geometry !== g) { hullNormals(g); m.geometry = g; }
  const u = (m.material as T.ShaderMaterial).uniforms;
  u.width.value = l.width; u.color.value.set(l.color);
}

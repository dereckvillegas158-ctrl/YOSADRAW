import * as T from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { Fx3 } from '../model';

/**
 * Efectos en tiempo real de YOSADRAW 3D (modo En vivo y vista previa): rayos de luz
 * volumétricos (dispersión en pantalla desde el sol, con oclusión de los objetos y
 * de la silueta de los dibujos), bloom, aberración cromática, glitch, tinte de color,
 * viñeta y grano. Cada fotograma se procesa en la GPU; la calidad cambia la
 * resolución interna y el número de muestras.
 */

const QUALITY = { low: { ratio: 0.75, occ: 0.25, samples: 24, bloomRes: 0.35 }, medium: { ratio: 1, occ: 0.35, samples: 48, bloomRes: 0.5 }, high: { ratio: 2, occ: 0.5, samples: 80, bloomRes: 0.7 } };
export type Quality = keyof typeof QUALITY;

const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';

/** Desenfoque radial de la oclusión hacia la posición del sol en pantalla. */
const RAYS = (samples: number) => new T.ShaderMaterial({
  uniforms: { tOcc: { value: null }, center: { value: new T.Vector2(0.5, 0.5) }, density: { value: 0.9 }, decay: { value: 0.955 }, weight: { value: 0.5 }, exposure: { value: 0.35 } },
  vertexShader: VERT,
  fragmentShader: `uniform sampler2D tOcc; uniform vec2 center; uniform float density, decay, weight, exposure; varying vec2 vUv;
    void main(){ vec2 uv = vUv; vec2 d = (uv - center) * density / ${samples}.0; vec3 c = vec3(0.0); float il = 1.0;
      for (int i = 0; i < ${samples}; i++) { uv -= d; c += texture2D(tOcc, uv).rgb * il * weight; il *= decay; }
      gl_FragColor = vec4(c * exposure, 1.0); }`,
  depthTest: false, depthWrite: false,
});

/** Composición final: rayos, aberración, glitch, tinte, viñeta y grano. */
const FINAL = {
  uniforms: {
    tDiffuse: { value: null }, tRays: { value: null }, rays: { value: 0 }, rayColor: { value: new T.Color('#ffe2b0') },
    chroma: { value: 0 }, glitch: { value: 0 }, time: { value: 0 }, tint: { value: new T.Color('#ffffff') }, tintAmt: { value: 0 }, vignette: { value: 0 }, grain: { value: 0 }, res: { value: new T.Vector2(1, 1) },
  },
  vertexShader: VERT,
  fragmentShader: `uniform sampler2D tDiffuse, tRays; uniform float rays, chroma, glitch, time, tintAmt, vignette, grain; uniform vec3 rayColor, tint; uniform vec2 res; varying vec2 vUv;
    float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 uv = vUv;
      if (glitch > 0.0) {
        float row = floor(uv.y * 28.0), tick = floor(time * 11.0);
        float r = rnd(vec2(row, tick));
        if (r < glitch * 0.3) uv.x += (rnd(vec2(row * 1.7, tick + 3.0)) - 0.5) * 0.15 * glitch;
        if (rnd(vec2(tick, 9.0)) < glitch * 0.15) uv.y += (rnd(vec2(tick, 4.0)) - 0.5) * 0.04 * glitch;
      }
      vec2 d = uv - 0.5;
      float ca = chroma * 0.014 + glitch * 0.012 * step(0.7, rnd(vec2(floor(time * 9.0), 1.0)));
      vec4 base = texture2D(tDiffuse, uv);
      vec3 col = vec3(texture2D(tDiffuse, uv + d * ca).r, base.g, texture2D(tDiffuse, uv - d * ca).b);
      col += texture2D(tRays, vUv).rgb * rayColor * rays;
      col = mix(col, col * tint * 1.25, tintAmt);
      col *= mix(1.0, smoothstep(0.95, 0.25, length(d)), vignette);
      col += (rnd(vUv * res + fract(time)) - 0.5) * grain * 0.18;
      gl_FragColor = vec4(col, max(base.a, min(1.0, dot(texture2D(tRays, vUv).rgb, vec3(0.33)) * rays)));
    }`,
};

/**
 * Estilo (después de la salida a color de pantalla): «squiggle vision» (las líneas
 * tiemblan a pocos fotogramas por segundo, como dibujadas a mano), contorno de
 * tinta, pintura al óleo (Kuwahara), posterizado, semitono de cómic, píxeles,
 * papel y líneas de TV.
 */
const SLOTS = 16;
const STYLE = {
  uniforms: {
    tDiffuse: { value: null }, tMask: { value: null }, useMask: { value: 0 }, res: { value: new T.Vector2(1, 1) }, time: { value: 0 }, paper: { value: 0 },
    // Por ranura (0 = toda la escena, 1.. = objetos con estilo propio):
    // sA = squiggle, fps, tamaño, tinta · sB = posterizar, semitono, píxel, óleo · sC = TV · sInk = color de tinta.
    sA: { value: Array.from({ length: SLOTS }, () => new T.Vector4()) }, sB: { value: Array.from({ length: SLOTS }, () => new T.Vector4()) },
    sC: { value: Array.from({ length: SLOTS }, () => new T.Vector4()) }, sInk: { value: Array.from({ length: SLOTS }, () => new T.Color()) },
  },
  vertexShader: VERT,
  fragmentShader: `uniform sampler2D tDiffuse, tMask; uniform vec2 res; uniform float time, paper, useMask; varying vec2 vUv;
    uniform vec4 sA[${SLOTS}], sB[${SLOTS}], sC[${SLOTS}]; uniform vec3 sInk[${SLOTS}];
    float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
    float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += vn(p) * a; p *= 2.03; a *= 0.5; } return s; }
    float lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
    vec4 tex(vec2 uv){ return texture2D(tDiffuse, clamp(uv, 0.0, 1.0)); }
    int slotAt(vec2 uv){ if (useMask < 0.5) return 0; return int(floor(texture2D(tMask, clamp(uv, 0.0, 1.0)).r * 255.0 / 16.0 + 0.5)); }
    vec3 kuwahara(vec2 uv, float r){
      vec2 px = r / res; vec3 m[4]; vec3 s2[4];
      for (int k = 0; k < 4; k++) { m[k] = vec3(0.0); s2[k] = vec3(0.0); }
      for (int j = 0; j <= 3; j++) for (int i = 0; i <= 3; i++) {
        vec2 o = vec2(float(i), float(j)) * px / 3.0;
        vec3 a = tex(uv + vec2(-o.x, -o.y)).rgb, b = tex(uv + vec2(o.x, -o.y)).rgb, c = tex(uv + vec2(-o.x, o.y)).rgb, d = tex(uv + o).rgb;
        m[0] += a; s2[0] += a * a; m[1] += b; s2[1] += b * b; m[2] += c; s2[2] += c * c; m[3] += d; s2[3] += d * d;
      }
      vec3 best = vec3(0.0); float bv = 1e9;
      for (int k = 0; k < 4; k++) { vec3 mu = m[k] / 16.0; vec3 v = abs(s2[k] / 16.0 - mu * mu); float vs = v.r + v.g + v.b; if (vs < bv) { bv = vs; best = mu; } }
      return best;
    }
    void main(){
      vec2 uv = vUv;
      int sl = slotAt(vUv);
      // Píxeles grandes.
      float pix = sB[sl].z;
      if (pix > 0.0) { vec2 cell = vec2(1.0 + pix * 15.0) / res; uv = (floor(uv / cell) + 0.5) * cell; }
      // Squiggle: desplazamiento con ruido que cambia a saltos. Cerca del borde de un
      // objeto con squiggle propio también se desplaza, para que su contorno tiemble.
      vec4 A = sA[sl];
      if (A.x <= 0.0 && useMask > 0.5) {
        vec2 r8 = 8.0 / res;
        int n1 = slotAt(vUv + vec2(r8.x, 0.0)), n2 = slotAt(vUv - vec2(r8.x, 0.0)), n3 = slotAt(vUv + vec2(0.0, r8.y)), n4 = slotAt(vUv - vec2(0.0, r8.y));
        if (sA[n1].x > 0.0) A = sA[n1]; else if (sA[n2].x > 0.0) A = sA[n2]; else if (sA[n3].x > 0.0) A = sA[n3]; else if (sA[n4].x > 0.0) A = sA[n4];
      }
      if (A.x > 0.0) {
        float fr = floor(time * A.y);
        vec2 q = uv * res / max(4.0, A.z) + vec2(fr * 7.13, fr * 3.71);
        uv += (vec2(vn(q), vn(q + 19.7)) - 0.5) * A.x * 7.0 / res * (res.y / 720.0 + 0.5);
        sl = slotAt(uv);
      }
      vec4 B = sB[sl];
      vec4 base = tex(uv);
      vec3 col = B.w > 0.0 ? kuwahara(uv, 1.0 + B.w * 7.0 * res.y / 1080.0) : base.rgb;
      if (B.x > 0.0) { float lv = mix(24.0, 3.0, B.x); col = floor(col * lv + 0.5) / lv; }
      // Semitono: puntos en rejilla girada 45° (más grandes donde es más oscuro).
      if (B.y > 0.0) {
        float cs = max(3.0, res.y / 150.0);
        vec2 p = mat2(0.7071, -0.7071, 0.7071, 0.7071) * (vUv * res) / cs;
        float d = length(fract(p) - 0.5);
        float r = sqrt(clamp(1.0 - lum(col), 0.0, 1.0)) * 0.62;
        float dotm = 1.0 - smoothstep(r - 0.06, r + 0.06, d);
        col = mix(col, mix(min(col * 1.15 + 0.05, 1.0), col * 0.3, dotm), B.y);
      }
      // Tinta: bordes (Sobel de luminancia y de alfa) y la silueta de los objetos con estilo.
      float ink = sA[sl].w; vec3 inkC = sInk[sl];
      vec2 px = (1.0 + max(ink, 0.5) * 1.5 * res.y / 1080.0) / res;
      float mE = 0.0;
      if (useMask > 0.5) {
        int a1 = slotAt(uv + vec2(px.x, 0.0)), a2 = slotAt(uv - vec2(px.x, 0.0)), a3 = slotAt(uv + vec2(0.0, px.y)), a4 = slotAt(uv - vec2(0.0, px.y));
        if (a1 != sl || a2 != sl || a3 != sl || a4 != sl) {
          int o = a1 != sl ? a1 : a2 != sl ? a2 : a3 != sl ? a3 : a4;
          if (sA[o].w > ink) { ink = sA[o].w; inkC = sInk[o]; }
          mE = 1.0;
        }
      }
      if (ink > 0.0) {
        float tl = lum(tex(uv + px * vec2(-1.0, 1.0)).rgb), t = lum(tex(uv + px * vec2(0.0, 1.0)).rgb), tr = lum(tex(uv + px * vec2(1.0, 1.0)).rgb);
        float l = lum(tex(uv + px * vec2(-1.0, 0.0)).rgb), r = lum(tex(uv + px * vec2(1.0, 0.0)).rgb);
        float bl = lum(tex(uv + px * vec2(-1.0, -1.0)).rgb), b = lum(tex(uv + px * vec2(0.0, -1.0)).rgb), br = lum(tex(uv + px * vec2(1.0, -1.0)).rgb);
        float gx = tr + 2.0 * r + br - tl - 2.0 * l - bl, gy = tl + 2.0 * t + tr - bl - 2.0 * b - br;
        float aE = abs(tex(uv + px * vec2(1.0, 0.0)).a - tex(uv - px * vec2(1.0, 0.0)).a) + abs(tex(uv + px * vec2(0.0, 1.0)).a - tex(uv - px * vec2(0.0, 1.0)).a);
        float e = max(smoothstep(0.12, 0.45, length(vec2(gx, gy)) + aE), mE);
        col = mix(col, inkC, e * min(1.0, ink * 1.4));
        base.a = max(base.a, e * ink);
      }
      // Papel (toda la escena): fibras y manchas suaves, tono cálido.
      if (paper > 0.0) {
        vec2 pp = vUv * res / (res.y / 720.0);
        float n = fbm(pp / 90.0) * 0.6 + vn(pp / 2.5) * 0.4;
        col *= mix(vec3(1.0), vec3(0.99, 0.95, 0.86) * (0.9 + 0.18 * n), paper);
      }
      // Líneas de TV.
      float scan = sC[sl].x;
      if (scan > 0.0) {
        float y = vUv.y * res.y;
        col *= 1.0 - scan * 0.32 * (0.5 + 0.5 * sin(y * 3.14159 / max(1.0, res.y / 540.0)));
        col *= 1.0 - scan * 0.12 * step(0.5, fract(vUv.y * 3.0 - time * 0.35)) * 0.5;
        col = mix(col, col * vec3(1.06, 0.98, 1.04), scan * 0.5);
      }
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), base.a);
    }`,
};
const STYLE_KEYS = ['squiggle', 'ink', 'posterize', 'halftone', 'pixel', 'paint', 'paper', 'scan'] as const;
type StyleLike = Pick<Fx3, 'squiggle' | 'squigFps' | 'squigSize' | 'ink' | 'inkColor' | 'posterize' | 'halftone' | 'pixel' | 'paint' | 'scan'>;

/**
 * Máscara de estilos por objeto: cada objeto con estilo propio se dibuja con el
 * número de su ranura; lo demás en negro (tapa lo que queda detrás).
 */
class StyleMask {
  rt = new T.WebGLRenderTarget(1, 1, { minFilter: T.NearestFilter, magFilter: T.NearestFilter, type: T.UnsignedByteType });
  private black = new T.MeshBasicMaterial({ color: 0x000000 });
  private mats = new Map<string, T.MeshBasicMaterial>();
  private mat(slot: number, map: T.Texture | null, alphaTest: number, side: T.Side) {
    const k = `${slot}|${map?.uuid ?? ''}|${alphaTest}|${side}`;
    let m = this.mats.get(k);
    if (!m) { m = new T.MeshBasicMaterial({ color: new T.Color(slot * 16 / 255, 0, 0), map, alphaTest, side }); this.mats.set(k, m); }
    return m;
  }
  setSize(w: number, h: number) { this.rt.setSize(Math.max(1, w), Math.max(1, h)); }
  render(renderer: T.WebGLRenderer, scene: T.Scene, cam: T.Camera) {
    const swapped: [T.Mesh, T.Material | T.Material[]][] = [];
    const hidden: T.Object3D[] = [];
    scene.traverseVisible(o => {
      const m = o as T.Mesh;
      if (m.isMesh) {
        if (m.userData.noOcclude) { hidden.push(m); return; }
        const src = Array.isArray(m.material) ? m.material : [m.material];
        if (src.every(x => x.transparent && x.opacity < 0.6)) { hidden.push(m); return; }
        const slot = (m.userData.styleSlot as number) ?? 0;
        swapped.push([m, m.material]);
        const out = src.map(x => { const sm = x as T.MeshStandardMaterial; const cut = sm.alphaTest > 0 && sm.map; return slot || cut ? this.mat(slot, cut ? sm.map : null, cut ? sm.alphaTest : 0, sm.side) : this.black; });
        m.material = Array.isArray(m.material) ? out : out[0];
      } else if ((o as T.Line).isLine || (o as T.Points).isPoints || (o as T.Sprite).isSprite) hidden.push(o);
    });
    for (const o of hidden) o.visible = false;
    const bg = scene.background, fog = scene.fog, cc = renderer.getClearColor(new T.Color()), ca = renderer.getClearAlpha();
    const prevRT = renderer.getRenderTarget();
    scene.background = null; scene.fog = null;
    renderer.setRenderTarget(this.rt);
    renderer.setClearColor(0x000000, 1); renderer.clear();
    renderer.render(scene, cam);
    renderer.setClearColor(cc, ca);
    renderer.setRenderTarget(prevRT);
    scene.background = bg; scene.fog = fog;
    for (const [m, mat] of swapped) m.material = mat;
    for (const o of hidden) o.visible = true;
  }
  dispose() { this.rt.dispose(); this.black.dispose(); for (const m of this.mats.values()) m.dispose(); }
}

/** Oclusión ambiental (volumen): sin los haces de luz ni el cristal. */
class AOPass extends GTAOPass {
  render(renderer: T.WebGLRenderer, writeBuffer: T.WebGLRenderTarget, readBuffer: T.WebGLRenderTarget, dt?: number, mask?: boolean) {
    const hidden: T.Object3D[] = [];
    this.scene.traverseVisible(o => { const m = o as T.Mesh; if (m.isMesh && (m.userData.noOcclude || (!Array.isArray(m.material) && m.material.transparent && m.material.opacity < 0.6))) hidden.push(m); });
    for (const o of hidden) o.visible = false;
    super.render(renderer, writeBuffer, readBuffer, dt ?? 0, mask ?? false);
    for (const o of hidden) o.visible = true;
  }
}

/** Pase de rayos volumétricos: oclusión a baja resolución y desenfoque radial. */
class GodRaysPass extends Pass {
  occ = new T.WebGLRenderTarget(1, 1);
  rays = new T.WebGLRenderTarget(1, 1);
  private quad: FullScreenQuad;
  private mat: T.ShaderMaterial;
  private black = new T.MeshBasicMaterial({ color: 0x000000 });
  private cutMats = new Map<T.Material, T.MeshBasicMaterial>();
  private sun = new T.Mesh(new T.SphereGeometry(1, 16, 8), new T.MeshBasicMaterial({ color: '#ffffff' }));
  sunDir: T.Vector3 | null = null;
  strength = 0;
  scale = 0.35;
  constructor(private scene: T.Scene, public camera: T.Camera, samples: number) {
    super();
    this.needsSwap = false;
    this.mat = RAYS(samples);
    this.quad = new FullScreenQuad(this.mat);
  }
  setSamples(n: number) { this.mat.dispose(); this.mat = RAYS(n); this.quad.material = this.mat; }
  setSize(w: number, h: number) { const W = Math.max(1, Math.round(w * this.scale)), H = Math.max(1, Math.round(h * this.scale)); this.occ.setSize(W, H); this.rays.setSize(W, H); }
  render(renderer: T.WebGLRenderer) {
    if (!this.sunDir || this.strength <= 0) { renderer.setRenderTarget(this.rays); renderer.setClearColor(0, 1); renderer.clear(); return; }
    const cam = this.camera as T.PerspectiveCamera;
    // Sol: una esfera brillante lejos, en la dirección de la luz.
    const far = Math.min(cam.far ?? 500, 400) * 0.8;
    this.sun.position.copy(cam.position).addScaledVector(this.sunDir, far);
    this.sun.scale.setScalar(far * 0.06);
    this.sun.updateMatrixWorld();
    const sp = this.sun.position.clone().project(cam);
    const facing = new T.Vector3(0, 0, -1).applyQuaternion(cam.quaternion).dot(this.sunDir);
    if (facing <= 0.05) { renderer.setRenderTarget(this.rays); renderer.setClearColor(0, 1); renderer.clear(); return; }
    // Oclusión: todo negro (los dibujos con su silueta) y el sol blanco.
    const swapped: [T.Mesh, T.Material | T.Material[]][] = [];
    const hidden: T.Object3D[] = [];
    this.scene.traverseVisible(o => {
      if ((o as T.Mesh).isMesh) {
        const m = o as T.Mesh;
        if (m.userData.noOcclude) { hidden.push(m); return; }
        // Cristal y materiales casi transparentes: dejan pasar los rayos.
        const ms = Array.isArray(m.material) ? m.material : [m.material];
        if (ms.every(x => x.transparent && x.opacity < 0.6)) { hidden.push(m); return; }
        swapped.push([m, m.material]);
        const src = Array.isArray(m.material) ? m.material : [m.material];
        const occ = src.map(x => { const sm = x as T.MeshStandardMaterial; if (sm.alphaTest > 0 && sm.map) { let c = this.cutMats.get(x); if (!c) { c = new T.MeshBasicMaterial({ color: 0x000000, map: sm.map, alphaTest: sm.alphaTest, side: T.DoubleSide }); this.cutMats.set(x, c); } return c; } return this.black; });
        m.material = Array.isArray(m.material) ? occ : occ[0];
      } else if ((o as T.Line).isLine || (o as T.Points).isPoints || (o as T.Sprite).isSprite) hidden.push(o);
    });
    for (const o of hidden) o.visible = false;
    const bg = this.scene.background, fog = this.scene.fog;
    this.scene.background = null; this.scene.fog = null;
    this.scene.add(this.sun);
    renderer.setRenderTarget(this.occ);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    renderer.render(this.scene, cam);
    this.scene.remove(this.sun);
    this.scene.background = bg; this.scene.fog = fog;
    for (const [m, mat] of swapped) m.material = mat;
    for (const o of hidden) o.visible = true;
    // Desenfoque radial.
    this.mat.uniforms.tOcc.value = this.occ.texture;
    this.mat.uniforms.center.value.set((sp.x + 1) / 2, (sp.y + 1) / 2);
    this.mat.uniforms.exposure.value = 0.35 * Math.min(1, facing * 2);
    renderer.setRenderTarget(this.rays);
    this.quad.render(renderer);
  }
  dispose() { this.occ.dispose(); this.rays.dispose(); this.mat.dispose(); this.quad.dispose(); this.black.dispose(); for (const m of this.cutMats.values()) m.dispose(); }
}

/** Cadena de efectos (se salta si no hay ninguno activo: sin coste). */
export class FxPipeline {
  readonly composer: EffectComposer;
  private renderPass: RenderPass;
  private god: GodRaysPass;
  private bloom: UnrealBloomPass;
  private final: ShaderPass;
  private style: ShaderPass;
  private mask = new StyleMask();
  private ao: AOPass;
  private quality: Quality = 'medium';
  private w = 1; private h = 1;
  /** Resolución mínima (píxeles por punto) mientras se graba un vídeo; 0 = la normal. */
  minRatio = 0;
  /** FPS medidos (para bajar la calidad sola). */
  fps = 60;
  private frames = 0; private t0 = performance.now(); private slow = 0;
  /** `fixedRatio`: resolución exacta (renders), sin mirar la pantalla. */
  constructor(renderer: T.WebGLRenderer, scene: T.Scene, camera: T.Camera, private fixedRatio = 0) {
    this.composer = new EffectComposer(renderer, new T.WebGLRenderTarget(1, 1, { type: T.HalfFloatType, samples: fixedRatio ? 4 : 0 }));
    this.renderPass = new RenderPass(scene, camera);
    this.god = new GodRaysPass(scene, camera, QUALITY.medium.samples);
    this.bloom = new UnrealBloomPass(new T.Vector2(256, 256), 0.6, 0.4, 0.85);
    this.final = new ShaderPass(FINAL);
    this.composer.addPass(this.renderPass);
    this.ao = new AOPass(scene, camera, 1, 1);
    this.ao.enabled = false;
    this.composer.addPass(this.ao);
    this.composer.addPass(this.god);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.final);
    this.composer.addPass(new OutputPass());
    this.style = new ShaderPass(STYLE);
    this.composer.addPass(this.style);
  }
  /** ¿Hay algún efecto de estilo (shader) activo? */
  static styled(f: Fx3) { return STYLE_KEYS.some(k => (f[k] ?? 0) > 0); }
  /** ¿Hay que procesar algo? (efectos de la escena, volumen o estilos de objetos). */
  static needed(f: Fx3 | null, objStyles: number) { return objStyles > 0 || (!!f && FxPipeline.active(f)); }
  /** ¿Hay algún efecto que procesar? */
  static active(f: Fx3) { return f.godrays > 0 || f.bloom > 0 || f.chroma > 0 || f.glitch > 0 || f.tintAmt > 0 || f.vignette > 0 || f.grain > 0 || (f.ao ?? 0) > 0 || FxPipeline.styled(f); }
  setQuality(q: Quality) {
    if (q === this.quality) return;
    this.quality = q;
    this.god.setSamples(QUALITY[q].samples);
    this.setSize(this.w, this.h);
  }
  get currentQuality() { return this.quality; }
  /** Suavizado de bordes (MSAA) de la escena con efectos (al grabar en vivo). */
  setMsaa(n: number) {
    const c = this.composer as unknown as { renderTarget1: T.WebGLRenderTarget; renderTarget2: T.WebGLRenderTarget };
    if (this.fixedRatio || c.renderTarget1.samples === n) return;
    for (const rt of [c.renderTarget1, c.renderTarget2]) { rt.samples = n; rt.dispose(); }
  }
  setSize(w: number, h: number) {
    this.w = w; this.h = h;
    const q = QUALITY[this.quality];
    const pr = this.fixedRatio || Math.max(this.minRatio, Math.min(window.devicePixelRatio || 1, q.ratio));
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.god.scale = q.occ;
    this.god.setSize(w * pr, h * pr);
    this.bloom.resolution.set(w * pr * q.bloomRes, h * pr * q.bloomRes);
    this.final.uniforms.res.value.set(w * pr, h * pr);
    this.style.uniforms.res.value.set(w * pr, h * pr);
    this.mask.setSize(Math.round(w * pr), Math.round(h * pr));
    this.ao.setSize(Math.round(w * pr), Math.round(h * pr));
  }
  /** Dibuja con efectos. `sunDir` = dirección hacia la luz principal (null = sin rayos). */
  render(scene: T.Scene, camera: T.Camera, f: Fx3, time: number, sunDir: T.Vector3 | null, objStyles: StyleLike[] = []) {
    this.renderPass.scene = scene; this.renderPass.camera = camera; this.god.camera = camera;
    this.ao.camera = camera; this.ao.scene = scene;
    this.ao.enabled = (f.ao ?? 0) > 0;
    if (this.ao.enabled) { this.ao.blendIntensity = Math.min(1, f.ao); this.ao.updateGtaoMaterial({ radius: 0.6 + f.ao * 0.6, thickness: 1, scale: 1 + f.ao, samples: this.quality === 'low' ? 8 : this.quality === 'high' ? 24 : 16 }); this.ao.updatePdMaterial({ samples: this.quality === 'low' ? 8 : 16 }); }
    this.god.sunDir = sunDir; this.god.strength = f.godrays;
    this.god.enabled = f.godrays > 0 && !!sunDir;
    this.bloom.enabled = f.bloom > 0 && this.quality !== 'low';
    this.bloom.strength = f.bloom; this.bloom.radius = 0.45; this.bloom.threshold = 0.7;
    const u = this.final.uniforms;
    u.tRays.value = this.god.rays.texture; u.rays.value = this.god.enabled ? f.godrays : 0; u.rayColor.value.set(f.godColor);
    u.chroma.value = f.chroma; u.glitch.value = f.glitch; u.time.value = time; u.tint.value.set(f.tint); u.tintAmt.value = f.tintAmt; u.vignette.value = f.vignette; u.grain.value = f.grain;
    const st = this.style.uniforms;
    const n = Math.min(SLOTS - 1, objStyles.length);
    this.style.enabled = FxPipeline.styled(f) || n > 0;
    if (this.style.enabled) {
      // Ranura 0: la escena; 1..: cada objeto (suma su estilo al de la escena).
      const put = (i: number, o: StyleLike, g: StyleLike | null) => {
        const mx = (k: keyof StyleLike) => Math.max(Number(o[k]) || 0, g ? Number(g[k]) || 0 : 0);
        const own = (o.squiggle ?? 0) > 0 || !g;
        st.sA.value[i].set(mx('squiggle'), own ? o.squigFps ?? 8 : g!.squigFps ?? 8, own ? o.squigSize ?? 40 : g!.squigSize ?? 40, mx('ink'));
        st.sB.value[i].set(mx('posterize'), mx('halftone'), mx('pixel'), mx('paint'));
        st.sC.value[i].set(mx('scan'), 0, 0, 0);
        st.sInk.value[i].set((o.ink ?? 0) > 0 || !g ? o.inkColor ?? '#1a1420' : g.inkColor ?? '#1a1420');
      };
      put(0, f, null);
      for (let i = 0; i < n; i++) put(i + 1, objStyles[i], f);
      st.paper.value = f.paper ?? 0; st.time.value = time;
      st.useMask.value = n > 0 ? 1 : 0;
      if (n > 0) { this.mask.render(this.composer.renderer, scene, camera); st.tMask.value = this.mask.rt.texture; }
    }
    this.composer.render();
    // Siempre se termina dibujando en la pantalla (si un pase dejó otro destino, la vista
    // se quedaría congelada con la última imagen).
    this.composer.renderer.setRenderTarget(null);
    this.tick(f);
  }
  /** Mide los FPS y, con «adaptativa», baja la calidad si van lentos (y la sube si sobran). */
  tick(f: Fx3) {
    this.frames++;
    const now = performance.now();
    if (now - this.t0 < 1000) return;
    this.fps = (this.frames * 1000) / (now - this.t0);
    this.frames = 0; this.t0 = now;
    if (!f.adaptive) return;
    const order: Quality[] = ['low', 'medium', 'high'];
    const i = order.indexOf(this.quality), want = order.indexOf(f.quality);
    if (this.fps < 40 && i > 0) { if (++this.slow >= 2) { this.setQuality(order[i - 1]); this.slow = 0; } }
    else if (this.fps > 57 && i < want) { this.slow = 0; this.setQuality(order[i + 1]); }
    else this.slow = 0;
  }
  dispose() { this.god.dispose(); this.bloom.dispose(); this.mask.dispose(); this.ao.dispose(); this.composer.dispose(); }
}

/**
 * Haz de luz volumétrica de un foco. En vez de un cono plano que atraviesa todo,
 * cada píxel del haz recorre el rayo de la cámara dentro del cono (pocos pasos con
 * ruido para que no se noten) y mira el mapa de sombras del foco: donde una pared,
 * un mueble o la silueta de un dibujo tapa la luz, el haz se corta. Más denso cerca
 * del foco, bordes suaves y más brillante mirando hacia la luz. Sin pases extra:
 * reutiliza la sombra que el foco ya calcula.
 */
/** Foco de cada haz (fuera de userData, que se copia con JSON al clonar/exportar). */
export const coneLight = new WeakMap<T.Object3D, T.SpotLight>();
export const CONE_STEPS = { low: 10, medium: 18, high: 28 } as const;
export function volumeCone(angleDeg: number, length: number): T.Mesh {
  const tanA = Math.tan((Math.max(1, Math.min(80, angleDeg)) * Math.PI) / 180);
  const r = tanA * length;
  // Cerrado (con tapa) para que el haz también se vea mirando desde la base.
  const g = new T.ConeGeometry(r, length, 40, 1, false).translate(0, -length / 2, 0).rotateX(Math.PI / 2);
  const m = new T.ShaderMaterial({
    uniforms: {
      color: { value: new T.Color('#ffffff') }, strength: { value: 0.5 }, len: { value: length }, tanA: { value: tanA }, time: { value: 0 },
      inside: { value: 0 }, camLocal: { value: new T.Vector3() }, steps: { value: CONE_STEPS.medium },
      shadowMap: { value: null }, shadowMatrix: { value: new T.Matrix4() }, hasShadow: { value: 0 },
    },
    vertexShader: `varying vec3 vL; void main(){ vL = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `#include <packing>
      uniform vec3 color, camLocal; uniform float strength, len, tanA, time, inside, steps, hasShadow; uniform sampler2D shadowMap; uniform mat4 shadowMatrix;
      varying vec3 vL;
      float k2;
      // Salida del rayo del cono (eje -z, vértice en el origen) o de su tapa.
      float exitT(vec3 o, vec3 d){
        float a = d.x * d.x + d.y * d.y - k2 * d.z * d.z, b = 2.0 * (o.x * d.x + o.y * d.y - k2 * o.z * d.z), c = o.x * o.x + o.y * o.y - k2 * o.z * o.z;
        float best = 1e9;
        if (abs(a) > 1e-6) { float D = b * b - 4.0 * a * c; if (D >= 0.0) { float s = sqrt(D);
          float t1 = (-b - s) / (2.0 * a), t2 = (-b + s) / (2.0 * a);
          float z1 = o.z + d.z * t1, z2 = o.z + d.z * t2;
          if (t1 > 1e-3 && z1 <= 0.0 && z1 >= -len) best = min(best, t1);
          if (t2 > 1e-3 && z2 <= 0.0 && z2 >= -len) best = min(best, t2); } }
        if (abs(d.z) > 1e-6) { float t = (-len - o.z) / d.z; vec3 p = o + d * t; if (t > 1e-3 && length(p.xy) <= tanA * len) best = min(best, t); }
        return best > 1e8 ? 0.0 : best;
      }
      float lit(vec3 local){
        if (hasShadow < 0.5) return 1.0;
        vec4 sc = shadowMatrix * vec4(local, 1.0);
        sc.xyz /= sc.w;
        if (sc.x < 0.0 || sc.x > 1.0 || sc.y < 0.0 || sc.y > 1.0 || sc.z > 1.0) return 1.0;
        return step(sc.z - 0.003, unpackRGBAToDepth(texture2D(shadowMap, sc.xy)));
      }
      void main(){
        k2 = tanA * tanA;
        vec3 o, d; float tEnd;
        if (inside > 0.5) { o = camLocal; vec3 v = vL - camLocal; tEnd = length(v); d = v / max(tEnd, 1e-5); }
        else { o = vL; d = normalize(vL - camLocal); tEnd = exitT(o, d); }
        if (tEnd <= 0.0) discard;
        // Ruido por píxel (y por fotograma) para repartir los pasos sin bandas.
        float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))) + time * 0.618);
        float n = steps, dt = tEnd / n, acc = 0.0;
        for (int i = 0; i < 32; i++) {
          if (float(i) >= n) break;
          vec3 p = o + d * (dt * (float(i) + jit));
          float z = -p.z; if (z <= 0.0) continue;
          float edge = smoothstep(1.0, 0.55, length(p.xy) / (tanA * z));
          float fall = 1.0 / (1.0 + 6.0 * (z / len) * (z / len)) * smoothstep(len, len * 0.75, z);
          float dust = 0.85 + 0.15 * sin(p.x * 4.0 + time * 1.3) * sin(p.y * 3.0 - time * 0.9 + p.z * 2.0);
          acc += lit(p) * edge * fall * dust;
        }
        // Más brillo mirando hacia el foco (dispersión hacia delante).
        float c = dot(d, normalize(o + d * tEnd * 0.5));
        float phase = clamp(0.8775 / pow(1.1225 - 0.7 * c, 1.5), 0.5, 3.0);
        float a = 1.0 - exp(-acc * dt * strength * 0.9 * phase / max(0.3, tanA * len * 0.5));
        gl_FragColor = vec4(color * a, a);
      }`,
    transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.FrontSide,
  });
  const mesh = new T.Mesh(g, m);
  mesh.userData.noOcclude = true;
  mesh.userData.cone = true;
  mesh.castShadow = false; mesh.receiveShadow = false;
  mesh.raycast = () => undefined;
  const inv = new T.Matrix4(), cl = new T.Vector3();
  // Antes de dibujarlo: cámara en coordenadas del cono, ¿dentro del haz?, y la sombra del foco.
  mesh.onBeforeRender = (_r, _s, camera) => {
    const u = m.uniforms;
    inv.copy(mesh.matrixWorld).invert();
    cl.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(inv);
    u.camLocal.value.copy(cl);
    const z = -cl.z, inCone = z > 0 && z < length && Math.hypot(cl.x, cl.y) < tanA * z;
    u.inside.value = inCone ? 1 : 0;
    m.side = inCone ? T.BackSide : T.FrontSide;
    m.depthTest = !inCone;
    const l = coneLight.get(mesh);
    const map = l?.castShadow ? l.shadow.map?.texture ?? null : null;
    u.shadowMap.value = map; u.hasShadow.value = map ? 1 : 0;
    // Del espacio del cono directamente a la textura de sombra del foco.
    if (l) u.shadowMatrix.value.multiplyMatrices(l.shadow.matrix, mesh.matrixWorld);
  };
  return mesh;
}

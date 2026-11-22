import * as T from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
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
const STYLE = {
  uniforms: {
    tDiffuse: { value: null }, res: { value: new T.Vector2(1, 1) }, time: { value: 0 },
    squiggle: { value: 0 }, squigFps: { value: 8 }, squigSize: { value: 40 }, ink: { value: 0 }, inkColor: { value: new T.Color('#1a1420') },
    posterize: { value: 0 }, halftone: { value: 0 }, pixel: { value: 0 }, paint: { value: 0 }, paper: { value: 0 }, scan: { value: 0 },
  },
  vertexShader: VERT,
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 res; uniform float time, squiggle, squigFps, squigSize, ink, posterize, halftone, pixel, paint, paper, scan; uniform vec3 inkColor; varying vec2 vUv;
    float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
    float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += vn(p) * a; p *= 2.03; a *= 0.5; } return s; }
    float lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
    vec4 tex(vec2 uv){ return texture2D(tDiffuse, clamp(uv, 0.0, 1.0)); }
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
      // Píxeles grandes.
      if (pixel > 0.0) { vec2 cell = vec2(1.0 + pixel * 15.0) / res; uv = (floor(uv / cell) + 0.5) * cell; }
      // Squiggle: desplazamiento con ruido que cambia a saltos (squigFps).
      if (squiggle > 0.0) {
        float fr = floor(time * squigFps);
        vec2 q = uv * res / max(4.0, squigSize) + vec2(fr * 7.13, fr * 3.71);
        uv += (vec2(vn(q), vn(q + 19.7)) - 0.5) * squiggle * 7.0 / res * (res.y / 720.0 + 0.5);
      }
      vec4 base = tex(uv);
      vec3 col = paint > 0.0 ? kuwahara(uv, 1.0 + paint * 7.0 * res.y / 1080.0) : base.rgb;
      if (posterize > 0.0) { float lv = mix(24.0, 3.0, posterize); col = floor(col * lv + 0.5) / lv; }
      // Semitono: puntos en rejilla girada 45° (más grandes donde es más oscuro).
      if (halftone > 0.0) {
        float cs = max(3.0, res.y / 150.0);
        vec2 p = mat2(0.7071, -0.7071, 0.7071, 0.7071) * (vUv * res) / cs;
        float d = length(fract(p) - 0.5);
        float r = sqrt(clamp(1.0 - lum(col), 0.0, 1.0)) * 0.62;
        float dotm = 1.0 - smoothstep(r - 0.06, r + 0.06, d);
        col = mix(col, mix(min(col * 1.15 + 0.05, 1.0), col * 0.3, dotm), halftone);
      }
      // Tinta: bordes (Sobel de luminancia y de alfa) del color de tinta.
      if (ink > 0.0) {
        vec2 px = (1.0 + ink * 1.5 * res.y / 1080.0) / res;
        float tl = lum(tex(uv + px * vec2(-1.0, 1.0)).rgb), t = lum(tex(uv + px * vec2(0.0, 1.0)).rgb), tr = lum(tex(uv + px * vec2(1.0, 1.0)).rgb);
        float l = lum(tex(uv + px * vec2(-1.0, 0.0)).rgb), r = lum(tex(uv + px * vec2(1.0, 0.0)).rgb);
        float bl = lum(tex(uv + px * vec2(-1.0, -1.0)).rgb), b = lum(tex(uv + px * vec2(0.0, -1.0)).rgb), br = lum(tex(uv + px * vec2(1.0, -1.0)).rgb);
        float gx = tr + 2.0 * r + br - tl - 2.0 * l - bl, gy = tl + 2.0 * t + tr - bl - 2.0 * b - br;
        float aE = abs(tex(uv + px * vec2(1.0, 0.0)).a - tex(uv - px * vec2(1.0, 0.0)).a) + abs(tex(uv + px * vec2(0.0, 1.0)).a - tex(uv - px * vec2(0.0, 1.0)).a);
        float e = smoothstep(0.12, 0.45, length(vec2(gx, gy)) + aE);
        col = mix(col, inkColor, e * min(1.0, ink * 1.4));
        base.a = max(base.a, e * ink);
      }
      // Papel: fibras y manchas suaves, tono cálido.
      if (paper > 0.0) {
        vec2 pp = vUv * res / (res.y / 720.0);
        float n = fbm(pp / 90.0) * 0.6 + vn(pp / 2.5) * 0.4;
        col *= mix(vec3(1.0), vec3(0.99, 0.95, 0.86) * (0.9 + 0.18 * n), paper);
      }
      // Líneas de TV.
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
  private quality: Quality = 'medium';
  private w = 1; private h = 1;
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
    this.composer.addPass(this.god);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.final);
    this.composer.addPass(new OutputPass());
    this.style = new ShaderPass(STYLE);
    this.composer.addPass(this.style);
  }
  /** ¿Hay algún efecto de estilo (shader) activo? */
  static styled(f: Fx3) { return STYLE_KEYS.some(k => (f[k] ?? 0) > 0); }
  /** ¿Hay algún efecto que procesar? */
  static active(f: Fx3) { return f.godrays > 0 || f.bloom > 0 || f.chroma > 0 || f.glitch > 0 || f.tintAmt > 0 || f.vignette > 0 || f.grain > 0 || FxPipeline.styled(f); }
  setQuality(q: Quality) {
    if (q === this.quality) return;
    this.quality = q;
    this.god.setSamples(QUALITY[q].samples);
    this.setSize(this.w, this.h);
  }
  get currentQuality() { return this.quality; }
  setSize(w: number, h: number) {
    this.w = w; this.h = h;
    const q = QUALITY[this.quality];
    const pr = this.fixedRatio || Math.min(window.devicePixelRatio || 1, q.ratio);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.god.scale = q.occ;
    this.god.setSize(w * pr, h * pr);
    this.bloom.resolution.set(w * pr * q.bloomRes, h * pr * q.bloomRes);
    this.final.uniforms.res.value.set(w * pr, h * pr);
    this.style.uniforms.res.value.set(w * pr, h * pr);
  }
  /** Dibuja con efectos. `sunDir` = dirección hacia la luz principal (null = sin rayos). */
  render(scene: T.Scene, camera: T.Camera, f: Fx3, time: number, sunDir: T.Vector3 | null) {
    this.renderPass.scene = scene; this.renderPass.camera = camera; this.god.camera = camera;
    this.god.sunDir = sunDir; this.god.strength = f.godrays;
    this.god.enabled = f.godrays > 0 && !!sunDir;
    this.bloom.enabled = f.bloom > 0 && this.quality !== 'low';
    this.bloom.strength = f.bloom; this.bloom.radius = 0.45; this.bloom.threshold = 0.7;
    const u = this.final.uniforms;
    u.tRays.value = this.god.rays.texture; u.rays.value = this.god.enabled ? f.godrays : 0; u.rayColor.value.set(f.godColor);
    u.chroma.value = f.chroma; u.glitch.value = f.glitch; u.time.value = time; u.tint.value.set(f.tint); u.tintAmt.value = f.tintAmt; u.vignette.value = f.vignette; u.grain.value = f.grain;
    const st = this.style.uniforms;
    this.style.enabled = FxPipeline.styled(f);
    for (const k of STYLE_KEYS) st[k].value = f[k] ?? 0;
    st.time.value = time; st.squigFps.value = f.squigFps ?? 8; st.squigSize.value = f.squigSize ?? 40; st.inkColor.value.set(f.inkColor ?? '#1a1420');
    this.composer.render();
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
  dispose() { this.god.dispose(); this.bloom.dispose(); this.composer.dispose(); }
}

/** Cono de luz volumétrica de un foco (aditivo, se desvanece a lo largo y en los bordes). */
export function volumeCone(angleDeg: number, length: number): T.Mesh {
  const r = Math.tan((Math.max(1, Math.min(80, angleDeg)) * Math.PI) / 180) * length;
  const g = new T.ConeGeometry(r, length, 40, 1, true).translate(0, -length / 2, 0).rotateX(Math.PI / 2);
  const m = new T.ShaderMaterial({
    uniforms: { color: { value: new T.Color('#ffffff') }, strength: { value: 0.5 }, len: { value: length }, time: { value: 0 } },
    vertexShader: `varying float vL; varying vec3 vN; varying vec3 vV; varying vec3 vP; uniform float len;
      void main(){ vL = clamp(-position.z / len, 0.0, 1.0); vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); vP = position; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 color; uniform float strength, time; varying float vL; varying vec3 vN; varying vec3 vV; varying vec3 vP;
      float n(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      void main(){ float edge = pow(abs(dot(normalize(vN), normalize(vV))), 2.0); float dust = 0.85 + 0.15 * sin(vP.z * 3.0 + time * 1.7 + vP.x * 5.0);
        float a = pow(1.0 - vL, 1.6) * edge * strength * dust; gl_FragColor = vec4(color * a, a); }`,
    transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide,
  });
  const mesh = new T.Mesh(g, m);
  mesh.userData.noOcclude = true;
  mesh.userData.cone = true;
  mesh.raycast = () => undefined;
  return mesh;
}

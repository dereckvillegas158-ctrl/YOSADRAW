/**
 * Ejecutor de shaders WebGL2 para los efectos.
 *
 * - Todas las texturas intermedias están en alfa PREMULTIPLICADO: los
 *   desenfoques mezclan bien los bordes transparentes (sin halos oscuros).
 * - Coordenadas: el píxel (0,0) es la esquina superior izquierda de la imagen
 *   en todas las texturas; sólo la presentación final invierte la Y.
 * - Un único contexto para toda la app (se crea al usar el primer efecto).
 */

export interface Tex { tex: WebGLTexture; fb: WebGLFramebuffer; w: number; h: number }
export type Uniforms = Record<string, number | number[] | boolean>;

const VS = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;

/** Cabecera común de los fragment shaders. */
export const HEAD = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D u_tex;
uniform vec2 u_size;     // tamaño de la textura de entrada (px)
uniform vec2 u_out;      // tamaño de la salida (px)
uniform vec2 u_offset;   // posición global (px de imagen) de la esquina del mosaico
uniform vec2 u_full;     // tamaño global de la imagen (px)
uniform vec4 u_doc;      // rectángulo del documento dentro de la imagen (px)
uniform float u_unit;    // px de imagen por px de documento
uniform vec2 u_scaleIn;  // px de entrada por px de salida (pasadas reducidas o ampliadas)
out vec4 o;
// Coordenada de salida en px de la salida (0,0 = arriba a la izquierda).
vec2 outPos() { return gl_FragCoord.xy; }
// Px de entrada que corresponde a la salida actual.
vec2 inPos() { return gl_FragCoord.xy * u_scaleIn; }
// Posición global en px de imagen.
vec2 gpos() { return u_offset + gl_FragCoord.xy * u_scaleIn; }
// Fuera de la imagen todo es transparente (una capa no continúa más allá de su borde).
vec4 tx(vec2 p) { return (p.x < 0.0 || p.y < 0.0 || p.x > u_size.x || p.y > u_size.y) ? vec4(0.0) : texture(u_tex, p / u_size); }
vec3 unpm(vec4 c) { return c.a > 1e-5 ? c.rgb / c.a : vec3(0.0); }
vec4 pm(vec3 rgb, float a) { return vec4(clamp(rgb, 0.0, 1.0) * a, a); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec3 rgb2hsl(vec3 c) {
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b)), l = (mx + mn) * 0.5, d = mx - mn;
  if (d < 1e-6) return vec3(0.0, 0.0, l);
  float s = l > 0.5 ? d / (2.0 - mx - mn) : d / (mx + mn);
  float h = mx == c.r ? (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0) : mx == c.g ? (c.b - c.r) / d + 2.0 : (c.r - c.g) / d + 4.0;
  return vec3(h / 6.0, s, l);
}
float hue2rgb(float p, float q, float t) {
  t = fract(t);
  if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
  if (t < 0.5) return q;
  if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
  return p;
}
vec3 hsl2rgb(vec3 h) {
  if (h.y < 1e-6) return vec3(h.z);
  float q = h.z < 0.5 ? h.z * (1.0 + h.y) : h.z + h.y - h.z * h.y, p = 2.0 * h.z - q;
  return vec3(hue2rgb(p, q, h.x + 1.0 / 3.0), hue2rgb(p, q, h.x), hue2rgb(p, q, h.x - 1.0 / 3.0));
}
`;

export class GLRunner {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  readonly maxTex: number;
  private programs = new Map<string, { prog: WebGLProgram; loc: Map<string, WebGLUniformLocation | null> }>();
  private pool: Tex[] = [];
  private vao: WebGLVertexArrayObject;

  constructor() {
    this.canvas = document.createElement('canvas');
    const gl = this.canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false, preserveDrawingBuffer: true, depth: false, stencil: false });
    if (!gl) throw new Error('Este dispositivo no admite WebGL2: los efectos no están disponibles.');
    this.gl = gl;
    this.maxTex = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE) as number, 8192);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.disable(gl.BLEND);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }

  private program(fs: string) {
    let p = this.programs.get(fs);
    if (p) return p;
    const gl = this.gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`Shader: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(prog, 0, 'a_pos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`Programa: ${gl.getProgramInfoLog(prog)}`);
    p = { prog, loc: new Map() };
    this.programs.set(fs, p);
    return p;
  }

  /** Textura de trabajo (reutilizada de un depósito). */
  alloc(w: number, h: number): Tex {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    const i = this.pool.findIndex(t => t.w === w && t.h === h);
    if (i >= 0) return this.pool.splice(i, 1)[0];
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fb, w, h };
  }
  release(...t: (Tex | null | undefined)[]) { for (const x of t) if (x && !this.pool.includes(x)) this.pool.push(x); }
  /** Libera la memoria de vídeo de las texturas guardadas. */
  trim() { const gl = this.gl; for (const t of this.pool) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); } this.pool = []; }

  /** Sube una imagen (canvas) como textura premultiplicada. */
  upload(src: TexImageSource, w: number, h: number): Tex {
    const t = this.alloc(w, h);
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, src);
    return t;
  }

  /**
   * Ejecuta un fragment shader. `inputs`: u_tex y otras texturas. Devuelve la
   * salida (o dibuja en `target`). Uniformes comunes: u_size (de u_tex), u_out.
   */
  run(fs: string, inputs: Record<string, Tex>, uniforms: Uniforms, out: { w: number; h: number } | Tex, base: Uniforms = {}): Tex {
    const gl = this.gl;
    const p = this.program(fs);
    const target = 'tex' in out ? out : this.alloc(out.w, out.h);
    gl.useProgram(p.prog);
    gl.bindVertexArray(this.vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb);
    gl.viewport(0, 0, target.w, target.h);
    let unit = 0;
    for (const [name, t] of Object.entries(inputs)) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      this.set(p, name, unit, true);
      this.set(p, name === 'u_tex' ? 'u_size' : `${name}Size`, [t.w, t.h]);
      unit++;
    }
    this.set(p, 'u_out', [target.w, target.h]);
    for (const [k, v] of Object.entries({ u_scaleIn: [1, 1], ...base, ...uniforms })) this.set(p, k, v);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return target;
  }

  private set(p: { prog: WebGLProgram; loc: Map<string, WebGLUniformLocation | null> }, name: string, v: number | number[] | boolean, sampler = false) {
    const gl = this.gl;
    let l = p.loc.get(name);
    if (l === undefined) { l = gl.getUniformLocation(p.prog, name); p.loc.set(name, l); }
    if (!l) return;
    if (sampler) { gl.uniform1i(l, v as number); return; }
    if (typeof v === 'boolean') gl.uniform1f(l, v ? 1 : 0);
    else if (typeof v === 'number') gl.uniform1f(l, v);
    else if (v.length === 2) gl.uniform2fv(l, v);
    else if (v.length === 3) gl.uniform3fv(l, v);
    else if (v.length === 4) gl.uniform4fv(l, v);
  }

  /** Dibuja una textura en el lienzo del contexto (invirtiendo la Y) para copiarla a 2D. */
  present(t: Tex, sx: number, sy: number, w: number, h: number) {
    const gl = this.gl;
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    const p = this.program(PRESENT);
    gl.useProgram(p.prog);
    gl.bindVertexArray(this.vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    this.set(p, 'u_tex', 0, true);
    this.set(p, 'u_size', [t.w, t.h]);
    this.set(p, 'u_src', [sx, sy, w, h]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

const PRESENT = `${HEAD}
uniform vec4 u_src;
void main() {
  // El búfer por defecto tiene la Y hacia arriba: se invierte para que quede como la imagen.
  vec2 p = vec2(gl_FragCoord.x, u_src.w - gl_FragCoord.y) + u_src.xy;
  o = texture(u_tex, p / u_size);
}`;

let shared: GLRunner | null = null;
let failure: Error | null = null;
/** Contexto compartido (null si el dispositivo no tiene WebGL2). */
export function getGL(): GLRunner {
  if (failure) throw failure;
  if (!shared) { try { shared = new GLRunner(); } catch (e) { failure = e as Error; throw e; } }
  return shared;
}
export const glAvailable = () => { try { getGL(); return true; } catch { return false; } };

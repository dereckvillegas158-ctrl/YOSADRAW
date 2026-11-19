import { blendOp } from '../doc/ItemRenderer';
import { EFFECTS, LUTS, lutCanvas, parseCube, type Values } from '../effects/effects';
import { applyEffect } from '../effects/run';
import { valueAt, type Prop } from './keys';
import type { MediaManager } from './media';
import {
  activeClips, clipSize, setTextMeasurer, isAudioOnly, sourceTime, type Clip, type Composition, type MediaClip, type Motion, type ShapeClip, type TextClip, type Transition,
} from './model';

export type M6 = [number, number, number, number, number, number];
type TransState = ReturnType<typeof trans>;
export const mul = (a: M6, b: M6): M6 => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
const T = (x: number, y: number): M6 => [1, 0, 0, 1, x, y];
const S = (x: number, y: number): M6 => [x, 0, 0, y, 0, 0];
const R = (deg: number): M6 => { const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r); return [c, s, -s, c, 0, 0]; };
const K = (sx: number, sy: number): M6 => [1, Math.tan((sy * Math.PI) / 180), Math.tan((sx * Math.PI) / 180), 1, 0, 0];

export interface RenderOpts {
  /** Px de salida por px de composición. */
  scale: number;
  /** Vista previa (puede usar proxies y calidad reducida de efectos). */
  preview: boolean;
  /** Vídeo exacto: esperar al fotograma justo (exportar, en pausa). Si no, se usa lo que el reproductor muestre. */
  exact: boolean;
  /** Desenfoque de movimiento: sub-fotogramas y obturación (0..1 de un fotograma). */
  motionBlur?: { samples: number; shutter: number } | null;
  /** Sin efectos (vista previa muy rápida). */
  noFx?: boolean;
}

const tv = <T>(p: Prop<T>, t: number) => valueAt(p, t);

/**
 * Compositor de YOSADRAW MOTION: dibuja un instante de una composición.
 *
 * Por cada clip visible (de la pista de abajo a la de arriba): obtiene la imagen
 * de origen (fotograma de vídeo, imagen, GIF, secuencia, dibujo o animación de
 * YOSADRAW, composición anidada) o la dibuja como vector (texto, formas, sólido),
 * con su transformación animada (posición, escala, giro, inclinación, anclaje),
 * la cámara 2D con paralaje, el recorte y las máscaras; le aplica su pila de
 * efectos (motor WebGL2 de YOSADRAW) y las transiciones, y la compone con su
 * opacidad y modo de fusión. Nada destruye el original.
 */
export class Compositor {
  private pool: HTMLCanvasElement[] = [];

  constructor(readonly media: MediaManager) {}

  private canvas(i: number, w: number, h: number) {
    let c = this.pool[i];
    if (!c) { c = document.createElement('canvas'); this.pool[i] = c; }
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const g = c.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.filter = 'none';
    g.clearRect(0, 0, w, h);
    return { c, g };
  }

  /** Dibuja la composición en `t` (s) en `out` (que se redimensiona a comp × scale). */
  async render(m: Motion, comp: Composition, t: number, out: HTMLCanvasElement, o: RenderOpts, depth = 0): Promise<HTMLCanvasElement> {
    const W = Math.max(1, Math.round(comp.w * o.scale)), H = Math.max(1, Math.round(comp.h * o.scale));
    if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
    const g = out.getContext('2d')!;
    const mb = o.motionBlur;
    if (mb && mb.samples > 1 && depth === 0) {
      // Desenfoque de movimiento: media de sub-fotogramas dentro de la obturación.
      g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
      g.clearRect(0, 0, W, H);
      const tmp = document.createElement('canvas');
      for (let i = 0; i < mb.samples; i++) {
        const ti = t + ((i + 0.5) / mb.samples - 0.5) * mb.shutter / comp.fps;
        await this.render(m, comp, Math.max(0, ti), tmp, { ...o, motionBlur: null }, 1);
        g.globalAlpha = 1 / (i + 1);
        g.drawImage(tmp, 0, 0);
      }
      g.globalAlpha = 1;
      return out;
    }
    const layer = depth === 0 ? this.canvas(0, W, H) : { c: document.createElement('canvas'), g: null as unknown as CanvasRenderingContext2D };
    const L = layer.c;
    if (depth > 0) { L.width = W; L.height = H; }
    const lg = L.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.filter = 'none';
    g.clearRect(0, 0, W, H);
    if (comp.bg) { g.fillStyle = comp.bg; g.fillRect(0, 0, W, H); }
    const tracks = new Map(comp.tracks.map(tr => [tr.id, tr]));
    for (const c of activeClips(comp, t)) {
      const tr = tracks.get(c.track);
      if (!tr || tr.hidden || tr.kind === 'audio' || isAudioOnly(m, c)) continue;
      const lt = t - c.start;
      lg.setTransform(1, 0, 0, 1, 0, 0); lg.globalAlpha = 1; lg.globalCompositeOperation = 'source-over'; lg.filter = 'none';
      lg.clearRect(0, 0, W, H);
      const size = clipSize(m, c, lt);
      const tin = trans(c.tin, lt, c.dur, 'in'), tout = trans(c.tout, lt, c.dur, 'out');
      const M = this.matrix(comp, c, t, o.scale, tr.parallax, size, [tin, tout]);
      const tf = c.tf;
      const drawn = await this.drawContent(m, comp, c, lt, lg, M, size, o, depth);
      if (!drawn) continue;
      if (c.masks.length) this.applyMasks(c, lt, lg, M, W, H);
      let img: HTMLCanvasElement = L;
      if (!o.noFx) for (const f of c.fx) {
        if (!f.on) continue;
        const def = EFFECTS.find(e => e.id === f.fx);
        if (!def) continue;
        const vals: Values = {};
        for (const [k, p] of Object.entries(f.p)) vals[k] = valueAt(p as Prop<number | string | boolean>, lt);
        if (def.id === 'lut') await this.ensureLut(m, String(vals.lut));
        img = await applyEffect(img, def, vals, { unit: o.scale, doc: [0, 0, W, H], into: img === L ? this.canvas(1, W, H).c : L });
      }
      // Barridos, iris y persianas: sólo se ve una parte de la imagen.
      for (const tr2 of [tin, tout]) if (tr2 && ['wipe-l', 'wipe-r', 'wipe-u', 'wipe-d', 'iris', 'blinds', 'flash', 'glitch'].includes(tr2.type)) this.transitionPixels(img, tr2, W, H);
      let alpha = Math.max(0, Math.min(1, tv(tf.opacity, lt)));
      for (const tr2 of [tin, tout]) if (tr2 && ['fade', 'zoom', 'zoom-out', 'spin'].includes(tr2.type)) alpha *= tr2.p;
      g.save();
      g.globalAlpha = alpha;
      g.globalCompositeOperation = blendOp(c.blend);
      const blur = [tin, tout].reduce((b, x) => (x?.type === 'blur' ? Math.max(b, (1 - x.p) * 30 * o.scale) : b), 0);
      if (blur > 0.3) g.filter = `blur(${blur.toFixed(1)}px)`;
      g.drawImage(img, 0, 0);
      g.restore();
    }
    return out;
  }

  /**
   * Matriz de un clip en `t`: salida · cámara (con paralaje) · transiciones · posición ·
   * giro · inclinación · escala · anclaje. El visor la usa para sus controles.
   */
  matrix(comp: Composition, c: Clip, t: number, scale: number, parallax: number, size: { w: number; h: number }, trs: (TransState | null)[] = []): M6 {
    const lt = t - c.start, tf = c.tf;
    let M: M6 = S(scale, scale);
    if (comp.camera.on) M = mul(M, this.camera(comp, t, parallax));
    for (const x of trs) M = mul(M, transitionMatrix(x, comp));
    M = mul(M, T(tv(tf.x, lt), tv(tf.y, lt)));
    M = mul(M, R(tv(tf.rot, lt)));
    M = mul(M, K(tv(tf.skx, lt), tv(tf.sky, lt)));
    M = mul(M, S(tv(tf.sx, lt), tv(tf.sy, lt)));
    return mul(M, T(-tv(tf.ax, lt) * size.w, -tv(tf.ay, lt) * size.h));
  }

  /** Matriz del «padre» de los clips de una pista: salida · cámara (para mover en el visor). */
  parentMatrix(comp: Composition, t: number, scale: number, parallax: number): M6 {
    const M: M6 = S(scale, scale);
    return comp.camera.on ? mul(M, this.camera(comp, t, parallax)) : M;
  }

  /** Transiciones que actúan sobre los píxeles del clip ya dibujado. */
  private transitionPixels(img: HTMLCanvasElement, t: NonNullable<ReturnType<typeof trans>>, W: number, H: number) {
    const ig = img.getContext('2d')!, k = t.p;
    ig.save(); ig.setTransform(1, 0, 0, 1, 0, 0);
    if (t.type === 'flash') {
      // Destello blanco que se apaga (sólo sobre lo que hay del clip).
      ig.globalCompositeOperation = 'source-atop';
      ig.globalAlpha = (1 - k) * 0.95; ig.fillStyle = '#ffffff'; ig.fillRect(0, 0, W, H);
    } else if (t.type === 'glitch') {
      // Franjas desplazadas al azar (determinista por fotograma) que se calman al terminar.
      const { c: tmp, g } = this.canvas(4, W, H);
      g.drawImage(img, 0, 0);
      ig.clearRect(0, 0, W, H);
      const q = 1 - k, n = 14;
      let seed = Math.floor(q * 97) * 7919 + 13;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < n; i++) {
        const y0 = (i / n) * H, hh = H / n + 1, dx = (rnd() - 0.5) * W * 0.25 * q;
        ig.drawImage(tmp, 0, y0, W, hh, dx, y0, W, hh);
      }
      if (q > 0.05) { ig.globalCompositeOperation = 'lighter'; ig.globalAlpha = q * 0.5; ig.drawImage(tmp, W * 0.015 * q, 0); }
    } else {
      ig.globalCompositeOperation = 'destination-in'; ig.fillStyle = '#000';
      ig.beginPath();
      if (t.type === 'wipe-r') ig.rect(0, 0, W * k, H);
      else if (t.type === 'wipe-l') ig.rect(W * (1 - k), 0, W * k, H);
      else if (t.type === 'wipe-d') ig.rect(0, 0, W, H * k);
      else if (t.type === 'wipe-u') ig.rect(0, H * (1 - k), W, H * k);
      else if (t.type === 'iris') ig.arc(W / 2, H / 2, Math.hypot(W, H) / 2 * k, 0, Math.PI * 2);
      else if (t.type === 'blinds') { const n = 10, bh = H / n; for (let i = 0; i < n; i++) ig.rect(0, i * bh, W, bh * k); }
      ig.fill();
    }
    ig.restore();
  }

  private camera(comp: Composition, t: number, parallax: number): M6 {
    const cam = comp.camera, p = parallax;
    const z = 1 + (tv(cam.zoom, t) - 1) * p, r = tv(cam.rot, t) * Math.min(1, p);
    const cx = comp.w / 2, cy = comp.h / 2;
    return mul(mul(mul(T(cx, cy), R(-r)), S(z, z)), T(-cx - tv(cam.x, t) * p, -cy - tv(cam.y, t) * p));
  }

  /** Dibuja el contenido del clip en `g` con la matriz `M`. Devuelve false si no hay nada que dibujar. */
  private async drawContent(m: Motion, _comp: Composition, c: Clip, lt: number, g: CanvasRenderingContext2D, M: M6, size: { w: number; h: number }, o: RenderOpts, depth: number): Promise<boolean> {
    g.setTransform(...M);
    g.imageSmoothingQuality = o.preview ? 'medium' : 'high';
    if (c.kind === 'solid') { g.fillStyle = tv(c.color, lt); g.fillRect(0, 0, size.w, size.h); return true; }
    if (c.kind === 'text') { this.drawText(c, lt, g, M); return true; }
    if (c.kind === 'shape') { this.drawShape(c, lt, g); return true; }
    let src: CanvasImageSource | null = null, sw = size.w, sh = size.h;
    if (c.kind === 'comp') {
      const sub = m.comps.find(x => x.id === c.comp);
      if (!sub || depth > 8) return false;
      const st = sourceTime(c, lt, sub.dur);
      const k = Math.min(2, o.scale * Math.hypot(M[0], M[1]) / o.scale || 1);
      src = await this.render(m, sub, st, document.createElement('canvas'), { ...o, scale: Math.max(0.05, Math.min(2, k)) }, depth + 1);
    } else {
      const md = m.media.find(x => x.id === c.media);
      if (!md) return false;
      const st = sourceTime(c as MediaClip, lt, md.dur);
      if (md.kind === 'video') {
        const v = await this.media.video(c.id, md, o.preview);
        if (!v) return false;
        if (o.exact || Math.abs(v.currentTime - st) > 0.25 || v.readyState < 2) await this.media.seek(v, st);
        src = v;
      } else if (md.kind === 'image' || md.kind === 'svg') src = await this.media.image(md).catch(() => null);
      else if (md.kind === 'gif') src = await this.media.gifFrame(md, st).catch(() => null);
      else if (md.kind === 'seq') src = await this.media.seqFrame(md, st);
      else if (md.kind === 'drawing' || md.kind === 'anim') src = await this.media.drawingFrame(md, st, Math.hypot(M[0], M[1]));
      if (!src) return false;
    }
    const nat = natural(src, sw, sh);
    const [cl, ct, cr, cb] = c.crop;
    const sx = cl * nat.w, sy = ct * nat.h, sW = Math.max(1, nat.w * (1 - cl - cr)), sH = Math.max(1, nat.h * (1 - ct - cb));
    g.drawImage(src, sx, sy, sW, sH, cl * sw, ct * sh, sw * (1 - cl - cr), sh * (1 - ct - cb));
    return true;
  }

  private applyMasks(c: Clip, lt: number, g: CanvasRenderingContext2D, M: M6, W: number, H: number) {
    const { c: mc, g: mg } = this.canvas(2, W, H);
    let first = true;
    for (const mk of c.masks) {
      const x = tv(mk.x, lt), y = tv(mk.y, lt), w = tv(mk.w, lt), h = tv(mk.h, lt), f = Math.max(0, tv(mk.feather, lt));
      const { c: one, g: og } = this.canvas(3, W, H);
      og.setTransform(...M);
      og.fillStyle = '#000';
      og.beginPath();
      if (mk.type === 'ellipse') og.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2);
      else og.rect(x, y, w, h);
      og.fill();
      if (mk.invert) { og.setTransform(1, 0, 0, 1, 0, 0); og.globalCompositeOperation = 'xor'; og.fillRect(0, 0, W, H); og.globalCompositeOperation = 'source-over'; }
      mg.save();
      mg.setTransform(1, 0, 0, 1, 0, 0);
      if (f > 0) mg.filter = `blur(${(f * Math.hypot(M[0], M[1])).toFixed(1)}px)`;
      mg.globalCompositeOperation = first ? 'source-over' : mk.mode === 'subtract' ? 'destination-out' : 'source-over';
      if (first && mk.mode === 'subtract') { mg.fillStyle = '#000'; mg.fillRect(0, 0, W, H); mg.globalCompositeOperation = 'destination-out'; }
      mg.drawImage(one, 0, 0);
      mg.restore();
      first = false;
    }
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(mc, 0, 0);
    g.restore();
  }

  private async ensureLut(m: Motion, id: string) {
    if (!id || LUTS.has(id)) return;
    const md = m.media.find(x => x.id === id && x.kind === 'lut');
    if (!md) return;
    const { size, data } = parseCube(await this.media.lutText(md));
    LUTS.set(id, { size, canvas: lutCanvas(size, data) });
  }

  // ---------------------------------------------------------------- texto

  /** Caja del texto (px de composición) para el anclaje. */
  static textBox(c: TextClip, g: CanvasRenderingContext2D, lt: number) {
    g.font = fontOf(c);
    (g as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${tv(c.spacing, lt)}px`;
    const lines = c.text.split('\n');
    const w = Math.max(1, ...lines.map(l => g.measureText(l).width));
    return { lines, w, h: Math.max(1, lines.length * c.size * c.lineH) };
  }

  private drawText(c: TextClip, lt: number, g: CanvasRenderingContext2D, M: M6) {
    const box = Compositor.textBox(c, g, lt);
    g.setTransform(...M);
    const k = Math.hypot(M[0], M[1]) || 1;
    if (c.bg.on) {
      g.fillStyle = c.bg.color;
      g.beginPath(); g.roundRect(-c.bg.pad, -c.bg.pad, box.w + 2 * c.bg.pad, box.h + 2 * c.bg.pad, c.bg.radius); g.fill();
    }
    let fill: string | CanvasGradient = tv(c.fill, lt);
    if (c.grad.on) {
      const a = (c.grad.angle * Math.PI) / 180, cx = box.w / 2, cy = box.h / 2, r = Math.hypot(box.w, box.h) / 2;
      const gr = g.createLinearGradient(cx - Math.cos(a) * r, cy - Math.sin(a) * r, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      gr.addColorStop(0, tv(c.fill, lt)); gr.addColorStop(1, tv(c.grad.c2, lt));
      fill = gr;
    }
    g.textBaseline = 'top';
    g.lineJoin = 'round';
    const shadow = () => { if (c.shadow.on) { g.shadowColor = c.shadow.color; g.shadowBlur = c.shadow.blur * k; g.shadowOffsetX = c.shadow.dx * k; g.shadowOffsetY = c.shadow.dy * k; } };
    const noShadow = () => { g.shadowColor = 'transparent'; g.shadowBlur = 0; g.shadowOffsetX = 0; g.shadowOffsetY = 0; };
    const reveal = Math.max(0, Math.min(1, tv(c.reveal, lt))), bend = tv(c.bend, lt);
    const total = c.text.replace(/\n/g, '').length;
    let idx = 0;
    const perChar = c.anim !== 'none' || Math.abs(bend) > 1e-3;
    const words = c.anim === 'words-pop' ? c.text.split(/\s+/).filter(Boolean).length : 0;
    let wordIdx = 0;
    box.lines.forEach((line, li) => {
      const lw = g.measureText(line).width;
      const x0 = c.align === 'left' ? 0 : c.align === 'right' ? box.w - lw : (box.w - lw) / 2;
      const y0 = li * c.size * c.lineH;
      if (!perChar) {
        shadow();
        if (c.stroke.on) { g.strokeStyle = tv(c.stroke.color, lt); g.lineWidth = tv(c.stroke.w, lt) * 2; g.strokeText(line, x0, y0); noShadow(); }
        g.fillStyle = fill; g.fillText(line, x0, y0);
        noShadow();
        return;
      }
      // Carácter a carácter: animaciones de texto y texto en arco.
      let prefix = '';
      for (const ch of line) {
        const cx = x0 + g.measureText(prefix).width, cw = g.measureText(ch).width;
        prefix += ch;
        const i = idx++;
        if (/\s/.test(ch)) { if (c.anim === 'words-pop') wordIdx++; continue; }
        let a = 1, dy = 0, sc = 1;
        if (c.anim === 'typewriter') a = i < Math.floor(reveal * total + 1e-6) ? 1 : 0;
        else if (c.anim === 'chars-fade') a = Math.max(0, Math.min(1, reveal * (total + 4) - i));
        else if (c.anim === 'chars-up') { a = Math.max(0, Math.min(1, reveal * (total + 4) - i)); dy = (1 - a) * c.size * 0.6; }
        else if (c.anim === 'words-pop') { const u = Math.max(0, Math.min(1, reveal * (words + 1) - wordIdx)); a = u > 0 ? 1 : 0; sc = u < 1 ? 0.4 + 0.75 * u - 0.15 * u * u : 1; }
        if (a <= 0) continue;
        g.save();
        g.globalAlpha *= a;
        if (Math.abs(bend) > 1e-3) {
          // Arco: el centro de la línea queda arriba (bend > 0) o abajo (bend < 0).
          const R = box.w / (Math.abs(bend) * Math.PI * 1.2), ang = ((cx + cw / 2 - box.w / 2) / R) * Math.sign(bend);
          const pcx = box.w / 2, pcy = y0 + (bend > 0 ? R : -R);
          g.translate(pcx + Math.sin(ang) * R, pcy - Math.cos(ang) * R * Math.sign(bend));
          g.rotate(ang);
          g.translate(-cw / 2, 0);
        } else g.translate(cx, y0 + dy);
        if (sc !== 1) { g.translate(cw / 2, c.size / 2); g.scale(sc, sc); g.translate(-cw / 2, -c.size / 2); }
        shadow();
        if (c.stroke.on) { g.strokeStyle = tv(c.stroke.color, lt); g.lineWidth = tv(c.stroke.w, lt) * 2; g.strokeText(ch, 0, 0); noShadow(); }
        g.fillStyle = fill; g.fillText(ch, 0, 0);
        g.restore();
      }
    });
    noShadow();
  }

  // ---------------------------------------------------------------- formas

  private drawShape(c: ShapeClip, lt: number, g: CanvasRenderingContext2D) {
    const w = Math.max(1, tv(c.w, lt)), h = Math.max(1, tv(c.h, lt));
    const path = new Path2D();
    let len = 0;
    const poly = (pts: [number, number][], close = true) => {
      pts.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)));
      if (close) path.closePath();
      for (let i = 0; i < pts.length - (close ? 0 : 1); i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; len += Math.hypot(b[0] - a[0], b[1] - a[1]); }
    };
    switch (c.shape) {
      case 'rect': { const r = Math.max(0, Math.min(tv(c.radius, lt), w / 2, h / 2)); path.roundRect(0, 0, w, h, r); len = 2 * (w + h) - (8 - 2 * Math.PI) * r; break; }
      case 'ellipse': path.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); len = Math.PI * (3 * (w + h) / 2 - Math.sqrt((3 * w / 2 + h / 2) * (w / 2 + 3 * h / 2))); break;
      case 'polygon': case 'star': {
        const n = Math.max(3, c.sides), pts: [number, number][] = [];
        const k = c.shape === 'star' ? 2 * n : n;
        for (let i = 0; i < k; i++) {
          const a = -Math.PI / 2 + (i * 2 * Math.PI) / k, r = c.shape === 'star' && i % 2 ? c.inner : 1;
          pts.push([w / 2 + Math.cos(a) * (w / 2) * r, h / 2 + Math.sin(a) * (h / 2) * r]);
        }
        poly(pts);
        break;
      }
      case 'line': poly([[0, h / 2], [w, h / 2]], false); break;
      case 'arrow': { const hd = Math.min(w * 0.35, h * 1.2); poly([[0, h * 0.35], [w - hd, h * 0.35], [w - hd, 0], [w, h / 2], [w - hd, h], [w - hd, h * 0.65], [0, h * 0.65]]); break; }
    }
    const trim = Math.max(0, Math.min(1, tv(c.trim, lt)));
    if (c.fillOn && c.shape !== 'line' && trim >= 0.999) {
      let fill: string | CanvasGradient = tv(c.fill, lt);
      if (c.grad.on) {
        const a = (c.grad.angle * Math.PI) / 180, r = Math.hypot(w, h) / 2;
        const gr = g.createLinearGradient(w / 2 - Math.cos(a) * r, h / 2 - Math.sin(a) * r, w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r);
        gr.addColorStop(0, tv(c.fill, lt)); gr.addColorStop(1, tv(c.grad.c2, lt));
        fill = gr;
      }
      g.fillStyle = fill;
      g.fill(path);
    }
    if (c.strokeOn || c.shape === 'line') {
      g.strokeStyle = tv(c.stroke, lt);
      g.lineWidth = Math.max(0.1, tv(c.strokeW, lt));
      g.lineJoin = 'round'; g.lineCap = 'round';
      // Trazado progresivo: se dibuja la fracción `trim` del contorno.
      if (trim < 0.999) g.setLineDash([Math.max(0.001, len * trim), len + 1]);
      else if (c.dash > 0) g.setLineDash([c.dash, c.dash]);
      g.stroke(path);
      g.setLineDash([]);
    }
  }
}

/** Medidor de texto para el modelo (tamaño de la caja de un clip de texto: anclaje, selección). */
const measureCtx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
setTextMeasurer((c, t) => { if (!measureCtx) return { w: 1, h: 1 }; const b = Compositor.textBox(c, measureCtx, t); return { w: b.w, h: b.h }; });

const fontOf = (c: TextClip) => `${c.italic ? 'italic ' : ''}${c.weight} ${c.size}px "${c.font}", "Instrument Sans", system-ui, sans-serif`;

function natural(src: CanvasImageSource, fw: number, fh: number) {
  const s = src as { videoWidth?: number; videoHeight?: number; naturalWidth?: number; naturalHeight?: number; displayWidth?: number; displayHeight?: number; width?: number; height?: number };
  const w = s.videoWidth || s.displayWidth || s.naturalWidth || (typeof s.width === 'number' ? s.width : 0) || fw;
  const h = s.videoHeight || s.displayHeight || s.naturalHeight || (typeof s.height === 'number' ? s.height : 0) || fh;
  return { w, h };
}

/** Estado de una transición en el tiempo de clip `lt` (p = 0 → empieza, 1 → completa). */
function trans(tr: Transition, lt: number, dur: number, side: 'in' | 'out'): { type: Transition['type']; p: number; u: number; side: 'in' | 'out' } | null {
  if (tr.type === 'none' || tr.dur <= 0) return null;
  const d = Math.min(tr.dur, dur);
  const u = side === 'in' ? lt / d : (dur - lt) / d;
  if (u >= 1) return null;
  const p = Math.max(0, Math.min(1, u));
  return { type: tr.type, p: 1 - (1 - p) ** 2, u: p, side };
}

function transitionMatrix(t: ReturnType<typeof trans>, comp: Composition): M6 {
  if (!t) return [1, 0, 0, 1, 0, 0];
  const q = 1 - t.p, W = comp.w, H = comp.h;
  // Entrada: llega desde ese lado; salida: se va hacia ese lado.
  const dir = t.side === 'in' ? -1 : 1;
  switch (t.type) {
    // «Deslizar ←»: entra por la derecha y sale por la izquierda (el resto, igual en su sentido).
    case 'slide-l': return T(-dir * W * q, 0);
    case 'slide-r': return T(dir * W * q, 0);
    case 'slide-u': return T(0, -dir * H * q);
    case 'slide-d': return T(0, dir * H * q);
    case 'zoom': { const s = 0.6 + 0.4 * t.p; return mul(mul(T(W / 2, H / 2), S(s, s)), T(-W / 2, -H / 2)); }
    case 'zoom-out': { const s = 1 + 0.8 * q; return mul(mul(T(W / 2, H / 2), S(s, s)), T(-W / 2, -H / 2)); }
    case 'spin': { const s = 0.2 + 0.8 * t.p; return mul(mul(mul(T(W / 2, H / 2), R(dir * -180 * q)), S(s, s)), T(-W / 2, -H / 2)); }
    case 'pop': {
      // Rebote al aparecer (o al irse): sobrepasa el tamaño y vuelve.
      const u = t.u, c1 = 1.70158, c3 = c1 + 1, s = Math.max(0, 1 + c3 * (u - 1) ** 3 + c1 * (u - 1) ** 2);
      return mul(mul(T(W / 2, H / 2), S(s, s)), T(-W / 2, -H / 2));
    }
    case 'swing': return mul(mul(T(W / 2, 0), R(dir * 75 * q)), T(-W / 2, 0));
    default: return [1, 0, 0, 1, 0, 0];
  }
}

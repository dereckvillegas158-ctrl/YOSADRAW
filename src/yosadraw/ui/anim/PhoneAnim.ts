import { desktopBridge } from '../../brush/storage';
import type { Item } from '../../doc/items';
import * as M from '../../anim/model';
import { encodeGif, encodeMp4, mp4Codec } from '../../anim/webexport';
import { h, toast } from '../dom';
import { openSheet } from '../Mobile';
import type { AnimStudio } from './AnimStudio';
import { contextMenu } from './Timeline';
import { TI } from './icons';
import { onionPopover } from './AnimPanel';

const SQ = 58;

/**
 * Animación simplificada para teléfono y Android: fotogramas en cuadrados con
 * miniatura sobre el lienzo, al estilo de un bloc animado. Se dibuja con las
 * mismas herramientas (pinceles, estabilizador, borrador, capas…); cada cuadrado
 * es un fotograma de la animación y los botones actúan sobre la pista activa.
 * Debajo usa el mismo modelo, historial, papel cebolla, reproductor y guardado
 * que la versión de PC.
 */
export class PhoneAnim {
  readonly el: HTMLElement;
  private list = h('div', { class: 'pa-list', role: 'listbox', 'aria-label': 'Fotogramas' });
  private playBtn: HTMLButtonElement;
  private onionBtn: HTMLButtonElement;
  private counter = h('span', { class: 'pa-count mono' });
  private fpsBtn: HTMLButtonElement;
  private thumbs = new Map<number, { sig: string; canvas: HTMLCanvasElement }>();
  private ids = new WeakMap<Item[], number>();
  private nextId = 1;
  private req = 0;

  constructor(private s: AnimStudio, private projectName: () => string) {
    const b = (icon: string, label: string, run: (e: Event) => void, cls = '') => h('button', { type: 'button', class: `pa-btn ${cls}`, title: label, 'aria-label': label, html: icon, on: { click: run } }) as HTMLButtonElement;
    this.playBtn = b(TI.play, 'Reproducir', () => s.player.toggle(), 'pa-play');
    this.onionBtn = b(TI.onion, 'Papel cebolla (mantén pulsado: ajustes)', () => s.run(() => M.cmdAnimSettings(s.doc, { onion: { enabled: !s.anim!.onion.enabled } }, 'Papel cebolla')));
    this.longPress(this.onionBtn, () => onionPopover(s, this.onionBtn));
    this.fpsBtn = h('button', { type: 'button', class: 'pa-fps', title: 'Velocidad (fotogramas por segundo)', on: { click: () => this.fpsMenu() } }) as HTMLButtonElement;
    const bar = h('div', { class: 'pa-bar' },
      this.playBtn, this.onionBtn, this.fpsBtn, this.counter,
      h('span', { class: 'pa-spacer' }),
      b(TI.dup, 'Duplicar fotograma', () => this.duplicate()),
      b(TI.add, 'Nuevo fotograma', () => this.add()),
      b(TI.gear.replace(/width="16" height="16"/, 'width="20" height="20"'), 'Más opciones de animación', e => this.menu(e.currentTarget as HTMLElement)));
    this.el = h('div', { class: 'phone-anim', 'data-ui': '' }, bar, this.list);
    s.on('change', () => this.schedule());
    s.player.on('state', p => { this.playBtn.innerHTML = p ? TI.pause : TI.play; this.playBtn.classList.toggle('on', p); });
    s.player.on('frame', () => this.markCurrent(true));
    this.list.addEventListener('scroll', () => this.schedule(), { passive: true });
  }

  private longPress(el: HTMLElement, run: () => void) {
    let t = 0;
    el.addEventListener('pointerdown', () => { t = window.setTimeout(() => { t = 0; run(); }, 500); });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(ev, () => clearTimeout(t));
    el.addEventListener('contextmenu', e => { e.preventDefault(); run(); });
  }

  /** Lo que se ve en cada cuadrado: un fotograma de la animación. Al final, el botón «+». */
  private frames() { return this.s.anim ? this.s.anim.length : 0; }

  private schedule() { if (!this.req) this.req = requestAnimationFrame(() => { this.req = 0; this.render(); }); }

  private idOf(items: Item[]) { let i = this.ids.get(items); if (!i) { i = this.nextId++; this.ids.set(items, i); } return i; }

  /** Firma del contenido visible de un fotograma (para repintar sólo las miniaturas que cambian). */
  private sig(f: number) {
    const d = this.s.doc;
    M.capture(d);
    return d.layers.map(l => {
      if (!M.effectiveVisible(d, l) || l.reference) return '';
      const items = l.cels ? M.celAt(l, f)?.content.items : l.items;
      return items ? `${this.idOf(items)}:${items.length}:${l.opacity}` : '';
    }).join('|') + `|${d.settings.background}`;
  }

  render() {
    const a = this.s.anim;
    if (!a || !this.el.isConnected) return;
    this.updateBar();
    const n = this.frames();
    let addBtn = this.list.querySelector<HTMLElement>('.pa-add');
    if (!addBtn) { addBtn = h('button', { type: 'button', class: 'pa-sq pa-add', 'aria-label': 'Añadir fotograma al final', html: TI.add, on: { click: () => this.addAtEnd() } }); this.list.append(addBtn); }
    const squares = [...this.list.querySelectorAll<HTMLElement>('.pa-sq:not(.pa-add)')];
    while (squares.length < n) { const el = this.square(squares.length); this.list.insertBefore(el, addBtn); squares.push(el); }
    while (squares.length > n) squares.pop()!.remove();
    [...this.list.querySelectorAll<HTMLElement>('.pa-sq:not(.pa-add)')].forEach((el, i) => { el.dataset.f = String(i); });
    this.markCurrent(false);
    // Miniaturas: sólo las visibles en la tira.
    const r = this.list.getBoundingClientRect();
    const l = this.s.active;
    for (const el of this.list.querySelectorAll<HTMLElement>('.pa-sq:not(.pa-add)')) {
      const f = Number(el.dataset.f);
      const c = l.cels ? M.celAt(l, f) : null;
      el.classList.toggle('hold', !!c && c.start !== f);
      el.classList.toggle('blank', !!l.cels && !c);
      el.classList.toggle('key', !!c && c.key && c.start === f);
      const er = el.getBoundingClientRect();
      if (er.right < r.left - SQ || er.left > r.right + SQ) continue;
      const sig = this.sig(f);
      const t = this.thumbs.get(f);
      if (t?.sig === sig && el.firstElementChild === t.canvas) continue;
      const canvas = t?.canvas ?? document.createElement('canvas');
      const d = this.s.doc, k = SQ / Math.max(d.width, d.height);
      this.s.frames.renderFrame(f, Math.max(0.005, k * Math.min(2, devicePixelRatio || 1)), canvas, { background: true, includeReference: true });
      this.thumbs.set(f, { sig, canvas });
      if (el.firstElementChild !== canvas) el.replaceChildren(canvas, h('span', { class: 'pa-n' }, String(f + 1)));
    }
  }

  private square(f: number) {
    const el = h('button', { type: 'button', class: 'pa-sq', role: 'option', dataset: { f: String(f) }, on: { click: () => { if (this.s.player.playing) this.s.player.pause(); this.s.go(Number(el.dataset.f)); } } });
    this.longPress(el, () => { this.s.go(Number(el.dataset.f)); this.frameMenu(el); });
    return el;
  }

  private markCurrent(scroll: boolean) {
    const a = this.s.anim;
    if (!a) return;
    for (const el of this.list.querySelectorAll<HTMLElement>('.pa-sq[aria-selected="true"]')) el.setAttribute('aria-selected', 'false');
    const cur = this.list.querySelector<HTMLElement>(`.pa-sq[data-f="${a.current}"]`);
    cur?.setAttribute('aria-selected', 'true');
    this.counter.textContent = `${a.current + 1}/${a.length}`;
    if (cur && (scroll || this.s.player.playing)) {
      const r = this.list.getBoundingClientRect(), c = cur.getBoundingClientRect();
      if (c.left < r.left || c.right > r.right) this.list.scrollLeft += c.left - r.left - r.width / 2 + c.width / 2;
    }
  }

  private updateBar() {
    const a = this.s.anim!;
    this.onionBtn.classList.toggle('on', a.onion.enabled);
    this.fpsBtn.textContent = `${a.fps} fps`;
    this.counter.textContent = `${a.current + 1}/${a.length}`;
  }

  // ---------------------------------------------------------------- acciones (pista activa)

  private track() {
    const l = this.s.active;
    if (l.cels) return l;
    toast(`«${l.name}» es un fondo (igual en todos los fotogramas). Elige otra capa o conviértela en «Animar capa» desde ⚙`);
    return null;
  }

  /**
   * Inserta un fotograma (columna) en `at` en todas las pistas animadas: lo que sigue se
   * desplaza y los dibujos que se mantenían a través de `at` se mantienen uno más; en la
   * pista activa el nuevo fotograma lleva `items` (vacío o copia).
   */
  private insertColumn(at: number, items: Item[] | null, label: string) {
    const l = this.track();
    if (!l) return;
    this.s.run(() => M.cmdAnimEdit(this.s.doc, label, an => {
      for (const t of this.s.doc.layers) {
        if (!t.cels) continue;
        t.cels = t.cels.flatMap(x => {
          if (x.start >= at) return [{ ...x, start: x.start + 1 }];
          if (M.celEnd(x) <= at) return [x];
          // El dibujo atraviesa `at`: en la pista activa se parte (el nuevo va en medio); en las demás se mantiene.
          return t === l ? [{ ...x, length: at - x.start }, { ...x, id: M.uid('c'), start: at + 1, length: M.celEnd(x) - at }] : [{ ...x, length: x.length + 1 }];
        });
      }
      l.cels = [...l.cels!, M.newCel(at, 1, items ?? [], true, '')];
      an.length = Math.min(M.MAX_FRAMES, Math.max(an.length + 1, M.contentEnd(this.s.doc)));
      an.current = at;
    }));
    this.markCurrent(true);
  }

  add() { const a = this.s.anim; if (a) this.insertColumn(a.current + 1, null, 'Nuevo fotograma'); }

  duplicate() {
    const l = this.track(), a = this.s.anim;
    if (!l || !a) return;
    M.capture(this.s.doc);
    const c = M.celAt(l, a.current);
    if (!c) { toast('Este fotograma está vacío: dibuja algo o pulsa +'); return; }
    this.insertColumn(a.current + 1, c.content.items.slice(), 'Duplicar fotograma');
  }

  private addAtEnd() { const a = this.s.anim; if (a) this.insertColumn(a.length, null, 'Nuevo fotograma'); }

  /** Quita el fotograma actual (la columna en todas las pistas animadas): los de después se adelantan. */
  private remove() {
    const a = this.s.anim;
    if (!a) return;
    if (a.length <= 1) { toast('La animación necesita al menos un fotograma'); return; }
    const f = a.current;
    this.s.run(() => M.cmdAnimEdit(this.s.doc, 'Eliminar fotograma', an => {
      for (const t of this.s.doc.layers) if (t.cels) t.cels = t.cels.flatMap(x => (M.celEnd(x) <= f ? [x] : x.start > f ? [{ ...x, start: x.start - 1 }] : x.length > 1 ? [{ ...x, length: x.length - 1 }] : []));
      an.length = Math.max(1, an.length - 1);
      an.current = Math.min(f, an.length - 1);
    }));
  }

  /** Mueve el fotograma actual una posición (intercambia con el vecino de la pista activa). */
  private shift(d: -1 | 1) {
    const a = this.s.anim, l = this.track();
    if (!a || !l) return;
    const f = a.current, g = f + d;
    if (g < 0 || g >= a.length) return;
    this.s.run(() => M.cmdAnimEdit(this.s.doc, d < 0 ? 'Mover fotograma a la izquierda' : 'Mover fotograma a la derecha', an => {
      const at = (x: number) => M.celAt(l, x);
      const A = at(f), B = at(g);
      // Fotograma a fotograma: se separan las exposiciones largas en fotogramas sueltos antes de intercambiar.
      const one = (c: M.Cel | null, x: number) => (c ? { ...c, id: c.start === x ? c.id : M.uid('c'), start: x, length: 1 } : null);
      const keep = l.cels!.flatMap(c => {
        const out: M.Cel[] = [];
        for (let x = c.start; x < M.celEnd(c); x++) if (x !== f && x !== g) out.push({ ...c, id: x === c.start ? c.id : M.uid('c'), start: x, length: 1 });
        return out;
      });
      const a2 = one(A, g), b2 = one(B, f);
      l.cels = [...keep, ...(a2 ? [a2] : []), ...(b2 ? [b2] : [])];
      // Las copias de un mismo dibujo comparten contenido; las piezas separadas se vuelven a unir si siguen juntas.
      l.cels = merge(M.sortCels(l.cels));
      an.current = g;
    }));
  }

  private frameMenu(anchor: HTMLElement) {
    const r = anchor.getBoundingClientRect();
    const s = this.s, l = s.active, c = s.anim && M.celAt(l, s.anim.current);
    contextMenu(r.left, r.top - 8, [
      { label: 'Duplicar', disabled: !c, run: () => this.duplicate() },
      { label: 'Insertar fotograma vacío después', run: () => this.add() },
      { label: 'Copiar', disabled: !c, run: () => s.copy() },
      { label: 'Pegar después', disabled: !s.clipboard, run: () => this.insertColumn(s.anim!.current + 1, s.clipboard!.cels[0].items.slice(), 'Pegar fotograma') },
      { label: '← Mover a la izquierda', run: () => this.shift(-1) },
      { label: 'Mover a la derecha →', run: () => this.shift(1) },
      null,
      { label: 'Eliminar fotograma', danger: true, run: () => this.remove() },
    ]);
  }

  private fpsMenu() {
    const r = this.fpsBtn.getBoundingClientRect();
    contextMenu(r.left, r.top - 8, M.FPS_OPTIONS.map(f => ({ label: `${f} fps${f === this.s.anim?.fps ? '  ✓' : ''}`, run: () => this.s.run(() => M.cmdAnimSettings(this.s.doc, { fps: f }, 'Velocidad')) })));
  }

  private menu(anchor: HTMLElement) {
    const s = this.s, a = s.anim!, l = s.active;
    const r = anchor.getBoundingClientRect();
    contextMenu(r.left - 200, r.top - 8, [
      { label: 'Exportar GIF o vídeo…', run: () => this.exportSheet() },
      { label: 'Ajustes del papel cebolla…', run: () => onionPopover(s, this.onionBtn) },
      { label: a.loop ? 'Reproducir una vez' : 'Reproducir en bucle', run: () => s.run(() => M.cmdAnimSettings(s.doc, { loop: !a.loop }, 'Bucle')) },
      null,
      { label: 'Nueva capa animada', run: () => s.newTrack(true) },
      l.cels ? { label: `«${l.name}» como fondo fijo`, run: () => s.makeStatic(l.id) } : { label: `Animar «${l.name}»`, run: () => s.makeAnimated(l.id) },
      { label: 'Importar imágenes como fotogramas…', run: () => void s.importSequence() },
      { label: 'Importar audio…', run: () => void s.importAudio() },
    ]);
  }

  // ---------------------------------------------------------------- exportar (sin FFmpeg)

  private exportSheet() {
    const s = this.s, a = s.anim!;
    if (s.player.playing) s.player.pause();
    let format: 'gif' | 'mp4' = 'gif', size = 720, loop = a.loop, alpha = false;
    openSheet('Exportar animación', close => {
      const out = h('div', { class: 'pa-export' });
      const draw = () => {
        const seg = <T extends string | number | boolean>(label: string, value: T, opts: [T, string][], set: (v: T) => void) =>
          h('div', { class: 'ctl' }, h('span', { class: 'ctl-label' }, label), h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': label },
            ...opts.map(([v, t]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(v === value), on: { click: () => { set(v); draw(); } } }, t))));
        const d = s.doc, k = Math.min(1, size / Math.min(d.width, d.height));
        let w = Math.round(d.width * k), hh = Math.round(d.height * k);
        if (format === 'mp4') { w -= w % 2; hh -= hh % 2; }
        const secs = (a.length / a.fps).toFixed(1).replace('.', ',');
        out.replaceChildren(
          seg('Formato', format, [['gif', 'GIF'], ['mp4', 'Vídeo MP4']], v => { format = v; }),
          seg('Tamaño', size, [[1080, '1080'], [720, '720'], [480, '480'], [320, '320']], v => { size = v; }),
          format === 'gif' ? seg('Repetir', loop, [[true, 'En bucle'], [false, 'Una vez']], v => { loop = v; }) : '',
          format === 'gif' ? seg('Fondo', alpha, [[false, 'Papel'], [true, 'Transparente']], v => { alpha = v; }) : '',
          h('p', { class: 'ctl-help' }, `${a.length} fotogramas · ${w} × ${hh} px · ${a.fps} fps · ${secs} s${format === 'mp4' && a.audio.length ? ' · con el audio' : ''}`),
          h('div', { class: 'dialog-actions' }, h('button', { type: 'button', class: 'btn primary', on: { click: () => { close(); void this.runExport(format, w, hh, loop, alpha); } } }, 'Exportar')));
      };
      draw();
      return [out];
    });
  }

  private async runExport(format: 'gif' | 'mp4', w: number, hh: number, loop: boolean, alpha: boolean) {
    const s = this.s, a = s.anim!, d = s.doc;
    let cancelled = false;
    const bar = h('span'), label = h('p', { class: 'ctl-help' }, 'Preparando…');
    const closeSheet = openSheet('Exportando…', () => [h('div', { class: 'ax-progress' }, h('div', { class: 'ax-bar' }, bar), label), h('div', { class: 'dialog-actions' }, h('button', { type: 'button', class: 'btn', on: { click: () => { cancelled = true; } } }, 'Cancelar'))]);
    const r = s.frames.fork(192 * 1024 * 1024);
    const tmp = document.createElement('canvas'), canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = hh;
    const frame = (k: number) => {
      r.renderFrame(k, w / d.width, tmp, { background: !alpha, includeReference: false });
      const g = canvas.getContext('2d', { willReadFrequently: format === 'gif' })!;
      g.clearRect(0, 0, w, hh);
      if (!alpha) { g.fillStyle = d.settings.background ?? '#ffffff'; g.fillRect(0, 0, w, hh); }
      g.drawImage(tmp, 0, 0, w, hh);
      return canvas;
    };
    const progress = (k: number, n: number) => { bar.style.width = `${(k / n) * 100}%`; label.textContent = `Fotograma ${k} / ${n}`; };
    try {
      let data: Uint8Array | null, note = '';
      if (format === 'gif') data = await encodeGif({ width: w, height: hh, fps: a.fps, frames: a.length, frame, progress, cancelled: () => cancelled, loop, alpha });
      else {
        if (!(await mp4Codec(w, hh, a.fps))) throw new Error('este dispositivo no puede codificar vídeo H.264 a ese tamaño (prueba uno menor o GIF)');
        const audio = a.audio.length ? await s.audio.mix(a, 0, a.length / a.fps).catch(() => null) : null;
        const res = await encodeMp4({ width: w, height: hh, fps: a.fps, frames: a.length, frame, progress, cancelled: () => cancelled, bitrate: Math.round(w * hh * a.fps * 0.15), audio });
        data = res?.data ?? null;
        if (res && audio && !res.audio) note = ' (sin audio: el sistema no codifica AAC)';
      }
      closeSheet();
      if (!data) { toast('Exportación cancelada'); return; }
      const name = `${this.projectName().replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80) || 'Animación'}.${format}`;
      const bridge = desktopBridge();
      if (bridge?.writeExport) {
        const path = await bridge.writeExport(bridge.exportFolder ? await bridge.exportFolder() : '', name, data, false);
        const shown = bridge.describe?.(path).path ?? path;
        toast(`Guardado en ${shown}${note}`, 'ok', bridge.shareFile ? { label: 'Compartir', run: () => void bridge.shareFile!(path) } : undefined);
      } else {
        const url = URL.createObjectURL(new Blob([data as Uint8Array<ArrayBuffer>], { type: format === 'gif' ? 'image/gif' : 'video/mp4' }));
        const link = h('a', { href: url, download: name, style: { display: 'none' } });
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        toast(`Descargado ${name}${note}`, 'ok');
      }
    } catch (e) {
      closeSheet();
      toast(`No se pudo exportar: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally { r.clear(); }
  }
}

/** Une cels seguidos que comparten el mismo dibujo (tras separar en fotogramas sueltos). */
function merge(cels: M.Cel[]): M.Cel[] {
  const out: M.Cel[] = [];
  for (const c of cels) {
    const p = out[out.length - 1];
    if (p && M.celEnd(p) === c.start && p.content === c.content && p.label === c.label) out[out.length - 1] = { ...p, length: p.length + c.length };
    else out.push(c);
  }
  return out;
}

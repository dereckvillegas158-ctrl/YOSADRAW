import { CATEGORIES, defaults, EFFECTS } from '../../effects/effects';
import { applyEffect } from '../../effects/run';
import { FILTERS, type FilterDef } from '../../motion/filters';
import { applyPreset, MOTION_PRESETS, prop, type MotionPreset, type PresetGroup } from '../../motion/keys';
import { mid, newMotion, shapeClip, TRANSITIONS, type FxInst, type Motion, type TransitionType } from '../../motion/model';
import { Compositor } from '../../motion/render';
import { h, toast } from '../dom';
import type { MotionStudio } from './MotionStudio';

type Tab = 'filters' | 'transitions' | 'effects' | 'anims';
const TW = 112, TH = 63;

/** Imagen de muestra (colorida, con luces y sombras) para las miniaturas de filtros y efectos. */
let sample: HTMLCanvasElement | null = null;
function sampleImage(): HTMLCanvasElement {
  if (sample) return sample;
  const c = document.createElement('canvas');
  c.width = TW * 2; c.height = TH * 2;
  const g = c.getContext('2d')!;
  const sky = g.createLinearGradient(0, 0, 0, c.height);
  sky.addColorStop(0, '#5b8cff'); sky.addColorStop(0.55, '#ffb38a'); sky.addColorStop(1, '#2a1f44');
  g.fillStyle = sky; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#ffe28a'; g.beginPath(); g.arc(c.width * 0.68, c.height * 0.42, 22, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#3a2b5c'; g.beginPath(); g.moveTo(0, c.height); g.lineTo(60, 60); g.lineTo(120, c.height); g.fill();
  g.fillStyle = '#5a3f86'; g.beginPath(); g.moveTo(70, c.height); g.lineTo(150, 74); g.lineTo(c.width, c.height); g.fill();
  g.fillStyle = '#9d6bff'; g.fillRect(14, c.height - 30, 40, 22);
  g.fillStyle = '#5fd3a5'; g.fillRect(170, c.height - 26, 36, 18);
  return (sample = c);
}

/** Proyecto mínimo con una estrella para previsualizar transiciones y animaciones. */
function miniMotion(): Motion {
  const m = newMotion(TW * 2, TH * 2, 30, 2);
  const comp = m.comps[0];
  comp.bg = '#14111d';
  const c = shapeClip(comp, comp.tracks[1].id, 0, 'star');
  c.w = prop(70); c.h = prop(70); c.fill = prop('#9d6bff'); c.grad = { on: true, c2: prop('#ffb38a'), angle: 45 };
  comp.clips.push(c);
  return m;
}

/**
 * Explorador de YOSADRAW MOTION: filtros (looks), transiciones, efectos y
 * animaciones listas, con miniaturas hechas por el propio motor (lo que se ve es
 * lo que sale). Al pasar el ratón las transiciones y animaciones se reproducen;
 * un clic (o toque) lo aplica a los clips elegidos.
 */
export class MBrowser {
  readonly el: HTMLElement;
  private tab: Tab = 'filters';
  private body: HTMLElement;
  private tabs: HTMLElement;
  private search: HTMLInputElement;
  private side: 'in' | 'out' | 'both' = 'in';
  private comp: Compositor;
  private anim = 0;
  private io: IntersectionObserver | null = null;
  private thumbCache = new Map<string, HTMLCanvasElement>();

  constructor(private s: MotionStudio) {
    this.comp = new Compositor(s.media);
    this.tabs = h('div', { class: 'mo-tabs mo-btabs', role: 'tablist' });
    this.search = h('input', { type: 'search', class: 'mo-search', placeholder: 'Buscar…', 'aria-label': 'Buscar' });
    this.search.addEventListener('input', () => this.render());
    this.body = h('div', { class: 'mo-bgrid' });
    this.el = h('div', { class: 'mo-browser' }, this.tabs, h('div', { class: 'mo-librow' }, this.search), this.body);
  }

  show(tab?: Tab) { if (tab) this.tab = tab; this.render(); }

  private targets() {
    const sel = this.s.selected.filter(c => !(c.kind === 'media' && this.s.m.media.find(m => m.id === c.media)?.kind === 'audio'));
    if (!sel.length) toast('Elige primero uno o varios clips (en la línea de tiempo o el visor).');
    return sel;
  }

  render() {
    cancelAnimationFrame(this.anim);
    this.io?.disconnect();
    const labels: [Tab, string][] = [['filters', 'Filtros'], ['transitions', 'Transiciones'], ['effects', 'Efectos'], ['anims', 'Animaciones']];
    this.tabs.replaceChildren(...labels.map(([id, l]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(this.tab === id), on: { click: () => { this.tab = id; this.search.value = ''; this.render(); } } }, l)));
    const q = this.search.value.trim().toLowerCase();
    const match = (l: string) => !q || l.toLowerCase().includes(q);
    this.body.replaceChildren();
    this.io = new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) { this.io!.unobserve(e.target); (e.target as HTMLElement).dispatchEvent(new Event('mo-visible')); } }, { root: this.body.closest('.mo-browser') ?? null });
    if (this.tab === 'filters') {
      this.body.append(h('p', { class: 'ctl-help mo-span' }, 'Se añaden a la pila de efectos del clip: luego puedes ajustarlos o quitarlos en la pestaña Efectos.'));
      for (const f of FILTERS.filter(x => match(x.label))) this.body.append(this.card(f.label, `f:${f.id}`, c => this.filterThumb(f, c), () => this.applyFilter(f)));
    } else if (this.tab === 'effects') {
      for (const cat of CATEGORIES) {
        const list = EFFECTS.filter(e => e.cat === cat.id && match(e.label) && e.id !== 'lut');
        if (!list.length) continue;
        this.body.append(h('h4', { class: 'mo-span' }, cat.label));
        for (const e of list) this.body.append(this.card(e.label, `e:${e.id}`, c => this.effectThumb(e.id, c), () => this.applyEffect(e.id)));
      }
    } else if (this.tab === 'transitions') {
      const seg = h('div', { class: 'segmented mo-span', role: 'radiogroup', 'aria-label': 'Aplicar como' },
        ...([['in', 'Entrada'], ['out', 'Salida'], ['both', 'Entrada y salida']] as const).map(([v, l]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(this.side === v), on: { click: () => { this.side = v; this.render(); } } }, l)));
      this.body.append(seg);
      for (const [id, label] of TRANSITIONS.filter(([id, l]) => id !== 'none' && match(l))) this.body.append(this.card(label, `t:${id}`, c => this.transThumb(id, c, 0.35), () => this.applyTransition(id), (c, t) => this.transThumb(id, c, t)));
      this.body.append(h('button', { type: 'button', class: 'btn sm mo-span', on: { click: () => this.applyTransition('none') } }, 'Quitar la transición'));
    } else {
      const groups: PresetGroup[] = ['Entrada', 'Salida', 'Bucle'];
      for (const g of groups) {
        const list = MOTION_PRESETS.filter(p => p.group === g && match(p.label));
        if (!list.length) continue;
        this.body.append(h('h4', { class: 'mo-span' }, g === 'Bucle' ? 'En bucle (todo el clip)' : g));
        for (const p of list) this.body.append(this.card(p.label, `a:${p.id}`, c => this.animThumb(p.id, c, p.group === 'Salida' ? 0.05 : p.group === 'Bucle' ? 0 : 0.95), () => this.applyAnim(p.id, p.label), (c, t) => this.animThumb(p.id, c, t)));
      }
      this.body.append(h('p', { class: 'ctl-help mo-span' }, 'Añade keyframes de transformación (editables). Duración del movimiento: la que tengas en la pestaña Animar del clip (0,8 s por defecto).'));
    }
  }

  /** Tarjeta con miniatura (estática) y, si hay `live`, animada al pasar el ratón. */
  private card(label: string, key: string, still: (c: HTMLCanvasElement) => Promise<void>, apply: () => void, live?: (c: HTMLCanvasElement, t: number) => Promise<void>) {
    const cv = document.createElement('canvas');
    cv.width = TW * 2; cv.height = TH * 2;
    cv.className = 'mo-bthumb';
    const b = h('button', { type: 'button', class: 'mo-bcard', title: `${label}: clic para aplicar a los clips elegidos` }, cv, h('span', null, label));
    b.addEventListener('click', apply);
    b.addEventListener('mo-visible', () => {
      const hit = this.thumbCache.get(key);
      if (hit) { cv.getContext('2d')!.drawImage(hit, 0, 0); return; }
      void still(cv).then(() => { const k = document.createElement('canvas'); k.width = cv.width; k.height = cv.height; k.getContext('2d')!.drawImage(cv, 0, 0); this.thumbCache.set(key, k); }).catch(() => undefined);
    });
    this.io!.observe(b);
    if (live) {
      let on = false;
      const t0 = { v: 0 };
      const loop = async (now: number) => {
        if (!on) return;
        if (!t0.v) t0.v = now;
        const t = (((now - t0.v) / 1000) % 1.6) / 1.2;
        await live(cv, Math.min(1, t)).catch(() => undefined);
        if (on) this.anim = requestAnimationFrame(loop);
      };
      b.addEventListener('pointerenter', () => { on = true; t0.v = 0; cancelAnimationFrame(this.anim); this.anim = requestAnimationFrame(loop); });
      b.addEventListener('pointerleave', () => { on = false; const hit = this.thumbCache.get(key); if (hit) cv.getContext('2d')!.drawImage(hit, 0, 0); });
    }
    return b;
  }

  // ---------------------------------------------------------------- miniaturas

  private async filterThumb(f: FilterDef, out: HTMLCanvasElement) {
    let img = sampleImage();
    for (const x of f.fx) {
      const def = EFFECTS.find(e => e.id === x.fx);
      if (def) img = await applyEffect(img, def, { ...defaults(def), ...x.p }, { unit: 0.5, doc: [0, 0, img.width, img.height] });
    }
    out.getContext('2d')!.drawImage(img, 0, 0, out.width, out.height);
  }
  private async effectThumb(id: string, out: HTMLCanvasElement) {
    const def = EFFECTS.find(e => e.id === id)!;
    const img = await applyEffect(sampleImage(), def, defaults(def), { unit: 0.5, doc: [0, 0, out.width, out.height] });
    const g = out.getContext('2d')!;
    g.clearRect(0, 0, out.width, out.height);
    g.drawImage(img, 0, 0, out.width, out.height);
  }
  private async transThumb(id: TransitionType, out: HTMLCanvasElement, t: number) {
    const m = miniMotion(), comp = m.comps[0], c = comp.clips[0];
    c.tin = { type: id, dur: 1 };
    await this.comp.render(m, comp, Math.max(0, Math.min(0.999, t)), out, { scale: 1, preview: true, exact: true });
  }
  private async animThumb(id: MotionPreset, out: HTMLCanvasElement, t: number) {
    const m = miniMotion(), comp = m.comps[0], c = comp.clips[0];
    applyPreset(c.tf, id, c.dur, 1, comp.w, comp.h);
    // Entradas: 0→1 s; salidas: 1→2 s; bucles: todo.
    const g = MOTION_PRESETS.find(p => p.id === id)!.group;
    const time = g === 'Entrada' ? t : g === 'Salida' ? 1 + t * 0.999 : t * 2 * 0.999;
    await this.comp.render(m, comp, time, out, { scale: 1, preview: true, exact: true });
  }

  // ---------------------------------------------------------------- aplicar

  private applyFilter(f: FilterDef) {
    const sel = this.targets();
    if (!sel.length) return;
    this.s.edit(`Filtro ${f.label}`, (_m, comp) => {
      for (const c of comp.clips) if (sel.some(x => x.id === c.id)) for (const x of f.fx) {
        const def = EFFECTS.find(e => e.id === x.fx);
        if (!def) continue;
        const vals = { ...defaults(def), ...x.p };
        c.fx.push({ id: mid('fx'), fx: def.id, on: true, p: Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, prop(v)])) } as FxInst);
      }
    });
    toast(`Filtro «${f.label}» aplicado`, 'ok');
  }
  private applyEffect(id: string) {
    const sel = this.targets();
    if (!sel.length) return;
    const def = EFFECTS.find(e => e.id === id)!;
    this.s.edit(`Efecto ${def.label}`, (_m, comp) => {
      for (const c of comp.clips) if (sel.some(x => x.id === c.id)) c.fx.push({ id: mid('fx'), fx: id, on: true, p: Object.fromEntries(Object.entries(defaults(def)).map(([k, v]) => [k, prop(v)])) } as FxInst);
    });
    toast(`«${def.label}» añadido (ajústalo en la pestaña Efectos del clip)`, 'ok');
  }
  private applyTransition(id: TransitionType) {
    const sel = this.targets();
    if (!sel.length) return;
    this.s.edit(id === 'none' ? 'Quitar transición' : 'Transición', (_m, comp) => {
      for (const c of comp.clips) if (sel.some(x => x.id === c.id)) {
        const d = Math.min(0.6, c.dur / 2);
        if (this.side !== 'out') c.tin = { type: id, dur: c.tin.type === 'none' ? d : c.tin.dur };
        if (this.side !== 'in') c.tout = { type: id, dur: c.tout.type === 'none' ? d : c.tout.dur };
      }
    });
    if (id !== 'none') toast(`Transición aplicada (${this.side === 'in' ? 'entrada' : this.side === 'out' ? 'salida' : 'entrada y salida'})`, 'ok');
  }
  private applyAnim(id: MotionPreset, label: string) {
    const sel = this.targets();
    if (!sel.length) return;
    const len = this.s.presetLen;
    this.s.edit(`Animación ${label}`, (_m, comp) => { for (const c of comp.clips) if (sel.some(x => x.id === c.id)) applyPreset(c.tf, id, c.dur, Math.min(len, c.dur), comp.w, comp.h); });
    toast(`Animación «${label}» aplicada`, 'ok');
  }
}

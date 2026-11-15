import type { FingerMode } from '../engine/CanvasEngine';
import type { CanvasEngine } from '../engine';
import type { ToolManager } from '../tools/ToolManager';
import type { Prop } from '../tools/types';
import { h } from './dom';

type SliderProp = Extract<Prop, { type: 'slider' }>;

/* =================== Preferencias táctiles =================== */

export interface TouchPrefs {
  /** Qué hace un dedo en el lienzo. */
  finger: FingerMode;
  /** Mantener pulsado / botón del lápiz = cuentagotas. */
  hold: boolean;
  /** Deslizadores rápidos de tamaño y opacidad junto al lienzo. */
  sliders: boolean;
  sliderSide: 'left' | 'right';
}

export const DEFAULT_TOUCH: TouchPrefs = { finger: 'auto', hold: true, sliders: true, sliderSide: 'left' };

export function normalizeTouch(v: unknown): TouchPrefs {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<TouchPrefs>;
  return {
    finger: o.finger === 'draw' || o.finger === 'navigate' ? o.finger : 'auto',
    hold: o.hold !== false,
    sliders: o.sliders !== false,
    sliderSide: o.sliderSide === 'right' ? 'right' : 'left',
  };
}

/* =================== Tipo de dispositivo =================== */

/**
 * Clases en <html>:
 * - `touch`: el puntero principal es un dedo (objetivos táctiles grandes).
 * - `phone`: pantalla táctil cuyo lado corto mide menos de 600 px CSS (teléfono).
 * Se recalculan al girar la pantalla. `?phone` en la URL fuerza el modo teléfono.
 */
export function watchDevice(onChange?: () => void) {
  const coarse = matchMedia('(pointer: coarse)');
  const force = new URLSearchParams(location.search).has('phone');
  const apply = () => {
    const root = document.documentElement;
    const touch = force || coarse.matches || navigator.maxTouchPoints > 0 && !matchMedia('(pointer: fine)').matches;
    const phone = force || (touch && Math.min(innerWidth, innerHeight) < 600);
    const changed = root.classList.contains('phone') !== phone || root.classList.contains('touch') !== touch;
    root.classList.toggle('touch', touch);
    root.classList.toggle('phone', phone);
    if (changed) onChange?.();
  };
  apply();
  addEventListener('resize', apply);
  coarse.addEventListener?.('change', apply);
}

export const isPhone = () => document.documentElement.classList.contains('phone');
export const isTouch = () => document.documentElement.classList.contains('touch');

/* =================== Deslizadores rápidos =================== */

/**
 * Dos deslizadores verticales junto al borde del lienzo, para el pulgar:
 * tamaño y opacidad de la herramienta activa. Usan las mismas propiedades
 * que la barra de propiedades (no hay ajustes duplicados).
 */
export class QuickSliders {
  readonly el: HTMLElement;
  private dragging = false;

  constructor(private mgr: ToolManager, private prefs: () => TouchPrefs) {
    this.el = h('div', { class: 'quick-sliders', 'aria-label': 'Tamaño y opacidad', 'data-ui': '' });
    mgr.on('tool', () => this.render());
    mgr.on('props', () => { if (!this.dragging) this.render(); });
    this.render();
  }

  private find(label: string): SliderProp | null {
    const props = this.mgr.current.props?.(this.mgr.ctx) ?? [];
    return (props.find(p => p.type === 'slider' && p.label === label) as SliderProp | undefined) ?? null;
  }

  render() {
    const p = this.prefs();
    const size = this.find('Tamaño'), opacity = this.find('Opacidad');
    this.el.hidden = !p.sliders || (!size && !opacity);
    this.el.classList.toggle('right', p.sliderSide === 'right');
    const parts: HTMLElement[] = [];
    if (size) parts.push(this.slider(size, 'Tamaño'));
    if (opacity) parts.push(this.slider(opacity, 'Opacidad'));
    this.el.replaceChildren(...parts);
  }

  private slider(prop: SliderProp, label: string) {
    // Posición 0..1 ↔ valor (logarítmica si la propiedad lo es, como el tamaño del pincel).
    const lo = prop.log ? Math.log(Math.max(prop.min, 1e-3)) : prop.min, hi = prop.log ? Math.log(prop.max) : prop.max;
    const toPos = (v: number) => ((prop.log ? Math.log(Math.max(v, 1e-3)) : v) - lo) / (hi - lo);
    const step = prop.step ?? 0;
    const fromPos = (t: number) => {
      let v = lo + Math.min(1, Math.max(0, t)) * (hi - lo);
      if (prop.log) v = Math.exp(v);
      if (step) v = Math.round(v / step) * step;
      return Math.min(prop.max, Math.max(prop.min, +v.toFixed(4)));
    };
    const show = (v: number) => {
      const x = v * (prop.display ?? 1);
      return `${Math.abs(x) >= 10 || Number.isInteger(x) ? Math.round(x) : x.toFixed(1)}${prop.unit === 'px' ? ' px' : prop.unit ?? ''}`;
    };
    let value = prop.value;
    const fill = h('span', { class: 'qs-fill' });
    const bubble = h('span', { class: 'qs-bubble', 'aria-hidden': 'true' });
    const track = h('div', {
      class: 'qs-track', role: 'slider', tabindex: '0', 'aria-label': label, 'aria-orientation': 'vertical',
      'aria-valuemin': String(prop.min), 'aria-valuemax': String(prop.max),
    }, fill, bubble);
    const paint = () => {
      const t = toPos(value);
      track.style.setProperty('--t', String(t));
      track.setAttribute('aria-valuenow', String(value));
      track.setAttribute('aria-valuetext', show(value));
      bubble.textContent = show(value);
    };
    paint();
    // Arrastre relativo: el valor no salta al tocar, se mueve con el dedo (como en las apps de dibujo).
    let start: { y: number; t: number; id: number } | null = null;
    track.addEventListener('pointerdown', e => {
      e.preventDefault();
      track.setPointerCapture(e.pointerId);
      start = { y: e.clientY, t: toPos(value), id: e.pointerId };
      this.dragging = true;
      track.classList.add('active');
    });
    track.addEventListener('pointermove', e => {
      if (!start || e.pointerId !== start.id) return;
      const hgt = track.getBoundingClientRect().height || 1;
      const v = fromPos(start.t + (start.y - e.clientY) / hgt);
      if (v !== value) { value = v; paint(); prop.onInput(v); }
    });
    const end = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      start = null;
      this.dragging = false;
      track.classList.remove('active');
      prop.onChange?.(value);
    };
    track.addEventListener('pointerup', end);
    track.addEventListener('pointercancel', end);
    track.addEventListener('keydown', e => {
      const d = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 0.02 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -0.02 : 0;
      if (!d) return;
      e.preventDefault(); e.stopPropagation();
      value = fromPos(toPos(value) + d); paint(); prop.onInput(value); prop.onChange?.(value);
    });
    return h('div', { class: 'qs' }, track, h('span', { class: 'qs-label' }, label === 'Tamaño' ? 'Tam.' : 'Opac.'));
  }
}

/* =================== Hoja inferior genérica =================== */

/** Hoja que sube desde abajo en el teléfono (diálogo centrado en pantallas grandes). Esc/Atrás la cierra. */
export function openSheet(title: string, build: (close: () => void) => HTMLElement[]) {
  const prev = document.activeElement as HTMLElement | null;
  const close = () => { root.remove(); prev?.focus?.(); };
  const root = h('div', {
    class: 'dialog-backdrop sheet-backdrop',
    on: {
      keydown: (e: Event) => { e.stopPropagation(); if ((e as KeyboardEvent).key === 'Escape') close(); },
      pointerdown: (e: Event) => { if (e.target === root) close(); },
    },
  });
  const sheet = h('div', { class: 'dialog sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabindex: '-1' },
    h('div', { class: 'sheet-grip', 'aria-hidden': 'true' }),
    h('div', { class: 'dialog-head' }, h('h2', null, title), h('button', { type: 'button', class: 'btn sm ghost', on: { click: close } }, 'Cerrar')),
    ...build(close));
  root.append(sheet);
  document.body.append(root);
  sheet.focus();
  dragToClose(sheet, sheet.querySelector('.sheet-grip')!, close);
  return close;
}

/** Deslizar hacia abajo desde el asa cierra la hoja. */
export function dragToClose(sheet: HTMLElement, handle: HTMLElement, close: () => void) {
  let y0 = 0, id = -1;
  handle.addEventListener('pointerdown', e => { id = e.pointerId; y0 = e.clientY; handle.setPointerCapture(id); sheet.style.transition = 'none'; });
  handle.addEventListener('pointermove', e => {
    if (e.pointerId !== id) return;
    sheet.style.transform = `translateY(${Math.max(0, e.clientY - y0)}px)`;
  });
  const up = (e: PointerEvent) => {
    if (e.pointerId !== id) return;
    id = -1;
    sheet.style.transition = '';
    sheet.style.transform = '';
    if (e.clientY - y0 > 70) close();
  };
  handle.addEventListener('pointerup', up);
  handle.addEventListener('pointercancel', up);
}

/* =================== Menú «Más» =================== */

export interface MoreDeps {
  engine: CanvasEngine;
  prefs: () => TouchPrefs;
  setPrefs: (p: TouchPrefs) => void;
  openCustomize: () => void;
  openShortcuts: () => void;
}

/** Vista, entrada táctil y ajustes que en el teléfono no caben en la barra superior. */
export function openMore({ engine, prefs, setPrefs, openCustomize, openShortcuts }: MoreDeps) {
  openSheet('Más opciones', close => {
    const p = prefs();
    const seg = <T extends string>(label: string, value: T, options: [T, string][], set: (v: T) => void) =>
      h('div', { class: 'ctl' }, h('span', { class: 'ctl-label' }, label),
        h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': label }, ...options.map(([v, l]) => h('button', {
          type: 'button', role: 'radio', 'aria-checked': String(v === value),
          on: { click: (e: Event) => { set(v); const g = (e.currentTarget as HTMLElement).parentElement!; g.querySelectorAll('button').forEach(b => b.setAttribute('aria-checked', String(b === e.currentTarget))); } },
        }, l))));
    const sw = (label: string, value: boolean, set: (v: boolean) => void) => {
      const input = h('input', { type: 'checkbox', checked: value });
      input.addEventListener('change', () => set(input.checked));
      return h('label', { class: 'switch' }, input, h('span', { class: 'track' }), h('span', null, label));
    };
    const viewBtn = (label: string, run: () => void) => h('button', { type: 'button', class: 'btn', on: { click: run } }, label);
    const fingerHelp: Record<FingerMode, string> = {
      auto: 'El dedo dibuja hasta que uses un lápiz; desde entonces el dedo sólo navega y la palma no pinta.',
      draw: 'El dedo siempre dibuja. Dos dedos mueven, amplían y giran.',
      navigate: 'Un dedo mueve el lienzo; dibuja con el lápiz. Ideal con S Pen o lápiz activo.',
    };
    const help = h('p', { class: 'ctl-help' }, fingerHelp[p.finger]);
    return [
      h('section', { class: 'sheet-sec' }, h('h3', null, 'Vista'),
        h('div', { class: 'sheet-row' },
          viewBtn('Encajar', () => engine.fit()), viewBtn('100 %', () => engine.zoomTo(1)),
          viewBtn('↺ 15°', () => engine.rotateBy(-15)), viewBtn('↻ 15°', () => engine.rotateBy(15)), viewBtn('Enderezar', () => engine.setRotation(0)))),
      h('section', { class: 'sheet-sec' }, h('h3', null, 'Dedo y lápiz'),
        seg('El dedo…', p.finger, [['auto', 'Automático'], ['draw', 'Dibuja'], ['navigate', 'Sólo navega']], v => { setPrefs({ ...prefs(), finger: v }); help.textContent = fingerHelp[v]; }),
        help,
        sw('Mantener pulsado para tomar color', p.hold, v => setPrefs({ ...prefs(), hold: v })),
        sw('Deslizadores de tamaño y opacidad', p.sliders, v => setPrefs({ ...prefs(), sliders: v })),
        seg('Lado de los deslizadores', p.sliderSide, [['left', 'Izquierda'], ['right', 'Derecha']], v => setPrefs({ ...prefs(), sliderSide: v }))),
      h('section', { class: 'sheet-sec' }, h('h3', null, 'Gestos'),
        h('ul', { class: 'gesture-list' },
          h('li', null, h('b', null, 'Dos dedos'), ' mover, ampliar y girar'),
          h('li', null, h('b', null, 'Toque con dos dedos'), ' deshacer'),
          h('li', null, h('b', null, 'Toque con tres dedos'), ' rehacer'),
          h('li', null, h('b', null, 'Mantener pulsado'), ' cuentagotas (arrastra para afinar)'),
          h('li', null, h('b', null, 'Botón del lápiz'), ' cuentagotas · ', h('b', null, 'extremo borrador'), ' borra'))),
      h('section', { class: 'sheet-sec' }, h('h3', null, 'Interfaz'),
        h('div', { class: 'sheet-row' },
          viewBtn('Personalizar barra', () => { close(); openCustomize(); }),
          viewBtn('Atajos de teclado', () => { close(); openShortcuts(); }))),
    ];
  });
}

/* =================== Botón Atrás =================== */

/**
 * Cierra lo que esté encima (diálogo, editor, menú, panel). Devuelve false si
 * no había nada que cerrar (entonces Android sale de la app).
 */
export function closeTopOverlay(): boolean {
  const open = [...document.querySelectorAll<HTMLElement>('.studio-backdrop, .dialog-backdrop, .popover, .menu')]
    .filter(el => !el.hidden && el.getClientRects().length > 0);
  const top = open[open.length - 1];
  if (top) {
    top.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    return true;
  }
  if (document.body.classList.contains('panel-open')) { document.body.classList.remove('panel-open'); document.getElementById('panel-toggle')?.setAttribute('aria-expanded', 'false'); return true; }
  return false;
}

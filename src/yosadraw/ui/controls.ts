import { DEFAULT_PRESET, getPath, type BrushPreset } from '../brush/BrushPreset';
import { fileToDataUrl } from '../brush/ImageStore';
import { GRAIN_OPTIONS, SHAPE_OPTIONS, type Control } from '../brush/schema';
import { CurveEditor } from './CurveEditor';
import { h, pickFiles, toast } from './dom';

export interface ControlContext {
  draft: BrushPreset;
  set: (path: string, value: unknown) => void;
  categories: () => string[];
  tipPreview: (shape: BrushPreset['tip']['shape']) => HTMLCanvasElement | null;
  grainPreview: (type: BrushPreset['grain']['type']) => HTMLCanvasElement | null;
}

export interface BuiltControl { el: HTMLElement; sync(): void; curve?: CurveEditor }

const fmt = (v: number, unit = '', display = 1) => {
  const x = v * display;
  const s = Math.abs(x) >= 100 || Number.isInteger(x) ? Math.round(x).toString() : Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2).replace(/\.?0+$/, '');
  return unit ? `${s}${unit === 'px' ? ' px' : unit}` : s;
};

let uid = 0;

/** Construye el control descrito en el esquema, enlazado al borrador del pincel. */
export function buildControl(c: Control, ctx: ControlContext): BuiltControl {
  const id = `ctl-${c.path.replace(/\./g, '-')}-${++uid}`;
  const help = 'help' in c && c.help ? h('p', { class: 'ctl-help', id: `${id}-help` }, c.help) : null;
  const describedBy = help ? `${id}-help` : undefined;

  if (c.type === 'slider') {
    const display = c.display ?? 1;
    const LOG = 1000;
    const toSlider = (v: number) => c.log ? Math.round((Math.log(v / c.min) / Math.log(c.max / c.min)) * LOG) : v;
    const fromSlider = (s: number) => c.log ? c.min * Math.pow(c.max / c.min, s / LOG) : s;
    const range = h('input', { type: 'range', id, min: String(c.log ? 0 : c.min), max: String(c.log ? LOG : c.max), step: c.log ? '1' : String(c.step ?? 0.01), 'aria-describedby': describedBy });
    const num = h('input', { type: 'text', inputmode: 'decimal', class: 'ctl-num', 'aria-label': `${c.label} (valor)` });
    const def = getPath(DEFAULT_PRESET, c.path) as number;
    const sync = () => {
      const v = getPath(ctx.draft, c.path) as number;
      range.value = String(toSlider(v));
      const f = c.log ? toSlider(v) / LOG : (v - c.min) / (c.max - c.min);
      range.style.setProperty('--fill', `${f * 100}%`);
      range.style.setProperty('--from', c.signed ? `${((0 - c.min) / (c.max - c.min)) * 100}%` : '0%');
      if (document.activeElement !== num) num.value = fmt(v, c.unit, display);
    };
    const commit = (v: number) => {
      const step = c.step ?? 0.01;
      v = Math.min(c.max, Math.max(c.min, Math.round(v / step) * step));
      ctx.set(c.path, Number(v.toFixed(6)));
      sync();
    };
    range.addEventListener('input', () => commit(fromSlider(Number(range.value))));
    num.addEventListener('change', () => {
      const n = parseFloat(num.value.replace(',', '.'));
      if (Number.isFinite(n)) commit(n / display); else sync();
    });
    num.addEventListener('blur', sync);
    num.addEventListener('keydown', e => { if (e.key === 'Enter') num.blur(); });
    const label = h('label', { for: id, title: 'Doble clic para volver al valor por defecto' }, c.label);
    label.addEventListener('dblclick', () => commit(def));
    sync();
    return { el: h('div', { class: 'ctl ctl-slider' }, h('div', { class: 'ctl-row' }, label, num), range, help), sync };
  }

  if (c.type === 'toggle') {
    const input = h('input', { type: 'checkbox', id, 'aria-describedby': describedBy });
    input.addEventListener('change', () => ctx.set(c.path, input.checked));
    const sync = () => { input.checked = !!getPath(ctx.draft, c.path); };
    sync();
    return { el: h('div', { class: 'ctl ctl-toggle' }, h('label', { for: id, class: 'switch' }, input, h('span', { class: 'track', 'aria-hidden': 'true' }), h('span', null, c.label)), help), sync };
  }

  if (c.type === 'select') {
    const sel = h('select', { id, 'aria-describedby': describedBy }, ...c.options.map(o => h('option', { value: o.value }, o.label)));
    sel.addEventListener('change', () => ctx.set(c.path, sel.value));
    const sync = () => { sel.value = String(getPath(ctx.draft, c.path)); };
    sync();
    return { el: h('div', { class: 'ctl' }, h('label', { for: id, class: 'ctl-label' }, c.label), sel, help), sync };
  }

  if (c.type === 'segmented') {
    const btns = c.options.map(o => h('button', { type: 'button', role: 'radio', dataset: { v: o.value }, on: { click: () => ctx.set(c.path, o.value) } }, o.label));
    const sync = () => { const v = String(getPath(ctx.draft, c.path)); btns.forEach(b => b.setAttribute('aria-checked', String(b.dataset.v === v))); };
    sync();
    return { el: h('div', { class: 'ctl' }, h('span', { class: 'ctl-label', id }, c.label), h('div', { class: 'segmented', role: 'radiogroup', 'aria-labelledby': id }, ...btns), help), sync };
  }

  if (c.type === 'text') {
    const listId = c.list ? `${id}-list` : undefined;
    const input = h('input', { type: 'text', id, maxlength: String(c.max), list: listId, autocomplete: 'off' });
    input.addEventListener('input', () => { if (input.value.trim()) ctx.set(c.path, input.value); });
    const sync = () => { if (document.activeElement !== input) input.value = String(getPath(ctx.draft, c.path)); };
    sync();
    const list = listId ? h('datalist', { id: listId }, ...ctx.categories().map(cat => h('option', { value: cat }))) : null;
    return { el: h('div', { class: 'ctl' }, h('label', { for: id, class: 'ctl-label' }, c.label), input, list), sync };
  }

  if (c.type === 'curve') {
    const ed = new CurveEditor(getPath(ctx.draft, c.path) as BrushPreset['pressure']['curve'], pts => ctx.set(c.path, pts));
    const reset = h('button', { type: 'button', class: 'link', on: { click: () => { ctx.set(c.path, DEFAULT_PRESET.pressure.curve); ed.set(DEFAULT_PRESET.pressure.curve); } } }, 'Restablecer curva lineal');
    return { el: h('div', { class: 'ctl' }, h('div', { class: 'ctl-row' }, h('span', { class: 'ctl-label' }, c.label), reset), ed.el, help), sync: () => ed.set(getPath(ctx.draft, c.path) as BrushPreset['pressure']['curve']), curve: ed };
  }

  if (c.type === 'image') {
    const img = h('img', { alt: '', class: 'img-thumb' });
    const choose = h('button', { type: 'button', class: 'btn', on: { click: async () => {
      const [file] = await pickFiles('image/png,image/jpeg,image/webp');
      if (!file) return;
      try { ctx.set(c.path, await fileToDataUrl(file)); sync(); toast('Imagen cargada', 'ok'); }
      catch (e) { toast(e instanceof Error ? e.message : 'No se pudo leer la imagen', 'error'); }
    } } }, 'Elegir imagen…');
    const sync = () => { const v = getPath(ctx.draft, c.path) as string | undefined; img.hidden = !v; if (v) img.src = v; };
    sync();
    return { el: h('div', { class: 'ctl' }, h('span', { class: 'ctl-label' }, c.label), h('div', { class: 'img-pick' }, img, choose), help), sync };
  }

  if (c.type === 'shapes' || c.type === 'grains') {
    const opts = c.type === 'shapes' ? SHAPE_OPTIONS : GRAIN_OPTIONS;
    const btns = opts.map(o => {
      const prev = c.type === 'shapes' ? ctx.tipPreview(o.value as BrushPreset['tip']['shape']) : ctx.grainPreview(o.value as BrushPreset['grain']['type']);
      return h('button', { type: 'button', role: 'radio', class: 'tile', dataset: { v: o.value }, on: { click: () => ctx.set(c.path, o.value) } },
        prev ?? h('span', { class: 'tile-ph', 'aria-hidden': 'true' }, '＋'), h('span', null, o.label));
    });
    const sync = () => { const v = String(getPath(ctx.draft, c.path)); btns.forEach(b => b.setAttribute('aria-checked', String(b.dataset.v === v))); };
    sync();
    return { el: h('div', { class: 'ctl' }, h('span', { class: 'ctl-label', id }, c.label), h('div', { class: 'tiles', role: 'radiogroup', 'aria-labelledby': id }, ...btns)), sync };
  }

  throw new Error('Control desconocido');
}

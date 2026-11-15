import type { DocProfile } from '../doc/Document';
import { MAX_DOC_SIDE } from '../project/format';
import { docSizeProblem, type NewProjectSpec } from '../project/session';
import { h } from './dom';

export interface Template { id: string; label: string; sub: string; width: number; height: number; dpi: number; background?: string | null }

/** Plantillas habituales (tamaños reales de pantalla e impresión). */
export const TEMPLATES: Template[] = [
  { id: 'phone', label: 'Pantalla del móvil', sub: '1080 × 1920 · 72 ppp', width: 1080, height: 1920, dpi: 72 },
  { id: 'square', label: 'Cuadrado', sub: '2048 × 2048 · 300 ppp', width: 2048, height: 2048, dpi: 300 },
  { id: 'a4', label: 'A4 vertical', sub: '210 × 297 mm · 300 ppp', width: 2480, height: 3508, dpi: 300 },
  { id: 'a5', label: 'A5 vertical', sub: '148 × 210 mm · 300 ppp', width: 1748, height: 2480, dpi: 300 },
  { id: 'letter', label: 'Carta', sub: '8,5 × 11 in · 300 ppp', width: 2550, height: 3300, dpi: 300 },
  { id: 'comic', label: 'Página de cómic B5', sub: '182 × 257 mm · 350 ppp', width: 2508, height: 3541, dpi: 350 },
  { id: 'post', label: 'Publicación 4:5', sub: '1080 × 1350 · 72 ppp', width: 1080, height: 1350, dpi: 72 },
  { id: 'wide', label: 'Panorámico 4K', sub: '3840 × 2160 · 72 ppp', width: 3840, height: 2160, dpi: 72 },
  { id: 'illus', label: 'Ilustración 4:3', sub: '4096 × 3072 · 300 ppp', width: 4096, height: 3072, dpi: 300 },
  { id: 'icon', label: 'Icono', sub: '1024 × 1024 · 72 ppp', width: 1024, height: 1024, dpi: 72, background: null },
];

const cm = (px: number, dpi: number) => ((px / dpi) * 2.54).toFixed(1).replace('.', ',');

/**
 * Ventana «Nuevo proyecto»: nombre, ancho, alto, DPI, fondo blanco o
 * transparente, perfil de color y plantillas. Devuelve la especificación o null.
 */
export function openNewProject(defaultName: string, last: Partial<NewProjectSpec> | null): Promise<NewProjectSpec | null> {
  return new Promise(resolve => {
    const spec: NewProjectSpec = {
      name: defaultName, width: last?.width ?? 2048, height: last?.height ?? 2048, dpi: last?.dpi ?? 300,
      background: last?.background === null ? null : '#ffffff', profile: last?.profile ?? 'srgb',
    };
    const prev = document.activeElement as HTMLElement | null;
    let done = false;
    const finish = (v: NewProjectSpec | null) => { if (done) return; done = true; root.remove(); prev?.focus?.(); resolve(v); };

    const nameIn = h('input', { type: 'text', value: spec.name, maxlength: '120', spellcheck: 'false', autocomplete: 'off', id: 'np-name' });
    const wIn = h('input', { type: 'number', min: '16', max: String(MAX_DOC_SIDE), value: String(spec.width), id: 'np-w', inputmode: 'numeric', 'aria-label': 'Ancho en píxeles' });
    const hIn = h('input', { type: 'number', min: '16', max: String(MAX_DOC_SIDE), value: String(spec.height), id: 'np-h', inputmode: 'numeric', 'aria-label': 'Alto en píxeles' });
    const dpiIn = h('input', { type: 'number', min: '1', max: '2400', value: String(spec.dpi), id: 'np-dpi', inputmode: 'numeric', 'aria-label': 'Resolución en ppp' });
    const info = h('p', { class: 'np-info' });
    const warn = h('p', { class: 'ex-warn', hidden: true });
    const createBtn = h('button', { type: 'button', class: 'btn primary' }, 'Crear proyecto');
    const preview = h('div', { class: 'np-preview' }, h('div', { class: 'np-paper' }));

    const seg = <T extends string | null>(label: string, value: T, opts: [T, string][], set: (v: T) => void) => {
      const g = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': label });
      for (const [v, l] of opts) g.append(h('button', { type: 'button', role: 'radio', 'aria-checked': String(v === value), on: { click: () => { set(v); g.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-checked', String(opts[i][0] === v))); sync(); } } }, l));
      return h('div', { class: 'np-field' }, h('span', { class: 'ex-label' }, label), g);
    };

    const tplButtons = TEMPLATES.map(t => {
      const k = 34 / Math.max(t.width, t.height);
      return h('button', { type: 'button', class: 'np-tpl', role: 'radio', 'aria-checked': 'false', dataset: { tpl: t.id }, on: { click: () => applyTemplate(t) } },
        h('span', { class: 'np-shape', style: { width: `${Math.round(t.width * k)}px`, height: `${Math.round(t.height * k)}px` } }),
        h('span', { class: 'np-tpl-text' }, h('strong', null, t.label), h('span', null, t.sub)));
    });
    const markTemplate = () => tplButtons.forEach((b, i) => { const t = TEMPLATES[i]; b.setAttribute('aria-checked', String(t.width === spec.width && t.height === spec.height && t.dpi === spec.dpi)); });
    function applyTemplate(t: Template) {
      spec.width = t.width; spec.height = t.height; spec.dpi = t.dpi;
      if (t.background !== undefined) { spec.background = t.background; bgSeg.replaceWith(bgSeg = bgControl()); }
      wIn.value = String(t.width); hIn.value = String(t.height); dpiIn.value = String(t.dpi);
      sync();
    }
    const bgControl = () => seg<string | null>('Fondo', spec.background, [['#ffffff', 'Blanco'], [null, 'Transparente']], v => { spec.background = v; });
    let bgSeg = bgControl();

    function sync() {
      spec.name = nameIn.value;
      spec.width = Math.round(Number(wIn.value));
      spec.height = Math.round(Number(hIn.value));
      spec.dpi = Math.min(2400, Math.max(1, Math.round(Number(dpiIn.value) || 72)));
      const problem = docSizeProblem(spec.width, spec.height);
      warn.hidden = !problem;
      warn.textContent = problem ?? '';
      createBtn.disabled = !!problem;
      if (!problem) {
        const mp = (spec.width * spec.height) / 1e6;
        info.textContent = `${spec.width} × ${spec.height} px · ${mp.toFixed(1).replace('.', ',')} MP · impreso a ${spec.dpi} ppp: ${cm(spec.width, spec.dpi)} × ${cm(spec.height, spec.dpi)} cm`;
        const k = 120 / Math.max(spec.width, spec.height);
        const paper = preview.firstElementChild as HTMLElement;
        paper.style.width = `${Math.max(8, spec.width * k)}px`;
        paper.style.height = `${Math.max(8, spec.height * k)}px`;
        paper.classList.toggle('transparent', spec.background === null);
      }
      markTemplate();
    }
    for (const el of [nameIn, wIn, hIn, dpiIn]) el.addEventListener('input', sync);
    const swap = h('button', { type: 'button', class: 'icon sm np-swap', title: 'Girar orientación', 'aria-label': 'Intercambiar ancho y alto', html: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4v14M3.5 7.5 7 4l3.5 3.5M17 20V6M20.5 16.5 17 20l-3.5-3.5"/></svg>', on: { click: () => { const w = wIn.value; wIn.value = hIn.value; hIn.value = w; sync(); } } });

    createBtn.addEventListener('click', () => { sync(); if (!createBtn.disabled) finish({ ...spec, name: spec.name.trim() || defaultName }); });
    const form = h('div', { class: 'np-form' },
      h('label', { class: 'np-field' }, h('span', { class: 'ex-label' }, 'Nombre'), nameIn),
      h('div', { class: 'np-field' }, h('span', { class: 'ex-label' }, 'Tamaño (píxeles)'),
        h('div', { class: 'np-dims' }, h('label', null, h('span', null, 'Ancho'), wIn), swap, h('label', null, h('span', null, 'Alto'), hIn), h('label', null, h('span', null, 'Resolución (ppp)'), dpiIn))),
      h('div', { class: 'np-summary' }, preview, info),
      warn,
      bgSeg,
      seg<DocProfile>('Perfil de color', spec.profile, [['srgb', 'sRGB'], ['p3', 'Display P3'], ['gray', 'Escala de grises']], v => { spec.profile = v; }),
      h('p', { class: 'ctl-help' }, 'El perfil se aplica al exportar (y se incrusta en el archivo). Puedes dibujar en color y exportar en grises.'));

    const root = h('div', { class: 'dialog-backdrop modal-backdrop np-backdrop', on: { keydown: (e: Event) => { e.stopPropagation(); const k = (e as KeyboardEvent).key; if (k === 'Escape') finish(null); if (k === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') createBtn.click(); }, pointerdown: (e: Event) => { if (e.target === root) finish(null); } } },
      h('div', { class: 'dialog modal new-project', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'np-title' },
        h('div', { class: 'dialog-head' }, h('h2', { id: 'np-title' }, 'Nuevo proyecto'), h('button', { type: 'button', class: 'btn sm ghost', on: { click: () => finish(null) } }, 'Cerrar')),
        h('div', { class: 'np-body' },
          h('section', { class: 'np-templates', 'aria-label': 'Plantillas' }, h('h3', null, 'Plantillas'), h('div', { class: 'np-tpl-list', role: 'radiogroup', 'aria-label': 'Plantillas' }, ...tplButtons)),
          form),
        h('div', { class: 'dialog-actions' }, h('button', { type: 'button', class: 'btn ghost', on: { click: () => finish(null) } }, 'Cancelar'), createBtn)));
    document.body.append(root);
    sync();
    requestAnimationFrame(() => { nameIn.focus(); nameIn.select(); });
  });
}

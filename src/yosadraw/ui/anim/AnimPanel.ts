import type { LayerBlend as BlendMode } from '../../doc/items';
import { clipSpan } from '../../anim/audio';
import * as M from '../../anim/model';
import { h, toast } from '../dom';
import { promptText } from '../modal';
import type { AnimStudio } from './AnimStudio';

const num = (label: string, value: number, o: { min?: number; max?: number; step?: number; unit?: string }, set: (v: number) => void) => {
  const input = h('input', { type: 'number', value: String(+value.toFixed(3)), min: o.min !== undefined ? String(o.min) : undefined, max: o.max !== undefined ? String(o.max) : undefined, step: String(o.step ?? 1), 'aria-label': label });
  input.addEventListener('change', () => { const v = Number(input.value); if (Number.isFinite(v)) set(v); });
  return h('label', { class: 'ap-field' }, h('span', null, label), h('span', { class: 'ap-num' }, input, o.unit ? h('small', null, o.unit) : null));
};
const sw = (label: string, value: boolean, set: (v: boolean) => void, title?: string) => {
  const input = h('input', { type: 'checkbox', checked: value });
  input.addEventListener('change', () => set(input.checked));
  return h('label', { class: 'switch ap-switch', title: title ?? '' }, input, h('span', { class: 'track' }), h('span', null, label));
};
const range = (label: string, value: number, o: { min: number; max: number; step: number; fmt: (v: number) => string }, set: (v: number) => void, live?: (v: number) => void) => {
  const out = h('output', null, o.fmt(value));
  const input = h('input', { type: 'range', min: String(o.min), max: String(o.max), step: String(o.step), value: String(value), 'aria-label': label });
  const fill = () => input.style.setProperty('--fill', `${((Number(input.value) - o.min) / (o.max - o.min)) * 100}%`);
  fill();
  input.addEventListener('input', () => { fill(); out.textContent = o.fmt(Number(input.value)); live?.(Number(input.value)); });
  input.addEventListener('change', () => set(Number(input.value)));
  return h('div', { class: 'ctl' }, h('div', { class: 'ctl-row' }, h('span', { class: 'ctl-label' }, label), out), input);
};
const sec = (title: string, ...kids: (Node | null)[]) => h('section', { class: 'ap-sec' }, h('h3', null, title), ...kids);
const btn = (label: string, run: () => void, cls = 'btn sm') => h('button', { type: 'button', class: cls, on: { click: run } }, label);

/** Ajustes del papel cebolla (popover). */
export function onionPopover(s: AnimStudio, anchor: HTMLElement) {
  document.querySelector('.popover.ap-onion')?.remove();
  const a = s.anim;
  if (!a) return;
  const o = a.onion;
  const set = (patch: Partial<M.OnionSettings>) => s.run(() => M.cmdAnimSettings(s.doc, { onion: patch }, 'Papel cebolla'));
  const color = (label: string, value: string, key: 'colorBefore' | 'colorAfter') => {
    const input = h('input', { type: 'color', value, 'aria-label': label });
    input.addEventListener('change', () => set({ [key]: input.value }));
    return h('label', { class: 'ap-field' }, h('span', null, label), input);
  };
  const close = () => { pop.remove(); removeEventListener('pointerdown', outside, true); };
  const outside = (e: Event) => { if (!pop.contains(e.target as Node) && e.target !== anchor) close(); };
  const pop = h('div', { class: 'popover ap-onion', role: 'dialog', 'aria-label': 'Papel cebolla', on: { keydown: (e: Event) => { if ((e as KeyboardEvent).key === 'Escape') { e.stopPropagation(); close(); } } } },
    h('strong', null, 'Papel cebolla'),
    sw('Activado', o.enabled, v => set({ enabled: v })),
    h('div', { class: 'ap-row2' }, num('Anteriores', o.before, { min: 0, max: 10 }, v => set({ before: Math.round(Math.max(0, Math.min(10, v))) })), num('Siguientes', o.after, { min: 0, max: 10 }, v => set({ after: Math.round(Math.max(0, Math.min(10, v))) }))),
    range('Opacidad', o.opacity, { min: 0.05, max: 1, step: 0.01, fmt: v => `${Math.round(v * 100)} %` }, v => set({ opacity: v })),
    range('Atenuación por paso', o.falloff, { min: 0.1, max: 1, step: 0.01, fmt: v => `× ${v.toFixed(2)}` }, v => set({ falloff: v })),
    h('div', { class: 'ap-row2' }, color('Antes', o.colorBefore, 'colorBefore'), color('Después', o.colorAfter, 'colorAfter')),
    sw('Teñir con el color', o.tint, v => set({ tint: v })),
    sw('En todas las pistas animadas', o.allTracks, v => set({ allTracks: v })),
    h('p', { class: 'ctl-help' }, 'Muestra los dibujos anteriores y siguientes (no los fotogramas repetidos) de la pista activa.'));
  document.body.append(pop);
  const r = anchor.getBoundingClientRect(), pr = pop.getBoundingClientRect();
  pop.style.left = `${Math.max(8, Math.min(innerWidth - pr.width - 8, r.left))}px`;
  pop.style.top = `${Math.max(8, r.top - pr.height - 8)}px`;
  addEventListener('pointerdown', outside, true);
}

/** Calidad y opciones de reproducción (popover). */
export function qualityPopover(s: AnimStudio, anchor: HTMLElement, persist: () => void) {
  document.querySelector('.popover.ap-quality')?.remove();
  const p = s.player;
  const seg = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Calidad' }, ...([[1, 'Completa'], [0.5, 'Media'], [0.25, 'Baja']] as const).map(([q, l]) =>
    h('button', { type: 'button', role: 'radio', 'aria-checked': String(p.quality === q), on: { click: (e: Event) => { p.quality = q; s.frames.clear(); seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-checked', String(b === e.currentTarget))); persist(); } } }, l)));
  const close = () => { pop.remove(); removeEventListener('pointerdown', outside, true); };
  const outside = (e: Event) => { if (!pop.contains(e.target as Node) && e.target !== anchor) close(); };
  const pop = h('div', { class: 'popover ap-quality', role: 'dialog', 'aria-label': 'Reproducción' },
    h('strong', null, 'Reproducción'),
    h('div', { class: 'ap-field' }, h('span', null, 'Calidad de imagen'), seg),
    h('p', { class: 'ctl-help' }, 'Completa = resolución de pantalla (hasta 1:1 con el lienzo). Media o baja rasterizan menos píxeles para animaciones muy pesadas.'),
    sw('Mostrar pistas de referencia', p.showReference, v => { p.showReference = v; persist(); }),
    sw('Sonido al arrastrar el cabezal', s.scrubAudio, v => { s.scrubAudio = v; persist(); }),
    h('p', { class: 'ctl-help' }, `Caché de dibujos: ${(s.frames.memory / 1048576).toFixed(0)} MB de ${(s.frames.budget / 1048576).toFixed(0)} MB.`),
    btn('Vaciar caché', () => { s.frames.clear(); toast('Caché de reproducción vaciada'); close(); }));
  document.body.append(pop);
  const r = anchor.getBoundingClientRect(), pr = pop.getBoundingClientRect();
  pop.style.left = `${Math.max(8, Math.min(innerWidth - pr.width - 8, r.left))}px`;
  pop.style.top = `${Math.max(8, r.top - pr.height - 8)}px`;
  addEventListener('pointerdown', outside, true);
}

/**
 * Pestaña «Animación» del panel lateral: propiedades editables del fotograma,
 * la pista, el grupo, el clip de audio (con diálogos y bocas), guías y marcadores.
 */
export class AnimPanel {
  readonly el = h('div', { class: 'anim-panel' });
  private dirty = true;

  constructor(private s: AnimStudio, private hooks: { drawGuide: () => void }) {
    s.on('change', () => this.schedule());
    s.on('selection', () => this.schedule());
    this.el.addEventListener('focusout', () => setTimeout(() => { if (this.dirty) this.render(); }, 0));
  }

  private schedule() {
    this.dirty = true;
    // No se reconstruye mientras se escribe en un campo del panel.
    if (this.el.contains(document.activeElement) && document.activeElement !== document.body) return;
    requestAnimationFrame(() => { if (this.dirty) this.render(); });
  }

  render() {
    this.dirty = false;
    const s = this.s, a = s.anim, doc = s.doc;
    if (!a) { this.el.replaceChildren(); return; }
    const l = s.active;
    const sel = s.selection();
    const cel = sel.length === 1 ? doc.layer(sel[0].layer)?.cels?.find(c => c.id === sel[0].cel) ?? null : M.celAt(l, a.current);
    const celLayer = sel.length === 1 ? doc.layer(sel[0].layer)! : l;
    const parts: (Node | null)[] = [];

    // ----- Fotograma
    if (sel.length > 1) parts.push(sec(`${sel.length} fotogramas seleccionados`, h('div', { class: 'ap-btns' }, btn('Copiar', () => s.copy()), btn('Clave/intermedio', () => s.toggleKey()), btn('Eliminar', () => s.deleteFrames(false), 'btn sm danger'))));
    else if (cel && celLayer.cels) {
      const shapes = h('div', { class: 'ap-shapes', role: 'group', 'aria-label': 'Etiqueta de boca' }, ...M.MOUTH_SHAPES.map(sh => h('button', {
        type: 'button', class: `chip-btn ${cel.label === sh ? 'on' : ''}`, title: M.MOUTH_HELP[sh],
        on: { click: () => s.run(() => M.cmdCelProps(doc, celLayer.id, cel.id, { label: cel.label === sh ? '' : sh })) },
      }, sh)));
      const label = h('input', { type: 'text', value: cel.label, maxlength: '24', 'aria-label': 'Etiqueta' });
      label.addEventListener('change', () => s.run(() => M.cmdCelProps(doc, celLayer.id, cel.id, { label: label.value.trim() })));
      parts.push(sec(`Fotograma ${cel.start + 1}${cel.length > 1 ? `–${cel.start + cel.length}` : ''} · ${celLayer.name}`,
        h('div', { class: 'ap-row2' },
          num('Duración', cel.length, { min: 1, max: M.MAX_FRAMES, unit: 'f' }, v => s.setLength({ layer: celLayer.id, cel: cel.id }, v)),
          h('label', { class: 'ap-field' }, h('span', null, 'Etiqueta'), label)),
        sw('Fotograma clave (pose principal)', cel.key, v => s.run(() => M.cmdCelProps(doc, celLayer.id, cel.id, { key: v }))),
        h('span', { class: 'ap-sub' }, 'Boca (sincronización labial)'), shapes,
        h('p', { class: 'ctl-help' }, `${cel.content.items.length} elementos · ${(cel.length / a.fps).toFixed(2).replace('.', ',')} s`),
        h('div', { class: 'ap-btns' }, btn('Duplicar', () => s.newFrame(true)), btn('Copiar', () => s.copy()), btn('Eliminar', () => s.deleteFrames(false), 'btn sm danger'))));
    } else if (l.cels) parts.push(sec(`Fotograma ${a.current + 1} · ${l.name}`, h('p', { class: 'ctl-help' }, 'En blanco. Dibuja aquí para crear un dibujo nuevo, o:'), h('div', { class: 'ap-btns' }, btn('Nuevo fotograma', () => s.newFrame(false)), s.clipboard ? btn('Pegar', () => s.paste()) : null)));

    // ----- Pista
    const groups = a.groups;
    const gsel = h('select', { 'aria-label': 'Grupo' }, h('option', { value: '' }, 'Sin grupo'), ...groups.map(g => h('option', { value: g.id, selected: l.group === g.id }, g.name)), h('option', { value: '__new' }, 'Nuevo grupo…'));
    gsel.addEventListener('change', async () => {
      if (gsel.value === '__new') { const n = await promptText('Nombre del grupo', `Grupo ${groups.length + 1}`); if (n) s.run(() => M.cmdGroupTracks(doc, [l.id], n)); else this.render(); return; }
      s.run(() => M.cmdTrackProps(doc, l.id, { group: gsel.value || null }));
    });
    const blend = h('select', { 'aria-label': 'Fusión' }, ...(['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-burn', 'color-dodge', 'soft-light', 'hard-light', 'difference'] as BlendMode[]).map(b => h('option', { value: b, selected: l.blend === b }, b)));
    blend.addEventListener('change', () => s.engine.setLayerProps(l.id, { blend: blend.value as BlendMode }));
    parts.push(sec(`Pista · ${l.name}`,
      range('Opacidad', l.opacity, { min: 0, max: 1, step: 0.01, fmt: v => `${Math.round(v * 100)} %` }, v => s.engine.setLayerProps(l.id, { opacity: v }, { opacity: l.opacity }), v => s.engine.previewLayerProps(l.id, { opacity: v })),
      h('div', { class: 'ap-row2' }, h('label', { class: 'ap-field' }, h('span', null, 'Fusión'), blend), h('label', { class: 'ap-field' }, h('span', null, 'Grupo'), gsel)),
      sw('Visible', l.visible, v => s.engine.setLayerProps(l.id, { visible: v })),
      sw('Bloqueada', l.locked, v => s.engine.setLayerProps(l.id, { locked: v })),
      l.cels ? sw('Sincronizada (el tiempo insertado desplaza las demás sincronizadas)', !!l.sync, v => s.run(() => M.cmdTrackProps(doc, l.id, { sync: v }))) : null,
      sw('Referencia (no se exporta)', !!l.reference, v => s.run(() => M.cmdTrackProps(doc, l.id, { reference: v }))),
      h('div', { class: 'ap-btns' }, l.cels ? btn('Volver estática', () => s.makeStatic(l.id)) : btn('Animar capa', () => s.makeAnimated(l.id), 'btn sm primary'),
        l.cels ? btn('En doses', () => s.retime(2)) : null, l.cels ? btn('En unos', () => s.retime(1)) : null)));

    // ----- Grupo
    const g = M.groupOf(doc, l);
    if (g) parts.push(sec(`Grupo · ${g.name}`,
      range('Opacidad del grupo', g.opacity, { min: 0, max: 1, step: 0.01, fmt: v => `${Math.round(v * 100)} %` }, v => s.run(() => M.cmdGroupProps(doc, g.id, { opacity: v }))),
      sw('Visible', g.visible, v => s.run(() => M.cmdGroupProps(doc, g.id, { visible: v }))),
      sw('Bloqueado', g.locked, v => s.run(() => M.cmdGroupProps(doc, g.id, { locked: v }))),
      h('div', { class: 'ap-btns' }, btn('Renombrar…', async () => { const n = await promptText('Renombrar grupo', g.name); if (n) s.run(() => M.cmdGroupProps(doc, g.id, { name: n })); }), btn('Desagrupar', () => s.run(() => M.cmdUngroup(doc, g.id))))));

    // ----- Audio
    const c = s.clip();
    if (c) parts.push(this.audioSection(c));
    else if (a.audio.length) parts.push(sec('Audio', h('p', { class: 'ctl-help' }, 'Selecciona un clip en la línea de tiempo para editar su volumen, recorte, diálogos y bocas.')));

    // ----- Guías
    parts.push(sec('Guías de movimiento',
      ...a.guides.map(gd => h('div', { class: 'ap-list-row' },
        sw(gd.name, gd.visible, v => s.run(() => M.cmdAnimEdit(doc, 'Guía visible', an => { const x = an.guides.find(q => q.id === gd.id); if (!x) return false; x.visible = v; return true; }))),
        btn('×', () => s.run(() => M.cmdAnimEdit(doc, 'Quitar guía', an => { an.guides = an.guides.filter(q => q.id !== gd.id); })), 'btn xs ghost'))),
      h('div', { class: 'ap-btns' }, btn('Dibujar guía nueva', () => this.hooks.drawGuide())),
      h('p', { class: 'ctl-help' }, 'Una guía es un recorrido que «Interpolar movimiento» puede seguir. Se ve sobre el lienzo y no se exporta.')));

    // ----- Marcadores
    if (a.markers.length) parts.push(sec('Marcadores', ...a.markers.map(m => h('div', { class: 'ap-list-row' },
      h('button', { type: 'button', class: 'link', on: { click: () => s.go(m.frame) } }, `${m.frame + 1} · ${m.name}`),
      btn('×', () => s.run(() => M.cmdMarker(doc, { remove: m.id })), 'btn xs ghost')))));

    this.el.replaceChildren(...parts.filter((x): x is Node => !!x));
  }

  private audioSection(c: M.AudioClip) {
    const s = this.s, a = s.anim!, fps = a.fps;
    const lane = h('select', { 'aria-label': 'Pista de audio' }, ...a.lanes.map(l => h('option', { value: l.id, selected: l.id === c.lane }, l.name)));
    lane.addEventListener('change', () => s.editClip(c.id, 'Pista del audio', x => { x.lane = lane.value; }));
    const dlg = c.dialogue.map(d => {
      const text = h('input', { type: 'text', value: d.text, 'aria-label': 'Texto del diálogo' });
      text.addEventListener('change', () => s.editClip(c.id, 'Diálogo', x => { const q = x.dialogue.find(y => y.id === d.id); if (!q) return false; q.text = text.value; return true; }));
      return h('div', { class: 'ap-dlg' },
        num('De', d.start + 1, { min: 1 }, v => s.editClip(c.id, 'Diálogo', x => { const q = x.dialogue.find(y => y.id === d.id)!; q.start = Math.max(0, Math.round(v) - 1); if (q.end < q.start) q.end = q.start; })),
        num('a', d.end + 1, { min: 1 }, v => s.editClip(c.id, 'Diálogo', x => { const q = x.dialogue.find(y => y.id === d.id)!; q.end = Math.max(q.start, Math.round(v) - 1); })),
        text, btn('×', () => s.editClip(c.id, 'Quitar diálogo', x => { x.dialogue = x.dialogue.filter(y => y.id !== d.id); }), 'btn xs ghost'));
    });
    const tracks = s.doc.layers.filter(l => l.cels);
    const target = h('select', { 'aria-label': 'Pista de bocas' }, ...tracks.map(l => h('option', { value: l.id, selected: l.id === s.active.id }, l.name)));
    return sec(`Audio · ${c.name}`,
      h('div', { class: 'ap-row2' }, h('label', { class: 'ap-field' }, h('span', null, 'Pista'), lane),
        num('Empieza (f)', Math.round(c.offset * fps) + 1, { min: 1 }, v => s.editClip(c.id, 'Mover audio', x => { x.offset = Math.max(0, (Math.round(v) - 1) / fps); }))),
      h('div', { class: 'ap-row2' },
        num('Recorte inicio', c.trimStart, { min: 0, step: 0.01, unit: 's' }, v => s.editClip(c.id, 'Recortar audio', x => { x.trimStart = Math.max(0, Math.min(x.duration - x.trimEnd - 0.05, v)); })),
        num('Recorte final', c.trimEnd, { min: 0, step: 0.01, unit: 's' }, v => s.editClip(c.id, 'Recortar audio', x => { x.trimEnd = Math.max(0, Math.min(x.duration - x.trimStart - 0.05, v)); }))),
      range('Volumen', c.volume, { min: 0, max: 2, step: 0.01, fmt: v => `${Math.round(v * 100)} %` }, v => s.editClip(c.id, 'Volumen del audio', x => { x.volume = v; })),
      sw('Silenciado', c.muted, v => s.editClip(c.id, 'Silenciar audio', x => { x.muted = v; })),
      h('p', { class: 'ctl-help' }, `Archivo: ${c.duration.toFixed(2).replace('.', ',')} s · suena ${clipSpan(c).toFixed(2).replace('.', ',')} s (fotogramas ${Math.round(c.offset * fps) + 1}–${Math.round((c.offset + clipSpan(c)) * fps)})`),
      h('span', { class: 'ap-sub' }, 'Diálogos (referencia)'), ...dlg,
      h('div', { class: 'ap-btns' }, btn('Añadir línea en el fotograma actual', () => s.editClip(c.id, 'Añadir diálogo', (x, an) => { x.dialogue.push({ id: M.uid('d'), start: an.current, end: Math.min(an.length - 1, an.current + an.fps), text: 'Texto' }); }))),
      h('span', { class: 'ap-sub' }, `Bocas: ${c.mouth.length} cambios`),
      h('div', { class: 'ap-btns' },
        btn('Generar por volumen', () => void s.autoLipSync(c.id)),
        btn('Borrar bocas', () => s.editClip(c.id, 'Borrar bocas', x => { x.mouth = []; }), 'btn sm ghost')),
      tracks.length ? h('div', { class: 'ap-row2 ap-apply' }, h('label', { class: 'ap-field' }, h('span', null, 'Pista de bocas'), target), btn('Aplicar bocas', () => s.applyMouth(c.id, target.value), 'btn sm primary')) : null,
      h('p', { class: 'ctl-help' }, 'Etiqueta los dibujos de la pista de bocas con A…H o X (en «Fotograma»). «Aplicar» los expone siguiendo las bocas del clip; se ajustan a mano en la hoja de exposición.'),
      h('div', { class: 'ap-btns' }, btn('Eliminar clip', () => s.run(() => M.cmdAnimEdit(s.doc, 'Eliminar audio', an => { an.audio = an.audio.filter(x => x.id !== c.id); })), 'btn sm danger')));
  }
}

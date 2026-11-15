import type { BrushLibrary } from '../brush/BrushLibrary';
import { clonePreset, type BrushPreset } from '../brush/BrushPreset';
import type { StrokePainter } from '../brush/StrokePainter';
import type { CanvasEngine, Tool } from '../engine';
import { BrushStudio } from './BrushStudio';
import { h, toast } from './dom';
import { ICONS } from './icons';
import { LibraryPanel } from './LibraryPanel';
import { Thumbnails } from './thumbnails';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const SWATCHES = ['#1b1530', '#4b4366', '#f4f1fb', '#9d6bff', '#5b8cff', '#2fb7a3', '#5fae4a', '#f2c84b', '#f08a3c', '#e2445c', '#b8336a', '#7a4b33'];

export interface AppDeps { engine: CanvasEngine; lib: BrushLibrary; painter: StrokePainter }

/**
 * Capa de interfaz de YOSADRAW. Sólo conecta controles con la API del motor
 * y de la biblioteca; no contiene lógica de dibujo.
 */
export function mountApp({ engine, lib, painter }: AppDeps) {
  const thumbs = new Thumbnails(painter);
  const studio = new BrushStudio(lib, painter, thumbs);
  const panel = new LibraryPanel(lib, thumbs);
  const target = () => (engine.tool === 'eraser' ? 'eraser' : 'brush') as 'brush' | 'eraser';

  // ---------- Iconos de la barra ----------
  const icon = (sel: string, key: keyof typeof ICONS) => document.querySelectorAll<HTMLElement>(sel).forEach(el => (el.innerHTML = ICONS[key]));
  for (const t of ['brush', 'eraser', 'hand', 'rotate'] as const) icon(`[data-tool="${t}"]`, t);
  icon('#undo', 'undo'); icon('#redo', 'redo'); icon('#zoom-in', 'zoomIn'); icon('#zoom-out', 'zoomOut');
  icon('#fit', 'fit'); icon('#rot-left', 'rotL'); icon('#rot-right', 'rotR'); icon('#clear', 'trash'); icon('#panel-toggle', 'sliders');

  // ---------- Pincel activo + ajustes rápidos ----------
  const cardThumb = h('span', { class: 'thumb big' });
  const cardName = h('strong', { class: 'active-name' });
  const cardCat = h('span', { class: 'active-cat' });
  const cardFor = h('span', { class: 'eyebrow' });
  const sizeIn = h('input', { type: 'range', id: 'quick-size', min: '0', max: '1000', step: '1' });
  const sizeOut = h('output', { for: 'quick-size' });
  const opIn = h('input', { type: 'range', id: 'quick-opacity', min: '1', max: '100', step: '1' });
  const opOut = h('output', { for: 'quick-opacity' });
  const colorIn = h('input', { type: 'color', id: 'brush-color', 'aria-label': 'Color personalizado' });
  const swatches = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Colores' },
    ...SWATCHES.map(c => h('button', { type: 'button', role: 'radio', class: 'sw', dataset: { c }, style: { '--sw': c } as Record<string, string>, 'aria-label': `Color ${c}`, on: { click: () => setColor(c) } })));

  const MIN = 0.5, MAX = 1000;
  const toS = (v: number) => Math.round((Math.log(v / MIN) / Math.log(MAX / MIN)) * 1000);
  const fromS = (s: number) => Math.round(MIN * Math.pow(MAX / MIN, s / 1000) * 10) / 10;

  const activeCard = h('section', { class: 'block active-brush', 'aria-labelledby': 'active-title' },
    h('div', { class: 'active-top' },
      h('div', null, cardFor, h('h2', { id: 'active-title', class: 'sr' }, 'Pincel activo'), cardName, cardCat),
      h('div', { class: 'active-actions' },
        h('button', { type: 'button', class: 'btn sm', html: `${ICONS.edit}<span>Editar</span>`, on: { click: () => studio.show(lib.activeFor(target()), engine.color) } }),
        h('button', { type: 'button', class: 'btn ghost sm', on: { click: () => { const d = lib.duplicate(lib.activeId(target())); if (d) { lib.setActive(target(), d.id); toast(`Creado «${d.name}»`, 'ok'); } } } }, 'Duplicar'))),
    cardThumb,
    h('div', { class: 'quick' },
      h('label', { for: 'quick-size', class: 'row' }, h('span', null, 'Tamaño'), sizeOut), sizeIn,
      h('label', { for: 'quick-opacity', class: 'row' }, h('span', null, 'Opacidad'), opOut), opIn));

  const colorBlock = h('section', { class: 'block color-block', 'aria-labelledby': 'color-title' },
    h('div', { class: 'row' }, h('h2', { id: 'color-title' }, 'Color'), colorIn), swatches);

  $('panel').append(activeCard, colorBlock, panel.el);

  const renderActive = () => {
    const t = target(), p = lib.activeFor(t);
    cardFor.textContent = t === 'brush' ? 'Pincel activo' : 'Borrador activo';
    cardName.textContent = p.name;
    cardCat.textContent = p.category;
    cardThumb.replaceChildren(thumbs.stroke(p, engine.color, 260, 64));
    sizeIn.value = String(toS(p.size.size));
    sizeIn.style.setProperty('--fill', `${Number(sizeIn.value) / 10}%`);
    sizeOut.textContent = `${p.size.size < 10 ? p.size.size.toFixed(1) : Math.round(p.size.size)} px`;
    opIn.value = String(Math.round(p.opacity.opacity * 100));
    opIn.style.setProperty('--fill', `${opIn.value}%`);
    opOut.textContent = `${opIn.value}%`;
    panel.setTarget(t);
  };

  // Ajuste rápido: en vivo durante el arrastre, se guarda al soltar.
  const quick = (mutate: (p: BrushPreset) => void, commit: boolean) => {
    const t = target();
    const p = clonePreset(lib.activeFor(t));
    mutate(p);
    if (commit) lib.update(p); else engine.setBrushPreset(t, p);
    sizeOut.textContent = `${p.size.size < 10 ? p.size.size.toFixed(1) : Math.round(p.size.size)} px`;
    opOut.textContent = `${Math.round(p.opacity.opacity * 100)}%`;
    sizeIn.style.setProperty('--fill', `${Number(sizeIn.value) / 10}%`);
    opIn.style.setProperty('--fill', `${opIn.value}%`);
  };
  sizeIn.addEventListener('input', () => quick(p => { p.size.size = fromS(Number(sizeIn.value)); }, false));
  sizeIn.addEventListener('change', () => quick(p => { p.size.size = fromS(Number(sizeIn.value)); }, true));
  opIn.addEventListener('input', () => quick(p => { p.opacity.opacity = Number(opIn.value) / 100; }, false));
  opIn.addEventListener('change', () => quick(p => { p.opacity.opacity = Number(opIn.value) / 100; }, true));

  function setColor(c: string) {
    engine.setColor(c);
    lib.setColor(c);
    colorIn.value = c;
    swatches.querySelectorAll<HTMLElement>('.sw').forEach(b => b.setAttribute('aria-checked', String(b.dataset.c === c)));
    panel.setColor(c);
    renderActive();
    if (engine.tool === 'eraser') engine.setTool('brush');
  }
  colorIn.addEventListener('input', () => setColor(colorIn.value));
  colorIn.value = engine.color;
  swatches.querySelectorAll<HTMLElement>('.sw').forEach(b => b.setAttribute('aria-checked', String(b.dataset.c === engine.color)));
  panel.setColor(engine.color);

  lib.on('active', ({ tool, preset }) => { engine.setBrushPreset(tool, preset); renderActive(); });
  lib.on('change', renderActive);
  panel.onEdit = p => studio.show(p, engine.color);
  studio.onSaved = (p, isNew) => { if (isNew) lib.setActive(target(), p.id); };
  painter.tips.images.onReady(() => { thumbs.invalidate(); panel.render(); renderActive(); });

  // ---------- Herramientas ----------
  const toolButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-tool]')];
  toolButtons.forEach(b => b.addEventListener('click', () => engine.setTool(b.dataset.tool as Tool)));
  const showTool = (t: Tool) => { toolButtons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === t))); renderActive(); };
  engine.on('tool', showTool);
  showTool(engine.tool);

  // ---------- Historial ----------
  const undoBtn = $<HTMLButtonElement>('undo'), redoBtn = $<HTMLButtonElement>('redo');
  undoBtn.addEventListener('click', () => engine.undo());
  redoBtn.addEventListener('click', () => engine.redo());
  $('clear').addEventListener('click', () => engine.clear());
  const showHistory = () => {
    const hs = engine.historyState;
    undoBtn.disabled = !hs.canUndo;
    redoBtn.disabled = !hs.canRedo;
    $<HTMLButtonElement>('clear').disabled = engine.store.count === 0;
    $('st-hist').textContent = `${hs.undoDepth} / ${hs.redoDepth}`;
    $('empty-hint').hidden = engine.store.count > 0 || hs.undoDepth > 0;
  };
  engine.on('history', showHistory);
  showHistory();

  // ---------- Vista ----------
  $('zoom-in').addEventListener('click', () => engine.zoomBy(1.5));
  $('zoom-out').addEventListener('click', () => engine.zoomBy(1 / 1.5));
  $('zoom-value').addEventListener('click', () => engine.zoomTo(1));
  $('fit').addEventListener('click', () => engine.fit());
  $('rot-left').addEventListener('click', () => engine.rotateBy(-15));
  $('rot-right').addEventListener('click', () => engine.rotateBy(15));
  $('rot-value').addEventListener('click', () => engine.setRotation(0));
  let viewReq = 0;
  const showView = () => {
    if (viewReq) return;
    viewReq = requestAnimationFrame(() => {
      viewReq = 0;
      const pct = engine.view.scale * 100;
      $('zoom-value').textContent = `${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`;
      let deg = Math.round((engine.view.rotation * 180) / Math.PI);
      if (deg === -180) deg = 180;
      $('rot-value').textContent = `${deg}°`;
    });
  };
  engine.on('view', showView);
  showView();

  // ---------- Estado ----------
  $('st-doc').textContent = `${engine.docWidth} × ${engine.docHeight} px`;
  engine.on('pointer', p => {
    if (!p) { $('st-pos').textContent = '–'; return; }
    $('st-pos').textContent = p.inside ? `${Math.round(p.x)}, ${Math.round(p.y)}` : 'fuera';
    $('st-pressure').textContent = p.type === 'pen' ? p.pressure.toFixed(2) : p.type === 'mouse' ? 'ratón' : 'táctil';
    $('st-tilt').textContent = p.type === 'pen' ? `${Math.round(p.tilt)}°` : '–';
  });
  engine.on('stats', s => {
    $('st-strokes').textContent = `${s.strokes} · ${s.dabs.toLocaleString('es')} sellos`;
    $('st-render').textContent = `${s.renderMs.toFixed(1)} ms${s.progressive ? ' (por lotes)' : ''}`;
  });
  const where = lib.storageKind === 'desktop' ? 'en este equipo' : lib.storageKind === 'browser' ? 'en el navegador' : 'solo en esta sesión';
  $('st-save').textContent = `Biblioteca ${where}`;
  lib.on('saved', r => {
    $('st-save').textContent = r.ok ? `Guardado ${where} · ${new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}` : 'Error al guardar';
    if (!r.ok) toast(r.error ?? 'No se pudo guardar la biblioteca', 'error');
  });

  // ---------- Panel en pantallas estrechas ----------
  const toggle = $('panel-toggle');
  toggle.addEventListener('click', () => {
    const open = document.body.classList.toggle('panel-open');
    toggle.setAttribute('aria-expanded', String(open));
  });

  // ---------- Teclado ----------
  window.addEventListener('keydown', e => {
    const t = e.target as HTMLElement;
    if (studio.open || t.closest('.dialog-backdrop, .menu')) return;
    if (t instanceof HTMLInputElement && (t.type === 'text' || t.type === 'number')) return;
    if (t instanceof HTMLTextAreaElement) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (e.code === 'Space') { e.preventDefault(); engine.setSpacePan(true); return; }
    if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) engine.redo(); else engine.undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); engine.redo(); return; }
    if (mod && k === '0') { e.preventDefault(); engine.fit(); return; }
    if (mod && k === '1') { e.preventDefault(); engine.zoomTo(1); return; }
    if (mod && k === 's') { e.preventDefault(); void lib.saveNow(); return; }
    if (mod || e.altKey) return;
    if (k === 'r' && e.shiftKey) { engine.setRotation(0); return; }
    if (k === 'b') engine.setTool('brush');
    else if (k === 'e') engine.setTool('eraser');
    else if (k === 'h') engine.setTool('hand');
    else if (k === 'r') engine.setTool('rotate');
    else if (k === 'enter' && document.activeElement === document.body) studio.show(lib.activeFor(target()), engine.color);
    else if (k === '+' || k === '=') engine.zoomBy(1.5);
    else if (k === '-' || k === '_') engine.zoomBy(1 / 1.5);
    else if (k === '[' || k === ']') {
      const p = clonePreset(lib.activeFor(target()));
      p.size.size = Math.min(1000, Math.max(0.5, Math.round(p.size.size * (k === ']' ? 1.2 : 1 / 1.2) * 10) / 10));
      lib.update(p);
    }
  });
  window.addEventListener('keyup', e => { if (e.code === 'Space') { e.preventDefault(); engine.setSpacePan(false); } });
  window.addEventListener('blur', () => engine.setSpacePan(false));
  window.addEventListener('beforeunload', () => { void lib.saveNow(); });

  renderActive();
  return { studio, panel, thumbs };
}

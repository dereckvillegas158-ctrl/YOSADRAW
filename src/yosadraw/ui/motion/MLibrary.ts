import { strFromU8, unzipSync } from 'fflate';
import { MEDIA_ACCEPT } from '../../motion/media';
import { clipEnd, type MediaItem, type MediaKind } from '../../motion/model';
import { h, pickFiles, toast } from '../dom';
import { confirmDialog, modal, promptText } from '../modal';
import { MI } from './icons';
import type { MotionStudio } from './MotionStudio';
import { fmtDur, fmtSize, menu } from './util';

const KIND_LABEL: Record<MediaKind, string> = {
  video: 'Vídeo', audio: 'Audio', image: 'Imagen', gif: 'GIF', svg: 'SVG', seq: 'Secuencia', font: 'Fuente', drawing: 'Dibujo', anim: 'Animación', lut: 'LUT',
};
const FILTERS: [string, string, MediaKind[]][] = [
  ['all', 'Todo', []], ['video', 'Vídeo', ['video', 'gif', 'seq']], ['audio', 'Audio', ['audio']], ['image', 'Imágenes', ['image', 'svg']],
  ['yosa', 'YOSADRAW', ['drawing', 'anim']], ['other', 'Fuentes y LUT', ['font', 'lut']],
];

/**
 * Biblioteca de medios del proyecto: importar (botón, arrastrar o pegar), buscar,
 * filtrar por tipo, carpetas, miniaturas y metadatos; avisos de archivos que
 * faltan (volver a vincular) y de dibujos de YOSADRAW que cambiaron (actualizar);
 * proxies para editar vídeo pesado con fluidez (escritorio). Se arrastra a la
 * línea de tiempo o al visor.
 */
export class MLibrary {
  readonly el: HTMLElement;
  private list: HTMLElement;
  private search: HTMLInputElement;
  private filter = 'all';
  private folder = '';
  private folderSel: HTMLSelectElement;
  private filterBar: HTMLElement;
  private status: HTMLElement;
  private outdated = new Set<string>();

  constructor(private s: MotionStudio) {
    this.search = h('input', { type: 'search', placeholder: 'Buscar medios…', 'aria-label': 'Buscar medios', class: 'mo-search' });
    this.search.addEventListener('input', () => this.render());
    this.folderSel = h('select', { class: 'mo-sel', 'aria-label': 'Carpeta' });
    this.folderSel.addEventListener('change', () => { if (this.folderSel.value === '+') { void this.newFolder(); return; } this.folder = this.folderSel.value; this.render(); });
    this.filterBar = h('div', { class: 'mo-chips', role: 'radiogroup', 'aria-label': 'Tipo de medio' });
    this.status = h('div', { class: 'mo-libstatus', hidden: true });
    this.list = h('div', { class: 'mo-media', role: 'list' });
    const actions = h('div', { class: 'mo-libactions' },
      h('button', { type: 'button', class: 'btn sm primary', html: `${MI.import} Importar`, title: 'Vídeo, audio, imágenes, GIF, SVG, fuentes y LUT (.cube)', on: { click: () => void this.importPick() } }),
      h('button', { type: 'button', class: 'btn sm', html: `${MI.brush} De YOSADRAW`, title: 'Usar un dibujo o una animación de tu galería (se cita: el original no cambia)', on: { click: () => void this.fromGallery() } }),
      h('button', { type: 'button', class: 'icon sm', html: MI.more, title: 'Más', 'aria-label': 'Más opciones de importación', on: { click: (e: Event) => this.moreMenu(e as MouseEvent) } }));
    this.el = h('div', { class: 'mo-library' }, actions, h('div', { class: 'mo-librow' }, this.search, this.folderSel), this.filterBar, this.status, this.list);
    this.el.addEventListener('dragover', e => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); this.el.classList.add('drop'); } });
    this.el.addEventListener('dragleave', () => this.el.classList.remove('drop'));
    this.el.addEventListener('drop', e => { e.preventDefault(); this.el.classList.remove('drop'); if (e.dataTransfer?.files.length) void s.importFiles([...e.dataTransfer.files]); });
    s.on('media', () => { void this.checkOutdated(); this.render(); });
    s.on('change', l => { if (l.startsWith('·')) { this.status.hidden = false; this.status.textContent = l.slice(1); } else { this.status.hidden = true; } if (l.startsWith('Importar') || l.includes('medio') || l === '' || l.startsWith('Deshacer') || l.startsWith('Rehacer')) this.render(); });
    s.on('open', () => { this.folder = ''; this.search.value = ''; });
  }

  private items(): MediaItem[] {
    const s = this.s, q = this.search.value.trim().toLowerCase();
    const kinds = FILTERS.find(f => f[0] === this.filter)![2];
    return s.m.media
      .filter(m => (!kinds.length || kinds.includes(m.kind)) && (!this.folder || m.folder === this.folder) && (!q || m.name.toLowerCase().includes(q) || KIND_LABEL[m.kind].toLowerCase().includes(q)))
      .sort((a, b) => b.added - a.added);
  }

  private uses(m: MediaItem) { return this.s.m.comps.reduce((n, c) => n + c.clips.filter(cl => cl.kind === 'media' && cl.media === m.id).length, 0); }

  render() {
    const s = this.s;
    if (!s.active) return;
    // Filtros y carpetas.
    this.filterBar.replaceChildren(...FILTERS.map(([id, label]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(this.filter === id), class: 'mo-chip', on: { click: () => { this.filter = id; this.render(); } } }, label)));
    this.folderSel.replaceChildren(h('option', { value: '' }, 'Todas las carpetas'), ...s.m.folders.map(f => h('option', { value: f, selected: f === this.folder }, f)), h('option', { value: '+' }, 'Nueva carpeta…'));
    this.folderSel.value = this.folder;
    const items = this.items();
    this.list.replaceChildren();
    if (!items.length) {
      this.list.append(h('div', { class: 'mo-empty' }, s.m.media.length ? 'No hay medios con este filtro.' : h('span', null, 'Arrastra aquí vídeos, audio o imágenes, o pulsa ', h('b', null, 'Importar'), '.')));
      return;
    }
    for (const m of items) this.list.append(this.card(m));
  }

  private card(m: MediaItem): HTMLElement {
    const s = this.s;
    const missing = s.media.missing.has(m.id), old = this.outdated.has(m.id);
    const thumb = h('div', { class: 'mo-thumb' });
    if (!missing) void s.media.thumb(m).then(c => { if (c) { c.className = 'mo-thumbimg'; thumb.replaceChildren(c); } }).catch(() => undefined);
    const meta = [KIND_LABEL[m.kind], m.w && m.h && m.kind !== 'audio' ? `${m.w}×${m.h}` : '', m.dur && ['video', 'audio', 'gif', 'seq', 'anim'].includes(m.kind) ? fmtDur(m.dur) : '', m.fps && m.kind === 'video' ? `${+m.fps.toFixed(2)} fps` : '', m.size ? fmtSize(m.size) : ''].filter(Boolean).join(' · ');
    const n = this.uses(m);
    const card = h('div', { class: `mo-card${missing ? ' missing' : ''}`, role: 'listitem', draggable: 'true', tabindex: '0', title: `${m.name}\n${meta}${n ? `\nUsado en ${n} ${n === 1 ? 'clip' : 'clips'}` : ''}\nDoble clic: añadir en el cabezal` },
      thumb,
      h('div', { class: 'mo-cardtext' }, h('strong', null, m.name), h('span', null, meta),
        missing ? h('button', { type: 'button', class: 'btn xs danger', on: { click: (e: Event) => { e.stopPropagation(); void this.relink(m); } } }, 'Falta · volver a vincular') : null,
        old ? h('button', { type: 'button', class: 'btn xs', on: { click: (e: Event) => { e.stopPropagation(); this.refresh(m); } } }, 'Cambió en YOSADRAW · actualizar') : null,
        m.proxy ? h('span', { class: 'mo-badge' }, 'proxy') : null,
        n ? h('span', { class: 'mo-badge used' }, `${n}×`) : null));
    card.addEventListener('dragstart', e => { e.dataTransfer!.setData('application/x-yosa-media', m.id); e.dataTransfer!.effectAllowed = 'copy'; });
    card.addEventListener('dblclick', () => s.addMediaToTimeline([m.id]));
    card.addEventListener('keydown', e => { if (e.key === 'Enter') s.addMediaToTimeline([m.id]); });
    card.addEventListener('contextmenu', e => { e.preventDefault(); this.cardMenu(m, e.clientX, e.clientY); });
    return card;
  }

  private cardMenu(m: MediaItem, x: number, y: number) {
    const s = this.s;
    menu(x, y, m.name, [
      { label: 'Añadir en el cabezal', disabled: m.kind === 'font' || m.kind === 'lut', run: () => s.addMediaToTimeline([m.id]) },
      { label: 'Renombrar…', run: async () => { const v = await promptText('Renombrar medio', m.name); if (v) s.edit('Renombrar medio', mm => { mm.media.find(x2 => x2.id === m.id)!.name = v.slice(0, 120); }); this.render(); } },
      { label: 'Mover a carpeta…', run: () => void this.moveToFolder(m) },
      { label: 'Información', run: () => void this.info(m) },
      m.kind === 'video' && s.media.canTranscode ? { label: m.proxy ? 'Volver a crear el proxy' : 'Crear proxy (edición fluida)', run: () => void this.proxy(m) } : null,
      m.kind !== 'drawing' && m.kind !== 'anim' ? { label: 'Volver a vincular (otro archivo)…', run: () => void this.relink(m) } : { label: 'Actualizar desde YOSADRAW', run: () => this.refresh(m) },
      null,
      { label: 'Quitar de la biblioteca', danger: true, run: () => void this.remove(m) },
    ]);
  }

  private async importPick() {
    const files = await pickFiles(MEDIA_ACCEPT, true);
    if (files.length) await this.s.importFiles(files);
  }

  private moreMenu(e: MouseEvent) {
    menu(e.clientX, e.clientY, 'Importar', [
      { label: 'Secuencia de imágenes…', run: () => void this.importSeq() },
      { label: 'Fuente (TTF, OTF, WOFF)…', run: async () => { const f = await pickFiles('.ttf,.otf,.woff,.woff2', true); if (f.length) await this.s.importFiles(f); } },
      { label: 'LUT de color (.cube)…', run: async () => { const f = await pickFiles('.cube', true); if (f.length) await this.s.importFiles(f); } },
      { label: 'Nueva carpeta…', run: () => void this.newFolder() },
      { label: 'Comprobar archivos que faltan', run: async () => { const miss = await this.s.media.checkMissing(this.s.m.media); toast(miss.size ? `Faltan ${miss.size} medios` : 'Todos los medios están disponibles', miss.size ? 'error' : 'ok'); this.render(); } },
    ]);
  }

  private async importSeq() {
    const files = await pickFiles('image/png,image/jpeg,image/webp', true);
    if (files.length < 2) { if (files.length) toast('Elige todas las imágenes de la secuencia (2 o más).'); return; }
    const v = await promptText('Fotogramas por segundo de la secuencia', String(this.s.fps));
    const fps = Number(v?.replace(',', '.'));
    if (!v || !(fps > 0)) return;
    try {
      const item = await this.s.media.importSequence(files, Math.min(240, fps));
      this.s.edit(`Importar ${item.name}`, mm => { mm.media.push(item); });
      this.s.mediaChanged();
      toast(`Secuencia de ${files.length} imágenes importada`, 'ok');
    } catch (e) { toast(`No se pudo importar la secuencia: ${e instanceof Error ? e.message : String(e)}`, 'error'); }
  }

  private async newFolder() {
    const n = await promptText('Nueva carpeta', 'Carpeta');
    this.folderSel.value = this.folder;
    if (!n) return;
    const name = n.trim().slice(0, 60);
    if (this.s.m.folders.includes(name)) { this.folder = name; this.render(); return; }
    this.s.edit('Nueva carpeta', mm => { mm.folders.push(name); });
    this.folder = name;
    this.render();
  }

  private async moveToFolder(m: MediaItem) {
    const s = this.s;
    const opts = ['', ...s.m.folders];
    const sel = h('select', null, ...opts.map(f => h('option', { value: f, selected: f === m.folder }, f || '(sin carpeta)')));
    const r = await modal({ title: `Mover «${m.name}»`, body: [sel], actions: [{ label: 'Cancelar', value: false, kind: 'ghost' }, { label: 'Mover', value: true, kind: 'primary' }] });
    if (r) s.edit('Mover a carpeta', mm => { mm.media.find(x => x.id === m.id)!.folder = sel.value; });
    this.render();
  }

  private async info(m: MediaItem) {
    const rows: [string, string][] = [
      ['Tipo', KIND_LABEL[m.kind]], ['Formato', m.mime || '—'], ['Tamaño', m.size ? fmtSize(m.size) : '—'],
      ...(m.w ? [['Resolución', `${m.w} × ${m.h} px`] as [string, string]] : []),
      ...(m.dur && m.kind !== 'image' ? [['Duración', fmtDur(m.dur)] as [string, string]] : []),
      ...(m.fps ? [['Fotogramas por segundo', `${+m.fps.toFixed(3)}`] as [string, string]] : []),
      ...(m.frames > 1 ? [['Fotogramas', String(m.frames)] as [string, string]] : []),
      ...(m.kind === 'video' ? [['Audio', m.hasAudio ? 'Sí' : 'No'] as [string, string]] : []),
      ...(m.conv ? [['Copia compatible', 'Sí (H.264, creada al importar)'] as [string, string]] : []),
      ...(m.proxy ? [['Proxy', 'Sí (540p para editar)'] as [string, string]] : []),
      ['Usado en', `${this.uses(m)} clips`], ['Importado', new Date(m.added).toLocaleString('es')],
    ];
    await modal({ title: m.name, body: [h('dl', { class: 'mo-info' }, ...rows.flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)]))], actions: [{ label: 'Cerrar', value: true, kind: 'primary' }] });
  }

  private async proxy(m: MediaItem) {
    const s = this.s;
    this.status.hidden = false; this.status.textContent = `Creando proxy de ${m.name}…`;
    try {
      const copy = { ...m };
      await s.media.makeProxy(copy);
      s.edit('Crear proxy', mm => { Object.assign(mm.media.find(x => x.id === m.id)!, { proxy: true }); });
      toast('Proxy creado: la vista previa usa la versión ligera; la exportación, el original', 'ok');
    } catch (e) { toast(`No se pudo crear el proxy: ${e instanceof Error ? e.message : String(e)}`, 'error'); }
    this.status.hidden = true;
    this.render();
  }

  private async relink(m: MediaItem) {
    const s = this.s;
    const accept = m.kind === 'audio' ? 'audio/*' : m.kind === 'font' ? '.ttf,.otf,.woff,.woff2' : m.kind === 'lut' ? '.cube' : MEDIA_ACCEPT;
    const [f] = await pickFiles(accept, false);
    if (!f) return;
    try {
      const copy = { ...m };
      await s.media.relink(copy, f);
      s.edit('Volver a vincular', mm => { Object.assign(mm.media.find(x => x.id === m.id)!, copy); });
      s.player.invalidate();
      toast(`Vinculado: ${f.name}`, 'ok');
    } catch (e) { toast(`No se pudo vincular: ${e instanceof Error ? e.message : String(e)}`, 'error'); }
    this.render();
  }

  private refresh(m: MediaItem) {
    const s = this.s;
    const copy = { ...m, project: m.project ? { ...m.project } : null };
    s.media.refreshProject(copy);
    const e = copy.project && s.deps.projects.get(copy.project.id);
    s.edit('Actualizar desde YOSADRAW', mm => {
      const x = mm.media.find(y => y.id === m.id)!;
      x.project = copy.project;
      // Una animación pudo cambiar de duración: los clips que acababan con ella se ajustan.
      if (e?.anim) { x.dur = e.anim.frames / e.anim.fps; x.frames = e.anim.frames; x.fps = e.anim.fps; }
      if (e) { x.w = e.width; x.h = e.height; }
    });
    this.outdated.delete(m.id);
    s.player.invalidate();
    toast('Actualizado con los últimos cambios del dibujo', 'ok');
    this.render();
  }

  private async checkOutdated() {
    const s = this.s;
    if (!s.active) return;
    this.outdated.clear();
    for (const m of s.m.media) if (await s.media.outdated(m)) this.outdated.add(m.id);
    if (this.outdated.size) this.render();
  }

  private async remove(m: MediaItem) {
    const s = this.s;
    const n = this.uses(m);
    if (n && !(await confirmDialog('Quitar medio', `«${m.name}» se usa en ${n} ${n === 1 ? 'clip' : 'clips'}, que también se quitarán de la línea de tiempo.`, 'Quitar', true))) return;
    // El archivo se queda en el almacén (otras copias del proyecto o «deshacer» pueden necesitarlo).
    s.edit('Quitar medio', mm => {
      mm.media = mm.media.filter(x => x.id !== m.id);
      for (const c of mm.comps) c.clips = c.clips.filter(cl => !(cl.kind === 'media' && cl.media === m.id));
    });
    s.media.release(m);
    this.render();
  }

  /** Elegir un dibujo o animación de la galería (y una capa) como medio. */
  private async fromGallery() {
    const s = this.s;
    const list = s.deps.projects.list().filter(e => !e.trashed && !e.motion).sort((a, b) => b.modified - a.modified);
    if (!list.length) { toast('No hay dibujos ni animaciones en la galería.'); return; }
    let chosen = list[0].id;
    const urls: string[] = [];
    const grid = h('div', { class: 'mo-gallerypick', role: 'radiogroup', 'aria-label': 'Proyectos' });
    const layerSel = h('select', { 'aria-label': 'Capa' }, h('option', { value: '' }, 'Todas las capas'));
    const paper = h('input', { type: 'checkbox', checked: true });
    const loadLayers = async (id: string) => {
      layerSel.replaceChildren(h('option', { value: '' }, 'Todas las capas'));
      try {
        const bytes = await s.deps.projects.read(id);
        const files = unzipSync(bytes, { filter: f => f.name === 'project.json' });
        const p = JSON.parse(strFromU8(files['project.json']));
        for (const l of (p.document?.layers ?? []) as { id: string; name: string }[]) layerSel.append(h('option', { value: l.id }, l.name));
      } catch { /* sin capas: todas */ }
    };
    for (const e of list) {
      const img = h('img', { alt: '', loading: 'lazy' });
      void s.deps.projects.thumb(e.id).then(b => { if (b) { const u = URL.createObjectURL(new Blob([b as Uint8Array<ArrayBuffer>], { type: 'image/png' })); urls.push(u); img.src = u; } });
      const b = h('button', { type: 'button', role: 'radio', 'aria-checked': String(e.id === chosen), class: 'mo-gpitem' }, img, h('strong', null, e.name), h('span', null, e.anim ? `Animación · ${e.anim.frames} f` : `Dibujo · ${e.width}×${e.height}`));
      b.addEventListener('click', () => { chosen = e.id; grid.querySelectorAll('button').forEach(x => x.setAttribute('aria-checked', String(x === b))); void loadLayers(e.id); });
      grid.append(b);
    }
    void loadLayers(chosen);
    const ok = await modal({
      title: 'Usar un dibujo de YOSADRAW', wide: true,
      body: [h('p', { class: 'ctl-help' }, 'Se usa el proyecto tal como está en la galería (con su transparencia). Si después lo editas en YOSADRAW, aquí aparece «actualizar»: el original nunca cambia.'), grid,
        h('div', { class: 'mo-row' }, h('label', null, 'Capa ', layerSel), h('label', { class: 'mo-check' }, paper, ' Incluir el papel (fondo)'))],
      actions: [{ label: 'Cancelar', value: false, kind: 'ghost' }, { label: 'Añadir a la biblioteca', value: true, kind: 'primary' }],
    });
    for (const u of urls) URL.revokeObjectURL(u);
    if (!ok) return;
    try {
      const item = await s.media.fromProject(chosen, layerSel.value || null, paper.checked);
      if (layerSel.value) item.name = `${item.name} · ${layerSel.selectedOptions[0].textContent}`;
      s.edit(`Importar ${item.name}`, mm => { mm.media.push(item); });
      s.mediaChanged();
      toast(`«${item.name}» en la biblioteca: arrástralo a la línea de tiempo`, 'ok');
    } catch (e) { toast(e instanceof Error ? e.message : String(e), 'error'); }
  }
}

/** Panel de historial: cada paso del proyecto de vídeo; pulsar uno vuelve a ese punto. */
export class MHistory {
  readonly el = h('div', { class: 'mo-history', role: 'list' });
  constructor(private s: MotionStudio) { s.on('change', () => this.render()); s.on('open', () => this.render()); }
  render() {
    const hs = this.s.hist;
    this.el.replaceChildren();
    if (!hs) return;
    const item = (label: string, i: number, cls: string) => h('button', { type: 'button', role: 'listitem', class: `mo-hitem ${cls}`, on: { click: () => hs.goto(i) } }, label);
    this.el.append(item('Proyecto abierto', -1, hs.undoStack.length ? '' : 'current'));
    hs.undoStack.forEach((c, i) => this.el.append(item(c.label, i, i === hs.undoStack.length - 1 ? 'current' : '')));
    [...hs.redoStack].reverse().forEach((c, j) => this.el.append(item(c.label, hs.undoStack.length + j, 'redo')));
    this.el.querySelector('.current')?.scrollIntoView({ block: 'nearest' });
  }
}

/** Cuántos segundos dura el contenido de la composición (para el cartel vacío). */
export const contentEnd = (s: MotionStudio) => Math.max(0, ...s.comp.clips.map(clipEnd));

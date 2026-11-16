import { desktopBridge } from '../brush/storage';
import { PROJECT_EXT, ProjectFormatError, readProjectInfo } from '../project/format';
import { ConflictError, TRASH_DAYS, type Folder, type ProjectEntry, type ProjectLibrary } from '../project/library';
import type { NewProjectSpec, ProjectSession } from '../project/session';
import { h, IS_ARTIFACT, pickFiles, toast } from './dom';
import { isPhone, openSheet } from './Mobile';
import { confirmDialog, modal, promptText } from './modal';
import { openNewProject } from './NewProjectDialog';

/* ---------------------------------------------------------------- iconos */
const svg = (d: string, size = 20) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const GI = {
  grid: svg('<rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/>'),
  clock: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  star: svg('<path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/>'),
  starFill: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/></svg>',
  folder: svg('<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>'),
  trash: svg('<path d="M4 7h16M9.5 7V4.8a.8.8 0 0 1 .8-.8h3.4a.8.8 0 0 1 .8.8V7M6.5 7l.8 12.2a1 1 0 0 0 1 .8h7.4a1 1 0 0 0 1-.8L17.5 7"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>', 22),
  search: svg('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>', 18),
  import: svg('<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path d="M5 19h14"/>'),
  more: svg('<circle cx="5.5" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="18.5" cy="12" r="1.2" fill="currentColor"/>'),
  back: svg('<path d="M15 5 8 12l7 7"/>'),
  save: svg('<path d="M5 4h11l3 3v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>'),
  empty: svg('<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="m3.5 15 4.5-4.5 4 4 3-3 5.5 5.5"/><circle cx="15.5" cy="9" r="1.4"/>', 44),
};

type Section = 'all' | 'recent' | 'favorites' | 'folders' | 'trash';
type Orientation = 'any' | 'portrait' | 'landscape' | 'square';
type Sort = 'modified' | 'name' | 'created' | 'size';

const SECTIONS: { id: Section; label: string; icon: string }[] = [
  { id: 'all', label: 'Todos', icon: GI.grid },
  { id: 'recent', label: 'Recientes', icon: GI.clock },
  { id: 'favorites', label: 'Favoritos', icon: GI.star },
  { id: 'folders', label: 'Carpetas', icon: GI.folder },
  { id: 'trash', label: 'Papelera', icon: GI.trash },
];

const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });
export function ago(t: number): string {
  const s = (t - Date.now()) / 1000;
  const a = Math.abs(s);
  if (a < 45) return 'ahora mismo';
  if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  if (a < 86400 * 7) return rtf.format(Math.round(s / 86400), 'day');
  return new Date(t).toLocaleDateString('es', { day: 'numeric', month: 'short', year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}
const fullDate = (t: number) => new Date(t).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' });
export const fmtSize = (b: number) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1).replace('.', ',')} MB`);
const PROFILE: Record<string, string> = { srgb: 'sRGB', p3: 'Display P3', gray: 'Escala de grises' };

export interface GalleryHost {
  /** Muestra el editor (la galería se oculta). */
  showEditor(): void;
  /** Abre la ventana de exportación del proyecto abierto. */
  openExport(): void;
  /** Guarda preferencias de la galería. */
  persist(): void;
}

export interface GalleryPrefs { sort: Sort; orientation: Orientation; section: Section; lastNew: Partial<NewProjectSpec> | null }
export function normalizeGalleryPrefs(v: unknown): GalleryPrefs {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<GalleryPrefs>;
  return {
    sort: (['modified', 'name', 'created', 'size'] as Sort[]).includes(o.sort as Sort) ? o.sort as Sort : 'modified',
    orientation: (['any', 'portrait', 'landscape', 'square'] as Orientation[]).includes(o.orientation as Orientation) ? o.orientation as Orientation : 'any',
    section: SECTIONS.some(s => s.id === o.section) ? o.section as Section : 'all',
    lastNew: o.lastNew && typeof o.lastNew === 'object' ? o.lastNew : null,
  };
}

/**
 * Galería de proyectos y flujo de archivos (abrir, nuevo, guardar, guardar
 * como, versiones, recuperación). Es lo primero que se ve al abrir la app.
 */
export class Gallery {
  readonly el: HTMLElement;
  private section: Section;
  private folder: string | null = null;
  private query = '';
  private unsavedOnly = false;
  private thumbs = new Map<string, { key: string; url: string }>();
  private grid: HTMLElement;
  private head: HTMLElement;
  private nav: HTMLElement;
  private renderReq = 0;
  visible = false;

  constructor(private lib: ProjectLibrary, private session: ProjectSession, private host: GalleryHost, public prefs: GalleryPrefs) {
    this.section = prefs.section;
    const search = h('input', { type: 'search', class: 'g-search-input', placeholder: 'Buscar proyectos', 'aria-label': 'Buscar proyectos', spellcheck: 'false', autocomplete: 'off' });
    search.addEventListener('input', () => { this.query = search.value.trim().toLowerCase(); this.render(); });
    this.nav = h('nav', { class: 'g-nav', 'aria-label': 'Secciones' });
    this.head = h('div', { class: 'g-head' });
    this.grid = h('div', { class: 'g-content' });
    this.el = h('div', { class: 'gallery', id: 'gallery', 'aria-label': 'Galería de proyectos' },
      h('header', { class: 'g-top' },
        h('div', { class: 'brand' }, h('img', { class: 'brand-mark', src: (document.querySelector('.brand-mark') as HTMLImageElement | null)?.src ?? '', alt: '', width: '48', height: '36' }), h('span', { class: 'wordmark' }, 'YOSA', h('b', null, 'DRAW'))),
        h('label', { class: 'g-search', html: GI.search }, search),
        h('div', { class: 'g-top-actions' },
          h('button', { type: 'button', class: 'btn g-import', title: 'Importar un proyecto .yosa o una imagen', on: { click: () => void this.importFiles() }, html: `${GI.import}<span>Importar</span>` }),
          h('button', { type: 'button', class: 'btn primary g-new', on: { click: () => void this.newProject() }, html: `${GI.plus}<span>Nuevo proyecto</span>` }))),
      h('div', { class: 'g-body' }, this.nav, h('main', { class: 'g-main' }, this.head, this.grid)),
      h('button', { type: 'button', class: 'g-fab', 'aria-label': 'Nuevo proyecto', on: { click: () => void this.newProject() }, html: GI.plus }));
    lib.on('change', () => this.schedule());
    this.el.addEventListener('keydown', e => this.onKey(e));
  }

  // ---------------------------------------------------------------- visibilidad

  show() {
    this.visible = true;
    document.body.classList.add('view-gallery');
    this.el.hidden = false;
    this.render();
    (this.el.querySelector('.g-card, .g-new') as HTMLElement | null)?.focus({ preventScroll: true });
  }
  hide() { this.visible = false; document.body.classList.remove('view-gallery'); this.el.hidden = true; }

  private schedule() { if (this.renderReq || !this.visible) return; this.renderReq = requestAnimationFrame(() => { this.renderReq = 0; this.render(); }); }

  // ---------------------------------------------------------------- render

  private setSection(s: Section) { this.section = s; this.folder = null; this.unsavedOnly = false; this.prefs.section = s; this.host.persist(); this.render(); }

  private visibleEntries(): ProjectEntry[] {
    const all = this.lib.list();
    let list = this.section === 'trash' ? all.filter(e => e.trashed) : all.filter(e => !e.trashed);
    if (this.section === 'favorites') list = list.filter(e => e.favorite);
    if (this.section === 'folders') list = this.folder ? list.filter(e => e.folder === this.folder) : [];
    if (this.section === 'recent') {
      const since = Date.now() - 14 * 86_400_000;
      list = list.filter(e => Math.max(e.opened, e.modified) > since).sort((a, b) => Math.max(b.opened, b.modified) - Math.max(a.opened, a.modified)).slice(0, 30);
    }
    if (this.query) list = list.filter(e => e.name.toLowerCase().includes(this.query));
    const o = this.prefs.orientation;
    if (o !== 'any') list = list.filter(e => (o === 'square' ? Math.abs(e.width - e.height) <= Math.max(e.width, e.height) * 0.02 : o === 'portrait' ? e.height > e.width * 1.02 : e.width > e.height * 1.02));
    if (this.unsavedOnly) list = list.filter(e => e.recovery);
    if (this.section !== 'recent') {
      const s = this.prefs.sort;
      list.sort((a, b) => s === 'name' ? a.name.localeCompare(b.name, 'es', { numeric: true }) : s === 'created' ? b.created - a.created : s === 'size' ? b.size - a.size : (this.section === 'trash' ? (b.trashed ?? 0) - (a.trashed ?? 0) : b.modified - a.modified));
    }
    return list;
  }

  render() {
    const all = this.lib.list();
    const live = all.filter(e => !e.trashed);
    const counts: Record<Section, number> = {
      all: live.length, recent: live.filter(e => Math.max(e.opened, e.modified) > Date.now() - 14 * 86_400_000).length,
      favorites: live.filter(e => e.favorite).length, folders: this.lib.folders.length, trash: all.length - live.length,
    };
    this.nav.replaceChildren(...SECTIONS.map(s => h('button', {
      type: 'button', class: 'g-nav-item', 'aria-current': String(s.id === this.section), on: { click: () => this.setSection(s.id) },
      html: `${s.icon}<span class="g-nav-label">${s.label}</span><span class="g-count">${counts[s.id] || ''}</span>`,
    })));
    this.renderHead();
    if (this.lib.storeKind === 'memory') this.head.prepend(h('p', { class: 'ex-warn' }, 'Este navegador no permite guardar datos aquí: los proyectos sólo duran mientras la página esté abierta. Exporta el archivo .yosa para conservarlos, o usa la app de escritorio o de Android.'));
    if (this.section === 'folders' && !this.folder) { this.renderFolders(); return; }
    // Miniaturas de proyectos que ya no existen: se liberan.
    for (const [id, t] of this.thumbs) if (!this.lib.get(id)) { URL.revokeObjectURL(t.url); this.thumbs.delete(id); }
    const list = this.visibleEntries();
    if (!list.length) { this.grid.replaceChildren(this.emptyState()); return; }
    const cards = list.map((e, i) => this.card(e, i));
    this.grid.replaceChildren(h('div', { class: 'g-grid', role: 'list' }, ...cards));
  }

  private renderHead() {
    const folder = this.folder ? this.lib.folders.find(f => f.id === this.folder) : null;
    const title = folder ? folder.name : SECTIONS.find(s => s.id === this.section)!.label;
    const crumbs = folder ? h('button', { type: 'button', class: 'link g-crumb', on: { click: () => { this.folder = null; this.render(); } } }, '‹ Carpetas') : null;
    const sortSel = h('select', { class: 'g-sort', 'aria-label': 'Ordenar' },
      ...([['modified', 'Modificado'], ['name', 'Nombre'], ['created', 'Creado'], ['size', 'Tamaño']] as [Sort, string][]).map(([v, l]) => h('option', { value: v, selected: v === this.prefs.sort ? true : undefined }, l)));
    sortSel.value = this.prefs.sort;
    sortSel.addEventListener('change', () => { this.prefs.sort = sortSel.value as Sort; this.host.persist(); this.render(); });
    const chip = (label: string, on: boolean, click: () => void) => h('button', { type: 'button', class: 'chip-btn', 'aria-pressed': String(on), on: { click } }, label);
    const orient = (['any', 'portrait', 'landscape', 'square'] as Orientation[]).map(o => chip({ any: 'Todas', portrait: 'Vertical', landscape: 'Horizontal', square: 'Cuadrado' }[o], this.prefs.orientation === o, () => { this.prefs.orientation = o; this.host.persist(); this.render(); }));
    const showFilters = !(this.section === 'folders' && !this.folder);
    const actions: HTMLElement[] = [];
    if (this.section === 'trash' && this.lib.list().some(e => e.trashed)) actions.push(h('button', { type: 'button', class: 'btn sm danger', on: { click: () => void this.emptyTrash() } }, 'Vaciar papelera'));
    if (this.section === 'folders' && !this.folder) actions.push(h('button', { type: 'button', class: 'btn sm', on: { click: () => void this.newFolder() }, html: `${GI.plus}<span>Nueva carpeta</span>` }));
    if (folder) actions.push(h('button', { type: 'button', class: 'icon sm', title: 'Opciones de la carpeta', 'aria-label': 'Opciones de la carpeta', html: GI.more, on: { click: (e: Event) => this.folderMenu(folder, e.currentTarget as HTMLElement) } }));
    this.head.replaceChildren(...[
      h('div', { class: 'g-title-row' }, h('div', null, crumbs, h('h1', { class: 'g-title' }, title),
        this.section === 'trash' ? h('p', { class: 'muted' }, `Los proyectos se borran definitivamente a los ${TRASH_DAYS} días.`) : null), h('div', { class: 'g-head-actions' }, ...actions)),
      showFilters ? h('div', { class: 'g-filters' },
        h('div', { class: 'ex-chips', role: 'group', 'aria-label': 'Orientación' }, ...orient),
        this.section !== 'trash' ? chip('Sin guardar', this.unsavedOnly, () => { this.unsavedOnly = !this.unsavedOnly; this.render(); }) : null,
        this.section !== 'recent' ? h('label', { class: 'g-sort-wrap' }, h('span', null, 'Ordenar por'), sortSel) : null) : null,
    ].filter((x): x is HTMLDivElement => !!x));
  }

  private emptyState() {
    const msgs: Record<Section, [string, string]> = {
      all: ['Aún no hay proyectos', 'Crea un lienzo nuevo o importa una imagen o un archivo .yosa.'],
      recent: ['Nada reciente', 'Los proyectos que abras o modifiques aparecerán aquí.'],
      favorites: ['Sin favoritos', 'Marca un proyecto con la estrella para tenerlo a mano.'],
      folders: ['Carpeta vacía', 'Mueve proyectos aquí desde su menú (Mover a carpeta).'],
      trash: ['La papelera está vacía', 'Los proyectos eliminados se guardan aquí 30 días.'],
    };
    const [t, d] = this.query || this.prefs.orientation !== 'any' || this.unsavedOnly ? ['Sin resultados', 'Ningún proyecto coincide con la búsqueda o los filtros.'] : msgs[this.section];
    return h('div', { class: 'g-empty' }, h('span', { class: 'g-empty-icon', html: GI.empty }), h('h2', null, t), h('p', { class: 'muted' }, d),
      this.section === 'all' && !this.query ? h('button', { type: 'button', class: 'btn primary', on: { click: () => void this.newProject() }, html: `${GI.plus}<span>Nuevo proyecto</span>` }) : null);
  }

  private renderFolders() {
    const live = this.lib.list().filter(e => !e.trashed);
    const tiles = this.lib.folders.filter(f => !this.query || f.name.toLowerCase().includes(this.query)).sort((a, b) => a.name.localeCompare(b.name, 'es')).map((f, i) => {
      const items = live.filter(e => e.folder === f.id).sort((a, b) => b.modified - a.modified);
      const peek = items.slice(0, 3).map(e => { const img = h('img', { alt: '', loading: 'lazy', decoding: 'async' }); void this.thumbUrl(e).then(u => { if (u) img.src = u; }); return img; });
      return h('div', { class: 'g-folder', role: 'listitem', style: { '--i': String(i) } },
        h('button', { type: 'button', class: 'g-folder-open', on: { click: () => { this.folder = f.id; this.render(); } } },
          h('span', { class: 'g-folder-peek' }, ...peek, peek.length ? null : h('span', { class: 'g-folder-icon', html: GI.folder })),
          h('span', { class: 'g-folder-name' }, f.name), h('span', { class: 'g-meta' }, `${items.length} ${items.length === 1 ? 'proyecto' : 'proyectos'}`)),
        h('button', { type: 'button', class: 'icon sm g-more', 'aria-label': `Opciones de ${f.name}`, html: GI.more, on: { click: (e: Event) => this.folderMenu(f, e.currentTarget as HTMLElement) } }));
    });
    this.grid.replaceChildren(tiles.length ? h('div', { class: 'g-grid g-folders', role: 'list' }, ...tiles)
      : h('div', { class: 'g-empty' }, h('span', { class: 'g-empty-icon', html: GI.folder }), h('h2', null, 'Sin carpetas'), h('p', { class: 'muted' }, 'Agrupa tus proyectos por tema o cliente.'),
        h('button', { type: 'button', class: 'btn primary', on: { click: () => void this.newFolder() } }, 'Crear carpeta')));
  }

  private async thumbUrl(e: ProjectEntry): Promise<string | null> {
    const key = `${e.modified}:${e.rev}`;
    const c = this.thumbs.get(e.id);
    if (c?.key === key) return c.url;
    const bytes = await this.lib.thumb(e.id).catch(() => null);
    if (!bytes) return null;
    if (c) URL.revokeObjectURL(c.url);
    const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/png' }));
    this.thumbs.set(e.id, { key, url });
    return url;
  }

  private card(e: ProjectEntry, i: number): HTMLElement {
    const img = h('img', { alt: '', loading: 'lazy', decoding: 'async', draggable: 'false' });
    void this.thumbUrl(e).then(u => { if (u) { img.src = u; img.decode?.().then(() => img.classList.add('in')).catch(() => img.classList.add('in')); } });
    const trashed = !!e.trashed;
    const fav = h('button', {
      type: 'button', class: 'g-fav', 'aria-pressed': String(e.favorite), title: e.favorite ? 'Quitar de favoritos' : 'Añadir a favoritos', 'aria-label': 'Favorito', hidden: trashed,
      html: e.favorite ? GI.starFill : svg('<path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/>', 18),
      on: { click: (ev: Event) => { ev.stopPropagation(); void this.lib.update(e.id, { favorite: !e.favorite }); } },
    });
    const open = this.session.entry?.id === e.id;
    const days = trashed ? Math.max(0, TRASH_DAYS - Math.floor((Date.now() - e.trashed!) / 86_400_000)) : 0;
    const card = h('article', {
      class: `g-card${open ? ' is-open' : ''}`, role: 'listitem', tabindex: '0', 'aria-label': `${e.name}, ${e.width} × ${e.height}${e.recovery ? ', cambios sin guardar' : ''}`, dataset: { id: e.id }, style: { '--i': String(Math.min(i, 24)) },
    },
      h('div', { class: `g-thumb${e.background === null ? ' transparent' : ''}` }, img, fav,
        e.recovery && !trashed ? h('span', { class: 'g-badge', title: `Copia de recuperación del ${fullDate(e.recovery)}` }, h('span', { class: 'dot' }), 'Sin guardar') : null,
        open ? h('span', { class: 'g-badge open' }, 'Abierto') : null),
      h('div', { class: 'g-info' },
        h('div', { class: 'g-name', title: e.name }, e.name),
        h('div', { class: 'g-meta' }, trashed ? `Se borrará en ${days} ${days === 1 ? 'día' : 'días'}` : `Modificado ${ago(e.modified)}`),
        h('div', { class: 'g-meta g-specs' }, `${e.width} × ${e.height} · ${PROJECT_EXT.toUpperCase()}${e.source !== 'yosa' ? ` (de ${e.source.toUpperCase()})` : ''} · ${e.anim ? `animación · ${e.anim.frames} f · ${e.anim.fps} fps` : `${e.layers} ${e.layers === 1 ? 'capa' : 'capas'}`}`)),
      h('button', { type: 'button', class: 'icon sm g-more', 'aria-label': `Opciones de ${e.name}`, title: 'Opciones', html: GI.more, on: { click: (ev: Event) => { ev.stopPropagation(); this.cardMenu(e, ev.currentTarget as HTMLElement); } } }));
    card.addEventListener('click', () => { if (trashed) this.cardMenu(e, card.querySelector('.g-more')!); else void this.open(e.id); });
    card.addEventListener('contextmenu', ev => { ev.preventDefault(); this.cardMenu(e, card.querySelector('.g-more')!); });
    // Mantener pulsado (táctil): menú del proyecto.
    let timer = 0, sx = 0, sy = 0, fired = false;
    card.addEventListener('pointerdown', ev => { if (ev.pointerType === 'mouse') return; fired = false; sx = ev.clientX; sy = ev.clientY; timer = window.setTimeout(() => { fired = true; try { navigator.vibrate?.(10); } catch { /* */ } this.cardMenu(e, card.querySelector('.g-more')!); }, 520); });
    card.addEventListener('pointermove', ev => { if (timer && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 10) { clearTimeout(timer); timer = 0; } });
    for (const t of ['pointerup', 'pointercancel', 'pointerleave']) card.addEventListener(t, () => { clearTimeout(timer); timer = 0; });
    card.addEventListener('click', ev => { if (fired) { ev.stopImmediatePropagation(); fired = false; } }, true);
    return card;
  }

  private onKey(e: KeyboardEvent) {
    const card = (e.target as HTMLElement).closest?.('.g-card') as HTMLElement | null;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); void this.newProject(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); (this.el.querySelector('.g-search-input') as HTMLElement).focus(); return; }
    if (!card || e.target !== card) return;
    const entry = this.lib.get(card.dataset.id!);
    if (!entry) return;
    if (e.key === 'Enter') { e.preventDefault(); void this.open(entry.id); }
    else if (e.key === 'Delete') { e.preventDefault(); void (entry.trashed ? this.deleteForever(entry) : this.trash(entry)); }
    else if (e.key === 'F2') { e.preventDefault(); void this.rename(entry); }
    else if (e.key.startsWith('Arrow')) {
      const cards = [...this.el.querySelectorAll<HTMLElement>('.g-card')];
      const i = cards.indexOf(card);
      const cols = Math.max(1, Math.round((card.parentElement!.clientWidth) / card.offsetWidth));
      const j = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'ArrowDown' ? i + cols : i - cols;
      cards[Math.max(0, Math.min(cards.length - 1, j))]?.focus();
      e.preventDefault();
    }
  }

  // ---------------------------------------------------------------- menús

  /** Menú emergente (hoja inferior en el teléfono); también lo usa el editor. */
  popupMenu(anchor: HTMLElement, title: string, items: { label: string; run: () => void; danger?: boolean }[]) { this.menu(anchor, title, items); }

  /** Renombrar el proyecto abierto en el editor. */
  async renameOpen() { const e = this.session.entry && this.lib.get(this.session.entry.id); if (e) { await this.rename(e); this.session.refresh(); } }

  private menu(anchor: HTMLElement, title: string, items: ({ label: string; run: () => void; danger?: boolean } | null)[]) {
    const list = items.filter((x): x is { label: string; run: () => void; danger?: boolean } => !!x);
    if (isPhone()) {
      openSheet(title, close => [h('div', { class: 'action-list' }, ...list.map(it => h('button', { type: 'button', class: `action-item${it.danger ? ' danger' : ''}`, on: { click: () => { close(); it.run(); } } }, it.label)))]);
      return;
    }
    document.querySelector('.menu.g-menu')?.remove();
    const m = h('div', { class: 'menu g-menu', role: 'menu', 'aria-label': title });
    const close = () => { m.remove(); document.removeEventListener('pointerdown', outside, true); anchor.focus(); };
    const outside = (e: Event) => { if (!m.contains(e.target as Node)) close(); };
    for (const it of list) {
      if (it.danger && m.lastElementChild?.tagName === 'BUTTON') m.append(h('hr'));
      m.append(h('button', { type: 'button', role: 'menuitem', class: it.danger ? 'danger' : '', on: { click: () => { close(); it.run(); } } }, it.label));
    }
    m.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const b = [...m.querySelectorAll('button')]; const i = b.indexOf(document.activeElement as HTMLButtonElement); b[(i + (e.key === 'ArrowDown' ? 1 : -1) + b.length) % b.length].focus(); }
    });
    document.body.append(m);
    const r = anchor.getBoundingClientRect();
    const mw = m.offsetWidth, mh = m.offsetHeight;
    m.style.left = `${Math.max(8, Math.min(innerWidth - mw - 8, r.right - mw))}px`;
    m.style.top = `${r.bottom + mh + 8 > innerHeight ? Math.max(8, r.top - mh - 6) : r.bottom + 6}px`;
    setTimeout(() => document.addEventListener('pointerdown', outside, true));
    (m.querySelector('button') as HTMLElement).focus();
  }

  private cardMenu(e: ProjectEntry, anchor: HTMLElement) {
    if (e.trashed) {
      this.menu(anchor, e.name, [
        { label: 'Restaurar', run: () => void this.lib.restore(e.id).then(() => toast(`«${e.name}» restaurado`, 'ok')) },
        { label: 'Información', run: () => void this.info(e) },
        { label: 'Eliminar definitivamente…', danger: true, run: () => void this.deleteForever(e) },
      ]);
      return;
    }
    this.menu(anchor, e.name, [
      { label: 'Abrir', run: () => void this.open(e.id) },
      { label: 'Renombrar…', run: () => void this.rename(e) },
      { label: 'Duplicar', run: () => void this.duplicate(e) },
      { label: e.favorite ? 'Quitar de favoritos' : 'Añadir a favoritos', run: () => void this.lib.update(e.id, { favorite: !e.favorite }) },
      { label: 'Mover a carpeta…', run: () => void this.moveToFolder(e) },
      { label: 'Exportar imagen…', run: () => void this.exportImage(e) },
      IS_ARTIFACT ? null : { label: `Exportar archivo .${PROJECT_EXT}`, run: () => void this.exportNative(e) },
      { label: 'Historial de versiones…', run: () => void this.versions(e) },
      { label: 'Información', run: () => void this.info(e) },
      { label: 'Eliminar', danger: true, run: () => void this.trash(e) },
    ]);
  }

  private folderMenu(f: Folder, anchor: HTMLElement) {
    this.menu(anchor, f.name, [
      { label: 'Abrir', run: () => { this.folder = f.id; this.render(); } },
      { label: 'Renombrar…', run: async () => { const n = await promptText('Renombrar carpeta', f.name); if (n) await this.lib.renameFolder(f.id, n); } },
      { label: 'Eliminar carpeta…', danger: true, run: async () => {
        if (await confirmDialog('Eliminar carpeta', `Se elimina la carpeta «${f.name}». Sus proyectos no se borran: vuelven a Todos.`, 'Eliminar carpeta', true)) { await this.lib.deleteFolder(f.id); this.folder = null; this.render(); }
      } },
    ]);
  }

  // ---------------------------------------------------------------- acciones

  private async run<T>(what: string, fn: () => Promise<T>): Promise<T | undefined> {
    try { return await fn(); }
    catch (err) {
      const msg = err instanceof ProjectFormatError || err instanceof Error ? err.message : String(err);
      toast(`${what}: ${msg}`, 'error');
      return undefined;
    }
  }

  /** Abre un proyecto (pregunta si hay cambios sin guardar del abierto o una recuperación pendiente). */
  async open(id: string) {
    const e = this.lib.get(id);
    if (!e) return;
    if (this.session.entry?.id === id) { this.host.showEditor(); return; }
    if (!(await this.confirmLeave())) return;
    let recovery = false;
    if (e.recovery) {
      const choice = await modal<'recover' | 'saved'>({
        title: 'Cambios sin guardar',
        body: [`«${e.name}» tiene cambios que no se guardaron (copia de recuperación del ${fullDate(e.recovery)}). Lo guardado es del ${fullDate(e.modified)}.`],
        actions: [{ label: 'Cancelar', value: null as never, kind: 'ghost' }, { label: 'Abrir lo guardado', value: 'saved' }, { label: 'Recuperar cambios', value: 'recover', kind: 'primary' }],
      });
      if (!choice) return;
      recovery = choice === 'recover';
      if (!recovery && !(await confirmDialog('Descartar la recuperación', 'La copia de recuperación se borrará y se abrirá la última versión guardada.', 'Descartar y abrir', true))) return;
      if (!recovery) await this.lib.discardRecovery(id);
    }
    await this.run('No se pudo abrir', async () => {
      this.busy(true, 'Abriendo…');
      try { await this.session.open(id, { recovery }); } finally { this.busy(false); }
      this.host.showEditor();
      if (recovery) toast('Cambios recuperados. Guarda para conservarlos en el proyecto.', 'ok');
    });
  }

  /** Antes de cerrar el proyecto abierto: guardar, no guardar o cancelar. */
  async confirmLeave(): Promise<boolean> {
    const s = this.session;
    if (!s.entry || !s.dirty) return true;
    const choice = await modal<'save' | 'discard'>({
      title: 'Cambios sin guardar',
      body: [`¿Guardar los cambios de «${s.entry.name}» antes de cerrarlo?`],
      actions: [{ label: 'Cancelar', value: null as never, kind: 'ghost' }, { label: 'No guardar', value: 'discard', kind: 'danger' }, { label: 'Guardar', value: 'save', kind: 'primary' }],
    });
    if (!choice) return false;
    if (choice === 'discard') { await s.discardChanges(); return true; }
    return this.save();
  }

  /** Guardar (con aviso si otra ventana guardó antes). Devuelve true si quedó guardado. */
  async save(): Promise<boolean> {
    const s = this.session;
    if (!s.entry) return false;
    try { await s.save(); toast(`Guardado «${s.entry.name}»`, 'ok'); return true; }
    catch (err) {
      if (err instanceof ConflictError) {
        const c = await modal<'copy' | 'overwrite'>({
          title: 'El proyecto cambió en otra ventana',
          body: [`«${err.current.name}» se guardó el ${fullDate(err.current.modified)} desde otra ventana o pestaña. Si lo sobrescribes, esa versión pasa al historial de versiones.`],
          actions: [{ label: 'Cancelar', value: null as never, kind: 'ghost' }, { label: 'Sobrescribir', value: 'overwrite', kind: 'danger' }, { label: 'Guardar como copia', value: 'copy', kind: 'primary' }],
        });
        if (c === 'overwrite') { await s.save(true); toast('Guardado', 'ok'); return true; }
        if (c === 'copy') { const e = await s.saveAs(this.lib.uniqueName(`${err.current.name} copia`)); toast(`Guardado como «${e.name}»`, 'ok'); return true; }
        return false;
      }
      toast(`No se pudo guardar: ${err instanceof Error ? err.message : String(err)}`, 'error');
      return false;
    }
  }

  async saveAs(): Promise<boolean> {
    const s = this.session;
    const base = s.entry?.name ?? 'Sin título';
    const name = await promptText('Guardar como', this.lib.uniqueName(`${base} copia`), { ok: 'Guardar' });
    if (!name) return false;
    const r = await this.run('No se pudo guardar', async () => {
      const finalName = this.lib.uniqueName(name);
      const e = await s.saveAs(finalName);
      toast(finalName === name ? `Guardado como «${e.name}»` : `Ya existía un proyecto con ese nombre: guardado como «${e.name}»`, 'ok');
      return true;
    });
    return !!r;
  }

  async newProject() {
    const spec = await openNewProject(this.lib.uniqueName('Sin título'), this.prefs.lastNew);
    if (!spec) return;
    if (!(await this.confirmLeave())) return;
    await this.run('No se pudo crear el proyecto', async () => {
      this.busy(true, 'Creando…');
      try { await this.session.create(spec, this.section === 'folders' ? this.folder : null); } finally { this.busy(false); }
      this.prefs.lastNew = { width: spec.width, height: spec.height, dpi: spec.dpi, background: spec.background, profile: spec.profile, anim: spec.anim ?? null };
      this.host.persist();
      this.host.showEditor();
    });
  }

  private async importFiles() {
    const files = await pickFiles(`.${PROJECT_EXT},image/png,image/jpeg,image/webp`, true);
    if (!files.length) return;
    const folder = this.section === 'folders' ? this.folder : null;
    let ok = 0;
    for (const f of files) {
      const r = await this.run(`No se pudo importar ${f.name}`, async () => {
        if (f.name.toLowerCase().endsWith(`.${PROJECT_EXT}`)) await this.lib.importFile(new Uint8Array(await f.arrayBuffer()), folder);
        else if (/^image\/(png|jpeg|webp)$/.test(f.type)) {
          if (files.length === 1) { if (!(await this.confirmLeave())) return false; await this.session.createFromImage(f, folder); this.host.showEditor(); }
          else await this.session.createFromImage(f, folder, false);
        } else throw new Error('formato no compatible (usa .yosa, PNG, JPEG o WebP)');
        return true;
      });
      if (r) ok++;
    }
    if (ok > 1 || (ok === 1 && this.visible)) toast(`${ok} ${ok === 1 ? 'proyecto importado' : 'proyectos importados'}`, 'ok');
  }

  private async rename(e: ProjectEntry) {
    const name = await promptText('Renombrar proyecto', e.name, { ok: 'Renombrar' });
    if (!name || name === e.name) return;
    const finalName = this.lib.uniqueName(name, e.id);
    await this.run('No se pudo renombrar', async () => {
      await this.lib.rename(e.id, finalName);
      if (this.session.entry?.id === e.id) this.session.entry = this.lib.get(e.id)!;
      if (finalName !== name) toast(`Ya existía «${name}»: se llama «${finalName}»`);
    });
  }

  private async duplicate(e: ProjectEntry) {
    if (this.session.entry?.id === e.id && this.session.dirty) toast('Se duplica la última versión guardada (los cambios sin guardar no se copian).');
    await this.run('No se pudo duplicar', async () => { const c = await this.lib.duplicate(e.id); toast(`Creado «${c.name}»`, 'ok'); });
  }

  private async moveToFolder(e: ProjectEntry) {
    let target: string | null | undefined;
    await modal({
      title: 'Mover a carpeta', className: 'move-dialog',
      body: [h('div', { class: 'action-list' },
        h('button', { type: 'button', class: `action-item${e.folder === null ? ' current' : ''}`, dataset: { f: '' } }, 'Sin carpeta (Todos)'),
        ...this.lib.folders.map(f => h('button', { type: 'button', class: `action-item${e.folder === f.id ? ' current' : ''}`, dataset: { f: f.id } }, f.name)),
        h('button', { type: 'button', class: 'action-item add', dataset: { f: '+' } }, '+ Nueva carpeta…'))],
      actions: [{ label: 'Cancelar', value: null, kind: 'ghost' }],
      onOpen: (root, close) => root.querySelectorAll<HTMLElement>('[data-f]').forEach(b => b.addEventListener('click', () => { target = b.dataset.f === '' ? null : b.dataset.f; close(null); })),
    });
    if (target === undefined) return;
    if (target === '+') { const n = await promptText('Nueva carpeta', 'Carpeta'); if (!n) return; target = (await this.lib.createFolder(n)).id; }
    await this.lib.update(e.id, { folder: target });
    const f = this.lib.folders.find(x => x.id === target);
    toast(f ? `Movido a «${f.name}»` : 'Movido a Todos', 'ok');
  }

  private async newFolder() {
    const n = await promptText('Nueva carpeta', 'Carpeta', { ok: 'Crear' });
    if (n) await this.lib.createFolder(n);
  }

  private async trash(e: ProjectEntry) {
    if (this.session.entry?.id === e.id) {
      if (!(await this.confirmLeave())) return;
      this.session.close();
    }
    await this.lib.trash(e.id);
    toast(`«${e.name}» está en la papelera`, 'info', { label: 'Deshacer', run: () => void this.lib.restore(e.id) });
  }

  private async deleteForever(e: ProjectEntry) {
    if (!(await confirmDialog('Eliminar definitivamente', `«${e.name}», su historial de versiones y su copia de recuperación se borrarán para siempre.`, 'Eliminar para siempre', true))) return;
    await this.run('No se pudo eliminar', () => this.lib.deleteForever(e.id));
  }

  private async emptyTrash() {
    const n = this.lib.list().filter(e => e.trashed).length;
    if (!(await confirmDialog('Vaciar papelera', `Se borrarán para siempre ${n} ${n === 1 ? 'proyecto' : 'proyectos'} con su historial.`, 'Vaciar papelera', true))) return;
    await this.run('No se pudo vaciar la papelera', () => this.lib.emptyTrash());
  }

  private async exportImage(e: ProjectEntry) {
    if (this.session.entry?.id !== e.id) await this.open(e.id);
    if (this.session.entry?.id === e.id) { this.host.showEditor(); this.host.openExport(); }
  }

  /** Exporta el archivo nativo: carpeta de exportación (escritorio), Descargas (Android) o descarga (web). */
  async exportNative(e: ProjectEntry) {
    await this.run('No se pudo exportar', async () => {
      if (this.session.entry?.id === e.id && this.session.dirty) toast('Se exporta la última versión guardada. Guarda antes para incluir los cambios.');
      const bytes = await this.lib.read(e.id);
      const name = `${e.name.replace(/[\\/:*?"<>|]+/g, '_')}.${PROJECT_EXT}`;
      const b = desktopBridge();
      if (b?.writeExport && b.exportFolder) {
        const path = await b.writeExport(await b.exportFolder(), name, bytes, false);
        const shown = b.describe?.(path).path ?? path;
        toast(`Exportado: ${shown}`, 'ok', b.platform === 'android' && b.shareFile ? { label: 'Compartir', run: () => void b.shareFile!(path) } : b.revealFile ? { label: 'Abrir carpeta', run: () => void b.revealFile!(path) } : undefined);
        return;
      }
      const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' }));
      const a = h('a', { href: url, download: name });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    });
  }

  async info(e: ProjectEntry) {
    const versions = await this.lib.versions(e.id).catch(() => []);
    const where = await this.lib.store.location().catch(() => '');
    const folder = this.lib.folders.find(f => f.id === e.folder)?.name ?? 'Sin carpeta';
    const dpiCm = (px: number) => ((px / e.dpi) * 2.54).toFixed(1).replace('.', ',');
    const rows: [string, string][] = [
      ['Nombre', e.name], ['Tamaño', `${e.width} × ${e.height} px (${((e.width * e.height) / 1e6).toFixed(1).replace('.', ',')} MP)`],
      ['Resolución', `${e.dpi} ppp · ${dpiCm(e.width)} × ${dpiCm(e.height)} cm impreso`], ['Fondo', e.background === null ? 'Transparente' : 'Blanco'],
      ['Perfil de color', PROFILE[e.profile]], ['Capas', String(e.layers)], ['Formato', `.${PROJECT_EXT} (YOSADRAW)${e.source !== 'yosa' ? ` · importado de ${e.source.toUpperCase()}` : ''}`],
      ['Tamaño del archivo', fmtSize(e.size)], ['Creado', fullDate(e.created)], ['Modificado', fullDate(e.modified)],
      ['Abierto', e.opened ? fullDate(e.opened) : '—'], ['Guardados', String(e.rev)], ['Versiones anteriores', String(versions.length)],
      ['Carpeta', folder], ['Favorito', e.favorite ? 'Sí' : 'No'],
      ['Cambios sin guardar', e.recovery ? `Sí (recuperación del ${fullDate(e.recovery)})` : this.session.entry?.id === e.id && this.session.dirty ? 'Sí (en el editor)' : 'No'],
      ['Ubicación', where],
    ];
    if (e.trashed) rows.push(['En la papelera desde', fullDate(e.trashed)]);
    const thumb = h('div', { class: `info-thumb g-thumb${e.background === null ? ' transparent' : ''}` }, h('img', { alt: '' }));
    void this.thumbUrl(e).then(u => { if (u) (thumb.firstElementChild as HTMLImageElement).src = u; });
    await modal({ title: 'Información del proyecto', wide: true, className: 'info-dialog', body: [h('div', { class: 'info-body' }, thumb, h('dl', { class: 'info-list' }, ...rows.flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)])))], actions: [{ label: 'Cerrar', value: null, kind: 'primary' }] });
  }

  async versions(e: ProjectEntry) {
    const list = await this.lib.versions(e.id);
    let chosen: { action: 'open' | 'copy' | 'delete'; key: string; time: number } | null = null;
    const rows = list.map(v => {
      const img = h('img', { alt: '' });
      const size = h('span', { class: 'muted' }, ago(v.time));
      // Miniatura y tamaño de cada versión (se leen sin decodificar las capas).
      void this.lib.readVersion(v.key).then(bytes => {
        size.textContent = `${ago(v.time)} · ${fmtSize(bytes.length)}`;
        const t = readProjectInfo(bytes).thumb;
        if (t) { img.src = URL.createObjectURL(new Blob([t as Uint8Array<ArrayBuffer>], { type: 'image/png' })); img.onload = () => URL.revokeObjectURL(img.src); }
      }).catch(() => undefined);
      return h('li', { class: 'version-row' },
      h('span', { class: `version-thumb${e.background === null ? ' transparent' : ''}` }, img),
      h('div', { class: 'version-info' }, h('strong', null, fullDate(v.time)), size),
      h('div', { class: 'version-actions' },
        h('button', { type: 'button', class: 'btn sm', dataset: { a: 'open', k: v.key, t: String(v.time) } }, 'Abrir'),
        h('button', { type: 'button', class: 'btn sm', dataset: { a: 'copy', k: v.key, t: String(v.time) } }, 'Guardar como copia'),
        h('button', { type: 'button', class: 'icon sm danger', title: 'Eliminar versión', 'aria-label': 'Eliminar versión', html: GI.trash, dataset: { a: 'delete', k: v.key, t: String(v.time) } })));
    });
    await modal({
      title: `Historial de versiones · ${e.name}`, wide: true, className: 'versions-dialog',
      body: [list.length
        ? h('div', null, h('p', { class: 'muted' }, 'Cada vez que guardas, lo que había antes se conserva aquí (las 15 más recientes). Abrir una versión la carga en el editor como cambios sin guardar; el proyecto no cambia hasta que guardes.'),
          h('div', { class: 'version-current' }, h('strong', null, 'Actual'), h('span', { class: 'muted' }, ` · guardado ${fullDate(e.modified)}`)),
          h('ul', { class: 'version-list' }, ...rows))
        : h('p', { class: 'muted' }, 'Todavía no hay versiones anteriores: se crean al volver a guardar el proyecto.')],
      actions: [{ label: 'Cerrar', value: null, kind: 'primary' }],
      onOpen: (root, close) => root.querySelectorAll<HTMLElement>('[data-a]').forEach(b => b.addEventListener('click', () => { chosen = { action: b.dataset.a as 'open', key: b.dataset.k!, time: Number(b.dataset.t) }; close(null); })),
    });
    const c = chosen as { action: 'open' | 'copy' | 'delete'; key: string; time: number } | null;
    if (!c) return;
    if (c.action === 'delete') {
      if (await confirmDialog('Eliminar versión', `La versión del ${fullDate(c.time)} se borrará.`, 'Eliminar', true)) { await this.lib.deleteVersion(c.key); void this.versions(e); }
      return;
    }
    if (c.action === 'copy') {
      await this.run('No se pudo crear la copia', async () => {
        const copy = await this.lib.importFile(await this.lib.readVersion(c.key), e.folder);
        await this.lib.rename(copy.id, this.lib.uniqueName(`${e.name} (${new Date(c.time).toLocaleDateString('es')})`, copy.id));
        toast(`Creado «${this.lib.get(copy.id)!.name}»`, 'ok');
      });
      return;
    }
    if (this.session.entry?.id !== e.id && !(await this.confirmLeave())) return;
    if (this.session.entry?.id === e.id && this.session.dirty && !(await confirmDialog('Abrir versión', 'Los cambios sin guardar del proyecto abierto se sustituirán por esta versión.', 'Abrir versión', true))) return;
    await this.run('No se pudo abrir la versión', async () => {
      await this.session.openVersion(e.id, c.key);
      this.host.showEditor();
      toast(`Versión del ${fullDate(c.time)} abierta. Guarda para conservarla como actual.`, 'ok');
    });
  }

  private busyEl: HTMLElement | null = null;
  private busy(on: boolean, label = '') {
    this.busyEl?.remove();
    this.busyEl = null;
    if (on) { this.busyEl = h('div', { class: 'g-busy', role: 'status' }, h('span', { class: 'spinner' }), label); document.body.append(this.busyEl); }
  }
}

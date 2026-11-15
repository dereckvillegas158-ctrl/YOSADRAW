import type { BrushLibrary } from '../brush/BrushLibrary';
import type { BrushPreset } from '../brush/BrushPreset';
import { copyText, fileSafe, h, IS_ARTIFACT, openTextFiles, saveTextFile, toast } from './dom';
import { ICONS } from './icons';
import type { Thumbnails } from './thumbnails';

type Target = 'brush' | 'eraser';

/**
 * Biblioteca de pinceles: elegir, crear, duplicar, editar, renombrar,
 * exportar, importar, restablecer y borrar. Las miniaturas se dibujan con el
 * motor real usando el color actual.
 */
export class LibraryPanel {
  readonly el: HTMLElement;
  private list: HTMLElement;
  private chips: HTMLElement;
  private targetLabel: HTMLElement;
  private filter = 'Todos';
  private menu: HTMLElement | null = null;
  target: Target = 'brush';
  color = '#ece6ff';
  onEdit: ((p: BrushPreset) => void) | null = null;

  constructor(private lib: BrushLibrary, private thumbs: Thumbnails) {
    this.list = h('ul', { class: 'brush-list', role: 'listbox', 'aria-label': 'Pinceles' });
    this.chips = h('div', { class: 'chips', role: 'tablist', 'aria-label': 'Categorías' });
    this.targetLabel = h('span', { class: 'target-chip' });
    this.el = h('section', { class: 'block library', 'aria-labelledby': 'lib-title' },
      h('div', { class: 'lib-head' },
        h('h2', { id: 'lib-title' }, 'Biblioteca'), this.targetLabel,
        h('div', { class: 'lib-actions' },
          h('button', { type: 'button', class: 'icon sm', title: 'Pincel nuevo', 'aria-label': 'Pincel nuevo', html: ICONS.plus, on: { click: () => this.createNew() } }),
          h('button', { type: 'button', class: 'icon sm', title: 'Importar pinceles (.yosabrush)', 'aria-label': 'Importar pinceles', html: ICONS.import, on: { click: () => this.openImport() } }),
          h('button', { type: 'button', class: 'icon sm', title: 'Más acciones', 'aria-label': 'Más acciones de la biblioteca', 'aria-haspopup': 'menu', html: ICONS.more, on: { click: (e: Event) => this.libraryMenu(e.currentTarget as HTMLElement) } }))),
      this.chips, this.list);
    lib.on('change', () => this.render());
    lib.on('active', () => this.render());
    document.addEventListener('pointerdown', e => { if (this.menu && !this.menu.contains(e.target as Node)) this.closeMenu(); }, true);
    this.render();
  }

  setTarget(t: Target) { this.target = t; this.render(); }
  setColor(c: string) { this.color = c; this.render(); }

  render() {
    const cats = this.lib.categories();
    if (this.filter !== 'Todos' && !cats.includes(this.filter)) this.filter = 'Todos';
    this.targetLabel.textContent = this.target === 'brush' ? 'para Pincel' : 'para Borrador';
    this.chips.replaceChildren(...['Todos', ...cats].map(c => h('button', {
      type: 'button', role: 'tab', 'aria-selected': String(c === this.filter), on: { click: () => { this.filter = c; this.render(); } },
    }, c)));
    const activeId = this.lib.activeId(this.target);
    const items = this.lib.presets.filter(p => this.filter === 'Todos' || p.category === this.filter);
    this.list.replaceChildren(...items.map(p => this.item(p, p.id === activeId)));
  }

  private item(p: BrushPreset, active: boolean): HTMLElement {
    const thumb = this.thumbs.stroke(p, this.color, 150, 40);
    const modified = this.lib.isModified(p);
    const li = h('li', {
      class: 'brush-item', role: 'option', 'aria-selected': String(active), tabindex: '0', title: 'Clic: usar · Doble clic: editar',
      on: {
        click: () => this.lib.setActive(this.target, p.id),
        dblclick: () => this.onEdit?.(p),
        keydown: (e: Event) => { const k = (e as KeyboardEvent).key; if (k === 'Enter') this.onEdit?.(p); if (k === ' ') { e.preventDefault(); this.lib.setActive(this.target, p.id); } },
      },
    },
      h('span', { class: 'thumb' }, thumb),
      h('span', { class: 'brush-meta' }, h('span', { class: 'brush-name' }, p.name), h('span', { class: 'brush-cat' }, modified ? `${p.category} · modificado` : p.category)),
      h('button', { type: 'button', class: 'icon sm', 'aria-label': `Acciones de ${p.name}`, 'aria-haspopup': 'menu', html: ICONS.more, on: { click: (e: Event) => { e.stopPropagation(); this.brushMenu(e.currentTarget as HTMLElement, p); } } }));
    return li;
  }

  /* ---------- Menús ---------- */

  private closeMenu() { this.menu?.remove(); this.menu = null; }

  private showMenu(anchor: HTMLElement, items: (HTMLElement | null)[]) {
    this.closeMenu();
    const m = h('div', { class: 'menu', role: 'menu' }, ...items.filter((x): x is HTMLElement => !!x));
    document.body.append(m);
    const r = anchor.getBoundingClientRect();
    const mw = 220;
    m.style.left = `${Math.max(8, Math.min(window.innerWidth - mw - 8, r.right - mw))}px`;
    m.style.top = `${Math.min(window.innerHeight - m.offsetHeight - 8, r.bottom + 4)}px`;
    m.addEventListener('keydown', e => { if (e.key === 'Escape') { this.closeMenu(); anchor.focus(); } });
    this.menu = m;
    (m.querySelector('button') as HTMLElement | null)?.focus();
  }

  private mi(label: string, fn: () => void, cls = ''): HTMLElement {
    return h('button', { type: 'button', role: 'menuitem', class: cls, on: { click: () => { fn(); } } }, label);
  }

  private brushMenu(anchor: HTMLElement, p: BrushPreset) {
    const del = h('div', { class: 'menu-confirm' });
    const askDelete = this.mi('Eliminar…', () => {
      del.replaceChildren(h('span', null, `¿Eliminar «${p.name}»?`),
        this.mi('Eliminar', () => { this.closeMenu(); if (this.lib.remove(p.id)) toast(`Eliminado «${p.name}»`, 'ok'); else toast('La biblioteca necesita al menos un pincel', 'error'); }, 'danger'),
        this.mi('Cancelar', () => this.closeMenu()));
      askDelete.remove();
      (del.querySelector('button') as HTMLElement).focus();
    }, 'danger');
    this.showMenu(anchor, [
      this.mi('Editar en Brush Studio', () => { this.closeMenu(); this.onEdit?.(p); }),
      this.mi('Duplicar', () => { this.closeMenu(); const d = this.lib.duplicate(p.id); if (d) toast(`Creado «${d.name}»`, 'ok'); }),
      this.mi(IS_ARTIFACT ? 'Copiar como .yosabrush (JSON)' : 'Exportar…', () => { this.closeMenu(); void this.exportPresets([p.id], `${fileSafe(p.name)}.yosabrush`); }),
      this.lib.isModified(p) ? this.mi('Restablecer de fábrica', () => { this.closeMenu(); this.lib.reset(p.id); toast('Restablecido', 'ok'); }) : null,
      h('hr'), askDelete, del,
    ]);
  }

  private libraryMenu(anchor: HTMLElement) {
    this.showMenu(anchor, [
      this.mi('Pincel nuevo', () => { this.closeMenu(); this.createNew(); }),
      this.mi('Importar pinceles…', () => { this.closeMenu(); this.openImport(); }),
      this.mi(IS_ARTIFACT ? 'Copiar biblioteca (JSON)' : 'Exportar biblioteca…', () => { this.closeMenu(); void this.exportPresets(undefined, 'biblioteca-yosadraw.yosabrush'); }),
      this.mi('Restaurar pinceles de fábrica', () => { this.closeMenu(); const n = this.lib.restoreFactory(); toast(n ? `${n} pinceles de fábrica restaurados` : 'Ya están todos los pinceles de fábrica', 'ok'); }),
      this.mi('Guardar ahora', () => { this.closeMenu(); void this.lib.saveNow(); }),
    ]);
  }

  private createNew() {
    const p = this.lib.create(this.filter !== 'Todos' ? this.filter : 'Mis pinceles');
    this.lib.setActive(this.target, p.id);
    this.onEdit?.(p);
  }

  async exportPresets(ids: string[] | undefined, name: string) {
    const json = this.lib.exportJSON(ids);
    if (IS_ARTIFACT) {
      const ok = await copyText(json);
      toast(ok ? 'JSON copiado al portapapeles' : 'No se pudo copiar al portapapeles', ok ? 'ok' : 'error');
      return;
    }
    try {
      if (await saveTextFile(name, json)) toast('Pinceles exportados', 'ok');
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo exportar', 'error'); }
  }

  /* ---------- Importar ---------- */

  openImport() {
    const ta = h('textarea', { id: 'import-json', rows: '6', placeholder: 'Pega aquí el contenido de un archivo .yosabrush', spellcheck: 'false' });
    const report = h('p', { class: 'import-report', role: 'status' });
    const close = () => dlg.remove();
    const apply = (text: string, source: string) => {
      const res = this.lib.importJSON(text, source);
      const msg = [res.added.length ? `${res.added.length} pincel${res.added.length === 1 ? '' : 'es'} importado${res.added.length === 1 ? '' : 's'}` : '', ...res.errors].filter(Boolean).join(' · ');
      report.textContent = msg || 'No se encontró ningún pincel.';
      report.className = `import-report ${res.errors.length ? 'error' : 'ok'}`;
      if (res.added.length) { this.filter = 'Todos'; this.render(); }
      return res;
    };
    const dlg = h('div', { class: 'dialog-backdrop', on: { keydown: (e: Event) => { e.stopPropagation(); if ((e as KeyboardEvent).key === 'Escape') close(); } } },
      h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'import-title' },
        h('h2', { id: 'import-title' }, 'Importar pinceles'),
        h('p', { class: 'muted' }, 'Archivos .yosabrush o .json exportados desde YOSADRAW. Los valores fuera de rango se corrigen al importar.'),
        h('button', { type: 'button', class: 'btn primary', on: { click: async () => {
          try {
            const files = await openTextFiles('.yosabrush,.json,application/json');
            for (const f of files) apply(f.content, f.name);
          } catch (e) { report.textContent = e instanceof Error ? e.message : 'No se pudo leer el archivo'; report.className = 'import-report error'; }
        } } }, 'Elegir archivos…'),
        h('label', { for: 'import-json', class: 'ctl-label' }, 'O pega el JSON'),
        ta,
        report,
        h('div', { class: 'dialog-actions' },
          h('button', { type: 'button', class: 'btn ghost', on: { click: close } }, 'Cerrar'),
          h('button', { type: 'button', class: 'btn', on: { click: () => { if (ta.value.trim()) apply(ta.value, 'texto pegado'); } } }, 'Importar texto'))));
    document.body.append(dlg);
    (dlg.querySelector('.btn.primary') as HTMLElement).focus();
  }
}

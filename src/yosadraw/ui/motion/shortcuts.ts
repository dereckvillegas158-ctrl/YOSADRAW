import { h } from '../dom';
import { modal } from '../modal';

/** Acciones del editor de vídeo con su atajo por defecto (se pueden cambiar). */
export const MOTION_ACTIONS: { id: string; label: string; key: string; group: string }[] = [
  { id: 'play', label: 'Reproducir / pausa', key: 'Space', group: 'Reproducción' },
  { id: 'prev-frame', label: 'Fotograma anterior', key: 'ArrowLeft', group: 'Reproducción' },
  { id: 'next-frame', label: 'Fotograma siguiente', key: 'ArrowRight', group: 'Reproducción' },
  { id: 'prev-sec', label: 'Retroceder 1 s', key: 'Shift+ArrowLeft', group: 'Reproducción' },
  { id: 'next-sec', label: 'Avanzar 1 s', key: 'Shift+ArrowRight', group: 'Reproducción' },
  { id: 'prev-edit', label: 'Corte anterior', key: 'ArrowUp', group: 'Reproducción' },
  { id: 'next-edit', label: 'Corte siguiente', key: 'ArrowDown', group: 'Reproducción' },
  { id: 'home', label: 'Ir al principio', key: 'Home', group: 'Reproducción' },
  { id: 'end', label: 'Ir al final', key: 'End', group: 'Reproducción' },
  { id: 'loop', label: 'Repetir (bucle)', key: 'L', group: 'Reproducción' },
  { id: 'range-in', label: 'Inicio del intervalo', key: 'I', group: 'Reproducción' },
  { id: 'range-out', label: 'Fin del intervalo', key: 'O', group: 'Reproducción' },
  { id: 'range-clear', label: 'Quitar intervalo', key: 'Alt+X', group: 'Reproducción' },
  { id: 'tool-select', label: 'Herramienta: seleccionar', key: 'V', group: 'Herramientas' },
  { id: 'tool-razor', label: 'Herramienta: cortar', key: 'C', group: 'Herramientas' },
  { id: 'tool-text', label: 'Herramienta: texto', key: 'T', group: 'Herramientas' },
  { id: 'tool-shape', label: 'Herramienta: formas', key: 'U', group: 'Herramientas' },
  { id: 'tool-mask', label: 'Herramienta: máscara', key: 'G', group: 'Herramientas' },
  { id: 'split', label: 'Dividir en el cabezal', key: 'Ctrl+K', group: 'Edición' },
  { id: 'delete', label: 'Eliminar', key: 'Delete', group: 'Edición' },
  { id: 'ripple-delete', label: 'Eliminar y cerrar hueco', key: 'Shift+Delete', group: 'Edición' },
  { id: 'duplicate', label: 'Duplicar', key: 'Ctrl+D', group: 'Edición' },
  { id: 'copy', label: 'Copiar', key: 'Ctrl+C', group: 'Edición' },
  { id: 'cut', label: 'Cortar', key: 'Ctrl+X', group: 'Edición' },
  { id: 'paste', label: 'Pegar en el cabezal', key: 'Ctrl+V', group: 'Edición' },
  { id: 'copy-attrs', label: 'Copiar atributos', key: 'Ctrl+Alt+C', group: 'Edición' },
  { id: 'paste-attrs', label: 'Pegar atributos', key: 'Ctrl+Alt+V', group: 'Edición' },
  { id: 'select-all', label: 'Seleccionar todo', key: 'Ctrl+A', group: 'Edición' },
  { id: 'deselect', label: 'Deseleccionar', key: 'Escape', group: 'Edición' },
  { id: 'group', label: 'Agrupar / desagrupar', key: 'Ctrl+G', group: 'Edición' },
  { id: 'precompose', label: 'Precomponer', key: 'Ctrl+Shift+C', group: 'Edición' },
  { id: 'nudge-l', label: 'Mover clip 1 fotograma ←', key: 'Alt+ArrowLeft', group: 'Edición' },
  { id: 'nudge-r', label: 'Mover clip 1 fotograma →', key: 'Alt+ArrowRight', group: 'Edición' },
  { id: 'trim-start', label: 'Recortar inicio hasta el cabezal', key: 'Q', group: 'Edición' },
  { id: 'trim-end', label: 'Recortar final hasta el cabezal', key: 'W', group: 'Edición' },
  { id: 'keyframe', label: 'Keyframe de posición, escala, giro y opacidad', key: 'K', group: 'Animación' },
  { id: 'prev-key', label: 'Keyframe anterior', key: 'Shift+J', group: 'Animación' },
  { id: 'next-key', label: 'Keyframe siguiente', key: 'J', group: 'Animación' },
  { id: 'marker', label: 'Añadir marcador', key: 'M', group: 'Línea de tiempo' },
  { id: 'snap', label: 'Ajuste magnético', key: 'N', group: 'Línea de tiempo' },
  { id: 'ripple', label: 'Edición en cadena (ripple)', key: 'R', group: 'Línea de tiempo' },
  { id: 'zoom-in', label: 'Acercar línea de tiempo', key: '=', group: 'Línea de tiempo' },
  { id: 'zoom-out', label: 'Alejar línea de tiempo', key: '-', group: 'Línea de tiempo' },
  { id: 'zoom-fit', label: 'Ver toda la línea de tiempo', key: 'Shift+Z', group: 'Línea de tiempo' },
  { id: 'curves', label: 'Línea de tiempo / curvas', key: 'Shift+G', group: 'Línea de tiempo' },
  { id: 'undo', label: 'Deshacer', key: 'Ctrl+Z', group: 'Proyecto' },
  { id: 'redo', label: 'Rehacer', key: 'Ctrl+Shift+Z', group: 'Proyecto' },
  { id: 'redo2', label: 'Rehacer (alternativo)', key: 'Ctrl+Y', group: 'Proyecto' },
  { id: 'save', label: 'Guardar', key: 'Ctrl+S', group: 'Proyecto' },
  { id: 'import', label: 'Importar medios', key: 'Ctrl+I', group: 'Proyecto' },
  { id: 'export', label: 'Exportar vídeo', key: 'Ctrl+E', group: 'Proyecto' },
];

/** Combinación de un evento de teclado («Ctrl+Shift+K», «Space», «ArrowLeft»…). */
export function comboOf(e: KeyboardEvent): string {
  let k = e.key;
  if (k === ' ' || e.code === 'Space') k = 'Space';
  else if (k.length === 1) k = k.toUpperCase();
  if (k === '+') k = '=';
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(k)) return '';
  return `${e.ctrlKey || e.metaKey ? 'Ctrl+' : ''}${e.altKey ? 'Alt+' : ''}${e.shiftKey && k.length > 1 ? 'Shift+' : e.shiftKey && /^[A-Z]$/.test(k) ? 'Shift+' : ''}${k}`;
}

export const keyLabel = (k: string) => k.replace('Ctrl+', 'Ctrl + ').replace('Alt+', 'Alt + ').replace('Shift+', 'Mayús + ').replace('ArrowLeft', '←').replace('ArrowRight', '→').replace('ArrowUp', '↑').replace('ArrowDown', '↓').replace('Space', 'Espacio').replace('Delete', 'Supr').replace('Escape', 'Esc');

export class MotionKeys {
  constructor(public custom: Record<string, string>) {}
  key(id: string) { return this.custom[id] ?? MOTION_ACTIONS.find(a => a.id === id)?.key ?? ''; }
  /** Acción de una combinación (o null). */
  action(combo: string): string | null {
    if (!combo) return null;
    for (const a of MOTION_ACTIONS) if (this.key(a.id) === combo) return a.id;
    return null;
  }
  hint(id: string) { const k = this.key(id); return k ? ` (${keyLabel(k)})` : ''; }
}

/** Ventana para ver y cambiar los atajos del editor de vídeo. */
export function openMotionShortcuts(keys: MotionKeys, persist: () => void) {
  const list = h('div', { class: 'mo-keys' });
  const render = () => {
    list.replaceChildren();
    let group = '';
    for (const a of MOTION_ACTIONS) {
      if (a.group !== group) { group = a.group; list.append(h('h3', null, group)); }
      const btn = h('button', { type: 'button', class: 'btn sm mo-keycap', title: 'Pulsa y luego la nueva combinación' }, keyLabel(keys.key(a.id)) || '—');
      btn.addEventListener('click', () => {
        btn.textContent = 'Pulsa una tecla…';
        btn.classList.add('listening');
        const on = (e: KeyboardEvent) => {
          e.preventDefault(); e.stopPropagation();
          const c = comboOf(e);
          if (!c) return;
          window.removeEventListener('keydown', on, true);
          if (c !== 'Escape' || a.id === 'deselect') {
            // La combinación deja de usarse en otra acción.
            for (const o of MOTION_ACTIONS) if (o.id !== a.id && keys.key(o.id) === c) keys.custom[o.id] = '';
            keys.custom[a.id] = c;
            persist();
          }
          render();
        };
        window.addEventListener('keydown', on, true);
      });
      const reset = h('button', { type: 'button', class: 'btn sm ghost', title: 'Atajo por defecto', hidden: !(a.id in keys.custom), on: { click: () => { delete keys.custom[a.id]; persist(); render(); } } }, '↺');
      list.append(h('div', { class: 'mo-keyrow' }, h('span', null, a.label), btn, reset));
    }
  };
  render();
  void modal({ title: 'Atajos del editor de vídeo', body: [h('p', { class: 'ctl-help' }, 'Pulsa un atajo para cambiarlo. Una combinación sólo puede tener una acción.'), list], wide: true, actions: [
    { label: 'Restablecer todos', value: 'reset', kind: 'ghost' }, { label: 'Cerrar', value: 'ok', kind: 'primary' },
  ] }).then(v => { if (v === 'reset') { for (const k of Object.keys(keys.custom)) delete keys.custom[k]; persist(); } });
}

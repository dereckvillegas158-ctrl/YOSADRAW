import type { ToolManager } from '../tools/ToolManager';
import { fromHex, hsvToRgb, rgbToHsv, toHex } from './color';
import { h } from './dom';

const PALETTE = ['#1b1530', '#4b4366', '#8b84a3', '#f4f1fb', '#ffffff', '#9d6bff', '#5b8cff', '#2fb7a3', '#5fae4a', '#f2c84b', '#f08a3c', '#e2445c', '#b8336a', '#7a4b33', '#d9b38c', '#2b2f6e'];

/**
 * Selector de color: cuadro saturación/brillo, barra de tono, hexadecimal,
 * color principal y secundario (X intercambia), recientes y paleta.
 */
export class ColorPanel {
  readonly el: HTMLElement;
  private sv: HTMLCanvasElement;
  private hue: HTMLCanvasElement;
  private hex: HTMLInputElement;
  private primaryChip: HTMLButtonElement;
  private secondaryChip: HTMLButtonElement;
  private recent: HTMLElement;
  private editing: 'primary' | 'secondary' = 'primary';
  private hsv: [number, number, number] = [0, 0, 0];

  constructor(private mgr: ToolManager) {
    this.sv = h('canvas', { class: 'sv', tabindex: '0', role: 'slider', 'aria-label': 'Saturación y brillo (flechas para ajustar)' });
    this.hue = h('canvas', { class: 'hue', tabindex: '0', role: 'slider', 'aria-label': 'Tono (flechas para ajustar)', 'aria-valuemin': '0', 'aria-valuemax': '360' });
    this.hex = h('input', { type: 'text', id: 'color-hex', class: 'hex', maxlength: '7', spellcheck: 'false', 'aria-label': 'Color en hexadecimal' });
    this.primaryChip = h('button', { type: 'button', class: 'chip primary', title: 'Color principal', 'aria-label': 'Editar color principal', on: { click: () => this.edit('primary') } });
    this.secondaryChip = h('button', { type: 'button', class: 'chip secondary', title: 'Color secundario', 'aria-label': 'Editar color secundario', on: { click: () => this.edit('secondary') } });
    this.recent = h('div', { class: 'swatch-row', 'aria-label': 'Colores recientes' });
    const palette = h('div', { class: 'swatch-row' }, ...PALETTE.map(c => this.swatch(c)));
    this.el = h('section', { class: 'block color-panel', 'aria-label': 'Color' },
      h('div', { class: 'color-top' },
        h('div', { class: 'chips' }, this.secondaryChip, this.primaryChip),
        h('button', { type: 'button', class: 'link', title: 'Intercambiar (X)', on: { click: () => mgr.swapColors() } }, '⇄ Intercambiar'),
        this.hex),
      this.sv, this.hue,
      h('span', { class: 'mini-label' }, 'Recientes'), this.recent,
      h('span', { class: 'mini-label' }, 'Paleta'), palette);
    this.bindPicker();
    this.hex.addEventListener('change', () => {
      const v = this.hex.value.trim().replace(/^([0-9a-f]{6})$/i, '#$1');
      if (/^#[0-9a-f]{6}$/i.test(v)) this.apply(v.toLowerCase()); else this.sync();
    });
    mgr.on('colors', () => this.sync());
    new ResizeObserver(() => this.draw()).observe(this.sv);
    this.sync();
  }

  private swatch(c: string) {
    return h('button', { type: 'button', class: 'sw', style: { '--sw': c }, title: c, 'aria-label': `Usar ${c}`, on: { click: () => this.apply(c) } });
  }

  private edit(which: 'primary' | 'secondary') { this.editing = which; this.sync(); }

  private current() { return this.editing === 'primary' ? this.mgr.colors.primary : this.mgr.colors.secondary; }

  private apply(hex: string) {
    const c = this.mgr.colors;
    if (this.editing === 'primary') this.mgr.setColors(hex, c.secondary); else this.mgr.setColors(c.primary, hex);
  }

  private sync() {
    const c = this.mgr.colors;
    this.primaryChip.style.setProperty('--c', c.primary);
    this.secondaryChip.style.setProperty('--c', c.secondary);
    this.primaryChip.setAttribute('aria-pressed', String(this.editing === 'primary'));
    this.secondaryChip.setAttribute('aria-pressed', String(this.editing === 'secondary'));
    const cur = this.current();
    if (document.activeElement !== this.hex) this.hex.value = cur;
    const [r, g, b] = fromHex(cur);
    const hsv = rgbToHsv(r, g, b);
    // Conserva el tono si el color es gris (sin tono propio).
    this.hsv = [hsv[1] === 0 || hsv[2] === 0 ? this.hsv[0] : hsv[0], hsv[1], hsv[2]];
    this.recent.replaceChildren(...c.recent.map(x => this.swatch(x)));
    this.hue.setAttribute('aria-valuenow', String(Math.round(this.hsv[0])));
    this.draw();
  }

  private setHsv(hh: number, s: number, v: number) {
    this.hsv = [hh, Math.min(1, Math.max(0, s)), Math.min(1, Math.max(0, v))];
    this.apply(toHex(...hsvToRgb(...this.hsv)));
  }

  private bindPicker() {
    const drag = (el: HTMLCanvasElement, fn: (u: number, v: number) => void) => {
      const at = (e: PointerEvent) => { const r = el.getBoundingClientRect(); fn(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))); };
      el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); at(e); });
      el.addEventListener('pointermove', e => { if (el.hasPointerCapture(e.pointerId)) at(e); });
    };
    drag(this.sv, (u, v) => this.setHsv(this.hsv[0], u, 1 - v));
    drag(this.hue, u => this.setHsv(u * 360, this.hsv[1], this.hsv[2]));
    this.sv.addEventListener('keydown', e => {
      const d = e.shiftKey ? 0.1 : 0.02, [hh, s, v] = this.hsv;
      const m: Record<string, [number, number]> = { ArrowLeft: [s - d, v], ArrowRight: [s + d, v], ArrowUp: [s, v + d], ArrowDown: [s, v - d] };
      if (m[e.key]) { e.preventDefault(); e.stopPropagation(); this.setHsv(hh, m[e.key][0], m[e.key][1]); }
    });
    this.hue.addEventListener('keydown', e => {
      const d = e.shiftKey ? 15 : 3;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); this.setHsv((this.hsv[0] + (e.key === 'ArrowRight' ? d : -d) + 360) % 360, this.hsv[1], this.hsv[2]); }
    });
  }

  private draw() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const c of [this.sv, this.hue]) {
      const r = c.getBoundingClientRect();
      if (!r.width) return;
      c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
    }
    const g = this.sv.getContext('2d')!, W = this.sv.width, H = this.sv.height;
    const [hh, s, v] = this.hsv;
    g.fillStyle = toHex(...hsvToRgb(hh, 1, 1)); g.fillRect(0, 0, W, H);
    let grad = g.createLinearGradient(0, 0, W, 0); grad.addColorStop(0, '#fff'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    grad = g.createLinearGradient(0, 0, 0, H); grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(1, '#000');
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    g.lineWidth = 2 * dpr;
    g.beginPath(); g.arc(s * W, (1 - v) * H, 7 * dpr, 0, Math.PI * 2);
    g.strokeStyle = v > 0.55 ? '#1b1530' : '#fff'; g.stroke();

    const hg = this.hue.getContext('2d')!, HW = this.hue.width, HH = this.hue.height;
    const hgrad = hg.createLinearGradient(0, 0, HW, 0);
    for (let i = 0; i <= 6; i++) hgrad.addColorStop(i / 6, toHex(...hsvToRgb(i * 60, 1, 1)));
    hg.fillStyle = hgrad; hg.fillRect(0, 0, HW, HH);
    const x = (hh / 360) * HW;
    hg.fillStyle = '#fff'; hg.fillRect(x - 2 * dpr, 0, 4 * dpr, HH);
    hg.strokeStyle = '#1b1530'; hg.lineWidth = dpr; hg.strokeRect(x - 2 * dpr, 0.5, 4 * dpr, HH - 1);
  }
}

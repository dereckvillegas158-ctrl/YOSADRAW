import './style.css';
import type { StrokePoint } from './core/types';
import type { EngineSettings } from './filters';
import { PointerInput } from './input/PointerInput';
import type { BrushSettings } from './render/StrokeRenderer';
import { Pane } from './playground/Pane';
import { NoiseInjector } from './playground/Noise';
import { PATTERNS, generatePattern, type PatternId } from './playground/TestPatterns';
import { PRESETS, presetFor } from './playground/presets';

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel)!;

const CONTROLS: { key: keyof EngineSettings; label: string; hint: string }[] = [
  { key: 'streamLine', label: 'StreamLine', hint: 'Suaviza la trayectoria' },
  { key: 'stabilization', label: 'Stabilization', hint: 'Elimina el temblor' },
  { key: 'motionFiltering', label: 'Motion Filtering', hint: 'Filtra sacudidas y picos' },
];

const brush: BrushSettings = { size: 6, color: '#1b2233', usePressure: true, minRatio: 0.18, gamma: 0.8 };
const noise = new NoiseInjector();
let recording: StrokePoint[][] = [];
let current: StrokePoint[] | null = null;
let strokeSeed = 1;
let playing = 0;

// ---------- Construcción de paneles ----------
function paneMarkup(id: string): string {
  const ctl = CONTROLS.map(c => `
    <label class="ctl" for="${id}-${c.key}">
      <span class="ctl-name">${c.label}</span>
      <span class="ctl-hint">${c.hint}</span>
      <input type="range" id="${id}-${c.key}" data-key="${c.key}" min="0" max="100" step="1">
      <output for="${id}-${c.key}">0%</output>
    </label>`).join('');
  const opts = PRESETS.map(p => `<option value="${p.id}">${p.label}</option>`).join('');
  return `
    <div class="pane-head">
      <div class="pane-title">
        <span class="tag">${id}</span>
        <select id="preset-${id}" class="preset" aria-label="Preajuste ${id}">${opts}<option value="custom" disabled>Personalizado</option></select>
      </div>
      <div class="ctls">${ctl}</div>
    </div>
    <div class="surface">
      <canvas class="ink"></canvas><canvas class="raw"></canvas><canvas class="live"></canvas>
    </div>
    <dl class="metrics" aria-live="off">
      <div><dt>Coste</dt><dd data-m="cost">–</dd></div>
      <div><dt>Retraso medio</dt><dd data-m="lag">–</dd></div>
      <div><dt>Giro / 100 px</dt><dd data-m="rough">–</dd></div>
    </dl>`;
}

const stage = $('#stage');
const initial: Record<string, EngineSettings> = {
  A: { ...PRESETS[0].s },
  B: { ...PRESETS[2].s },
};
const panes: Pane[] = ['A', 'B'].map(id => {
  const section = $(`.pane[data-pane="${id}"]`, stage);
  section.innerHTML = paneMarkup(id);
  const pane = new Pane(id, $('.surface', section), initial[id], brush);
  bindPaneControls(pane, section);
  return pane;
});
const visiblePanes = () => (stage.dataset.compare === 'true' ? panes : [panes[0]]);

function bindPaneControls(pane: Pane, section: HTMLElement) {
  const preset = $<HTMLSelectElement>('.preset', section);
  const sliders = [...section.querySelectorAll<HTMLInputElement>('input[type=range]')];
  const sync = () => {
    for (const s of sliders) {
      const v = pane.settings[s.dataset.key as keyof EngineSettings];
      s.value = String(v);
      s.style.setProperty('--fill', `${v}%`);
      (s.nextElementSibling as HTMLOutputElement).value = `${v}%`;
    }
    preset.value = presetFor(pane.settings);
  };
  for (const s of sliders) {
    s.addEventListener('input', () => {
      pane.setSettings({ ...pane.settings, [s.dataset.key!]: Number(s.value) });
      sync();
      scheduleReprocess();
    });
  }
  preset.addEventListener('change', () => {
    const p = PRESETS.find(p => p.id === preset.value);
    if (p) { pane.setSettings({ ...p.s }); sync(); scheduleReprocess(); }
  });
  sync();
}

// ---------- Entrada en vivo ----------
const input = new PointerInput(panes.map(p => p.surface), {
  begin(_target, p) {
    stopPlayback();
    noise.beginStroke(strokeSeed++, p.t);
    const q = noise.apply(p);
    current = [q];
    for (const pane of visiblePanes()) pane.begin(q);
    startFrames();
  },
  move(points) {
    if (!current) return;
    const qs = points.map(p => noise.apply(p));
    for (const q of qs) current.push(q);
    for (const pane of visiblePanes()) pane.push(qs);
  },
  end() {
    if (!current) return;
    for (const pane of visiblePanes()) pane.end();
    recording.push(current);
    current = null;
    updateMetrics();
  },
});

// Bucle de fotogramas sólo mientras hay algo que animar.
let frameReq = 0;
function startFrames() {
  if (frameReq) return;
  const tick = () => {
    for (const pane of panes) pane.frame();
    if (input.drawing || playing) frameReq = requestAnimationFrame(tick);
    else { frameReq = 0; for (const pane of panes) pane.frame(); updateMetrics(); }
  };
  frameReq = requestAnimationFrame(tick);
}

// ---------- Reprocesado instantáneo ----------
let reprocessReq = 0;
function scheduleReprocess() {
  if (reprocessReq || input.drawing || playing) return;
  reprocessReq = requestAnimationFrame(() => { reprocessReq = 0; reprocessAll(); });
}

function runStroke(pane: Pane, stroke: StrokePoint[]) {
  pane.begin(stroke[0]);
  // Se alimenta muestra a muestra para medir el coste y el retraso real.
  for (let i = 1; i < stroke.length; i++) pane.push([stroke[i]]);
  pane.end();
}

function reprocessAll() {
  for (const pane of panes) {
    pane.clear();
    if (!visiblePanes().includes(pane)) continue;
    for (const s of recording) runStroke(pane, s);
    pane.frame();
  }
  updateMetrics();
}

// ---------- Reproducción con el tiempo original ----------
function stopPlayback() {
  if (!playing) return;
  cancelAnimationFrame(playing);
  playing = 0;
  $('#replay').textContent = 'Reproducir';
  reprocessAll();
}

function replay() {
  if (playing) { stopPlayback(); return; }
  if (!recording.length) return;
  for (const pane of panes) pane.clear();
  // Línea temporal continua con pausas de 250 ms entre trazos.
  const timeline: { stroke: StrokePoint[]; start: number }[] = [];
  let t = 0;
  for (const s of recording) {
    timeline.push({ stroke: s, start: t });
    t += s[s.length - 1].t - s[0].t + 250;
  }
  const t0 = performance.now();
  let si = 0, pi = 0;
  $('#replay').textContent = 'Detener';
  const step = () => {
    const now = performance.now() - t0;
    while (si < timeline.length) {
      const { stroke, start } = timeline[si];
      const base = stroke[0].t;
      const batch: StrokePoint[] = [];
      while (pi < stroke.length && stroke[pi].t - base + start <= now) batch.push(stroke[pi++]);
      for (const pane of visiblePanes()) {
        let b = batch;
        if (b.length && b[0] === stroke[0]) { pane.begin(stroke[0]); b = b.slice(1); }
        if (b.length) pane.push(b);
        if (pi >= stroke.length) pane.end();
      }
      if (pi < stroke.length) break;
      si++; pi = 0;
    }
    for (const pane of panes) pane.frame();
    if (si >= timeline.length) { playing = 0; $('#replay').textContent = 'Reproducir'; updateMetrics(); return; }
    playing = requestAnimationFrame(step);
  };
  playing = requestAnimationFrame(step);
}

// ---------- Patrones de prueba ----------
function loadPattern(id: PatternId) {
  stopPlayback();
  const pane = panes[0];
  const clean = generatePattern(id, pane.width, pane.height);
  recording = clean.map((s, i) => {
    noise.beginStroke(1000 + i, s[0].t);
    return s.map(p => noise.apply(p));
  });
  reprocessAll();
}

// ---------- Métricas ----------
function updateMetrics() {
  for (const pane of panes) {
    const section = pane.surface.parentElement!;
    const m = pane.metrics;
    const has = m.samples > 0;
    $('[data-m="cost"]', section).textContent = has ? `${m.costPerSample.toFixed(1)} µs/muestra` : '–';
    $('[data-m="lag"]', section).textContent = has ? `${m.lagAvg.toFixed(1)} px` : '–';
    $('[data-m="rough"]', section).textContent = has && m.outLen ? `${m.outRough.toFixed(0)}° (crudo ${m.rawRough.toFixed(0)}°)` : '–';
  }
}

// ---------- Barra de herramientas ----------
function bindRange(id: string, fmt: (v: number) => string, onInput: (v: number) => void) {
  const el = $<HTMLInputElement>(`#${id}`);
  const out = el.nextElementSibling as HTMLOutputElement;
  const apply = () => {
    const v = Number(el.value);
    el.style.setProperty('--fill', `${((v - Number(el.min)) / (Number(el.max) - Number(el.min))) * 100}%`);
    out.value = fmt(v);
    onInput(v);
  };
  el.addEventListener('input', apply);
  apply();
}

bindRange('brush-size', v => `${v} px`, v => { brush.size = v; scheduleReprocess(); });
bindRange('noise-tremor', v => `${v}%`, v => { noise.tremor = v / 100; });
bindRange('noise-spikes', v => `${v}%`, v => { noise.spikes = v / 100; });
$<HTMLInputElement>('#brush-color').addEventListener('input', e => { brush.color = (e.target as HTMLInputElement).value; scheduleReprocess(); });
$<HTMLInputElement>('#use-pressure').addEventListener('change', e => { brush.usePressure = (e.target as HTMLInputElement).checked; scheduleReprocess(); });
$<HTMLInputElement>('#show-raw').addEventListener('change', e => { stage.dataset.raw = String((e.target as HTMLInputElement).checked); });
$<HTMLInputElement>('#compare').addEventListener('change', e => {
  stage.dataset.compare = String((e.target as HTMLInputElement).checked);
  resizeAll();
});
const patternSel = $<HTMLSelectElement>('#pattern');
patternSel.innerHTML = PATTERNS.map(p => `<option value="${p.id}">${p.label}</option>`).join('');
$('#load-pattern').addEventListener('click', () => loadPattern(patternSel.value as PatternId));
$('#replay').addEventListener('click', replay);
$('#clear').addEventListener('click', () => { stopPlayback(); recording = []; for (const p of panes) p.clear(); updateMetrics(); });

function resizeAll() {
  for (const p of panes) p.resize();
  reprocessAll();
}
new ResizeObserver(() => { if (!input.drawing) { stopPlayback(); resizeAll(); } }).observe(stage);

// Estado inicial: un patrón de muestra con temblor sintético para comparar A y B.
for (const p of panes) p.resize();
loadPattern('corners');

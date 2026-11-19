import { valueAt } from './keys';
import type { MediaManager } from './media';
import { clipEnd, sourceTime, type Composition, type MediaClip, type Motion } from './model';

/**
 * Audio de YOSADRAW MOTION: la misma programación sirve para reproducir (AudioContext)
 * y para exportar (OfflineAudioContext), así lo que se oye es lo que se exporta.
 * Por clip: volumen y panorámica animables (keyframes), fundidos de entrada y salida,
 * velocidad (cambia el tono, como en una cinta), inversión, bucle y congelado
 * (silencio). Por pista: silencio y solo. Las composiciones anidadas suenan con su audio.
 */

const reversed = new WeakMap<AudioBuffer, AudioBuffer>();
function reverseOf(ctx: BaseAudioContext, b: AudioBuffer): AudioBuffer {
  let r = reversed.get(b);
  if (r) return r;
  r = ctx.createBuffer(b.numberOfChannels, b.length, b.sampleRate);
  for (let ch = 0; ch < b.numberOfChannels; ch++) { const s = b.getChannelData(ch), d = r.getChannelData(ch); for (let i = 0, n = s.length; i < n; i++) d[i] = s[n - 1 - i]; }
  reversed.set(b, r);
  return r;
}

/** Clips con sonido de una composición (también dentro de las anidadas), con su desplazamiento. */
function audible(m: Motion, comp: Composition, offset: number, depth = 0): { c: MediaClip; at: number }[] {
  const solo = comp.tracks.some(t => t.solo);
  const out: { c: MediaClip; at: number }[] = [];
  for (const c of comp.clips) {
    const tr = comp.tracks.find(t => t.id === c.track);
    if (!tr || tr.muted || (solo && !tr.solo) || !c.enabled) continue;
    if (c.kind === 'media') out.push({ c, at: offset + c.start });
    else if (c.kind === 'comp' && depth < 8) {
      const sub = m.comps.find(x => x.id === c.comp);
      // Composición anidada a velocidad normal: su audio se recorta a la duración del clip.
      if (sub && Math.abs(c.speed - 1) < 1e-6) for (const x of audible(m, sub, offset + c.start - c.in, depth + 1)) if (x.at < offset + clipEnd(c) && x.at + x.c.dur > offset + c.start) out.push(x);
    }
  }
  return out;
}

/**
 * Programa en `ctx` el audio de [from, until) s de la composición, empezando a sonar
 * en `at` (tiempo del contexto). Devuelve los nodos (para pararlos).
 */
export async function scheduleAudio(ctx: BaseAudioContext, m: Motion, comp: Composition, media: MediaManager, from: number, until: number, at: number): Promise<AudioScheduledSourceNode[]> {
  const nodes: AudioScheduledSourceNode[] = [];
  for (const { c, at: cs } of audible(m, comp, 0)) {
    if (c.freeze !== null) continue;
    const md = m.media.find(x => x.id === c.media);
    if (!md || !(md.kind === 'audio' || (md.kind === 'video' && md.hasAudio))) continue;
    const ce = cs + c.dur;
    if (ce <= from || cs >= until) continue;
    const buf0 = await media.audioBuffer(md).catch(() => null);
    if (!buf0) continue;
    const buf = c.reverse ? reverseOf(ctx, buf0) : buf0;
    const lt0 = Math.max(0, from - cs);
    const t1 = Math.min(ce, until);
    const playDur = t1 - Math.max(cs, from);
    if (playDur <= 0) continue;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = c.speed || 1;
    let off = sourceTime(c, lt0, md.dur);
    if (c.reverse) off = Math.max(0, buf.duration - off);
    if (c.loop) { src.loop = true; src.loopStart = 0; src.loopEnd = buf.duration; }
    const gain = ctx.createGain(), pan = ctx.createStereoPanner();
    // Curvas de volumen y panorámica (keyframes + fundidos), muestreadas a 60 Hz.
    const when = at + Math.max(0, cs - from);
    const N = Math.max(2, Math.ceil(playDur * 60));
    const gv = new Float32Array(N), pv = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const lt = lt0 + (i / (N - 1)) * playDur;
      let v = Math.max(0, valueAt(c.volume, lt));
      if (c.fadeIn > 0 && lt < c.fadeIn) v *= lt / c.fadeIn;
      if (c.fadeOut > 0 && lt > c.dur - c.fadeOut) v *= Math.max(0, (c.dur - lt) / c.fadeOut);
      gv[i] = v;
      pv[i] = Math.max(-1, Math.min(1, valueAt(c.pan, lt)));
    }
    gain.gain.setValueCurveAtTime(gv, when, playDur);
    pan.pan.setValueCurveAtTime(pv, when, playDur);
    src.connect(gain).connect(pan).connect(ctx.destination);
    src.start(when, Math.max(0, off), c.loop ? undefined : playDur * (c.speed || 1));
    if (c.loop) src.stop(when + playDur);
    nodes.push(src);
  }
  return nodes;
}

/** Mezcla estéreo de [from, from + dur) s para exportar (null si no hay audio). */
export async function mixAudio(m: Motion, comp: Composition, media: MediaManager, from: number, dur: number, sampleRate = 48000): Promise<AudioBuffer | null> {
  if (!audible(m, comp, 0).length) return null;
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(dur * sampleRate)), sampleRate);
  const nodes = await scheduleAudio(ctx, m, comp, media, from, from + dur, 0);
  if (!nodes.length) return null;
  return ctx.startRendering();
}

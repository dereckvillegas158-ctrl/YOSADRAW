import { describe, expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { buildArgs, ffmpegPath } = require('../desktop/video.cjs') as {
  buildArgs: (o: Record<string, unknown>, input: string, audio: string | null, out: string) => string[];
  ffmpegPath: () => string | null;
};
const bin = ffmpegPath();

/** WAV de prueba: tono de 440 Hz. */
function wav(seconds: number, sr = 48000) {
  const n = Math.floor(seconds * sr), buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) { const v = Math.round(Math.sin((2 * Math.PI * 440 * i) / sr) * 12000); buf.writeInt16LE(v, 44 + i * 4); buf.writeInt16LE(v, 46 + i * 4); }
  return buf;
}

/** Fotograma RGBA: cuadrado que se mueve sobre fondo transparente. */
function frame(k: number, w: number, h: number) {
  const d = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const inside = x >= k * 4 && x < k * 4 + 16 && y >= 10 && y < 30;
    const o = (y * w + x) * 4;
    if (inside) { d[o] = 157; d[o + 1] = 107; d[o + 2] = 255; d[o + 3] = 255; }
  }
  return d;
}

async function encode(o: Record<string, unknown>, out: string, audio: string | null, frames: number) {
  const args = buildArgs(o, 'pipe:0', audio, out);
  const p = spawn(bin!, args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let err = '';
  p.stderr.on('data', d => { err += d; });
  // Si FFmpeg se cierra (error de opciones), no se espera a un «drain» que no llegará.
  const closed = new Promise<number | null>(r => p.on('close', r));
  p.stdin.on('error', () => undefined);
  for (let k = 0; k < frames && p.exitCode === null; k++) if (!p.stdin.write(frame(k, o.width as number, o.height as number))) await Promise.race([new Promise(r => p.stdin.once('drain', r)), closed]);
  p.stdin.end();
  const code = await closed;
  if (code !== 0) throw new Error(`${o.format}: ${err}`);
}

/** Lo que FFmpeg dice del archivo (códecs, duración). */
const info = (file: string) => spawnSync(bin!, ['-hide_banner', '-i', file], { encoding: 'utf8' }).stderr;

describe.skipIf(!bin)('exportación de animación con FFmpeg (archivos reales)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'yosa-video-'));
  const audio = join(dir, 'a.wav');
  writeFileSync(audio, wav(1));
  const base = { width: 64, height: 48, fps: 12, quality: 80, bitrate: 0, alpha: false, loop: true };
  const cases: [string, Record<string, unknown>, string, RegExp[]][] = [
    ['MP4 H.264 + AAC', { format: 'mp4', codec: 'h264' }, 'o.mp4', [/Video: h264/, /yuv420p/, /Audio: aac/, /64x48/]],
    ['MP4 H.265 (bitrate)', { format: 'mp4', codec: 'h265', bitrate: 800 }, 'o265.mp4', [/Video: hevc/, /Audio: aac/]],
    ['MOV H.264', { format: 'mov', codec: 'h264' }, 'o.mov', [/Video: h264/, /Audio: aac/]],
    ['MOV ProRes 4444 con alfa', { format: 'mov', codec: 'prores', alpha: true }, 'p.mov', [/Video: prores \(4444\)/, /yuva444p1[02]/, /Audio: pcm_s16le/]],
    ['WebM VP9 con alfa + Opus', { format: 'webm', codec: 'vp9', alpha: true }, 'o.webm', [/Video: vp9/, /Audio: opus/, /alpha_mode/i]],
    ['GIF con transparencia', { format: 'gif', alpha: true }, 'o.gif', [/Video: gif/]],
    ['APNG', { format: 'apng', alpha: true }, 'o.png', [/Video: apng/, /rgba/]],
    ['WebP animado', { format: 'webp', alpha: true }, 'o.webp', [/webp/i]],
  ];
  for (const [label, o, name, expects] of cases) {
    it(label, async () => {
      const out = join(dir, name);
      await encode({ ...base, ...o }, out, ['mp4', 'mov', 'webm'].includes(o.format as string) ? audio : null, 12);
      expect(statSync(out).size).toBeGreaterThan(100);
      const txt = info(out);
      for (const re of expects) expect(txt).toMatch(re);
      // WebP: ha de ser animado, con un ANMF por fotograma.
      if (o.format === 'webp') { const buf = require('node:fs').readFileSync(out) as Buffer; expect(buf.toString('latin1').split('ANMF').length - 1).toBe(12); expect(buf.toString('latin1')).toContain('ANIM'); }
    }, 60_000);
  }
  for (const [fmt, ext] of [['png-seq', 'png'], ['jpeg-seq', 'jpg'], ['tiff-seq', 'tif']] as const) {
    it(`secuencia ${ext.toUpperCase()}`, async () => {
      const sub = join(dir, fmt);
      rmSync(sub, { recursive: true, force: true });
      require('node:fs').mkdirSync(sub);
      await encode({ ...base, format: fmt, alpha: fmt !== 'jpeg-seq' }, join(sub, `f_%05d.${ext}`), null, 12);
      const files = readdirSync(sub).sort();
      expect(files).toHaveLength(12);
      expect(files[0]).toBe(`f_00001.${ext}`);
      expect(existsSync(join(sub, `f_00012.${ext}`))).toBe(true);
    }, 30_000);
  }
});

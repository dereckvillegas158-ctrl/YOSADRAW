'use strict';
/**
 * Exportación de vídeo y animación con FFmpeg (proceso principal).
 *
 * La interfaz envía los fotogramas ya compuestos (RGBA crudo) de uno en uno; aquí
 * se escriben en la entrada estándar de FFmpeg con contrapresión (no se acumula la
 * animación en memoria). La interfaz nunca pasa argumentos de FFmpeg: elige formato,
 * códec y calidad de una lista cerrada y aquí se construye la línea de órdenes.
 *
 * Seguridad ante fallos: se escribe en un archivo (o carpeta) temporal «.part» y sólo
 * se renombra al terminar bien; un registro en userData permite borrar los restos de
 * una exportación interrumpida (corte de luz, cierre forzado) al volver a abrir la app.
 */
const { app, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const { spawn } = require('node:child_process');

const FORMATS = ['mp4', 'mov', 'webm', 'gif', 'apng', 'webp', 'png-seq', 'jpeg-seq', 'tiff-seq'];
const CODECS = ['h264', 'h265', 'prores', 'vp9'];
const EXT = { mp4: 'mp4', mov: 'mov', webm: 'webm', gif: 'gif', apng: 'png', webp: 'webp' };
const SEQ = { 'png-seq': 'png', 'jpeg-seq': 'jpg', 'tiff-seq': 'tif' };

function ffmpegPath() {
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const cands = [
    path.join(process.resourcesPath || '', 'ffmpeg', exe),
    path.join(__dirname, '..', 'node_modules', '@ffmpeg-installer', `${process.platform}-${process.arch}`, exe),
  ];
  return cands.find(p => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null;
}

const journalFile = () => path.join(app.getPath('userData'), 'exports-in-progress.json');
function readJournal() { try { return JSON.parse(fs.readFileSync(journalFile(), 'utf8')); } catch { return []; } }
function writeJournal(list) { try { fs.writeFileSync(journalFile(), JSON.stringify(list)); } catch { /* sin registro */ } }
const journalAdd = p => writeJournal([...readJournal().filter(x => x !== p), p]);
const journalRemove = p => writeJournal(readJournal().filter(x => x !== p));

/** Borra restos de exportaciones que no terminaron (la app se cerró a mitad). */
async function cleanupInterrupted() {
  const list = readJournal();
  for (const p of list) await fsp.rm(p, { recursive: true, force: true }).catch(() => undefined);
  writeJournal([]);
  return list.length;
}

const clampInt = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
/** FPS con decimales (23,976, 29,97…): hasta milésimas. */
const clampFps = v => { const n = Math.round(Number(v) * 1000) / 1000; return Number.isFinite(n) && n > 0 ? Math.max(1, Math.min(240, n)) : 24; };

/** Opciones de la interfaz → argumentos de FFmpeg (lista cerrada). */
function buildArgs(o, input, audioFile, out) {
  const a = ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${o.width}x${o.height}`, '-framerate', String(o.fps), '-i', input];
  const withAudio = !!audioFile && ['mp4', 'mov', 'webm'].includes(o.format);
  if (withAudio) a.push('-i', audioFile);
  const q = o.quality; // 0..100
  const crf = (lo, hi) => String(Math.round(hi - (q / 100) * (hi - lo))); // calidad alta → crf bajo
  const rate = o.bitrate > 0 ? ['-b:v', `${o.bitrate}k`, '-maxrate', `${Math.round(o.bitrate * 1.5)}k`, '-bufsize', `${o.bitrate * 2}k`] : null;
  switch (o.format) {
    case 'mp4': case 'mov': {
      if (o.format === 'mov' && o.codec === 'prores') {
        a.push('-c:v', 'prores_ks', '-profile:v', o.alpha ? '4' : '3', '-pix_fmt', o.alpha ? 'yuva444p10le' : 'yuv422p10le', '-vendor', 'apl0');
        if (withAudio) a.push('-c:a', 'pcm_s16le');
      } else if (o.codec === 'h265') {
        a.push('-c:v', 'libx265', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1', '-x265-params', 'log-level=error');
        a.push(...(rate ?? ['-crf', crf(14, 34)]));
        if (withAudio) a.push('-c:a', 'aac', '-b:a', '192k');
      } else {
        a.push('-c:v', 'libx264', '-preset', 'medium', '-pix_fmt', 'yuv420p');
        a.push(...(rate ?? ['-crf', crf(12, 32)]));
        if (withAudio) a.push('-c:a', 'aac', '-b:a', '192k');
      }
      if (o.format === 'mp4') a.push('-movflags', '+faststart');
      a.push('-f', o.format === 'mp4' ? 'mp4' : 'mov');
      break;
    }
    case 'webm':
      a.push('-c:v', 'libvpx-vp9', '-pix_fmt', o.alpha ? 'yuva420p' : 'yuv420p', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2');
      a.push(...(rate ?? ['-b:v', '0', '-crf', crf(15, 45)]));
      if (o.alpha) a.push('-auto-alt-ref', '0');
      if (withAudio) a.push('-c:a', 'libopus', '-b:a', '160k');
      a.push('-f', 'webm');
      break;
    case 'gif':
      // Paleta óptima de toda la animación (dos pasadas dentro de FFmpeg) y difuminado.
      a.push('-filter_complex', o.alpha
        ? '[0:v]split[x][y];[x]palettegen=reserve_transparent=1:stats_mode=full[p];[y][p]paletteuse=dither=sierra2_4a:alpha_threshold=128'
        : '[0:v]split[x][y];[x]palettegen=stats_mode=full[p];[y][p]paletteuse=dither=sierra2_4a');
      a.push('-loop', o.loop ? '0' : '-1', '-f', 'gif');
      break;
    case 'apng':
      a.push('-c:v', 'apng', '-pix_fmt', o.alpha ? 'rgba' : 'rgb24', '-plays', o.loop ? '0' : '1', '-f', 'apng');
      break;
    case 'webp':
      // libwebp (no libwebp_anim, que falta en algunas compilaciones de Windows): el contenedor
      // webp de FFmpeg escribe la animación (ANIM/ANMF) con cada fotograma codificado.
      a.push('-c:v', 'libwebp', '-lossless', '0', '-pix_fmt', o.alpha ? 'yuva420p' : 'yuv420p', '-quality', String(Math.round(q)), '-loop', o.loop ? '0' : '1', '-f', 'webp');
      break;
    case 'png-seq':
      a.push('-c:v', 'png', '-pix_fmt', o.alpha ? 'rgba' : 'rgb24', '-f', 'image2');
      break;
    case 'jpeg-seq':
      a.push('-c:v', 'mjpeg', '-pix_fmt', 'yuvj444p', '-q:v', String(Math.round(2 + (1 - q / 100) * 20)), '-f', 'image2');
      break;
    case 'tiff-seq':
      a.push('-c:v', 'tiff', '-pix_fmt', o.alpha ? 'rgba' : 'rgb24', '-compression_algo', 'lzw', '-f', 'image2');
      break;
  }
  if (withAudio) a.push('-map', '0:v:0', '-map', '1:a:0', '-shortest');
  a.push(out);
  return a;
}

const sessions = new Map();
let nextId = 1;

function register({ isApproved, rememberFolder, sanitizeName, storePath }) {
  void cleanupInterrupted();

  ipcMain.handle('video:probe', async () => {
    const bin = ffmpegPath();
    if (!bin) return { ok: false, error: 'FFmpeg no está incluido en esta instalación' };
    return await new Promise(resolve => {
      const p = spawn(bin, ['-hide_banner', '-version'], { windowsHide: true });
      let out = '';
      p.stdout.on('data', d => { out += d; });
      p.on('error', e => resolve({ ok: false, error: e.message }));
      p.on('close', code => resolve(code === 0 ? { ok: true, version: (out.split('\n')[0] || '').slice(0, 120) } : { ok: false, error: `FFmpeg terminó con código ${code}` }));
    });
  });

  ipcMain.handle('video:begin', async (_e, raw) => {
    const bin = ffmpegPath();
    if (!bin) throw new Error('FFmpeg no está incluido en esta instalación');
    const o = {
      folder: String(raw?.folder ?? ''), name: sanitizeName(String(raw?.name ?? 'Animación')),
      format: FORMATS.includes(raw?.format) ? raw.format : null, codec: CODECS.includes(raw?.codec) ? raw.codec : 'h264',
      width: clampInt(raw?.width, 16, 8192, 0), height: clampInt(raw?.height, 16, 8192, 0), fps: clampFps(raw?.fps),
      quality: clampInt(raw?.quality, 0, 100, 80), bitrate: clampInt(raw?.bitrate, 0, 400000, 0), alpha: raw?.alpha === true, loop: raw?.loop !== false,
      overwrite: raw?.overwrite === true, frames: clampInt(raw?.frames, 1, 200000, 1),
    };
    if (!o.format) throw new Error('Formato no válido');
    if (!o.width || !o.height) throw new Error('Tamaño no válido');
    if (!isApproved(o.folder)) throw new Error('Elige la carpeta de destino con el botón «Cambiar…»');
    if (['mp4', 'mov', 'webm'].includes(o.format) && o.codec !== 'prores' && (o.width % 2 || o.height % 2)) throw new Error('El ancho y el alto del vídeo han de ser pares');
    const dir = path.resolve(o.folder);
    await fsp.mkdir(dir, { recursive: true });
    const seq = SEQ[o.format];
    let target, temp, out;
    const exists = p => fs.existsSync(p);
    if (seq) {
      target = path.join(dir, o.name);
      if (!o.overwrite) for (let i = 2; exists(target); i++) target = path.join(dir, `${o.name} (${i})`);
      temp = `${target}.part`;
      await fsp.rm(temp, { recursive: true, force: true });
      await fsp.mkdir(temp, { recursive: true });
      out = path.join(temp, `${path.basename(target)}_%05d.${seq}`);
    } else {
      const ext = EXT[o.format];
      target = path.join(dir, `${o.name}.${ext}`);
      if (!o.overwrite) for (let i = 2; exists(target); i++) target = path.join(dir, `${o.name} (${i}).${ext}`);
      temp = `${target}.part`;
      out = temp;
    }
    journalAdd(temp);
    let audioFile = null;
    if (raw?.audio instanceof Uint8Array && raw.audio.length > 44 && ['mp4', 'mov', 'webm'].includes(o.format)) {
      audioFile = path.join(os.tmpdir(), `yosadraw-audio-${process.pid}-${nextId}.wav`);
      await fsp.writeFile(audioFile, raw.audio);
      journalAdd(audioFile);
    }
    const args = buildArgs(o, 'pipe:0', audioFile, out);
    const proc = spawn(bin, args, { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
    const id = nextId++;
    const s = { proc, o, target, temp, audioFile, stderr: '', exited: null, written: 0, frameBytes: o.width * o.height * 4, seq: !!seq };
    proc.stderr.on('data', d => { s.stderr = (s.stderr + d).slice(-4000); });
    s.done = new Promise(resolve => {
      proc.on('error', e => { s.exited = -1; s.stderr += `\n${e.message}`; resolve(-1); });
      proc.on('close', code => { s.exited = code; resolve(code); });
    });
    proc.stdin.on('error', () => { /* FFmpeg cerró la entrada: se informa al terminar */ });
    sessions.set(id, s);
    if (path.resolve(dir) && rememberFolder) await rememberFolder(dir).catch(() => undefined);
    return { id, target };
  });

  ipcMain.handle('video:frame', async (_e, id, data) => {
    const s = sessions.get(id);
    if (!s) throw new Error('Exportación no encontrada');
    if (!(data instanceof Uint8Array) || data.length !== s.frameBytes) throw new Error('Fotograma con tamaño incorrecto');
    if (s.exited !== null) throw new Error(`FFmpeg se detuvo: ${s.stderr.trim().split('\n').slice(-3).join(' ') || `código ${s.exited}`}`);
    const ok = s.proc.stdin.write(data);
    s.written++;
    if (!ok) await new Promise((resolve, reject) => {
      const onDrain = () => { cleanup(); resolve(); };
      const onClose = () => { cleanup(); reject(new Error(`FFmpeg se detuvo: ${s.stderr.trim().split('\n').slice(-3).join(' ')}`)); };
      const cleanup = () => { s.proc.stdin.off('drain', onDrain); s.proc.off('close', onClose); };
      s.proc.stdin.once('drain', onDrain);
      s.proc.once('close', onClose);
    });
    return s.written;
  });

  async function dispose(s) {
    if (s.audioFile) { await fsp.rm(s.audioFile, { force: true }).catch(() => undefined); journalRemove(s.audioFile); }
  }

  ipcMain.handle('video:finish', async (_e, id) => {
    const s = sessions.get(id);
    if (!s) throw new Error('Exportación no encontrada');
    sessions.delete(id);
    s.proc.stdin.end();
    const code = await s.done;
    await dispose(s);
    if (code !== 0) {
      await fsp.rm(s.temp, { recursive: true, force: true }).catch(() => undefined);
      journalRemove(s.temp);
      throw new Error(`FFmpeg no pudo terminar: ${s.stderr.trim().split('\n').slice(-4).join(' ') || `código ${code}`}`);
    }
    if (s.seq && s.o.overwrite) await fsp.rm(s.target, { recursive: true, force: true }).catch(() => undefined);
    await fsp.rename(s.temp, s.target);
    journalRemove(s.temp);
    const st = await fsp.stat(s.target);
    let size = st.size, files = 1;
    if (st.isDirectory()) { const list = await fsp.readdir(s.target); files = list.length; size = 0; for (const f of list) size += (await fsp.stat(path.join(s.target, f))).size; }
    return { path: s.target, size, files };
  });

  ipcMain.handle('video:abort', async (_e, id) => {
    const s = sessions.get(id);
    if (!s) return;
    sessions.delete(id);
    try { s.proc.kill('SIGKILL'); } catch { /* ya terminó */ }
    await s.done;
    await dispose(s);
    await fsp.rm(s.temp, { recursive: true, force: true }).catch(() => undefined);
    journalRemove(s.temp);
  });

  // Audio que Chromium no decodifica: FFmpeg lo convierte a WAV (estéreo, 48 kHz).
  ipcMain.handle('audio:decode', async (_e, data, name) => {
    const bin = ffmpegPath();
    if (!bin) throw new Error('FFmpeg no está disponible');
    if (!(data instanceof Uint8Array) || data.length > 400 * 1024 * 1024) throw new Error('Audio no válido');
    return await new Promise((resolve, reject) => {
      const p = spawn(bin, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-vn', '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le', '-f', 'wav', 'pipe:1'], { windowsHide: true });
      const chunks = [];
      let size = 0, err = '';
      p.stdout.on('data', d => { size += d.length; if (size > 1024 * 1024 * 1024) p.kill('SIGKILL'); else chunks.push(d); });
      p.stderr.on('data', d => { err = (err + d).slice(-2000); });
      p.on('error', reject);
      p.on('close', code => (code === 0 ? resolve(new Uint8Array(Buffer.concat(chunks))) : reject(new Error(`No se pudo decodificar ${String(name).slice(0, 80)}: ${err.trim().split('\n').pop() || code}`))));
      p.stdin.on('error', () => undefined);
      p.stdin.end(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
    });
  });

  // ---------------- YOSADRAW MOTION: medios del almacén (m/<id>) ----------------
  const MEDIA_KEY = /^m\/[A-Za-z0-9._~-]{1,140}$/;
  const mediaPath = key => { if (!MEDIA_KEY.test(String(key)) || String(key).includes('..')) throw new Error('Clave de medio no válida'); return storePath(String(key)); };

  /** Metadatos con FFmpeg (duración, tamaño, FPS, si tiene audio): sirve también para MKV o AVI. */
  ipcMain.handle('media:probe', async (_e, key) => {
    const bin = ffmpegPath();
    if (!bin) throw new Error('FFmpeg no está disponible');
    const file = mediaPath(key);
    const out = await new Promise(resolve => {
      const p = spawn(bin, ['-hide_banner', '-i', file], { windowsHide: true });
      let err = '';
      p.stderr.on('data', d => { err += d; });
      p.on('close', () => resolve(err));
      p.on('error', () => resolve(''));
    });
    const dur = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(out);
    const v = /Stream #[^\n]*Video: [^\n]*?(\d{2,5})x(\d{2,5})[^\n]*?(?:(\d+(?:\.\d+)?) fps|(\d+(?:\.\d+)?) tbr)/.exec(out);
    return {
      dur: dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : 0,
      w: v ? Number(v[1]) : 0, h: v ? Number(v[2]) : 0, fps: v ? Number(v[3] || v[4]) : 0,
      hasVideo: /Stream #[^\n]*Video:/.test(out), hasAudio: /Stream #[^\n]*Audio:/.test(out),
    };
  });

  /**
   * Convierte un medio a MP4 H.264 + AAC: `compat` para formatos que Chromium no reproduce
   * (AVI, MKV con códecs raros…) y `proxy` (540p, rápido) para editar con fluidez.
   */
  ipcMain.handle('media:transcode', async (_e, key, outKey, mode) => {
    const bin = ffmpegPath();
    if (!bin) throw new Error('FFmpeg no está disponible');
    const src = mediaPath(key), dst = mediaPath(outKey);
    const tmp = `${dst}.${process.pid}.part`;
    journalAdd(tmp);
    const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-map', '0:v:0?', '-map', '0:a:0?',
      '-c:v', 'libx264', '-preset', mode === 'proxy' ? 'veryfast' : 'medium', '-crf', mode === 'proxy' ? '26' : '18', '-pix_fmt', 'yuv420p',
      ...(mode === 'proxy' ? ['-vf', 'scale=-2:min(540\\,ih)'] : ['-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2']),
      '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-f', 'mp4', tmp];
    const res = await new Promise(resolve => {
      const p = spawn(bin, args, { windowsHide: true });
      let err = '';
      p.stderr.on('data', d => { err = (err + d).slice(-3000); });
      p.on('close', code => resolve({ code, err }));
      p.on('error', e => resolve({ code: -1, err: e.message }));
    });
    if (res.code !== 0) { await fsp.rm(tmp, { force: true }); journalRemove(tmp); throw new Error(`No se pudo convertir: ${res.err.trim().split('\n').pop() || res.code}`); }
    await fsp.rename(tmp, dst);
    journalRemove(tmp);
    return (await fsp.stat(dst)).size;
  });

  app.on('before-quit', () => { for (const s of sessions.values()) { try { s.proc.kill('SIGKILL'); } catch { /* */ } } });
}

module.exports = { register, buildArgs, ffmpegPath, cleanupInterrupted };

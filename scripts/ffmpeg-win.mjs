// Asegura el FFmpeg de Windows x64 para empaquetar YOSADRAW (también al compilar desde Linux).
// En Windows lo instala npm (dependencia opcional de @ffmpeg-installer/ffmpeg); en otros
// sistemas se descarga el paquete del registro de npm y se extrae, sin ejecutarlo.
import { existsSync, mkdirSync, mkdtempSync, rmSync, cpSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dest = join('node_modules', '@ffmpeg-installer', 'win32-x64');
if (existsSync(join(dest, 'ffmpeg.exe'))) { console.log('FFmpeg (win32-x64) ya está en', dest); process.exit(0); }
const tmp = mkdtempSync(join(tmpdir(), 'ffwin-'));
try {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const file = execFileSync(npm, ['pack', '@ffmpeg-installer/win32-x64@4.1.0', '--silent'], { cwd: tmp, encoding: 'utf8', shell: process.platform === 'win32' }).trim().split('\n').pop();
  execFileSync('tar', ['-xzf', file], { cwd: tmp });
  mkdirSync(dest, { recursive: true });
  cpSync(join(tmp, 'package'), dest, { recursive: true });
  console.log('FFmpeg (win32-x64) copiado en', dest);
} finally { rmSync(tmp, { recursive: true, force: true }); }

// Arranca Vite en modo desarrollo y abre YOSADRAW en Electron apuntando a él.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'vite';

const server = await createServer({ server: { port: 5173, strictPort: false } });
await server.listen();
const url = server.resolvedUrls.local[0];
const electron = createRequire(import.meta.url)('electron'); // ruta al ejecutable
const child = spawn(electron, ['.'], { stdio: 'inherit', env: { ...process.env, VITE_DEV_SERVER_URL: url } });
child.on('exit', code => { void server.close(); process.exit(code ?? 0); });

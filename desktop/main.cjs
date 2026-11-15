'use strict';
/**
 * Proceso principal de YOSADRAW para escritorio (Electron).
 *
 * Seguridad: la interfaz se sirve desde un protocolo propio `app://` con una
 * CSP estricta; el renderer no tiene acceso a Node (contextIsolation +
 * sandbox) y sólo puede usar las cinco funciones que expone preload.cjs.
 */
const { app, BrowserWindow, ipcMain, dialog, protocol, net, shell, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');

const DEV_URL = process.env.VITE_DEV_SERVER_URL || '';
const DIST = path.join(__dirname, '..', 'dist');
const MAX_FILE = 20 * 1024 * 1024;

const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:", "font-src 'self' data:", "connect-src 'self'",
  "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
].join('; ');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json', '.ico': 'image/x-icon',
};

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

const libraryFile = () => path.join(app.getPath('userData'), 'brushes.json');
const sanitize = name => String(name || 'pinceles.yosabrush').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120);

async function writeAtomic(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, content, 'utf8');
  await fs.rename(tmp, file);
}

function registerIpc() {
  ipcMain.handle('library:load', async () => {
    for (const f of [libraryFile(), `${libraryFile()}.bak`]) {
      try {
        const text = await fs.readFile(f, 'utf8');
        JSON.parse(text);
        return text;
      } catch (e) {
        if (e.code !== 'ENOENT') console.error('No se pudo leer', f, e.message);
      }
    }
    return null;
  });

  ipcMain.handle('library:save', async (_e, json) => {
    if (typeof json !== 'string' || json.length > 200 * 1024 * 1024) throw new Error('Datos de biblioteca no válidos');
    JSON.parse(json); // nunca escribir algo que no se pueda volver a leer
    try { await fs.copyFile(libraryFile(), `${libraryFile()}.bak`); } catch { /* primera vez */ }
    await writeAtomic(libraryFile(), json);
  });

  ipcMain.handle('file:export', async (e, name, content) => {
    if (typeof content !== 'string') return false;
    const win = BrowserWindow.fromWebContents(e.sender);
    const r = await dialog.showSaveDialog(win, {
      title: 'Exportar pinceles',
      defaultPath: path.join(app.getPath('documents'), sanitize(name)),
      filters: [{ name: 'Pinceles de YOSADRAW', extensions: ['yosabrush'] }, { name: 'JSON', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePath) return false;
    await fs.writeFile(r.filePath, content, 'utf8');
    return true;
  });

  ipcMain.handle('file:import', async e => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const r = await dialog.showOpenDialog(win, {
      title: 'Importar pinceles',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Pinceles de YOSADRAW', extensions: ['yosabrush', 'json'] }],
    });
    if (r.canceled) return [];
    const out = [];
    for (const f of r.filePaths) {
      const st = await fs.stat(f);
      if (st.size > MAX_FILE) throw new Error(`${path.basename(f)} es demasiado grande`);
      out.push({ name: path.basename(f), content: await fs.readFile(f, 'utf8') });
    }
    return out;
  });
}

function serveApp() {
  protocol.handle('app', async req => {
    const url = new URL(req.url);
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.normalize(path.join(DIST, rel));
    if (!file.startsWith(DIST + path.sep)) return new Response('Forbidden', { status: 403 });
    try {
      const res = await net.fetch(pathToFileURL(file).toString());
      return new Response(res.body, {
        status: res.status,
        headers: { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Security-Policy': CSP },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440, height: 900, minWidth: 960, minHeight: 620,
    title: 'YOSADRAW', backgroundColor: '#0c0a13', show: false, autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false,
      additionalArguments: [`--yosadraw-version=${app.getVersion()}`],
    },
  });
  mainWindow.once('ready-to-show', () => { mainWindow.maximize(); mainWindow.show(); });

  // Nada de navegación ni ventanas nuevas dentro de la app; los enlaces https se abren fuera.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const allowed = DEV_URL ? url.startsWith(DEV_URL) : url.startsWith('app://yosadraw/');
    if (!allowed) e.preventDefault();
  });

  if (DEV_URL) {
    void mainWindow.loadURL(DEV_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    void mainWindow.loadURL('app://yosadraw/index.html');
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.setAppUserModelId('com.yosadraw.app');
  app.whenReady().then(() => {
    // Los atajos los gestiona la propia app; en desarrollo se conservan recarga y DevTools.
    Menu.setApplicationMenu(DEV_URL ? Menu.buildFromTemplate([{ role: 'viewMenu' }]) : null);
    serveApp();
    registerIpc();
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}

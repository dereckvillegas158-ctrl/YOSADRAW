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
  "default-src 'self'", "script-src 'self' 'wasm-unsafe-eval'", "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:", "font-src 'self' data:", "connect-src 'self'", "worker-src 'self' blob:",
  "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
].join('; ');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json', '.ico': 'image/x-icon',
};

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

const libraryFile = () => path.join(app.getPath('userData'), 'brushes.json');
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const exportStateFile = () => path.join(app.getPath('userData'), 'export.json');
const MAX_EXPORT = 2 * 1024 * 1024 * 1024;

/**
 * Carpetas donde la interfaz puede escribir exportaciones: las estándar del
 * usuario y las que él mismo elige en el diálogo nativo (se recuerda la última).
 */
const approvedFolders = new Set();
let lastExportFolder = null;
function standardFolders() {
  return ['pictures', 'documents', 'desktop', 'downloads'].map(k => { try { return app.getPath(k); } catch { return null; } }).filter(Boolean);
}
function isApproved(folder) {
  const f = path.resolve(folder);
  return [...approvedFolders].some(a => f === a);
}
async function loadExportState() {
  for (const f of standardFolders()) approvedFolders.add(path.resolve(f));
  try {
    const st = JSON.parse(await fs.readFile(exportStateFile(), 'utf8'));
    if (typeof st.lastFolder === 'string') {
      const stat = await fs.stat(st.lastFolder).catch(() => null);
      if (stat?.isDirectory()) { lastExportFolder = path.resolve(st.lastFolder); approvedFolders.add(lastExportFolder); }
    }
  } catch { /* primera vez */ }
}
async function rememberFolder(folder) {
  lastExportFolder = path.resolve(folder);
  approvedFolders.add(lastExportFolder);
  await writeAtomic(exportStateFile(), JSON.stringify({ lastFolder: lastExportFolder }));
}
const sanitize = name => String(name || 'pinceles.yosabrush').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120);

async function writeAtomic(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, content, 'utf8');
  await fs.rename(tmp, file);
}

// ---------- Almacén de proyectos (galería) ----------
// Claves «carpeta/nombre» con caracteres seguros: nunca salen de userData/projects.
const STORE_KEY = /^(p|t|v|r|meta)\/[A-Za-z0-9._~-]{1,140}$/;
const storeRoot = () => path.join(app.getPath('userData'), 'projects');
function storePath(key) {
  if (typeof key !== 'string' || !STORE_KEY.test(key) || key.includes('..')) throw new Error('Clave de almacén no válida');
  return path.join(storeRoot(), ...key.split('/'));
}
/** Escritura segura: archivo temporal, fsync y renombrado (un corte no deja un proyecto a medias). */
async function writeBinaryAtomic(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  const h = await fs.open(tmp, 'w');
  try { await h.writeFile(data); await h.sync(); } finally { await h.close(); }
  await fs.rename(tmp, file);
}

function registerIpc() {
  ipcMain.handle('store:get', async (_e, key) => {
    try { return new Uint8Array(await fs.readFile(storePath(key))); }
    catch (err) { if (err.code === 'ENOENT') return null; throw err; }
  });
  ipcMain.handle('store:put', async (_e, key, data) => {
    if (!(data instanceof Uint8Array)) throw new Error('Datos no válidos');
    await writeBinaryAtomic(storePath(key), data);
  });
  ipcMain.handle('store:delete', async (_e, key) => { await fs.rm(storePath(key), { force: true }); });
  ipcMain.handle('store:list', async (_e, prefix) => {
    const dir = String(prefix).split('/')[0];
    if (!/^(p|t|v|r|meta)$/.test(dir)) throw new Error('Prefijo no válido');
    try {
      const names = await fs.readdir(path.join(storeRoot(), dir));
      return names.filter(n => !n.endsWith('.tmp')).map(n => `${dir}/${n}`).filter(k => k.startsWith(String(prefix)));
    } catch (err) { if (err.code === 'ENOENT') return []; throw err; }
  });
  ipcMain.handle('store:location', async () => storeRoot());
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

  ipcMain.handle('settings:load', async () => {
    try { const text = await fs.readFile(settingsFile(), 'utf8'); JSON.parse(text); return text; }
    catch (e) { if (e.code !== 'ENOENT') console.error('No se pudo leer settings.json', e.message); return null; }
  });

  ipcMain.handle('settings:save', async (_e, json) => {
    if (typeof json !== 'string' || json.length > 5 * 1024 * 1024) throw new Error('Preferencias no válidas');
    JSON.parse(json);
    await writeAtomic(settingsFile(), json);
  });

  ipcMain.handle('export:folder', async () => lastExportFolder ?? path.resolve(app.getPath('pictures')));

  ipcMain.handle('export:chooseFolder', async (e, current) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const r = await dialog.showOpenDialog(win, {
      title: 'Carpeta de exportación', properties: ['openDirectory', 'createDirectory'],
      defaultPath: typeof current === 'string' && current ? current : app.getPath('pictures'),
    });
    if (r.canceled || !r.filePaths[0]) return null;
    await rememberFolder(r.filePaths[0]);
    return lastExportFolder;
  });

  ipcMain.handle('export:write', async (_e, folder, name, data, overwrite) => {
    if (typeof folder !== 'string' || !isApproved(folder)) throw new Error('Elige la carpeta de destino con el botón «Cambiar…»');
    if (!(data instanceof Uint8Array) || data.length > MAX_EXPORT) throw new Error('Datos de exportación no válidos');
    const base = path.basename(String(name)).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').slice(0, 160);
    if (!base || base === '.' || base === '..') throw new Error('Nombre de archivo no válido');
    const dir = path.resolve(folder);
    await fs.mkdir(dir, { recursive: true });
    let target = path.join(dir, base);
    if (!overwrite) {
      const ext = path.extname(base), stem = base.slice(0, base.length - ext.length);
      for (let i = 2; await fs.stat(target).then(() => true, () => false); i++) target = path.join(dir, `${stem} (${i})${ext}`);
    }
    const tmp = `${target}.part`;
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, target);
    if (path.resolve(dir) !== lastExportFolder) await rememberFolder(dir);
    return target;
  });

  ipcMain.handle('export:reveal', async (_e, file) => {
    if (typeof file !== 'string' || !isApproved(path.dirname(file))) return;
    if (await fs.stat(file).then(() => true, () => false)) shell.showItemInFolder(file);
    else if (await fs.stat(path.dirname(file)).then(() => true, () => false)) await shell.openPath(path.dirname(file));
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

  // Cerrar con cambios sin guardar: la interfaz cancela el cierre y aquí se pregunta.
  mainWindow.webContents.on('will-prevent-unload', e => {
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning', title: 'YOSADRAW', buttons: ['Volver y guardar', 'Cerrar sin guardar'], defaultId: 0, cancelId: 0, noLink: true,
      message: 'Hay cambios sin guardar en el proyecto abierto.',
      detail: 'Si cierras ahora, podrás recuperarlos desde la galería la próxima vez (copia de recuperación), pero no se guardarán en el proyecto.',
    });
    if (choice === 1) e.preventDefault();
  });

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
    void loadExportState();
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}

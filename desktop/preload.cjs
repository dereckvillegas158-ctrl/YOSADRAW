'use strict';
/**
 * Puente mínimo entre la interfaz (sin acceso a Node) y el proceso principal.
 * La app lo detecta como `window.yosadraw` (ver src/yosadraw/brush/storage.ts).
 */
const { contextBridge, ipcRenderer } = require('electron');

const versionArg = process.argv.find(a => a.startsWith('--yosadraw-version='));

contextBridge.exposeInMainWorld('yosadraw', {
  platform: process.platform,
  version: versionArg ? versionArg.split('=')[1] : '',
  loadLibrary: () => ipcRenderer.invoke('library:load'),
  saveLibrary: json => ipcRenderer.invoke('library:save', String(json)),
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: json => ipcRenderer.invoke('settings:save', String(json)),
  exportFolder: () => ipcRenderer.invoke('export:folder'),
  chooseFolder: current => ipcRenderer.invoke('export:chooseFolder', String(current ?? '')),
  writeExport: (folder, name, data, overwrite) => ipcRenderer.invoke('export:write', String(folder), String(name), data, !!overwrite),
  revealFile: file => ipcRenderer.invoke('export:reveal', String(file)),
  exportFile: (name, content) => ipcRenderer.invoke('file:export', String(name), String(content)),
  importFiles: () => ipcRenderer.invoke('file:import'),
  // Almacén de proyectos (userData/projects).
  storeGet: key => ipcRenderer.invoke('store:get', String(key)),
  storePut: (key, data) => ipcRenderer.invoke('store:put', String(key), data),
  storeDelete: key => ipcRenderer.invoke('store:delete', String(key)),
  storeList: prefix => ipcRenderer.invoke('store:list', String(prefix)),
  storeLocation: () => ipcRenderer.invoke('store:location'),
  // Medios de YOSADRAW MOTION por streaming (protocolo app:// con rangos).
  storeUrl: key => Promise.resolve(/^m\/[A-Za-z0-9._~-]{1,140}$/.test(String(key)) ? `app://yosadraw/store/${key}` : null),
  // Animación: exportación con FFmpeg (fotogramas RGBA de uno en uno) y audio que Chromium no decodifica.
  video: {
    probe: () => ipcRenderer.invoke('video:probe'),
    begin: opts => ipcRenderer.invoke('video:begin', opts),
    frame: (id, data) => ipcRenderer.invoke('video:frame', Number(id), data),
    finish: id => ipcRenderer.invoke('video:finish', Number(id)),
    abort: id => ipcRenderer.invoke('video:abort', Number(id)),
  },
  // YOSADRAW MOTION: metadatos y conversión de medios con FFmpeg.
  media: {
    probe: key => ipcRenderer.invoke('media:probe', String(key)),
    transcode: (key, outKey, mode) => ipcRenderer.invoke('media:transcode', String(key), String(outKey), mode === 'proxy' ? 'proxy' : 'compat'),
  },
  decodeAudio: (data, name) => ipcRenderer.invoke('audio:decode', data, String(name ?? '')),
});

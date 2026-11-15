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
});

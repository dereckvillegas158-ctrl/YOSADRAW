import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
    modulePreload: false,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'), // YOSADRAW
        lab: resolve(__dirname, 'lab.html'),     // laboratorio del estabilizador
      },
    },
  },
});

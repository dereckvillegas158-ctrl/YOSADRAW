import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * `import data from 'x.wasm?base64'` → el binario como cadena base64.
 * Así el WebAssembly viaja dentro del worker de exportación (sin archivos
 * sueltos), también en la versión de una sola página.
 */
function base64Plugin(): Plugin {
  return {
    name: 'yosadraw-base64',
    enforce: 'pre',
    async resolveId(source, importer) {
      if (!source.endsWith('?base64')) return null;
      const r = await this.resolve(source.slice(0, -'?base64'.length), importer, { skipSelf: true });
      return r ? `\0base64:${r.id}` : null;
    },
    load(id) {
      if (!id.startsWith('\0base64:')) return null;
      return `export default ${JSON.stringify(readFileSync(id.slice('\0base64:'.length)).toString('base64'))};`;
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [base64Plugin()],
  worker: { format: 'es', plugins: () => [base64Plugin()] },
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

// Empaqueta una página en un único fragmento HTML autocontenido (CSS y JS en línea).
// Compila la entrada por separado para que todo el código quede en un solo bundle
// (en el build multipágina, Vite separa el código compartido en chunks aparte).
// Uso: node scripts/build-artifact.mjs [entrada.html] [salida.html] [título]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build, loadConfigFromFile } from 'vite';

const [entry = 'index.html', outName = 'yosadraw.html', title = 'YOSADRAW'] = process.argv.slice(2);
// La vista previa publicada no permite descargas: la UI exporta copiando al portapapeles.
process.env.VITE_TARGET = 'artifact';
const root = new URL('..', import.meta.url).pathname;
const outDir = join(root, 'dist-single', entry.replace(/\.html$/, ''));

// Reutiliza el plugin ?base64 (wasm de WebP incrustado) de vite.config.ts.
const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' }, join(root, 'vite.config.ts'));
await build({
  plugins: loaded.config.plugins,
  worker: loaded.config.worker,
  root,
  logLevel: 'warn',
  configFile: false,
  base: './',
  build: {
    outDir, emptyOutDir: true, target: 'es2020', assetsInlineLimit: 0, modulePreload: false,
    // Un solo archivo: también los import() dinámicos (worker de ZIP) van dentro.
    rollupOptions: { input: resolve(root, entry), output: { inlineDynamicImports: true } },
  },
});

const html = readFileSync(join(outDir, entry), 'utf8');
const cssHref = html.match(/<link rel="stylesheet"[^>]*href="\.\/(assets\/[^"]+\.css)"/)[1];
const jsSrc = html.match(/<script type="module"[^>]*src="\.\/(assets\/[^"]+\.js)"/)[1];
const assetDir = join(outDir, 'assets');
const dataUri = (file, mime) => `data:${mime};base64,${readFileSync(join(assetDir, file)).toString('base64')}`;
// Fuentes e imágenes incrustadas: la página publicada no puede cargar archivos sueltos.
const css = readFileSync(join(outDir, cssHref), 'utf8')
  .replace(/,\s*url\(\.\/[^)]+\.woff\) format\("woff"\)/g, '')
  .replace(/url\(\.\/([^)]+\.woff2)\)/g, (_, f) => `url(${dataUri(f, 'font/woff2')})`);
const js = readFileSync(join(outDir, jsSrc), 'utf8').replace(/<\/script/gi, '<\\/script');
if (/^\s*import\s/m.test(js) || /from"\.\//.test(js)) throw new Error('El bundle aún importa otros archivos');
const fontLink = html.match(/<link rel="stylesheet" href="https:\/\/fonts[^>]+>/);
const fonts = fontLink ? `<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n${fontLink[0]}` : '';
const body = html.match(/<body>([\s\S]*)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, '').trim()
  .replace(/src="\.\/assets\/([^"]+\.png)"/g, (_, f) => `src="${dataUri(f, 'image/png')}"`);

const out = `<title>${title}</title>
<meta name="claude:viewport-fit-sides" content="cover">
${fonts}
<style>${css}</style>
${body}
<script type="module">${js}</script>
`;
mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist', outName), out);
console.log(`dist/${outName}`, (out.length / 1024).toFixed(1), 'KB');

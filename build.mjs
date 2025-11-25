import { build } from 'esbuild';
import { copyFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function buildAll() {
  // Bundle JavaScript
  await build({
    entryPoints: [resolve(__dirname, 'src/main.jsx')],
    bundle: true,
    outfile: resolve(__dirname, 'dist/assets/index.js'),
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    minify: true,
    loader: {
      '.jsx': 'jsx',
      '.js': 'jsx'
    }
  });

  // Bundle CSS
  await build({
    entryPoints: [resolve(__dirname, 'src/index.css')],
    bundle: true,
    outfile: resolve(__dirname, 'dist/assets/index.css'),
    minify: true
  });

  // Copy vite.svg
  try {
    copyFileSync(
      resolve(__dirname, 'public/vite.svg'),
      resolve(__dirname, 'dist/vite.svg')
    );
  } catch(e) {
    console.log('vite.svg not found, skipping');
  }

  // Create index.html
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>EasyStones Product Display</title>
    <link rel="stylesheet" href="/assets/index.css">
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/assets/index.js"></script>
  </body>
</html>`;

  writeFileSync(resolve(__dirname, 'dist/index.html'), html);
  
  console.log('✅ Build completed successfully!');
}

buildAll().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});

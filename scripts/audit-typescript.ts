import { readdirSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const extensions = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts']);
const ignored = new Set(['node_modules', 'dist', 'build', 'coverage']);

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.name.startsWith('.') || ignored.has(entry.name)) return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return walk(path);
    return entry.isFile() && extensions.has(extname(path)) && !path.endsWith('.d.ts')
      ? [relative(root, path)] : [];
  });
}

const files = walk(root).sort();
const javascript = files.filter(file => /\.[cm]?jsx?$/.test(file));
const typescript = files.filter(file => /\.[cm]?tsx?$/.test(file));
const countByExtension = (list: string[]) => Object.fromEntries(
  [...new Set(list.map(extname))].sort().map(extension => [extension, list.filter(file => extname(file) === extension).length])
);
const areaOf = (file: string): string => file.startsWith('src/')
  ? file.split('/').length > 2 ? file.split('/').slice(0, 2).join('/') : 'src (root)'
  : file.includes('/') ? file.split('/')[0] : '(root)';
const areas = [...new Set(javascript.map(areaOf))].sort();
const report = {
  javascript: javascript.length,
  typescript: typescript.length,
  extensions: countByExtension(javascript),
  application: javascript.filter(file => file.startsWith('src/') && !file.includes('.test.')).length,
  tests: javascript.filter(file => file.includes('.test.')).length,
  tooling: javascript.filter(file => !file.startsWith('src/')).length,
  areas: Object.fromEntries(areas.map(area => [area, javascript.filter(file => areaOf(file) === area).length])),
  files: javascript
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`JavaScript remaining: ${report.javascript} (${Object.entries(report.extensions).map(([extension, count]) => `${count} ${extension}`).join(', ')})`);
  console.log(`Application: ${report.application}; tests: ${report.tests}; tooling/harness: ${report.tooling}`);
  console.log(`TypeScript: ${report.typescript}`);
  console.table(report.areas);
  if (process.argv.includes('--list')) console.log(report.files.join('\n'));
}

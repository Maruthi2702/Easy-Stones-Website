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

const check = process.argv.includes('--check');
if (check && !process.argv.includes('--json') && !process.argv.includes('--list')) {
  if (javascript.length === 0) {
    console.log('TypeScript migration check passed: no JavaScript source files remain.');
  } else {
    console.error(`TypeScript migration check failed: ${javascript.length} JavaScript source file(s) remain:\n${javascript.join('\n')}`);
  }
} else if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const extensionCounts = Object.entries(report.extensions).map(([extension, count]) => `${count} ${extension}`).join(', ');
  console.log(`JavaScript remaining: ${report.javascript}${extensionCounts ? ` (${extensionCounts})` : ''}`);
  console.log(`Application: ${report.application}; tests: ${report.tests}; tooling/harness: ${report.tooling}`);
  console.log(`TypeScript: ${report.typescript}`);
  if (areas.length) console.table(report.areas);
  if (process.argv.includes('--list')) console.log(report.files.join('\n'));
}
if (check && javascript.length > 0) process.exitCode = 1;

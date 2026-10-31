// Checks what the server loads can actually be loaded by Node on Render.
//
// Render runs `node server.ts` with no build step, on Node 24 (since
// 2026-10-23; MIGRATION_NOTES.md §1). Node 24 strips TypeScript types itself,
// so a server file may be `.ts` — but only plain, erasable TypeScript (tsconfig's
// erasableSyntaxOnly / verbatimModuleSyntax check that), never `.tsx` (Node
// doesn't compile JSX), and every import must name the file exactly as it is
// on disk, extension included: Node has no extension guessing, and
// './userForm' instead of './userForm.js' is what took the server down on
// 2026-10-23. This walks every relative import from the server's entry points
// (server.ts, ensure-indexes.ts) and refuses either mistake. `npm run build`
// runs it first, so on Render a bad import fails the deploy instead of the
// live server.
//
//   node scripts/check-server-ts.ts          (part of `npm run typecheck`)
//   node scripts/check-server-ts.ts --list   also prints the browser-only files
//   node scripts/check-server-ts.ts --server-list   …and the files the server loads
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

// Block comments, and lines that are only a comment: their example imports
// (`import createX from './src/routes/x.js'` in a doc comment) aren't real.
const stripComments = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

const IMPORT_RE = /(?:^|[\s;])(?:import|export)\s[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]|import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)|^\s*import\s*['"](\.{1,2}\/[^'"]+)['"]/gm;

export function walk(entries: string[], { exact }: { exact: boolean }) {
  const seen = new Set<string>();
  const problems: string[] = [];
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    if (!/\.(m?js|jsx|ts|tsx)$/.test(file)) return;
    const src = stripComments(fs.readFileSync(file, 'utf8'));
    // All matches first: visiting an import recurses, and the regex is shared.
    for (const m of [...src.matchAll(IMPORT_RE)]) {
      const spec = m[1] || m[2] || m[3];
      let target = path.resolve(path.dirname(file), spec);
      const isFile = (p: string) => fs.existsSync(p) && fs.statSync(p).isFile();
      if (!isFile(target)) {
        if (exact) { problems.push(`${path.relative(root, file)} imports '${spec}', which Node can't find as written`); continue; }
        // Vite resolves extensionless and directory imports; mirror it.
        const found = ['.js', '.jsx', '.ts', '.tsx', '/index.js', '/index.jsx', '/index.ts', '/index.tsx']
          .map((ext) => target + ext).find(isFile)
          || (/\.jsx?$/.test(target) ? [target.replace(/\.jsx?$/, '.ts'), target.replace(/\.jsx?$/, '.tsx')].find(isFile) : null);
        if (!found) continue;
        target = found;
      }
      visit(target);
    }
  };
  entries.forEach((e) => visit(path.resolve(root, e)));
  return { files: seen, problems };
}

// What Render runs. scripts/ are run by hand (some are old and import files
// that no longer exist), so a missing import there is only a warning.
const server = walk(['server.ts', 'ensure-indexes.ts'], { exact: true });
const scriptEntries = fs.readdirSync(path.join(root, 'scripts'))
  .filter((f) => /\.ts$/.test(f) && f !== 'check-server-ts.ts').map((f) => `scripts/${f}`);
const scripts = walk(scriptEntries, { exact: true });
const nodeFiles = new Set([...server.files, ...scripts.files]);

const typed = [...nodeFiles].filter((f) => /\.tsx$/.test(f)).map((f) => `${path.relative(root, f)} is .tsx (JSX), and the server or a script loads it — Node can't run JSX`);
const problems = [...server.problems, ...typed];
scripts.problems.filter((p) => !server.problems.includes(p)).forEach((p) => console.error(`  warning: ${p}`));

if (process.argv.includes('--server-list')) {
  console.log([...nodeFiles].map((f) => path.relative(root, f)).sort().join('\n'));
}

if (process.argv.includes('--list')) {
  const browser = walk(['src/main.tsx'], { exact: false });
  const only = [...browser.files].filter((f) => !nodeFiles.has(f) && /\.(jsx?|tsx?)$/.test(f)).map((f) => path.relative(root, f)).sort();
  console.log(only.join('\n'));
  console.error(`${only.length} browser-only files; ${only.filter((f) => /\.tsx?$/.test(f)).length} already TypeScript`);
}

if (problems.length) {
  console.error('Server import check failed (Node loads imports exactly as written, and never .tsx):');
  problems.forEach((p) => console.error(`  ${p}`));
  process.exit(1);
}
const tsCount = [...nodeFiles].filter((f) => /\.ts$/.test(f)).length;
console.error(`Server import check: ${nodeFiles.size} files found as written (${tsCount} TypeScript).`);

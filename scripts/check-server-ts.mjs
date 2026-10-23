// Fails if anything the server loads is a .ts/.tsx file (MIGRATION_NOTES.md §1).
//
// Render runs `node server.js` on Node 20.19 with no build step, and Node 20
// refuses a .ts file at start (ERR_UNKNOWN_FILE_EXTENSION) — the whole server
// stays down. So until Render is on Node 24, only files that the browser alone
// loads may be TypeScript. This walks every relative import from the server's
// entry points (server.js, ensure-indexes.js, scripts/*) and also refuses an
// import that doesn't resolve to a file exactly as written: Node has no
// extension guessing, and './userForm' instead of './userForm.js' is what took
// the server down on 2026-10-23.
//
//   node scripts/check-server-ts.mjs          (part of `npm run typecheck`)
//   node scripts/check-server-ts.mjs --list   also prints the browser-only files
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

// Block comments, and lines that are only a comment: their example imports
// (`import createX from './src/routes/x.js'` in a doc comment) aren't real.
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

const IMPORT_RE = /(?:^|[\s;])(?:import|export)\s[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]|import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)|^\s*import\s*['"](\.{1,2}\/[^'"]+)['"]/gm;

export function walk(entries, { exact }) {
  const seen = new Set();
  const problems = [];
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    if (!/\.(m?js|jsx|ts|tsx)$/.test(file)) return;
    const src = stripComments(fs.readFileSync(file, 'utf8'));
    // All matches first: visiting an import recurses, and the regex is shared.
    for (const m of [...src.matchAll(IMPORT_RE)]) {
      const spec = m[1] || m[2] || m[3];
      let target = path.resolve(path.dirname(file), spec);
      const isFile = (p) => fs.existsSync(p) && fs.statSync(p).isFile();
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
const server = walk(['server.js', 'ensure-indexes.js'], { exact: true });
const scriptEntries = fs.readdirSync(path.join(root, 'scripts'))
  .filter((f) => /\.m?js$/.test(f) && f !== 'check-server-ts.mjs').map((f) => `scripts/${f}`);
const scripts = walk(scriptEntries, { exact: true });
const nodeFiles = new Set([...server.files, ...scripts.files]);

const typed = [...nodeFiles].filter((f) => /\.tsx?$/.test(f)).map((f) => `${path.relative(root, f)} is TypeScript, and the server or a script loads it`);
const problems = [...server.problems, ...typed];
scripts.problems.filter((p) => !server.problems.includes(p)).forEach((p) => console.error(`  warning: ${p}`));

if (process.argv.includes('--list')) {
  const browser = walk(['src/main.jsx'], { exact: false });
  const only = [...browser.files].filter((f) => !nodeFiles.has(f) && /\.(jsx?|tsx?)$/.test(f)).map((f) => path.relative(root, f)).sort();
  console.log(only.join('\n'));
  console.error(`${only.length} browser-only files; ${only.filter((f) => /\.tsx?$/.test(f)).length} already TypeScript`);
}

if (problems.length) {
  console.error('Server import check failed (MIGRATION_NOTES.md §1 — Node 20 can only load .js):');
  problems.forEach((p) => console.error(`  ${p}`));
  process.exit(1);
}
console.error(`Server import check: ${nodeFiles.size} files, all plain JavaScript and found as written.`);

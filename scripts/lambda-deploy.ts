/**
 * Build the server's Lambda code and upload it (src/lambda/README.md).
 *
 *   node scripts/lambda-deploy.ts --module permits             build, zip, upload to easy-surfaces-<env>-api-permits
 *   node scripts/lambda-deploy.ts --module permits --zip-only  build and zip; print where and how big; upload nothing
 *   --out <dir>   build there (kept) instead of a temporary folder
 *
 * LAMBDA_ENV  dev (default) | staging | prod — names the function.
 * AWS credentials: the usual chain (AWS_PROFILE, SSO, env); region us-east-2 unless AWS_REGION.
 *
 * The bundle is the same for every module (MODULE is the function's own setting):
 *   index.mjs                 src/lambda/handler.ts and server.ts, bundled (esbuild, ESM, node24)
 *   src/…/<worker>.mjs        each worker thread a file starts with new URL('./x.ts', import.meta.url)
 *   public/…                  the files the server reads from disk (PDF logos, mockup templates)
 *   node_modules/sharp        native, for linux-arm64 (Lambda's arm64, glibc)
 *   node_modules/pdfjs-dist   pdf.js reads its own worker file next to it, so it isn't bundled
 * Playwright (the ERP scraper) is replaced by a stub that says it runs on Render only.
 * Like the db-copy Lambda (scripts/pg-copy-aws.ts): CloudFormation made the function
 * with placeholder code, and this replaces only the code.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'esbuild';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const valueOf = (name: string) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : undefined; };

/** Files the server reads from disk at run time, relative to the repo (kept at the same place in the bundle). */
export const RUNTIME_FILES = [
  'public/logo.png',                          // permits, check-in log and daily report PDFs
  'public/favicon.png',                       // the hold letter PDF
  'public/images/templates/kitchen_template.png',   // product mockups (server.ts generateMockups)
  'public/images/templates/bathroom_template.png'
];

/** Optional add-ons of bundled packages that this app never uses, and what must stay a real package. */
export const EXTERNAL = [
  'sharp', 'pdfjs-dist', 'pdfjs-dist/*',
  'pg-native', 'kerberos', '@mongodb-js/zstd', 'snappy', 'socks', 'aws4', 'mongodb-client-encryption', 'gcp-metadata',
  '@aws-sdk/credential-providers', 'fsevents', 'bufferutil', 'utf-8-validate', 'supports-color'
];

const PDFJS_FILES = ['package.json', 'LICENSE', 'legacy/build/pdf.mjs', 'legacy/build/pdf.worker.mjs'];

const posix = (p: string) => p.split(path.sep).join('/');
const inApp = (file: string) => file.startsWith(ROOT + path.sep) && !file.includes(`${path.sep}node_modules${path.sep}`);

/**
 * In the bundle every `import.meta.url` is the output file's. A source file's own
 * becomes its place in the bundle folder (`new URL('./src/permits/permitsPdf.ts',
 * import.meta.url)`), so `path.join(HERE, '..', '..', 'public', …)` still finds
 * public/ — and a worker started from `new URL('./x.ts', import.meta.url)` is
 * pointed at its bundled `x.mjs`, built next to where the source sits.
 */
function sourcePlaces(outRelDir: string, workers: Set<string>): Plugin {
  return {
    name: 'source-places',
    setup(b) {
      b.onLoad({ filter: /\.(ts|mts|js|mjs)$/ }, async (a) => {
        if (!inApp(a.path)) return undefined;
        let src = await fs.promises.readFile(a.path, 'utf8');
        if (!src.includes('import.meta.url')) return undefined;
        src = src.replace(/new URL\((['"])(\.{1,2}\/[^'"]+)\.ts\1,\s*import\.meta\.url\)/g, (_m, q: string, spec: string) => {
          workers.add(path.resolve(path.dirname(a.path), `${spec}.ts`));
          return `new URL(${q}${spec}.mjs${q}, import.meta.url)`;
        });
        // Where the source would sit in the bundle folder, from the output file's folder.
        let rel = path.posix.relative(outRelDir, posix(path.relative(ROOT, a.path)));
        if (!rel.startsWith('.')) rel = `./${rel}`;
        src = src.replaceAll('import.meta.url', `new URL(${JSON.stringify(rel)}, import.meta.url).href`);
        return { contents: src, loader: a.path.endsWith('ts') ? 'ts' : 'js' };
      });
    }
  };
}

/** The ERP scraper's browser can't run on Lambda; importing it must still work. */
const playwrightStub: Plugin = {
  name: 'playwright-stub',
  setup(b) {
    b.onResolve({ filter: /^playwright(-core)?$/ }, (a) => ({ path: a.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: "const off = () => { throw new Error('The ERP scraper needs a browser: it runs on Render, not on Lambda.'); };\n"
        + 'export const chromium = { launch: off }; export const firefox = { launch: off }; export const webkit = { launch: off }; export default { chromium, firefox, webkit };',
      loader: 'js'
    }));
  }
};

async function bundle(outDir: string): Promise<string[]> {
  const { build } = await import('esbuild');
  const workers = new Set<string>();
  const built = new Set<string>();
  const one = async (entry: string, outfile: string) => {
    await build({
      entryPoints: [entry],
      outfile,
      bundle: true, platform: 'node', target: 'node24', format: 'esm',
      sourcemap: true, minifyWhitespace: true, minifySyntax: true, legalComments: 'none',
      // The MongoDB driver, express and the AWS SDK are CommonJS and call require().
      banner: { js: "import { createRequire as __lambdaRequire } from 'node:module'; const require = __lambdaRequire(import.meta.url);" },
      external: EXTERNAL,
      plugins: [sourcePlaces(posix(path.relative(outDir, path.dirname(outfile))), workers), playwrightStub],
      logLevel: 'warning'
    });
    built.add(entry);
    // Every path must be inside the bundle: one that reaches back into this checkout
    // works here and fails on Lambda.
    if (fs.readFileSync(outfile, 'utf8').includes(ROOT)) throw new Error(`${path.relative(outDir, outfile)} names a path in ${ROOT}`);
  };
  await one(path.join(ROOT, 'src/lambda/handler.ts'), path.join(outDir, 'index.mjs'));
  // Workers a worker starts, too.
  for (let todo = [...workers]; todo.length; todo = [...workers].filter((w) => !built.has(w))) {
    for (const w of todo) {
      if (!fs.existsSync(w)) throw new Error(`A worker the server starts is missing: ${path.relative(ROOT, w)}`);
      await one(w, path.join(outDir, path.relative(ROOT, w).replace(/\.ts$/, '.mjs')));
    }
  }
  return [...workers].map((w) => path.relative(ROOT, w));
}

function copyRuntimeFiles(outDir: string) {
  for (const rel of RUNTIME_FILES) {
    const from = path.join(ROOT, rel);
    if (!fs.existsSync(from)) throw new Error(`The server reads ${rel}, which isn't there`);
    fs.mkdirSync(path.dirname(path.join(outDir, rel)), { recursive: true });
    fs.copyFileSync(from, path.join(outDir, rel));
  }
  const pdfjs = path.join(ROOT, 'node_modules/pdfjs-dist');
  for (const rel of PDFJS_FILES) {
    const to = path.join(outDir, 'node_modules/pdfjs-dist', rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(pdfjs, rel), to);
  }
}

/** Downloads are kept in LAMBDA_BUILD_CACHE (default ~/.cache/easy-surfaces-lambda): GitHub's release links are sometimes slow. */
const CACHE = process.env.LAMBDA_BUILD_CACHE || path.join(os.homedir(), '.cache', 'easy-surfaces-lambda');

async function download(url: string, check: (b: Buffer) => void = () => {}, tries = 6): Promise<Buffer> {
  const cached = path.join(CACHE, path.basename(new URL(url).pathname));
  if (fs.existsSync(cached)) {
    const b = fs.readFileSync(cached);
    try { check(b); return b; } catch { fs.rmSync(cached); }
  }
  let last: unknown;
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const b = Buffer.from(await res.arrayBuffer());
      check(b);
      fs.mkdirSync(CACHE, { recursive: true });
      fs.writeFileSync(cached, b);
      return b;
    } catch (err) {
      last = err;
      console.warn(`  download failed (${i}/${tries}): ${url} — ${(err as Error).message}`);
      if (i < tries) await new Promise((r) => setTimeout(r, 5000 * i));
    }
  }
  throw new Error(`Could not download ${url}: ${(last as Error)?.message}`);
}

/** Only what's loaded at run time (the dependency closure of `roots`, plus `also`): nothing an install script used. */
function keepOnly(nodeModules: string, roots: string[], also: string[]) {
  const keep = new Set<string>(also);
  const visit = (name: string) => {
    if (keep.has(name)) return;
    const pkgFile = path.join(nodeModules, name, 'package.json');
    if (!fs.existsSync(pkgFile)) return;
    keep.add(name);
    const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
    Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies }).forEach(visit);
  };
  roots.forEach(visit);
  for (const e of fs.readdirSync(nodeModules)) {
    if (e.startsWith('@')) {
      for (const sub of fs.readdirSync(path.join(nodeModules, e))) if (!keep.has(`${e}/${sub}`)) fs.rmSync(path.join(nodeModules, e, sub), { recursive: true, force: true });
    } else if (!keep.has(e)) fs.rmSync(path.join(nodeModules, e), { recursive: true, force: true });
  }
}

/**
 * The native packages, for linux-arm64 (glibc), into <outDir>/node_modules, at the
 * versions installed here: sharp, and @napi-rs/canvas (pdf.js needs its DOMMatrix
 * to read a PDF's text — the Fuel Man report, packing lists). npm's --os / --cpu
 * pick canvas's linux-arm64 package. sharp sharp 0.32 downloads its binaries in an install script that
 * would fetch the Mac's; so its JavaScript and dependencies are installed with no
 * scripts, and its two binaries (libvips, checked against sharp's own integrity
 * hash, and the addon) are fetched and unpacked here. sharp 0.33+ publishes them
 * on npm (@img/sharp-linux-arm64), which npm's --os / --cpu pick.
 */
const installedVersion = (name: string): string => JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', name, 'package.json'), 'utf8')).version;

async function installNative(outDir: string) {
  const version = installedVersion('sharp');
  const [major, minor] = version.split('.').map(Number);
  const npm = (...extra: string[]) => execFileSync('npm', ['install', '--no-save', '--no-audit', '--no-fund', '--no-package-lock', '--omit=dev', '--os=linux', '--cpu=arm64', '--libc=glibc', ...extra,
    `sharp@${version}`, `@napi-rs/canvas@${installedVersion('@napi-rs/canvas')}`], { cwd: outDir, stdio: ['ignore', 'ignore', 'inherit'] });
  fs.writeFileSync(path.join(outDir, 'package.json'), JSON.stringify({ name: 'easy-surfaces-api', private: true, type: 'module' }, null, 2));
  if (major > 0 || minor >= 33) { npm(); fs.rmSync(path.join(outDir, 'node_modules/.bin'), { recursive: true, force: true }); return version; }

  npm('--ignore-scripts');
  const sharpDir = path.join(outDir, 'node_modules/sharp');
  const pkg = JSON.parse(fs.readFileSync(path.join(sharpDir, 'package.json'), 'utf8'));
  const libvips: string = pkg.config.libvips;
  const platform = 'linux-arm64v8';
  const want = pkg.config.integrity[platform];
  const tar = await download(`https://github.com/lovell/sharp-libvips/releases/download/v${libvips}/libvips-${libvips}-${platform}.tar.br`, (b) => {
    const got = `sha512-${crypto.createHash('sha512').update(b).digest('base64')}`;
    if (want !== got) throw new Error(`libvips ${libvips} for ${platform}: integrity ${got} isn't sharp's ${want}`);
  });
  const vendor = path.join(sharpDir, 'vendor', libvips, platform);
  fs.mkdirSync(vendor, { recursive: true });
  execFileSync('tar', ['-x', '-C', vendor, '--exclude', 'include/*'], { input: zlib.brotliDecompressSync(tar) });
  const addon = await download(`https://github.com/lovell/sharp/releases/download/v${version}/sharp-v${version}-napi-v${pkg.binary.napi_versions[0]}-linux-arm64.tar.gz`, (b) => zlib.gunzipSync(b));
  execFileSync('tar', ['-xz', '-C', sharpDir], { input: addon });
  const node = path.join(sharpDir, 'build/Release/sharp-linux-arm64v8.node');
  if (!fs.existsSync(node)) throw new Error(`sharp's linux-arm64 addon isn't where sharp looks for it (${path.relative(outDir, node)})`);
  // Install-time only: what sharp's own install script used.
  keepOnly(path.join(outDir, 'node_modules'), ['color', 'detect-libc', 'semver', '@napi-rs/canvas'], ['sharp']);
  if (!fs.existsSync(path.join(outDir, 'node_modules/@napi-rs/canvas-linux-arm64-gnu'))) throw new Error("@napi-rs/canvas's linux-arm64 package wasn't installed");
  fs.rmSync(path.join(sharpDir, 'src'), { recursive: true, force: true });
  fs.rmSync(path.join(outDir, 'node_modules/.bin'), { recursive: true, force: true });
  return version;
}

const sizeOf = (dir: string): number => fs.readdirSync(dir, { withFileTypes: true })
  .reduce((n, e) => n + (e.isDirectory() ? sizeOf(path.join(dir, e.name)) : fs.lstatSync(path.join(dir, e.name)).size), 0);
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

export async function buildZip(outDir: string): Promise<{ zip: string; zipped: number; unzipped: number; workers: string[]; sharp: string }> {
  fs.mkdirSync(outDir, { recursive: true });
  for (const e of fs.readdirSync(outDir)) fs.rmSync(path.join(outDir, e), { recursive: true, force: true });
  const sharp = await installNative(outDir);
  const workers = await bundle(outDir);
  copyRuntimeFiles(outDir);
  const unzipped = sizeOf(outDir);
  const zip = path.join(path.dirname(outDir), `${path.basename(outDir)}.zip`);
  fs.rmSync(zip, { force: true });
  execFileSync('zip', ['-qr', '-X', zip, '.'], { cwd: outDir });
  return { zip, zipped: fs.statSync(zip).size, unzipped, workers, sharp };
}

async function main() {
  const moduleName = valueOf('--module');
  if (!moduleName || !/^[a-z][a-z0-9-]*$/.test(moduleName)) throw new Error('--module <name> is needed (lowercase, e.g. permits)');
  const functionName = `easy-surfaces-${process.env.LAMBDA_ENV || 'dev'}-api-${moduleName}`;
  const given = valueOf('--out');
  const outDir = given ? path.resolve(given) : fs.mkdtempSync(path.join(os.tmpdir(), `lambda-${moduleName}-`));
  const { zip, zipped, unzipped, workers, sharp } = await buildZip(outDir);
  console.log(`Built ${zip}: ${mb(zipped)} zipped, ${mb(unzipped)} unzipped (Lambda allows 50 MB / 250 MB).`);
  console.log(`  sharp ${sharp} linux-arm64; workers: ${workers.join(', ') || 'none'}`);
  if (zipped > 50 * 1024 * 1024 || unzipped > 250 * 1024 * 1024) throw new Error('Too big for Lambda.');
  if (flag('--zip-only')) { console.log(`--zip-only: nothing uploaded. The folder is ${outDir}`); return; }

  const { LambdaClient, UpdateFunctionCodeCommand, waitUntilFunctionUpdatedV2 } = await import('@aws-sdk/client-lambda');
  const lambda = new LambdaClient({ region: process.env.AWS_REGION || 'us-east-2' });
  await lambda.send(new UpdateFunctionCodeCommand({ FunctionName: functionName, ZipFile: fs.readFileSync(zip) }));
  await waitUntilFunctionUpdatedV2({ client: lambda, maxWaitTime: 300 }, { FunctionName: functionName });
  console.log(`Deployed ${functionName}.`);
  if (!given) fs.rmSync(outDir, { recursive: true, force: true });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exitCode = 1; });
}

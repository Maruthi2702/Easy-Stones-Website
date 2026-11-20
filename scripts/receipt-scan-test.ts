/**
 * Try receipt reading on real receipts before choosing a model (no database, nothing saved).
 *
 *   ANTHROPIC_API_KEY=… node scripts/receipt-scan-test.ts <folder> [--models claude-haiku-5-5,claude-sonnet-5-5,claude-opus-5-5]
 *
 * Reads every .jpg / .jpeg / .png / .webp / .pdf in the folder (photos shrunk to 2000px,
 * as the app stores them), with each model, and prints what each read, then the
 * tokens and the cost per receipt. Writes the full answers to <folder>/receipt-scan-results.json
 * so they can be checked against the receipts by hand.
 * Categories are the starting list (Admin → Receipt Categories may differ).
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { createReceiptScanner, type ReceiptSource } from '../src/services/receiptScan.ts';
import { STARTING_CATEGORIES, categoryKey, centsText } from '../src/utils/cardReceipts.ts';

// $ per million tokens (input, output), from Anthropic's price list, 2026-11.
const PRICES: Record<string, [number, number]> = {
  'claude-haiku-5-5': [0.10, 0.50],
  'claude-sonnet-5-5': [2, 10],
  'claude-opus-5-5': [4, 20]
};

const args = process.argv.slice(2);
const folder = args.find((a) => !a.startsWith('--'));
const modelsArg = args[args.indexOf('--models') + 1];
const models = args.includes('--models') && modelsArg ? modelsArg.split(',') : ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'];
if (!folder || !fs.existsSync(folder)) { console.error('Usage: node scripts/receipt-scan-test.ts <folder> [--models a,b]'); process.exit(1); }
if (!process.env.ANTHROPIC_API_KEY) { console.error('Set ANTHROPIC_API_KEY first.'); process.exit(1); }

const categories = STARTING_CATEGORIES.map((c) => ({ name: categoryKey(c.label), label: c.label }));
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const files = fs.readdirSync(folder).filter((f) => /\.(jpe?g|png|webp|pdf)$/i.test(f)).sort();
if (!files.length) { console.error('No .jpg / .png / .webp / .pdf files in that folder (HEIC: export as JPEG first).'); process.exit(1); }

async function sourceOf(file: string): Promise<ReceiptSource> {
  const full = path.join(folder!, file);
  if (/\.pdf$/i.test(file)) return { data: fs.readFileSync(full).toString('base64'), mediaType: 'application/pdf' };
  const jpeg = await sharp(full).rotate().resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
  return { data: jpeg.toString('base64'), mediaType: 'image/jpeg' };
}

const results: Record<string, Record<string, unknown>> = {};
const totals: Record<string, { cost: number; ok: number; ms: number }> = {};
for (const model of models) totals[model] = { cost: 0, ok: 0, ms: 0 };

for (const file of files) {
  const source = await sourceOf(file);
  results[file] = {};
  console.log(`\n${file}`);
  for (const model of models) {
    const scanner = createReceiptScanner({ model })!;
    const started = Date.now();
    const r = await scanner.scan(source, { categories, today });
    const ms = Date.now() - started;
    totals[model].ms += ms;
    if (!r.ok) {
      console.log(`  ${model.padEnd(18)} ✗ ${r.reason}`);
      results[file][model] = r;
      continue;
    }
    const [inP, outP] = PRICES[model] || [0, 0];
    const cost = (r.usage.input * inP + r.usage.output * outP) / 1e6;
    totals[model].cost += cost;
    totals[model].ok += 1;
    const s = r.scan;
    console.log(`  ${model.padEnd(18)} ${s.date || '—'.padEnd(10)}  ${('$' + (centsText(s.totalCents) || '—')).padStart(10)}  ${(s.merchant || '—').slice(0, 28).padEnd(28)}  ${(s.category || '—').padEnd(22)} tip ${centsText(s.tipCents) || '—'}  ${(ms / 1000).toFixed(1)}s  ${(cost * 100).toFixed(2)}¢`);
    results[file][model] = { ...s, usage: r.usage, ms, costUsd: cost };
  }
}

console.log('\nPer model:');
for (const model of models) {
  const t = totals[model];
  console.log(`  ${model.padEnd(18)} read ${t.ok}/${files.length}  avg ${(t.ms / files.length / 1000).toFixed(1)}s  avg ${(t.cost / Math.max(t.ok, 1) * 100).toFixed(2)}¢/receipt  ≈ $${(t.cost / Math.max(t.ok, 1) * 1050).toFixed(2)} for 1,050 a month`);
}
const out = path.join(folder, 'receipt-scan-results.json');
fs.writeFileSync(out, JSON.stringify(results, null, 2));
console.log(`\nFull answers: ${out}`);

import { Worker } from 'node:worker_threads';
import type { ParsedReport } from './types.ts';
let active = 0;
export async function readFuelManPdf(buffer: Buffer): Promise<ParsedReport> {
  if (!buffer.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error('Upload a genuine PDF file');
  if (active >= 2) throw new Error('Two reports are already being read. Try again shortly.');
  active++;
  try {
    return await new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./pdfWorker.ts', import.meta.url), { workerData: buffer, resourceLimits: { maxOldGenerationSizeMb: 256 } });
      let settled = false;
      const finish = (error?: Error, report?: ParsedReport) => {
        if (settled) return;
        settled = true; clearTimeout(timer); void worker.terminate();
        if (error) reject(error); else resolve(report!);
      };
      const timer = setTimeout(() => finish(new Error('Reading timed out. Use the original text-based Fuelman PDF.')), 30000);
      worker.on('message', value => value.ok ? finish(undefined, value.result) : finish(new Error(value.error)));
      worker.on('error', error => finish(error instanceof Error ? error : new Error(String(error))));
      worker.on('exit', code => { if (!settled) finish(new Error(`PDF reader stopped (${code})`)); });
    });
  } finally { active--; }
}

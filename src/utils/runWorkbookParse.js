/**
 * Parse an uploaded workbook with a hard ceiling on how long it's allowed to
 * take — see workbookParseWorker.js for why this has to be an actual worker
 * thread rather than a same-thread timeout, which cannot preempt a
 * synchronous parse that never yields.
 *
 * One worker per call, discarded afterward rather than pooled: an import is
 * an occasional, human-triggered action (someone picking a file and clicking
 * Import), not a hot path worth the complexity of keeping workers warm for.
 */
import { Worker } from 'node:worker_threads';

const WORKER_PATH = new URL('./workbookParseWorker.js', import.meta.url);

// Generous relative to any real export this app has ever produced (SPS's
// largest inventory snapshot so far is ~10,500 rows and parses in well under
// a second) — this exists to bound the *malicious or corrupt* case, not to
// pressure a legitimate big file.
const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * @param {'inventory-stock'|'inventory-sales'|'customer'} kind - which parser
 *   in workbookParseWorker.js's PARSERS map to run.
 * @param {Buffer} buffer - the uploaded file, exactly as multer handed it to
 *   the route (memory storage, so already a Buffer, not a stream).
 * @param {number} [timeoutMs]
 * @returns {Promise<any>} whatever the underlying parser normally returns.
 */
export function runWorkbookParse(kind, buffer, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_PATH, { workerData: { kind, buffer } });
    let settled = false;

    const finish = (fn, arg) => {
      if (settled) return; // one of the listeners below already resolved/rejected
      settled = true;
      clearTimeout(timer);
      // Fire-and-forget: the worker either already posted its result and is
      // about to exit on its own, or is being cut off after timing out.
      // Nothing downstream needs to wait on the termination itself.
      worker.terminate().catch(() => {});
      fn(arg);
    };

    const timer = setTimeout(() => {
      finish(reject, new Error(
        'This file took too long to process and was stopped. Check that it is a genuine, ' +
        'well-formed export — a corrupted or unusually structured file is the most common cause.'
      ));
    }, timeoutMs);

    worker.once('message', (msg) => {
      if (msg?.ok) finish(resolve, msg.result);
      else finish(reject, new Error(msg?.error || 'The file could not be parsed.'));
    });

    // A crash inside the worker that never reached the try/catch in
    // workbookParseWorker.js (e.g. an out-of-memory kill) — surfaces here
    // instead of taking down the request, which is the whole point of the
    // isolation.
    worker.once('error', (err) => finish(reject, err));

    worker.once('exit', (code) => {
      // A clean exit always follows a 'message' above, which already settled
      // this promise — this only fires for real when the worker vanished
      // without ever posting one (killed by something outside our own
      // terminate() call, e.g. the OS under memory pressure).
      if (!settled) finish(reject, new Error(`File processing stopped unexpectedly (code ${code}).`));
    });
  });
}

/**
 * Runs one untrusted-file parse, in a thread of its own.
 *
 * Every parser this dispatches to (parseInventoryStockWorkbook,
 * parseInventorySalesWorkbook, readCustomerSheet) is a plain, synchronous,
 * CPU-bound function over bytes someone else uploaded — no DB access, nothing
 * async inside them. That is exactly the shape a malformed file can turn into
 * a runaway parse (regex catastrophic backtracking, a pathological cell
 * count), and a synchronous CPU-bound loop cannot be interrupted by a
 * same-thread timeout: nothing else — including the timer's own callback —
 * gets to run until the loop finishes on its own. A setTimeout guarding this
 * on the main thread would never fire while the parse it's supposed to cancel
 * is still running, and while that parse runs, it is not just the uploader
 * who is stuck: this app is one Node process, so every other request stalls
 * behind it too.
 *
 * A worker thread is the actual fix: it has its own JS heap and its own
 * timeline, so the main thread — everyone else's requests, the socket.io
 * board updates, the auto-submit job's clock — keeps running while this one
 * parse does whatever it does, and runWorkbookParse.js can forcibly
 * worker.terminate() this whole thread if it runs too long, which no amount
 * of Promise.race() on the main thread could ever do to code that never
 * yields.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { parseInventoryStockWorkbook, parseInventorySalesWorkbook } from './inventoryImport.js';
import { readCustomerSheet } from './customerImport.js';

const PARSERS = {
  'inventory-stock': parseInventoryStockWorkbook,
  'inventory-sales': parseInventorySalesWorkbook,
  customer: readCustomerSheet
};

try {
  const { kind, buffer } = workerData;
  const parse = PARSERS[kind];
  if (!parse) throw new Error(`workbookParseWorker: unknown parse kind "${kind}"`);

  // workerData's structured clone degrades a real Buffer into a plain
  // Uint8Array — same bytes, but Buffer.prototype.toString(encoding) is what
  // actually decodes them as text; Uint8Array inherits Array.prototype's
  // toString(), which ignores the encoding argument and numeric-joins the
  // bytes instead ("60,104,116,109,..." instead of "<htm..."). Every parser
  // here eventually calls buffer.toString('utf8') on an HTML-flavored
  // export, so without this the worker path silently fed each one a wall of
  // comma-separated byte values instead of the actual document — no error,
  // just a parse that found nothing and fell through to a much worse guess.
  // Buffer.from() re-wraps the same bytes as a real Buffer before any parser
  // sees them.
  const result = parse(Buffer.from(buffer));
  parentPort.postMessage({ ok: true, result });
} catch (error) {
  // Serialized deliberately as a plain string, not the Error object — a
  // thrown Error doesn't survive postMessage's structured clone with its
  // message intact in every Node version, and the caller only ever surfaces
  // error.message to the client anyway.
  parentPort.postMessage({ ok: false, error: error?.message || String(error) });
}

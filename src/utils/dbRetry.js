/**
 * Surviving a dropped database connection during a big write. An import sends
 * thousands of rows to MongoDB Atlas over a long link, and a connection that
 * drops mid-write — "SSL alert bad record mac", a reset, a timeout — used to
 * fail the whole import. These helpers send rows in batches and resend a batch
 * whose connection dropped, without writing any row twice.
 *
 * Pure apart from the Model they're handed; tested in dbRetry.test.js.
 */

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/** A failure worth sending again: the connection, not the data, was the problem. */
export const isTransientDbError = (err) => {
  if (!err) return false;
  if (typeof err.hasErrorLabel === 'function'
    && (err.hasErrorLabel('RetryableWriteError') || err.hasErrorLabel('ResetPool'))) return true;
  if (/^Mongo(Network|NetworkTimeout|ServerSelection|PoolCleared)Error$/.test(err.name || '')) return true;
  return /ECONNRESET|EPIPE|ETIMEDOUT|ECONNREFUSED|socket hang up|bad record mac|SSL routines|TLS|connection .*(closed|reset)/i
    .test(String(err.message || ''));
};

/**
 * A write error saying this exact row is already there — which, for a row
 * given its _id before it was sent, only happens when an earlier attempt that
 * "failed" had in fact written it. Not an error.
 */
export const isAlreadyWrittenError = (writeError) =>
  Number(writeError?.code) === 11000 && /index: _id_ /.test(String(writeError?.errmsg || ''));

/** Run fn, sending again after a short, growing pause while the failure is a dropped connection. */
export const withDbRetry = async (fn, { attempts = 3, delayMs = 750 } = {}) => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= attempts || !isTransientDbError(err)) throw err;
      await sleep(delayMs * 2 ** (attempt - 1));
    }
  }
};

/**
 * Whether a bulk write error lists rows refused for their own data, rather
 * than the whole write failing — a dropped connection arrives as a bulk write
 * error with an empty writeErrors list, and must be resent, not read as
 * "everything saved".
 */
export const hasRowErrorsOnly = (err) => Boolean(err?.writeErrors?.length) && !isTransientDbError(err);

/**
 * Insert `docs` (each already carrying its _id) `batchSize` at a time, each
 * batch resent on a dropped connection. Rows the database refuses for their
 * data (a duplicate email, say) don't stop the rest; returns them as a Map of
 * index into `docs` → message. Rows an earlier attempt already wrote come back
 * as duplicate _id errors on the resend and count as written.
 */
export const insertInBatches = async (Model, docs, { batchSize = 1000, insertOptions = {}, attempts, delayMs } = {}) => {
  const failed = new Map();
  for (let start = 0; start < docs.length; start += batchSize) {
    const batch = docs.slice(start, start + batchSize);
    await withDbRetry(async () => {
      try {
        await Model.insertMany(batch, { ordered: false, ...insertOptions });
      } catch (err) {
        // A dropped connection fails the whole batch — resend it (withDbRetry).
        // The driver reports one as a bulk write error with an EMPTY
        // writeErrors list ("read ECONNRESET", writeErrors: []); reading that
        // empty list as "nothing refused" counted an unwritten batch as saved.
        if (!hasRowErrorsOnly(err)) throw err;
        for (const we of err.writeErrors) {
          if (isAlreadyWrittenError(we)) continue;
          failed.set(start + (we.index ?? we.err?.index), we.errmsg || we.err?.errmsg || 'Could not be saved');
        }
      }
    }, { attempts, delayMs });
  }
  return failed;
};

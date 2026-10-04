import { describe, it, expect, vi } from 'vitest';
import { isTransientDbError, isAlreadyWrittenError, withDbRetry, insertInBatches, hasRowErrorsOnly } from './dbRetry.js';

const sslDrop = () => Object.assign(new Error('402C5EF301000000:error:0A0003FC:SSL routines:ssl3_read_bytes:ssl/tls alert bad record mac'), { name: 'MongoNetworkError' });

describe('isTransientDbError', () => {
  it('recognises dropped connections', () => {
    expect(isTransientDbError(sslDrop())).toBe(true);
    expect(isTransientDbError(new Error('read ECONNRESET'))).toBe(true);
    expect(isTransientDbError({ name: 'MongoServerSelectionError', message: 'timed out' })).toBe(true);
    expect(isTransientDbError({ hasErrorLabel: (l) => l === 'RetryableWriteError', message: '' })).toBe(true);
  });

  it('does not resend a write the data itself made fail', () => {
    expect(isTransientDbError({ name: 'MongoBulkWriteError', message: 'E11000 duplicate key error', writeErrors: [] })).toBe(false);
    expect(isTransientDbError(new Error('Customer validation failed: email is required'))).toBe(false);
    expect(isTransientDbError(null)).toBe(false);
  });
});

describe('isAlreadyWrittenError', () => {
  it('is a duplicate on _id only', () => {
    expect(isAlreadyWrittenError({ code: 11000, errmsg: 'E11000 duplicate key error collection: db.c index: _id_ dup key: { _id: 1 }' })).toBe(true);
    expect(isAlreadyWrittenError({ code: 11000, errmsg: 'E11000 duplicate key error collection: db.c index: email_1 dup key' })).toBe(false);
    expect(isAlreadyWrittenError({ code: 121, errmsg: 'index: _id_ ' })).toBe(false);
  });
});

describe('withDbRetry', () => {
  it('sends again after a dropped connection', async () => {
    const fn = vi.fn().mockRejectedValueOnce(sslDrop()).mockResolvedValueOnce('ok');
    await expect(withDbRetry(fn, { delayMs: 0 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('gives up after the last attempt', async () => {
    const fn = vi.fn().mockRejectedValue(sslDrop());
    await expect(withDbRetry(fn, { attempts: 3, delayMs: 0 })).rejects.toThrow('bad record mac');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not resend other failures', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('validation failed'));
    await expect(withDbRetry(fn, { delayMs: 0 })).rejects.toThrow('validation failed');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('hasRowErrorsOnly', () => {
  it('is false for a dropped connection, even dressed as a bulk write error', () => {
    // Exactly what the driver threw when the connection was cut mid-batch.
    expect(hasRowErrorsOnly(Object.assign(new Error('read ECONNRESET'), { name: 'MongoBulkWriteError', writeErrors: [] }))).toBe(false);
    expect(hasRowErrorsOnly(sslDrop())).toBe(false);
  });

  it('is true when specific rows were refused for their data', () => {
    expect(hasRowErrorsOnly(Object.assign(new Error('E11000 duplicate key error'), { name: 'MongoBulkWriteError', writeErrors: [{ code: 11000, index: 2 }] }))).toBe(true);
  });
});

describe('insertInBatches', () => {
  // A stand-in collection that drops the connection once, after writing part of a batch.
  const fakeModel = ({ dropAfter = Infinity, taken = new Set() } = {}) => {
    const rows = new Map();
    let dropped = false;
    return {
      rows,
      insertMany: async (batch) => {
        const writeErrors = [];
        for (let i = 0; i < batch.length; i++) {
          const doc = batch[i];
          if (!dropped && rows.size >= dropAfter) {
            dropped = true;
            // How the driver really reports it: a bulk write error, no rows listed.
            throw Object.assign(new Error('read ECONNRESET'), { name: 'MongoBulkWriteError', writeErrors: [] });
          }
          if (rows.has(doc._id)) writeErrors.push({ code: 11000, index: i, errmsg: 'E11000 dup key index: _id_ dup key' });
          else if (taken.has(doc.email)) writeErrors.push({ code: 11000, index: i, errmsg: 'E11000 dup key index: email_1 dup key' });
          else rows.set(doc._id, doc);
        }
        if (writeErrors.length) throw Object.assign(new Error('bulk write error'), { name: 'MongoBulkWriteError', writeErrors });
      }
    };
  };
  const docs = Array.from({ length: 25 }, (_, i) => ({ _id: `id${i}`, email: `e${i}@x` }));

  it('writes every row exactly once when the connection drops mid-batch', async () => {
    const Model = fakeModel({ dropAfter: 13 });
    const failed = await insertInBatches(Model, docs, { batchSize: 10, delayMs: 0 });
    expect(failed.size).toBe(0);
    expect(Model.rows.size).toBe(25);
  });

  it('reports rows refused for their data by their index, and writes the rest', async () => {
    const Model = fakeModel({ taken: new Set(['e3@x', 'e17@x']) });
    const failed = await insertInBatches(Model, docs, { batchSize: 10, delayMs: 0 });
    expect([...failed.keys()]).toEqual([3, 17]);
    expect(Model.rows.size).toBe(23);
  });
});

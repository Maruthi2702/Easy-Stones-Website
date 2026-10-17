import express from 'express';
import mongoose from 'mongoose';
import Customer from '../models/Customer.js';
import { canEditCustomers, canImportCustomers } from '../utils/customerAccess.js';
import { checkSheet } from '../utils/spsSheet.js';
import { planConnect, resolveAnswers, spsRowsOf } from '../utils/spsConnect.js';

/**
 * Connect existing customers to SPS (step 3 of the SPS import redesign).
 *
 *   POST /api/customers/sps-connect/preview  file (+ mapping)  → the dry run: nothing is written
 *   POST /api/customers/sps-connect/apply    file (+ mapping, connectAuto, answers) → what was saved
 *
 * Both need Import and Edit (and View, which both imply). Apply re-reads the
 * file and re-plans against the database as it is now — it never trusts a plan
 * from the browser — and writes `sps.key` only where the customer has none, so
 * a retry or a second person doing the same thing changes nothing twice. The
 * unique index on `sps.key` is the last word on "one customer per SPS name".
 *
 *   app.use('/api/customers', createCustomerSpsConnectRouter({ authenticate, uploadMemory, readSheet, resolveMapping }));
 */
export default function createCustomerSpsConnectRouter({ authenticate, uploadMemory, readSheet, resolveMapping }) {
  const router = express.Router();

  const mayConnect = (req, res, next) => (
    canImportCustomers(req.user) && canEditCustomers(req.user)
      ? next()
      : res.status(403).json({ message: 'Connecting customers to SPS needs the Import and Edit customer switches.' })
  );
  const who = (req) => req.user?.username || req.user?.name || '';
  const json = (value) => { try { return value ? JSON.parse(value) : {}; } catch { return {}; } };

  /** The file, its mapping, its check and the plan against the customers held now. */
  const load = async (req) => {
    const { headers, rows, parse } = await readSheet(req.file.buffer);
    const mapping = resolveMapping(headers, json(req.body.mapping));
    const fileCheck = checkSheet({ rows, mapping, parse });
    if (!fileCheck.ok) return { fileCheck };
    const customers = await Customer.find({}, 'company email phone location sps').lean();
    const plan = planConnect({ rows, mapping, customers });
    const spsByKey = new Map(spsRowsOf({ rows, mapping }).map((r) => [r.key, r]));
    return { fileCheck, mapping, plan, spsByKey };
  };
  const stopped = (res, fileCheck) => res.status(422).json({ message: fileCheck.blocking.map((b) => b.message).join(' '), fileCheck });

  router.post('/sps-connect/preview', authenticate, mayConnect, uploadMemory.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
    try {
      const { fileCheck, plan } = await load(req);
      if (!plan) return stopped(res, fileCheck);
      res.json({
        fileCheck,
        total: plan.total,
        connected: plan.connected,
        notInSps: plan.notInSps,
        spsRows: plan.spsRows,
        spsUnclaimed: plan.spsUnclaimed,
        autoCount: plan.auto.length,
        autoSample: plan.auto.slice(0, 25),
        toCheck: plan.toCheck
      });
    } catch (err) {
      console.error('SPS connect preview error:', err);
      res.status(400).json({ message: `Preview failed: ${err.message}` });
    }
  });

  router.post('/sps-connect/apply', authenticate, mayConnect, uploadMemory.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
    try {
      const { fileCheck, plan, spsByKey } = await load(req);
      if (!plan) return stopped(res, fileCheck);

      const answers = resolveAnswers(plan, json(req.body.answers), spsByKey);
      const connectAuto = req.body.connectAuto === 'true';
      const now = new Date();
      const by = who(req);
      const stamp = (key) => ({
        'sps.key': key,
        'sps.name': spsByKey.get(key).name,
        'sps.firstImportedAt': now,
        'sps.lastSeenAt': now,
        'sps.connectedAt': now,
        'sps.connectedBy': by
      });
      const toConnect = [...(connectAuto ? plan.auto : []), ...answers.connect];
      const idOf = (customerId) => new mongoose.Types.ObjectId(customerId);
      const connectOps = toConnect.map(({ customerId, key }) => ({
        updateOne: { filter: { _id: idOf(customerId), 'sps.key': { $exists: false } }, update: { $set: stamp(key) } }
      }));
      const notInSpsOps = answers.notInSps.map((customerId) => ({
        updateOne: {
          filter: { _id: idOf(customerId), 'sps.key': { $exists: false } },
          update: { $set: { 'sps.reviewedAs': 'none', 'sps.connectedAt': now, 'sps.connectedBy': by } }
        }
      }));

      // ordered:false — one name taken in the meantime must not stop the rest.
      const failed = [];
      const run = async (ops) => {
        if (!ops.length) return 0;
        try {
          return (await Customer.collection.bulkWrite(ops, { ordered: false })).modifiedCount;
        } catch (err) {
          if (!err.writeErrors && !err.result) throw err;
          for (const e of err.writeErrors || []) {
            const op = ops[e.index ?? e.err?.index];
            failed.push({ customerId: String(op?.updateOne?.filter?._id || ''), reason: e.code === 11000 ? 'another customer took that SPS name first' : (e.errmsg || 'could not be saved') });
          }
          return err.result?.modifiedCount ?? err.result?.nModified ?? 0;
        }
      };
      const connected = await run(connectOps);
      const markedNotInSps = await run(notInSpsOps);

      req.app.get('io')?.emit('customer_update');
      res.json({ connected, notInSps: markedNotInSps, failed, rejected: answers.rejected });
    } catch (err) {
      console.error('SPS connect apply error:', err);
      res.status(500).json({ message: `Could not connect the customers: ${err.message}` });
    }
  });

  return router;
}

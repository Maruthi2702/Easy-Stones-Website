import express from 'express';
import type { RequestHandler } from 'express';
import multer from 'multer';
import { FUEL_MAN as P } from './permissions.ts';
import { requireAll } from '../server/http.js';
import { access, driverOptions, requireGlobal } from './access.ts';
import { readFuelManPdf } from './readPdf.ts';
import type { ParsedReport } from './types.ts';
import { importReport } from './importReport.ts';
import { FuelAudit, FuelPeriod, FuelSource, FuelState } from './models.ts';
import { reportFor, snapshot } from './storage.ts';
import { detailFor, linesFor, listReports, pnlFor } from './queries.ts';
import { saveAssignment, saveClassifications, saveDisposition } from './commands.ts';
import { publishReport, reverseReport, closePeriod } from './publication.ts';
import { assignmentSchema, classificationSchema, dispositionSchema, publicationSchema, reverseSchema, closeSchema } from './schemas.ts';
import { actor, handle, HttpError, idParam, parse } from './http.ts';
const pageOf = (v: unknown) => Math.max(1, Math.floor(Number(v) || 1));
const limitOf = (v: unknown) => [25, 50, 100].includes(Number(v)) ? Number(v) : 50;
function csv(rows: unknown[][]) {
  return '\uFEFF' + rows.map(row => row.map(value => {
    let text = typeof value === 'number' ? value.toFixed(2) : String(value ?? '');
    if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  }).join(',')).join('\r\n');
}
export default function createFuelManRouter({ authenticate, parsePdf = readFuelManPdf }: { authenticate: RequestHandler; parsePdf?: (buffer: Buffer) => Promise<ParsedReport> }) {
  const router = express.Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
  router.use(authenticate, requireAll(P.VIEW));
  const changed = (req: express.Request) => req.app.get('io')?.emit('fuel_man_update');
  router.get('/metadata', handle(async (req, res) => res.json(await snapshot(async session => {
    const a = await access(req.user, session);
    return { ...a, drivers: a.global ? await driverOptions(session) : [] };
  }))));
  router.get('/revision', handle(async (_req, res) => {
    const states = await FuelState.find({}, 'revision').lean();
    res.json({ revision: states.reduce((n, s) => n + s.revision, 0) });
  }));
  router.get('/reports', handle(async (req, res) => res.json(await snapshot(async session =>
    listReports(await access(req.user, session), session, pageOf(req.query.page), limitOf(req.query.limit))))));
  router.post('/reports', requireAll(P.IMPORT), (req, res, next) => {
    // Authorization precedes parsing or buffering a company-wide source.
    void requireGlobal(req.user).then(() => upload.single('file')(req, res, error => {
      if (error) res.status(400).json({ error: error.message || 'Upload one PDF no larger than 10 MB' }); else next();
    })).catch(next);
  }, handle(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'Select the original Fuelman PDF');
    let parsed: ParsedReport;
    try { parsed = await parsePdf(req.file.buffer); }
    catch (error) { throw new HttpError(400, error instanceof Error ? error.message : 'Cannot read this PDF'); }
    const result = await importReport(parsed, req.file.buffer, req.file.originalname, actor(req));
    changed(req); res.status(result.duplicate ? 200 : 201).json(result);
  }));
  router.get('/reports/:id', handle(async (req, res) => res.json(await snapshot(async session =>
    detailFor(await reportFor(idParam(req), session), await access(req.user, session), session)))));
  router.get('/reports/:id/lines', handle(async (req, res) => res.json(await snapshot(async session =>
    linesFor(await reportFor(idParam(req), session), await access(req.user, session), session, {
      externalId: String(req.query.externalId || ''), unknownOnly: req.query.unknown === 'true', page: pageOf(req.query.page), limit: limitOf(req.query.limit),
    })))));
  router.get('/reports/:id/source', handle(async (req, res) => {
    await requireGlobal(req.user); await reportFor(idParam(req));
    const source = await FuelSource.findOne({ reportId: idParam(req) }).select('+pdf');
    if (!source) throw new HttpError(404, 'Original file not found');
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="fuelman-report.pdf"', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }).send(source.pdf);
  }));
  router.get('/reports/:id/history', requireAll(P.HISTORY), handle(async (req, res) => {
    await requireGlobal(req.user); await reportFor(idParam(req));
    const page = pageOf(req.query.page), limit = limitOf(req.query.limit);
    res.json(await snapshot(async session => ({ total: await FuelAudit.countDocuments({ reportId: idParam(req) }).session(session),
      items: await FuelAudit.find({ reportId: idParam(req) }).session(session).sort({ at: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(), page, limit })));
  }));
  router.post('/reports/:id/assignments', requireAll(P.RECONCILE), handle(async (req, res) => {
    const a = await requireGlobal(req.user), body = parse(assignmentSchema, req.body);
    res.json(await saveAssignment(idParam(req), body, actor(req), a.locations)); changed(req);
  }));
  router.post('/reports/:id/missing', requireAll(P.RECONCILE), handle(async (req, res) => {
    await requireGlobal(req.user); res.json(await saveDisposition(idParam(req), parse(dispositionSchema, req.body), actor(req))); changed(req);
  }));
  router.post('/reports/:id/classifications', requireAll(P.RECONCILE), handle(async (req, res) => {
    await requireGlobal(req.user); res.json(await saveClassifications(idParam(req), parse(classificationSchema, req.body), actor(req))); changed(req);
  }));
  router.post('/reports/:id/publish', requireAll(P.APPROVE), handle(async (req, res) => {
    await requireGlobal(req.user); res.json(await publishReport(idParam(req), parse(publicationSchema, req.body), actor(req), req.user.permissions.includes(P.REVERSE))); changed(req);
  }));
  router.post('/reports/:id/reverse', requireAll(P.REVERSE), handle(async (req, res) => {
    await requireGlobal(req.user); res.json(await reverseReport(idParam(req), parse(reverseSchema, req.body), actor(req))); changed(req);
  }));
  router.post('/reports/:id/period', requireAll(P.CLOSE), handle(async (req, res) => {
    await requireGlobal(req.user); res.json(await closePeriod(idParam(req), parse(closeSchema, req.body), actor(req))); changed(req);
  }));
  router.get('/pnl', handle(async (req, res) => {
    const month = String(req.query.month || '');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new HttpError(400, 'Choose a reporting month');
    if (req.query.format === 'csv' && !req.user.permissions.includes(P.EXPORT)) throw new HttpError(403, 'Export permission is required');
    const result = await snapshot(async session => {
      const a = await access(req.user, session), location = String(req.query.location || '');
      if (location && !a.locations.includes(location)) throw new HttpError(403, 'Choose a location in your access');
      return pnlFor(month, location ? { global: false, locations: [location] } : a, session);
    });
    if (req.query.format !== 'csv') return res.json(result);
    const rows = [['Month', 'Source', 'Accounting basis', 'Location', 'Category', 'Amount USD'],
      ...result.locations.flatMap(l => Object.entries(l.amounts).map(([category, cents]) => [month, 'Fuel Man', 'Statement month', l.location, category, cents / 100]))];
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="fuel-man-${month}.csv"`, 'Cache-Control': 'private, no-store' }).send(csv(rows));
  }));
  // The authorization promise above forwards errors into Express.
  router.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    void next; // Express identifies error middleware by its four-argument signature.
    if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
    console.error('[fuel-man]', error); res.status(500).json({ error: 'Fuel Man could not complete this request' });
  });
  return router;
}

import type { RequestHandler } from 'express';
import express from 'express';
import multer from 'multer';
import * as leads from '../db/projectLeads/index.ts';
import { SORTS, type LeadFilter, type Sort } from '../db/projectLeads/index.ts';
import { runWorkbookParse } from '../utils/runWorkbookParse.ts';
import { isLeadStatus, type LeadStatus } from '../utils/projectLeads.ts';
import { canViewProjectLeads, canEditProjectLeads, canImportProjectLeads, canExportProjectLeads } from '../utils/projectLeadAccess.ts';

/**
 * Project leads (2026-11-20, src/utils/projectLeads.ts) — mounted at /api/project-leads.
 *
 *   GET   /meta       what the filters offer (states, stages, cities, assignees) and the last import
 *   GET   /           one page (limit ≤ 100) of projects with their companies, the total and the count per status
 *   GET   /export     the same filters, up to 5,000 projects (Excel is built on the screen)
 *   GET   /:id        one project
 *   PATCH /:id        { status?, note?, assignedTo? } — kept in the lead's history
 *   POST  /import     multipart `file`: a ConstructConnect export; adds new projects and refreshes known ones
 *
 * Filters: q, states (comma list), city, stage, subcategory, status, assignedTo (a name, or "none"),
 * minValue, updatedFrom (YYYY-MM-DD), reachable=1, sort. Every route checks its own permission
 * (src/utils/projectLeadAccess.ts).
 */
const MAX_LIMIT = 100;
const MAX_EXPORT = 5000;
const MAX_FILE = 25 * 1024 * 1024;

const one = (v: unknown) => (Array.isArray(v) ? String(v[0] ?? '') : String(v ?? '')).trim();
const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

/** The query's filters, checked. Throws a message the client can show. */
export function filterOf(query: Record<string, unknown>): LeadFilter {
  const f: LeadFilter = {};
  const q = one(query.q).slice(0, 100);
  if (q) f.q = q;
  const states = one(query.states).split(',').map(s => s.trim()).filter(Boolean).slice(0, 30);
  if (states.length) f.states = states;
  for (const key of ['city', 'stage', 'subcategory'] as const) {
    const v = one(query[key]).slice(0, 120);
    if (v) f[key] = v;
  }
  const status = one(query.status);
  if (status) {
    if (!isLeadStatus(status)) throw new Error('Unknown status.');
    f.status = status;
  }
  const assignedTo = one(query.assignedTo).slice(0, 120);
  if (assignedTo) f.assignedTo = assignedTo;
  const minValue = one(query.minValue);
  if (minValue) {
    const n = Number(minValue);
    if (!Number.isFinite(n) || n < 0) throw new Error('Minimum value must be a number.');
    f.minValue = n;
  }
  const updatedFrom = one(query.updatedFrom);
  if (updatedFrom) {
    if (!isDay(updatedFrom)) throw new Error('Dates must be YYYY-MM-DD.');
    f.updatedFrom = updatedFrom;
  }
  if (one(query.reachable) === '1') f.reachable = true;
  const sort = one(query.sort);
  if (sort) {
    if (!SORTS.includes(sort as Sort)) throw new Error('Unknown sort.');
    f.sort = sort as Sort;
  }
  return f;
}

export default function createProjectLeadsRouter({ authenticate }: { authenticate: RequestHandler }) {
  const router = express.Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE, files: 1 } });
  const who = (req: express.Request) => req.user?.name || req.user?.username || '';
  const refuse = (res: express.Response, what: string) => res.status(403).json({ message: `Your role can’t ${what}.` });
  const failed = (res: express.Response, err: unknown, what: string) => {
    console.error(`Project leads ${what}:`, err);
    res.status(500).json({ message: `Could not ${what}.` });
  };

  router.get('/meta', authenticate, async (req, res) => {
    if (!canViewProjectLeads(req.user)) return refuse(res, 'see project leads');
    try {
      res.json({ ...(await leads.leadMeta()), canEdit: canEditProjectLeads(req.user), canImport: canImportProjectLeads(req.user), canExport: canExportProjectLeads(req.user) });
    } catch (err) { failed(res, err, 'load project leads'); }
  });

  router.get('/', authenticate, async (req, res) => {
    if (!canViewProjectLeads(req.user)) return refuse(res, 'see project leads');
    let filter: LeadFilter;
    try { filter = filterOf(req.query); } catch (err) { return res.status(400).json({ message: (err as Error).message }); }
    const limit = Math.min(Math.max(Math.trunc(Number(req.query.limit)) || 50, 1), MAX_LIMIT);
    const page = Math.max(Math.trunc(Number(req.query.page)) || 1, 1);
    try {
      res.json(await leads.listLeads({ ...filter, limit, offset: (page - 1) * limit }));
    } catch (err) { failed(res, err, 'load project leads'); }
  });

  router.get('/export', authenticate, async (req, res) => {
    if (!canExportProjectLeads(req.user)) return refuse(res, 'export project leads');
    let filter: LeadFilter;
    try { filter = filterOf(req.query); } catch (err) { return res.status(400).json({ message: (err as Error).message }); }
    try {
      res.json(await leads.listLeads({ ...filter, limit: MAX_EXPORT, offset: 0 }));
    } catch (err) { failed(res, err, 'export project leads'); }
  });

  router.post('/import', authenticate, (req, res) => {
    if (!canImportProjectLeads(req.user)) return refuse(res, 'import project leads');
    upload.single('file')(req, res, async (uploadErr) => {
      if (uploadErr) {
        const tooBig = (uploadErr as { code?: string }).code === 'LIMIT_FILE_SIZE';
        return res.status(400).json({ message: tooBig ? 'That file is over 25 MB.' : 'The file could not be read.' });
      }
      if (!req.file) return res.status(400).json({ message: 'Choose the ConstructConnect Excel file.' });
      let read;
      try {
        read = await runWorkbookParse('project-leads', req.file.buffer);
      } catch (err) {
        return res.status(400).json({ message: err instanceof Error ? err.message : 'The file could not be read.' });
      }
      if (read.problems.length) return res.status(400).json({ message: read.problems[0] });
      try {
        const done = await leads.importProjects({ projects: read.projects, fileName: String(req.file.originalname || '').slice(0, 200), by: who(req) });
        res.json({ ...done, skippedRows: read.skippedRows });
      } catch (err) {
        console.error('Project leads import error:', err);
        res.status(500).json({ message: 'The import failed. Nothing was changed.' });
      }
    });
  });

  router.get('/:id', authenticate, async (req, res) => {
    if (!canViewProjectLeads(req.user)) return refuse(res, 'see project leads');
    try {
      const lead = await leads.getLead(String(req.params.id));
      if (!lead) return res.status(404).json({ message: 'Project not found.' });
      res.json(lead);
    } catch (err) { failed(res, err, 'load the project'); }
  });

  router.patch('/:id', authenticate, async (req, res) => {
    if (!canEditProjectLeads(req.user)) return refuse(res, 'change project leads');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const change: { status?: LeadStatus; note?: string; assignedTo?: string } = {};
    if (body.status !== undefined) {
      if (!isLeadStatus(body.status)) return res.status(400).json({ message: 'Unknown status.' });
      change.status = body.status;
    }
    if (body.note !== undefined) {
      if (typeof body.note !== 'string') return res.status(400).json({ message: 'The note must be text.' });
      change.note = body.note.trim().slice(0, 2000);
    }
    if (body.assignedTo !== undefined) {
      if (typeof body.assignedTo !== 'string') return res.status(400).json({ message: 'Choose a person from the list.' });
      change.assignedTo = body.assignedTo.trim().slice(0, 120);
    }
    try {
      const lead = await leads.updateLead(String(req.params.id), change, who(req));
      if (!lead) return res.status(404).json({ message: 'Project not found.' });
      res.json(lead);
    } catch (err) { failed(res, err, 'save the change'); }
  });

  return router;
}

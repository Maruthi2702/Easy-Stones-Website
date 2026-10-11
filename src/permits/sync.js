/**
 * The morning permit pull (2026-10-11).
 *
 *   run()               each source in turn: read every permit issued since
 *                       the start of the window, keep the lead types, save
 *                       them by permit number (new ones added, known ones
 *                       updated), then check any new county monthly report.
 *   checkCountyReport() a month of county permits against the county's own
 *                       "Permits Issued" PDF, permit number by number.
 *   start()             the timer: the first run ever reads six months back,
 *                       straight away; after that one run a day from 5:00 AM
 *                       Pacific, re-reading the last 30 days. A server asleep
 *                       at 5 runs when it wakes; a failed run tries again 30
 *                       minutes later.
 *
 * A source that fails leaves what's already saved untouched and records the
 * error, which the Permits page shows. Nothing is ever deleted.
 */
import { Permit, PermitRun, PermitCheck } from './models.js';
import {
  SOURCE_IDS, categoryFor, isUnsortedBuildingType, typeLabel, whatcomPermit, bellinghamPermit, dayOf,
  pacificNow, isDailyRunDue, runSince, reconcileReport, compareMonthToDate, permitPrefix, monthBounds, fullMonthsBetween
} from './permitRules.js';

const TICK_MS = 5 * 60 * 1000;
const RETRY_GAP_MS = 30 * 60 * 1000;
// A run still "going" after this long died with its server; the next one may start.
const STALE_RUN_MS = 45 * 60 * 1000;
// Reports checked per run, so one morning never turns into an hour of PDFs.
const REPORTS_PER_RUN = 2;
// The county's permit-number codes for lead types, even before the app holds one of each.
const LEAD_PREFIXES = ['SFR', 'DET', 'COM'];
// County permit pages opened at once. Each takes ~2 s on the county's server;
// four at a time keeps the six-month pull to a few minutes without hammering it.
const DETAIL_CONCURRENCY = 4;

const withoutUndefined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

function tallyUnsorted(rows, source, typeOf) {
  const counts = new Map();
  for (const row of rows) {
    const [type, sub] = typeOf(row);
    if (isUnsortedBuildingType(source, type, sub)) {
      const label = typeLabel(source, type, sub);
      counts.set(label, (counts.get(label) || 0) + 1);
    }
  }
  return [...counts].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count);
}

export function createPermitSync({ whatcom, bellingham, reports = null, log = console, now = () => new Date() }) {
  let running = null;

  /**
   * Saves one source's permits by number in one batch; returns how many were
   * new and how many the source actually changed. When the app last saw a
   * permit (and read its details) is stamped separately, so it doesn't make
   * every permit look changed on every pull.
   */
  async function save(source, permits, { detailsRead = false } = {}) {
    if (!permits.length) return { added: 0, updated: 0 };
    const at = now();
    const r = await Permit.bulkWrite(permits.map((p) => {
      const { permitNumber, source: _source, ...fields } = withoutUndefined(p);
      return { updateOne: { filter: { source, permitNumber }, update: { $set: fields, $setOnInsert: { firstSeenAt: at } }, upsert: true } };
    }), { ordered: false });
    await Permit.updateMany(
      { source, permitNumber: { $in: permits.map((p) => p.permitNumber) } },
      { $set: { lastSeenAt: at, ...(detailsRead && { detailsAt: at }) } }
    );
    return { added: r.upsertedCount, updated: r.modifiedCount };
  }

  async function pullWhatcom(since) {
    const { rows, pages, total } = await whatcom.issuedSince(since);
    // The county issues permits every working day; an empty window means the
    // search answered wrongly, not that nothing happened.
    if (!rows.length) throw new Error(`Whatcom County returned no permits issued since ${since} (it reported ${total ?? 'no'} records in all)`);
    const leads = rows.filter((row) => categoryFor('whatcom', row.CaseType));
    // Each permit is saved as soon as its details are read, so the page fills
    // in while a long pull runs. Ones whose details didn't load wait to the
    // end: if none loaded at all, something is wrong and nothing is saved.
    const totals = { added: 0, updated: 0 };
    const withoutDetails = [];
    let next = 0;
    const worker = async () => {
      while (next < leads.length) {
        const row = leads[next++];
        let detail = null;
        try {
          detail = await whatcom.details(row.CaseId);
        } catch (err) {
          log.warn?.(`[permits] Whatcom ${row.CaseNumber}: details failed — ${err.message}`);
        }
        const p = whatcomPermit(row, detail);
        if (!detail) { withoutDetails.push(p); continue; }
        const r = await save('whatcom', [p], { detailsRead: true });
        totals.added += r.added;
        totals.updated += r.updated;
      }
    };
    await Promise.all(Array.from({ length: Math.min(DETAIL_CONCURRENCY, leads.length) }, worker));
    if (leads.length && withoutDetails.length === leads.length) {
      throw new Error(`Whatcom County wouldn’t open any of the ${leads.length} permits’ details`);
    }
    const rest = await save('whatcom', withoutDetails);
    return {
      saved: { added: totals.added + rest.added, updated: totals.updated + rest.updated },
      leads: leads.length, pages, seen: rows.length, detailErrors: withoutDetails.length,
      unsortedTypes: tallyUnsorted(rows, 'whatcom', (r) => [r.CaseType]),
      latestIssuedOn: rows.map((r) => dayOf(r.IssueDate)).filter(Boolean).sort().pop() || null
    };
  }

  async function pullBellingham(since) {
    const { rows, pages } = await bellingham.issuedSince(since);
    if (!rows.length) throw new Error(`Bellingham’s permit data has no building permits issued since ${since} — the city’s copy may have stopped updating`);
    const permits = rows.filter((r) => categoryFor('bellingham', r.PermitType, r.PermitSubType)).map(bellinghamPermit);
    return {
      saved: await save('bellingham', permits), leads: permits.length, pages, seen: rows.length, detailErrors: 0,
      unsortedTypes: tallyUnsorted(rows, 'bellingham', (r) => [r.PermitType, r.PermitSubType]),
      latestIssuedOn: rows.map((r) => dayOf(r.ISSUED)).filter(Boolean).sort().pop() || null
    };
  }

  const hasBackfill = async (source) => Boolean(await PermitRun.exists({ source, ok: true, kind: 'backfill' }));

  /** One source, one window. Records the run whether it works or not. */
  async function runSource(source, { kind, by = '' }) {
    const backfilled = await hasBackfill(source);
    const since = runSince(backfilled, now());
    const actualKind = backfilled ? kind : 'backfill';
    const run = await PermitRun.create({ source, kind: actualKind, since, startedAt: now(), by });
    try {
      const pulled = source === 'whatcom' ? await pullWhatcom(since) : await pullBellingham(since);
      const { added, updated } = pulled.saved;
      Object.assign(run, {
        ok: true, finishedAt: now(), pages: pulled.pages, seen: pulled.seen, leads: pulled.leads,
        added, updated, detailErrors: pulled.detailErrors, unsortedTypes: pulled.unsortedTypes, latestIssuedOn: pulled.latestIssuedOn
      });
      await run.save();
      log.log?.(`[permits] ${source} ${actualKind} since ${since}: ${pulled.seen} permits, ${pulled.leads} leads, ${added} new, ${updated} changed`);
    } catch (err) {
      const error = String(err?.message || err).slice(0, 500);
      // Written directly, so a run that failed while saving its own counts is still closed.
      await PermitRun.updateOne({ _id: run._id }, { $set: { ok: false, finishedAt: now(), error } });
      log.error?.(`[permits] ${source} ${actualKind} failed:`, error);
      return (await PermitRun.findById(run._id).lean()) || { source, kind: actualKind, since, ok: false, error };
    }
    return run.toObject();
  }

  /**
   * The months to check, newest first: ones the app has whole (on or after
   * the first backfill's start), before this month, with no clean report
   * check yet. A month with differences is checked again on later mornings,
   * since the county sometimes enters a permit late.
   */
  async function monthsToCheck() {
    const first = await PermitRun.findOne({ source: 'whatcom', ok: true, kind: 'backfill' }).sort({ startedAt: 1 }).lean();
    if (!first) return [];
    const thisMonth = pacificNow(now()).day.slice(0, 7);
    // A month-so-far check ('search') doesn't count: only the report is final.
    const done = new Set((await PermitCheck.find({ source: 'whatcom', ok: true, method: { $ne: 'search' } }, 'month').lean()).map((c) => c.month));
    return fullMonthsBetween(first.since, thisMonth).filter((m) => !done.has(m)).reverse();
  }

  async function checkCountyReport() {
    if (!reports) return [];
    // Every month already checked against its report: nothing to download.
    const wanted = await monthsToCheck();
    if (!wanted.length) return [];
    let available;
    try {
      available = await reports.list();
    } catch (err) {
      log.warn?.(`[permits] county report archive: ${err.message}`);
      return [{ error: err.message }];
    }
    const results = [];
    const due = available.filter((r) => wanted.includes(r.month)).slice(0, REPORTS_PER_RUN);
    for (const report of due) {
      const { from, to } = monthBounds(report.month);
      const base = { source: 'whatcom', month: report.month, reportTitle: report.title, reportUrl: report.url, checkedAt: now() };
      let fields;
      try {
        const numbers = await reports.permitNumbers(report.url);
        const { rows } = await whatcom.issuedSince(from);
        const [appInMonth, appHas, appNumbers] = await Promise.all([
          Permit.distinct('permitNumber', { source: 'whatcom', issuedOn: { $gte: from, $lte: to } }),
          Permit.distinct('permitNumber', { source: 'whatcom', permitNumber: { $in: numbers } }),
          Permit.distinct('permitNumber', { source: 'whatcom' })
        ]);
        const leadPrefixes = new Set([...LEAD_PREFIXES, ...appNumbers.map(permitPrefix),
          ...rows.filter((r) => categoryFor('whatcom', r.CaseType)).map((r) => permitPrefix(r.CaseNumber))]);
        const r = reconcileReport({ month: report.month, reportNumbers: numbers, searchRows: rows, appInMonth, appHas, leadPrefixes: [...leadPrefixes] });
        fields = {
          ...base, method: 'report', inReport: r.inReport, matched: r.matched, missingFromApp: r.missingFromApp, notInReport: r.notInReport,
          notInCountySearch: r.notInCountySearch, datesMoved: r.datesMoved, notPublic: r.notPublic, ok: r.ok, error: ''
        };
      } catch (err) {
        fields = { ...base, method: 'report', ok: false, error: String(err?.message || err).slice(0, 500) };
      }
      await PermitCheck.findOneAndUpdate({ source: 'whatcom', month: report.month }, { $set: fields }, { upsert: true });
      log.log?.(`[permits] county report ${report.month}: ${fields.ok ? 'matches' : fields.error || 'differs'}`);
      results.push(fields);
    }
    return results;
  }

  /**
   * The month so far, before any report exists: each source's lead permits
   * for this month found a second, separate way, against what the app saved.
   *
   *   Whatcom County — the county's text search by permit-number code
   *     (SFR2026, DET2026, COM2026…, and last year's codes, since a permit
   *     numbered last year can be issued now), instead of the newest-first
   *     walk the pull uses.
   *   Bellingham — its own query of the city's layer for this month.
   *
   * Written as the month's 'search' check; the county's report replaces it
   * for Whatcom once the month is over and the report is posted.
   */
  async function checkMonthToDate() {
    const today = pacificNow(now()).day;
    const month = today.slice(0, 7);
    const from = `${month}-01`;
    const year = Number(month.slice(0, 4));
    const inMonth = (day) => day && day >= from && day <= today;
    const results = [];
    for (const source of SOURCE_IDS) {
      const base = { source, month, method: 'search', checkedAt: now(), reportTitle: '', reportUrl: '' };
      let fields;
      try {
        const found = new Set();
        if (source === 'whatcom') {
          const saved = await Permit.distinct('permitNumber', { source: 'whatcom' });
          const prefixes = [...new Set([...LEAD_PREFIXES, ...saved.map(permitPrefix)])];
          for (const prefix of prefixes) {
            for (const y of [year, year - 1]) {
              const code = `${prefix}${y}`;
              const { rows } = await whatcom.issuedSince(from, { keyword: code });
              for (const r of rows) {
                const n = String(r.CaseNumber || '').trim();
                if (n.startsWith(`${code}-`) && inMonth(dayOf(r.IssueDate)) && categoryFor('whatcom', r.CaseType)) found.add(n);
              }
            }
          }
        } else {
          const { rows } = await bellingham.issuedSince(from);
          for (const r of rows) {
            if (inMonth(dayOf(r.ISSUED)) && categoryFor('bellingham', r.PermitType, r.PermitSubType)) found.add(String(r.PERMIT_NO || '').trim());
          }
        }
        const app = await Permit.distinct('permitNumber', { source, issuedOn: { $gte: from, $lte: today } });
        const c = compareMonthToDate({ found: [...found], app });
        fields = { ...base, inSearch: c.inSearch, matched: c.matched, missingFromApp: c.missingFromApp, notFoundAgain: c.notFoundAgain, ok: c.ok, error: '' };
      } catch (err) {
        fields = { ...base, ok: false, error: String(err?.message || err).slice(0, 500) };
      }
      // Never over a report check: a month only has one once it's over.
      await PermitCheck.findOneAndUpdate({ source, month, method: { $ne: 'report' } }, { $set: fields }, { upsert: true }).catch((err) => {
        if (err?.code !== 11000) throw err;
      });
      log.log?.(`[permits] ${source} ${month} so far: ${fields.ok ? `all ${fields.matched} found again` : fields.error || 'differs'}`);
      results.push(fields);
    }
    return results;
  }

  /** Every source, then the county report. One at a time; a second call waits for the first. */
  function run({ kind = 'daily', by = '' } = {}) {
    if (running) return running;
    running = (async () => {
      const out = {};
      for (const source of SOURCE_IDS) {
        const stale = new Date(now().getTime() - STALE_RUN_MS);
        if (await PermitRun.exists({ source, finishedAt: null, startedAt: { $gt: stale } })) {
          out[source] = { skipped: 'another run is going' };
          continue;
        }
        out[source] = await runSource(source, { kind, by });
      }
      out.reports = await checkCountyReport();
      out.monthToDate = await checkMonthToDate();
      return out;
    })().finally(() => { running = null; });
    return running;
  }

  const isRunning = () => Boolean(running);

  /** Whether the timer should start a run now. */
  async function isDue() {
    const at = now();
    for (const source of SOURCE_IDS) {
      if (!(await hasBackfill(source))) {
        const last = await PermitRun.findOne({ source }).sort({ startedAt: -1 }).lean();
        if (!last || at - new Date(last.startedAt) >= RETRY_GAP_MS) return true;
        continue;
      }
      const lastOk = await PermitRun.findOne({ source, ok: true }).sort({ startedAt: -1 }).lean();
      const lastOkDay = lastOk ? pacificNow(new Date(lastOk.startedAt)).day : null;
      if (!isDailyRunDue(lastOkDay, at)) continue;
      const last = await PermitRun.findOne({ source }).sort({ startedAt: -1 }).lean();
      if (!last || at - new Date(last.startedAt) >= RETRY_GAP_MS) return true;
    }
    return false;
  }

  /**
   * A pull still marked "going" when this server starts died with the last
   * server (a restart or deploy mid-pull). Close it, so the next pull isn't
   * held back by it — saved permits stay; the next run re-reads the window.
   */
  async function closeInterrupted() {
    const r = await PermitRun.updateMany(
      { finishedAt: null },
      { $set: { finishedAt: now(), ok: false, error: 'The server restarted during this pull — it runs again shortly.' } }
    );
    if (r.modifiedCount) log.warn?.(`[permits] closed ${r.modifiedCount} pull(s) cut short by a restart`);
    return r.modifiedCount;
  }

  function start() {
    const tick = async (force = false) => {
      if (running) return;
      try {
        if (force || await isDue()) await run({ kind: 'daily' });
      } catch (err) {
        log.error?.('[permits] morning run check failed:', err?.message || err);
      }
    };
    // A minute after boot: close any pull the last server didn't finish and,
    // if there was one, start again straight away instead of waiting out the
    // retry gap.
    setTimeout(async () => {
      let interrupted = 0;
      try { interrupted = await closeInterrupted(); } catch (err) { log.error?.('[permits] closing interrupted pulls failed:', err?.message || err); }
      tick(interrupted > 0);
    }, 60 * 1000).unref?.();
    setInterval(tick, TICK_MS).unref?.();
  }

  return { run, runSource, checkCountyReport, checkMonthToDate, isDue, isRunning, closeInterrupted, start };
}


/**
 * The morning permit pull (2026-10-11; every source the same way since
 * 2026-10-14).
 *
 *   run()               each source in turn: read every permit issued since
 *                       the start of the window, keep the lead types, save
 *                       them by permit number (new ones added, known ones
 *                       updated); then the counties' monthly reports, each
 *                       source's month so far, and the contractor registry.
 *   checkCountyReport() a month of Whatcom County permits against the
 *                       county's own "Permits Issued" PDF, number by number.
 *   checkKingReport()   a month of King County permits against the county's
 *                       "Issued Permits" spreadsheet, which also fills in each
 *                       permit's value and city.
 *   start()             the timer: a source's first run reads six months
 *                       back, straight away; after that one run a day from
 *                       5:00 AM Pacific, re-reading the last 30 days. A server
 *                       asleep at 5 runs when it wakes; a failed run tries
 *                       again 30 minutes later.
 *
 * A source is its rules (src/permits/rules/<id>.js, via RULES) plus a reader
 * passed in here by the same id: `issuedSince(since)` → { rows, pages,
 * total }, and optionally `details(id)` (one permit's contacts etc., read for
 * leads only) and `recheck(from)` (the month-so-far check's second, separate
 * way in; without it the check reads the source a second time). Sources with
 * no reader aren't pulled.
 *
 * A source that fails leaves what's already saved untouched and records the
 * error, which the Permits page shows. Nothing is ever deleted.
 */
import { Permit, PermitRun, PermitCheck } from './models.js';
import {
  RULES, SOURCE_IDS, categoryFor, isUnsortedBuildingType, pacificNow, isDailyRunDue, runSince,
  reconcileReport, compareMonthToDate, permitPrefix, monthBounds, fullMonthsBetween
} from './permitRules.js';
import { reconcileKingReport, kingReportFill, kingReportPermit } from './rules/kingCounty.js';

const TICK_MS = 5 * 60 * 1000;
const RETRY_GAP_MS = 30 * 60 * 1000;
// A run still "going" after this long died with its server; the next one may start.
const STALE_RUN_MS = 45 * 60 * 1000;
// Reports checked per run, so one morning never turns into an hour of downloads.
const REPORTS_PER_RUN = 2;
// Whatcom County's permit-number codes for lead types, even before the app holds one of each.
const LEAD_PREFIXES = ['SFR', 'DET', 'COM'];
// Detail pages opened at once, unless the source says otherwise.
const DETAIL_CONCURRENCY = 2;

const withoutUndefined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

function tallyUnsorted(rows, id) {
  const rule = RULES[id];
  const counts = new Map();
  for (const row of rows) {
    const [type, sub] = rule.typeOf(row);
    if (isUnsortedBuildingType(id, type, sub)) {
      const label = rule.labelOf ? rule.labelOf(row) : rule.typeLabel(type, sub);
      counts.set(label, (counts.get(label) || 0) + 1);
    }
  }
  return [...counts].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count);
}

/**
 * `readers` maps a source id to its reader; readers may also be passed by
 * name (`whatcom`, `bellingham`, …). `reports` is Whatcom County's report
 * archive (countyReport.js), `kingReports` King County's (kingCountyReport.js),
 * `contractors` the WA registry (contractors.js).
 */
export function createPermitSync({ readers: given = {}, reports = null, kingReports = null, contractors = null, log = console, now = () => new Date(), ...named }) {
  const readers = { ...named, ...given };
  const ids = SOURCE_IDS.filter((id) => readers[id]);
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
      // `categoryIfNew`: a category only for a permit the app doesn't hold yet
      // (one that depends on details not read this time — rules/bellevue.js).
      const { permitNumber, source: _source, categoryIfNew, ...fields } = withoutUndefined(p);
      const onInsert = { firstSeenAt: at, ...(categoryIfNew && !fields.category && { category: categoryIfNew }) };
      return { updateOne: { filter: { source, permitNumber }, update: { $set: fields, $setOnInsert: onInsert }, upsert: true } };
    }), { ordered: false });
    await Permit.updateMany(
      { source, permitNumber: { $in: permits.map((p) => p.permitNumber) } },
      { $set: { lastSeenAt: at, ...(detailsRead && { detailsAt: at }) } }
    );
    return { added: r.upsertedCount, updated: r.modifiedCount };
  }

  async function pull(id, since) {
    const rule = RULES[id];
    const reader = readers[id];
    const { rows, pages, total } = await reader.issuedSince(since);
    // Offices issue permits every working day; an empty window means the
    // source answered wrongly, not that nothing happened.
    if (!rows.length && !rule.mayBeEmpty) throw new Error(rule.emptyError(since, total));
    const leads = rows.filter((row) => categoryFor(id, ...rule.typeOf(row)));
    const totals = { added: 0, updated: 0 };
    const add = (r) => { totals.added += r.added; totals.updated += r.updated; };
    let detailErrors = 0;
    if (reader.details) {
      // Leads whose details were read lately are saved from the list alone
      // (their contacts are left as they are), so a morning doesn't re-open
      // a month of permit pages.
      let toRead = leads;
      let skipped = 0;
      if (rule.detailsFreshDays) {
        const fresh = new Date(now().getTime() - rule.detailsFreshDays * 24 * 3600 * 1000);
        const recent = new Set(await Permit.distinct('permitNumber', { source: id, permitNumber: { $in: leads.map((r) => rule.numberOf(r)) }, detailsAt: { $gte: fresh } }));
        const known = leads.filter((r) => recent.has(rule.numberOf(r)));
        if (known.length) add(await save(id, known.map((row) => rule.toPermit(row, null))));
        toRead = leads.filter((r) => !recent.has(rule.numberOf(r)));
        skipped = known.length;
      }
      // Each permit is saved as soon as its details are read, so the page fills
      // in while a long pull runs. Ones whose details didn't load wait to the
      // end: if none loaded at all, something is wrong and nothing is saved
      // (one new permit failing among many already read is just counted).
      const withoutDetails = [];
      let next = 0;
      const worker = async () => {
        while (next < toRead.length) {
          const row = toRead[next++];
          let detail = null;
          try {
            detail = await reader.details(rule.detailIdOf(row));
          } catch (err) {
            log.warn?.(`[permits] ${rule.label} ${rule.numberOf(row)}: details failed — ${err.message}`);
          }
          const p = rule.toPermit(row, detail);
          if (!detail) { withoutDetails.push(p); continue; }
          add(await save(id, [p], { detailsRead: true }));
        }
      };
      await Promise.all(Array.from({ length: Math.min(rule.detailConcurrency || DETAIL_CONCURRENCY, toRead.length) }, worker));
      if (toRead.length && withoutDetails.length === toRead.length && (toRead.length > 1 || !skipped)) throw new Error(rule.detailsError(toRead.length));
      add(await save(id, withoutDetails));
      detailErrors = withoutDetails.length;
    } else {
      add(await save(id, leads.map((row) => rule.toPermit(row))));
    }
    const leadCount = leads.length;
    return {
      saved: totals, leads: leadCount, pages, seen: rows.length, detailErrors,
      unsortedTypes: tallyUnsorted(rows, id),
      latestIssuedOn: rows.map((r) => rule.issuedDayOf(r)).filter(Boolean).sort().pop() || null
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
      const pulled = await pull(source, since);
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
   * A source's months to check against its county's report, newest first:
   * ones the app has whole (on or after the first backfill's start), before
   * this month, with no clean report check yet. A month with differences is
   * checked again on later mornings, since a county sometimes enters a
   * permit late.
   */
  async function monthsToCheck(source) {
    const first = await PermitRun.findOne({ source, ok: true, kind: 'backfill' }).sort({ startedAt: 1 }).lean();
    if (!first) return [];
    const thisMonth = pacificNow(now()).day.slice(0, 7);
    // A month-so-far check ('search') doesn't count: only the report is final.
    const done = new Set((await PermitCheck.find({ source, ok: true, method: { $ne: 'search' } }, 'month').lean()).map((c) => c.month));
    return fullMonthsBetween(first.since, thisMonth).filter((m) => !done.has(m)).reverse();
  }

  async function checkCountyReport() {
    if (!reports || !readers.whatcom) return [];
    // Every month already checked against its report: nothing to download.
    const wanted = await monthsToCheck('whatcom');
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
        const { rows } = await readers.whatcom.issuedSince(from);
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
          notInCountySearch: r.notInCountySearch, notIssuedYet: r.notIssuedYet, datesMoved: r.datesMoved, notPublic: r.notPublic, ok: r.ok, error: ''
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

  async function checkKingReport() {
    const source = 'king_county';
    if (!kingReports || !readers[source]) return [];
    const wanted = await monthsToCheck(source);
    if (!wanted.length) return [];
    let available;
    try {
      available = await kingReports.list();
    } catch (err) {
      log.warn?.(`[permits] King County reports: ${err.message}`);
      return [{ source, error: err.message }];
    }
    const results = [];
    for (const report of available.filter((r) => wanted.includes(r.month)).slice(0, REPORTS_PER_RUN)) {
      const { from, to } = monthBounds(report.month);
      const base = { source, month: report.month, reportTitle: report.title, reportUrl: report.url, checkedAt: now() };
      let fields;
      try {
        const rows = await kingReports.rows(report.url);
        const numbers = rows.map((r) => r.number);
        const [appInMonth, held] = await Promise.all([
          Permit.distinct('permitNumber', { source, issuedOn: { $gte: from, $lte: to } }),
          Permit.find({ source, permitNumber: { $in: numbers } }, 'permitNumber valuation units projectName city zip parcel').lean()
        ]);
        const r = reconcileKingReport({ month: report.month, rows, appInMonth, appHas: held.map((p) => p.permitNumber) });
        // What the report adds to permits the app holds (value, units, city…), never over what the pull read.
        const byNumber = new Map(rows.map((row) => [row.number, row]));
        const fills = held.map((p) => ({ p, fill: kingReportFill(byNumber.get(p.permitNumber), p) })).filter((x) => Object.keys(x.fill).length);
        if (fills.length) {
          await Permit.bulkWrite(fills.map(({ p, fill }) => ({ updateOne: { filter: { _id: p._id }, update: { $set: fill } } })), { ordered: false });
        }
        // Leads only the report has (MyBuildingPermit lacks a few) are saved from
        // the report, so they're on the list — a month late, but not missed. The
        // check still says the pull missed them; the next morning's finds them all.
        const added = r.missingFromApp.map((n) => byNumber.get(n)).filter(Boolean).map(kingReportPermit);
        if (added.length) await save(source, added);
        fields = {
          ...base, method: 'report', inReport: r.inReport, matched: r.matched, missingFromApp: r.missingFromApp, notInReport: r.notInReport,
          datesMoved: r.datesMoved, notInCountySearch: [], notPublic: [], filled: fills.length, addedFromReport: added.map((p) => p.permitNumber), ok: r.ok, error: ''
        };
      } catch (err) {
        fields = { ...base, method: 'report', ok: false, error: String(err?.message || err).slice(0, 500) };
      }
      await PermitCheck.findOneAndUpdate({ source, month: report.month }, { $set: fields }, { upsert: true });
      log.log?.(`[permits] King County report ${report.month}: ${fields.ok ? 'matches' : fields.error || 'differs'}`);
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
   *   A source with `recheck` — its own second way in (Seattle: a second
   *     query in permit-number order; Bellevue: MyBuildingPermit's copy).
   *   Every other source — a second read of the month.
   *
   * Written as the month's 'search' check; a county's report replaces it once
   * the month is over and the report is posted.
   */
  async function checkMonthToDate() {
    const today = pacificNow(now()).day;
    const month = today.slice(0, 7);
    const from = `${month}-01`;
    const year = Number(month.slice(0, 4));
    const inMonth = (day) => day && day >= from && day <= today;
    const results = [];
    for (const source of ids) {
      const rule = RULES[source];
      const reader = readers[source];
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
              const { rows } = await reader.issuedSince(from, { keyword: code });
              for (const r of rows) {
                const n = String(r.CaseNumber || '').trim();
                if (n.startsWith(`${code}-`) && inMonth(rule.issuedDayOf(r)) && categoryFor('whatcom', r.CaseType)) found.add(n);
              }
            }
          }
        } else {
          const rows = reader.recheck
            ? await reader.recheck(from)
            : (await reader.issuedSince(from)).rows.map((r) => {
              const [type, subtype] = rule.typeOf(r);
              return { number: rule.numberOf(r), type, subtype, issuedOn: rule.issuedDayOf(r) };
            });
          for (const r of rows) {
            if (inMonth(r.issuedOn) && categoryFor(source, r.type, r.subtype)) found.add(String(r.number || '').trim());
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

  /** The registry's records for the contractors on permits this run saw. Never fails the run. */
  async function refreshContractors(since) {
    if (!contractors) return null;
    try {
      const seen = await Permit.find({ lastSeenAt: { $gte: since } }, 'contacts').lean();
      return await contractors.refreshFor(seen.flatMap((p) => p.contacts || []));
    } catch (err) {
      log.warn?.(`[permits] contractor registry: ${err.message}`);
      return { error: err.message };
    }
  }

  /** Every source, then the reports, the month so far and the registry. One at a time; a second call waits for the first. */
  function run({ kind = 'daily', by = '' } = {}) {
    if (running) return running;
    running = (async () => {
      const startedAt = now();
      const out = {};
      for (const source of ids) {
        const stale = new Date(now().getTime() - STALE_RUN_MS);
        if (await PermitRun.exists({ source, finishedAt: null, startedAt: { $gt: stale } })) {
          out[source] = { skipped: 'another run is going' };
          continue;
        }
        out[source] = await runSource(source, { kind, by });
      }
      out.reports = await checkCountyReport();
      out.kingReports = await checkKingReport();
      out.monthToDate = await checkMonthToDate();
      out.contractors = await refreshContractors(startedAt);
      return out;
    })().finally(() => { running = null; });
    return running;
  }

  const isRunning = () => Boolean(running);

  /** Whether the timer should start a run now. */
  async function isDue() {
    const at = now();
    for (const source of ids) {
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

  /** The sources this server pulls, in list order. */
  const sourceIds = () => [...ids];

  return { run, runSource, checkCountyReport, checkKingReport, checkMonthToDate, isDue, isRunning, closeInterrupted, start, sourceIds };
}

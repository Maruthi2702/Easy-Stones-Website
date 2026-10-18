/**
 * The new SPS import's planner — step 5 of the "SPS Import Redesign" artifact.
 * File in, ONE outcome per SPS customer out. Pure and DOM-free (tested in
 * spsImportPlan.test.js); the server reads the reference data, saves the answers
 * and carries the plan out, and the screen only draws it.
 *
 * Identity is the SPS name (`spsKey`, src/utils/spsSheet.js), never a guess:
 *   1. a customer already holding the key           → update / unchanged
 *   2. a customer whose company IS the name         → connect + update
 *   3. a customer deleted earlier that was this one → "Deleted before": bring
 *      it back or keep it deleted (always asked)
 *   4. a customer that looks like it (phone / email / name) → "Need a decision",
 *      Add as new pre-selected; or connect + update when a person says so
 *   5. nothing                                       → new
 * A row can't leave without an outcome, and two rows can't claim one customer.
 *
 * What an import may change (the artifact's Rules): the sales rep is updated
 * when SPS names one we know (blank/unknown in SPS keeps ours); the branch is
 * SPS's (today's rule); everything else only fills what's empty. It never
 * deletes.
 */
import { buildSignalIndex, matchAgainst, STRONG, isPlaceholderEmail } from './customerMatch.js';
import {
  importNormalize, importLabel, parseLevel, parseType, parseStatus,
  YES, isBlankValue, isDomainOnly, suggestRep
} from './customerImport.js';
import { spsKey } from './spsSheet.js';

export const ANSWER = Object.freeze({ NEW: 'new', RESTORE: 'restore', KEEP_DELETED: 'keep' });

/** The outcomes a person must still answer before an import can start. */
export const OPEN_ACTIONS = Object.freeze(['deleted']);

const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

/**
 * @param {object[]} input.rows
 * @param {object}   input.mapping      field → heading
 * @param {object[]} input.customers    held: the import's reference projection
 * @param {object[]} [input.deleted]    CustomerDeleteBackup rows: { customerId, customer, deletedBy, deletedAt, source, batchId }
 * @param {Map}      input.branchByKey  normalized branch → stored name ('' = default branch)
 * @param {Map}      input.repByKey     normalized alias → { salesRep, salesRepName } | false
 * @param {object}   [input.answers]    spsKey → 'new' | 'restore' | 'keep' | customerId
 * @param {boolean}  [input.finalize]   an unanswered "need a decision" row becomes a new customer
 */
export const planSpsImport = ({
  rows, mapping, customers, deleted = [], branchByKey, repByKey, answers = {}, finalize = false
}) => {
  const cell = (row, field) => (mapping[field] ? String(row[mapping[field]] ?? '').trim() : '');
  const nameColumn = mapping.company;

  const liveById = new Map(customers.map((c) => [String(c._id), c]));
  const holderByKey = new Map();
  for (const c of customers) if (c.sps?.key && !holderByKey.has(c.sps.key)) holderByKey.set(c.sps.key, c);
  const unconnected = customers.filter((c) => !c.sps?.key);
  const byCompany = new Map();
  for (const c of unconnected) {
    const k = spsKey(c.company);
    if (k) byCompany.set(k, [...(byCompany.get(k) || []), c]);
  }

  // Deleted customers an import may ask about: not back already, and not
  // removed by an earlier import's own Undo.
  const deletedByKey = new Map();
  for (const d of deleted) {
    if (d.undoneAt || d.source === 'sps-undo' || liveById.has(String(d.customerId))) continue;
    for (const k of new Set([d.customer?.sps?.key, spsKey(d.customer?.company)].filter(Boolean))) {
      const prev = deletedByKey.get(k);
      if (!prev || new Date(d.deletedAt || 0) > new Date(prev.deletedAt || 0)) deletedByKey.set(k, d);
    }
  }

  // ── the file's customers: one per distinct SPS name ───────────────────────
  const sheet = [];
  const seen = new Set();
  const skipped = { blank: 0, repeated: 0 };
  rows.forEach((row, i) => {
    const key = nameColumn ? spsKey(row[nameColumn]) : '';
    if (!key) { skipped.blank++; return; }
    if (seen.has(key)) { skipped.repeated++; return; }
    seen.add(key);
    sheet.push({ row, key, rowNumber: i + 2 });
  });

  const unresolvedReps = new Map();
  const unresolvedBranches = new Map();
  const tally = (map, given) => map.set(given, (map.get(given) || 0) + 1);

  const takenEmails = new Set(customers.map((c) => String(c.email || '').toLowerCase()).filter(Boolean));
  const claimEmail = (preferred, slug, rowNumber, warn) => {
    if (preferred && !takenEmails.has(preferred)) { takenEmails.add(preferred); return preferred; }
    if (preferred) warn(`${preferred} already belongs to another customer — filed without an email`);
    const base = `na+${slug || `row${rowNumber}`}`;
    let candidate = `${base}@easystones-client.com`;
    for (let n = 2; takenEmails.has(candidate); n++) candidate = `${base}-${n}@easystones-client.com`;
    takenEmails.add(candidate);
    return candidate;
  };

  /** Everything one SPS row says, in Easy Stones's terms. */
  const read = ({ row, key, rowNumber }) => {
    const warnings = [];
    const contactName = cell(row, 'contactName');
    const company = cell(row, 'company') || contactName;
    const rawEmail = cell(row, 'email');
    const usable = rawEmail.includes('@') && !isPlaceholderEmail(rawEmail);
    const sheetEmail = usable ? rawEmail.toLowerCase() : '';

    const branchGiven = cell(row, 'location');
    const branch = branchGiven ? (branchByKey.get(importNormalize(branchGiven)) ?? null) : '';
    if (branch === null) { warnings.push(`Unknown branch "${branchGiven}"`); tally(unresolvedBranches, branchGiven); }

    const repGiven = cell(row, 'salesRep');
    const rep = repGiven ? (repByKey.get(importNormalize(repGiven)) ?? null) : null;
    if (repGiven && rep === null) { warnings.push(`"${repGiven}" is not a selectable sales rep`); tally(unresolvedReps, repGiven); }

    const type = parseType(cell(row, 'customerType'));
    if (type === null) warnings.push(`Customer type "${cell(row, 'customerType')}" is not one of ours — imported as Fabricator`);
    const status = parseStatus(cell(row, 'status'));
    if (status === null) warnings.push(`Status "${cell(row, 'status')}" is not one of ours — imported as Onboarded`);
    const receiveMarketing = cell(row, 'receiveMarketing');
    const accountAlert = cell(row, 'accountAlert');

    const candidate = {
      contactName: contactName || 'N/A',
      company: company || 'N/A',
      email: sheetEmail,
      phone: cell(row, 'phone'),
      address: {
        street: [cell(row, 'street'), cell(row, 'street2')].filter(Boolean).join(', '),
        city: cell(row, 'city'), state: cell(row, 'state'), zipCode: cell(row, 'zipCode')
      },
      ...parseLevel(cell(row, 'level')),
      customerType: type ?? 'Fabricator',
      status: status ?? 'Onboarded',
      modaDisplay: YES.test(cell(row, 'modaDisplay')) ? 'Yes' : 'No',
      modaBinder: cell(row, 'modaBinder') || '0',
      marketingEmail: cell(row, 'marketingEmail').toLowerCase(),
      receiveMarketing: receiveMarketing ? YES.test(receiveMarketing) : true,
      quickNote: [
        accountAlert && `⚠ ${accountAlert}`,
        cell(row, 'quickNote'),
        cell(row, 'deliveryInstructions') && `Delivery: ${cell(row, 'deliveryInstructions')}`
      ].filter(Boolean).join(' | ')
    };
    const spsName = String(row[nameColumn]).trim();
    return {
      key, rowNumber, spsName, candidate, rep, branch, sheetEmail, rawEmail, usable, warnings,
      label: importLabel(candidate), company: candidate.company, city: candidate.address.city,
      sheetSalesRep: repGiven, sheetLocation: branchGiven
    };
  };

  const base = (r) => ({
    key: r.key, rowNumber: r.rowNumber, name: r.spsName, company: r.company, city: r.city,
    sheetSalesRep: r.sheetSalesRep, sheetLocation: r.sheetLocation, warnings: r.warnings
  });

  /** What this SPS row changes on a customer we hold: the Rules, in code. */
  const changesFor = (r, target, { connect, restoredFrom }) => {
    const changes = [];
    const apply = {};
    const before = {};
    const unset = [];
    const set = (path, to) => {
      const was = getPath(target, path);
      if (was === undefined) unset.push(path); else before[path] = was;
      apply[path] = to;
    };

    if (connect) {
      set('sps.key', r.key);
      set('sps.name', r.spsName);
      set('sps.firstImportedAt', new Date());
      changes.push({ field: 'sps', from: '', to: r.spsName });
    }
    // The rep: SPS updates it when it names someone we know.
    if (r.rep && r.rep.salesRepName !== target.salesRepName) {
      changes.push({ field: 'salesRep', from: target.salesRepName || '', to: r.rep.salesRepName });
      set('salesRep', r.rep.salesRep);
      set('salesRepName', r.rep.salesRepName);
    }
    // The branch: SPS wins.
    if (r.branch && target.location !== r.branch) {
      changes.push({ field: 'location', from: target.location || '', to: r.branch });
      set('location', r.branch);
    }
    const fill = (field, path, to) => {
      const from = getPath(target, path);
      if (!isBlankValue(from) || isBlankValue(to)) return;
      changes.push({ field, from: String(from ?? '').trim(), to });
      set(path, to);
    };
    const c = r.candidate;
    fill('company', 'company', c.company);
    fill('contactName', 'contactName', c.contactName);
    fill('phone', 'phone', c.phone);
    fill('street', 'address.street', c.address.street);
    fill('city', 'address.city', c.address.city);
    fill('state', 'address.state', c.address.state);
    fill('zipCode', 'address.zipCode', c.address.zipCode);
    fill('quickNote', 'quickNote', c.quickNote);
    if ((!target.email || isPlaceholderEmail(target.email)) && r.sheetEmail && !takenEmails.has(r.sheetEmail)) {
      takenEmails.add(r.sheetEmail);
      changes.push({ field: 'email', from: target.email || '', to: r.sheetEmail });
      set('email', r.sheetEmail);
    }
    if (Object.keys(apply).some((k) => k.startsWith('address.'))) set('geocode.status', 'pending');
    return { changes, apply, before, unset, restoredFrom };
  };

  const outcomes = new Map();           // key → outcome
  const claimed = new Set();            // customer ids an SPS row has taken
  const reads = sheet.map(read);

  const update = (r, target, { connect = false, matchedOn = [] } = {}) => {
    claimed.add(String(target._id));
    const { changes, apply, before, unset } = changesFor(r, target, { connect });
    outcomes.set(r.key, {
      ...base(r),
      action: changes.length ? 'update' : 'unchanged',
      connect,
      customerId: String(target._id),
      customerLabel: importLabel(target),
      matchedOn,
      changes,
      apply: changes.length ? apply : null,
      before, unset
    });
  };

  // ── pass 1: the certain ones (a held key, an exact company name) ──────────
  const rest = [];
  for (const r of reads) {
    const holder = holderByKey.get(r.key);
    if (holder) { update(r, holder); continue; }
    const same = (byCompany.get(r.key) || []).filter((c) => !claimed.has(String(c._id)));
    if (same.length === 1 && (byCompany.get(r.key) || []).length === 1) { update(r, same[0], { connect: true, matchedOn: ['exact name'] }); continue; }
    rest.push(r);
  }

  // ── pass 2: deleted before, look-alikes, new ──────────────────────────────
  const free = unconnected.filter((c) => !claimed.has(String(c._id)));
  const index = buildSignalIndex(free);
  const byId = new Map(free.map((c) => [String(c._id), c]));

  const createFor = (r) => {
    const finalEmail = (() => {
      if (r.rawEmail && !r.usable) r.warnings.push(`"${r.rawEmail}" is not this customer's own address — filed without an email`);
      return claimEmail(r.sheetEmail, importNormalize(r.candidate.company) || importNormalize(r.candidate.contactName), r.rowNumber, (w) => r.warnings.push(w));
    })();
    outcomes.set(r.key, {
      ...base(r),
      action: 'new',
      create: {
        ...r.candidate,
        email: finalEmail,
        marketingEmail: r.candidate.marketingEmail || finalEmail,
        ...(r.branch ? { location: r.branch } : {}),
        ...(r.rep || {}),
        isVerified: true
      }
    });
  };

  for (const r of rest) {
    const answer = String(answers[r.key] ?? '').trim();

    const gone = deletedByKey.get(r.key);
    if (gone) {
      const deletedInfo = {
        backupId: String(gone._id || ''), customerId: String(gone.customerId), company: gone.customer?.company || '',
        deletedBy: gone.deletedBy || '', deletedAt: gone.deletedAt || null, source: gone.source || '', batchId: gone.batchId || ''
      };
      if (gone.spsKeepDeleted || answer === ANSWER.KEEP_DELETED) {
        outcomes.set(r.key, { ...base(r), action: 'keptDeleted', deleted: deletedInfo, remembered: !!gone.spsKeepDeleted });
        continue;
      }
      if (answer === ANSWER.RESTORE) {
        const target = { ...(gone.customer || {}), _id: gone.customerId };
        const { changes, apply, before, unset } = changesFor(r, target, { connect: true });
        outcomes.set(r.key, {
          ...base(r), action: 'restore', connect: true, customerId: String(gone.customerId),
          customerLabel: importLabel(gone.customer || {}), deleted: deletedInfo, changes, apply, before, unset
        });
        continue;
      }
      outcomes.set(r.key, { ...base(r), action: 'deleted', deleted: deletedInfo });
      continue;
    }

    const matches = matchAgainst(index, r.candidate).filter((m) => byId.has(m.id) && !claimed.has(m.id));
    const worthAsking = matches.filter((m) => m.score >= STRONG || !isDomainOnly(m));
    if (worthAsking.length) {
      const chosen = worthAsking.find((m) => m.id === answer);
      if (chosen) { update(r, byId.get(chosen.id), { connect: true, matchedOn: chosen.signals }); continue; }
      if (answer !== ANSWER.NEW && !finalize) {
        outcomes.set(r.key, {
          ...base(r),
          action: 'decision',
          matches: worthAsking.slice(0, 5).map((m) => {
            const c = byId.get(m.id);
            return {
              id: m.id, label: importLabel(c), company: c.company, signals: m.signals, score: m.score,
              contactName: c.contactName || '', phone: c.phone || '', email: c.email || '', city: c.address?.city || '',
              salesRepName: c.salesRepName || '', location: c.location || '', visits: c.visitCount || 0
            };
          }),
          sheet: { company: r.company, contactName: r.candidate.contactName, phone: r.candidate.phone, email: r.sheetEmail, city: r.city, branch: r.sheetLocation, rep: r.sheetSalesRep }
        });
        continue;
      }
    }
    createFor(r);
  }

  const list = sheet.map((s) => outcomes.get(s.key));
  const counts = { new: 0, update: 0, unchanged: 0, decision: 0, deleted: 0, restore: 0, keptDeleted: 0 };
  for (const o of list) counts[o.action]++;
  const repNames = [...new Set([...repByKey.values()].filter(Boolean).map((x) => x.salesRepName))];
  const unresolved = (map, suggest) => [...map]
    .map(([given, rowCount]) => ({ given, rowCount, suggestion: suggest(given) }))
    .sort((a, b) => b.rowCount - a.rowCount);

  return {
    outcomes: list,
    counts,
    rowsRead: rows.length,
    distinct: sheet.length,
    skipped,
    // Every distinct SPS customer is in exactly one group.
    adds: Object.values(counts).reduce((a, b) => a + b, 0) === sheet.length,
    unresolvedReps: unresolved(unresolvedReps, (given) => suggestRep(given, repNames)),
    unresolvedBranches: unresolved(unresolvedBranches, () => null)
  };
};

/** Can this plan start? Names every reason it can't. */
export const blockersFor = (plan) => {
  const blockers = [];
  if (plan.counts.deleted > 0) blockers.push(`${plan.counts.deleted} deleted customer${plan.counts.deleted === 1 ? ' needs' : 's need'} an answer: bring back or keep deleted.`);
  if (plan.unresolvedReps.length) blockers.push(`${plan.unresolvedReps.length} sales rep name${plan.unresolvedReps.length === 1 ? '' : 's'} not answered yet.`);
  if (plan.unresolvedBranches.length) blockers.push(`${plan.unresolvedBranches.length} branch name${plan.unresolvedBranches.length === 1 ? '' : 's'} not answered yet.`);
  if (!plan.adds) blockers.push('The rows don’t add up to the file — nothing was started.');
  return blockers;
};

/**
 * Which extra switches this plan needs: connecting an existing customer needs
 * Edit, bringing one back needs Add (the artifact's "Who can do what").
 */
export const switchesNeeded = (plan) => ({
  edit: plan.outcomes.some((o) => o.connect && o.action !== 'restore') ,
  add: plan.outcomes.some((o) => o.action === 'restore')
});

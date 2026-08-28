/**
 * What would importing this spreadsheet do?
 *
 * Everything here is pure: a workbook goes in, along with the branches, the
 * sellable reps and the customers we already hold, and a plan comes out saying
 * row by row what would be created, what would be updated, and what a person
 * needs to look at first. Nothing reads or writes the database — server.js
 * fetches the reference data and carries the plan out, which is what lets the
 * whole decision be exercised against a real sheet without touching a record.
 *
 * Whether a row is someone we already have is decided by
 * src/utils/customerMatch.js, the same matcher the duplicate audit and the
 * merge script use. The import had its own looser rule until this file existed,
 * and the two disagreed about the very duplicates the audit was written to find.
 */
import { read, utils } from 'xlsx';
import {
  buildSignalIndex, addToSignalIndex, matchAgainst, STRONG, isPlaceholderEmail
} from './customerMatch.js';

/**
 * Marks an id as belonging to a row of the sheet being imported rather than to
 * a customer in the database. Nothing can be written to one of these.
 */
const SHEET_ROW_PREFIX = 'sheet:';

/**
 * The fields a spreadsheet can fill, and the headings that mean each one.
 *
 * Order is load-bearing. Each column is claimed by at most one field and the
 * list is walked top to bottom, so a specific heading wins over a loose one:
 * 'Sales Person1' has to be taken as the owner before the contact matcher sees
 * the word "name" in it, and 'Parent Location' as the branch before the address
 * matcher sees "location". Within a field the keywords are tried in order for
 * the same reason — 'contact' claims 'Contact Name' first, which is what frees
 * the bare 'Name' column for the company, where SPS exports put it.
 *
 * Detection is an opening guess, not the contract. The preview reports what it
 * matched and the admin can reassign any column before anything is written,
 * because the next export will name its columns something else again.
 */
export const IMPORT_COLUMNS = [
  ['salesRep', ['sales rep', 'salesrep', 'sales person', 'salesperson', 'account manager', 'account owner', 'assigned to', 'rep']],
  ['location', ['easy stones location', 'es location', 'branch', 'location', 'store', 'office']],
  ['email', ['email', 'e-mail', 'mail']],
  ['contactName', ['contact', 'full name', 'customer name', 'customer', 'name']],
  ['company', ['company', 'business', 'organization', 'firm', 'name', 'account']],
  ['phone', ['phone', 'mobile', 'cell', 'tel']],
  ['street', ['address', 'street']],
  ['city', ['city', 'town']],
  ['state', ['state', 'province', 'region']],
  ['zipCode', ['zip', 'postal', 'code']],
  ['level', ['level', 'tier', 'grade']],
  ['customerType', ['customertype', 'customer type', 'type', 'category']],
  ['status', ['status', 'stage', 'lead status']],
  ['modaDisplay', ['modadisplay', 'moda display', 'display']],
  ['modaBinder', ['modabinder', 'moda binder', 'binder']]
];

export const IMPORT_FIELDS = IMPORT_COLUMNS.map(([field]) => field);

/** Lowercase, letters and digits only. For matching branch and rep names, nothing else. */
export const importNormalize = (value) =>
  String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Which sheet column feeds which field. An override of '' means "leave this
 * field alone"; a field the override omits is auto-detected. Explicit choices
 * are claimed up front so detection cannot take a column the admin assigned.
 */
export const resolveImportMapping = (headers, override = {}) => {
  const mapping = {};
  const claimed = new Set();

  for (const field of IMPORT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(override, field)) continue;
    const chosen = String(override[field] ?? '').trim();
    mapping[field] = headers.includes(chosen) ? chosen : null;
    if (mapping[field]) claimed.add(mapping[field]);
  }

  for (const [field, keywords] of IMPORT_COLUMNS) {
    if (field in mapping) continue;
    mapping[field] = null;
    for (const word of keywords) {
      const hit = headers.find(h => !claimed.has(h) && h.toLowerCase().includes(word));
      if (hit) {
        claimed.add(hit);
        mapping[field] = hit;
        break;
      }
    }
  }

  return mapping;
};

/**
 * SPS's own export, downloaded straight from its web CRM rather than
 * re-saved through Excel, is not a real workbook: it's an HTML document
 * (Excel's lenient HTML+XML dialect) with the real data table nested
 * inside a decorative outer one, and only one closing </table> for the
 * three that get opened. `xlsx`'s HTML reader takes the nesting at face
 * value and grabs the outer, decorative table — its <td> content, not the
 * customer grid — which is why every column comes back unmapped.
 *
 * <tr>/<td>/<th> tags themselves are well-formed even though the table
 * nesting isn't, so scanning for rows directly (rather than resolving the
 * broken table structure) still finds the real grid: the header row is
 * whichever row is made entirely of <th> cells, and the true one is the
 * widest, since decorative rows elsewhere in the document aren't real
 * column headers with this many fields.
 */
const parseHtmlWorkbook = (text) => {
  const stripTags = (s) => s
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();

  const cellsOf = (rowHtml, tag) =>
    [...rowHtml.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi'))]
      .map(c => stripTags(c[1]));

  const rows = [...text.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map(m => {
      const th = cellsOf(m[1], 'th');
      const td = cellsOf(m[1], 'td');
      return th.length && !td.length
        ? { type: 'header', cells: th }
        : td.length ? { type: 'data', cells: td } : null;
    })
    .filter(Boolean);

  const headerRow = rows
    .filter(r => r.type === 'header')
    .sort((a, b) => b.cells.length - a.cells.length)[0];
  if (!headerRow) return null;

  const rawHeaders = headerRow.cells;
  const headerRowIndex = rows.indexOf(headerRow);
  const dataRows = rows.slice(headerRowIndex + 1)
    .filter(r => r.type === 'data' && r.cells.length === rawHeaders.length)
    .map(r => Object.fromEntries(rawHeaders.map((h, i) => [h, r.cells[i] ?? ''])));

  const headers = [...new Set(rawHeaders.map(h => h.trim()).filter(Boolean))];
  return { headers, rows: dataRows };
};

/** Real xlsx (zip) starts with 'PK'; real binary xls (OLE) starts with D0CF11E0. */
const isBinaryWorkbook = (buffer) =>
  (buffer[0] === 0x50 && buffer[1] === 0x4b) ||
  (buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0);

/**
 * Headings come from the header row itself, not from the keys of the first data
 * row. A sheet whose first customer happens to have no contact name would
 * otherwise lose the Contact Name column for every row beneath it.
 */
export const readCustomerSheet = (buffer) => {
  if (!isBinaryWorkbook(buffer)) {
    const parsed = parseHtmlWorkbook(buffer.toString('utf8'));
    if (parsed && parsed.rows.length) return parsed;
  }

  const workbook = read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error('The file has no readable sheet');

  const headers = [...new Set(
    (utils.sheet_to_json(sheet, { header: 1, blankrows: false })[0] || [])
      .map(h => String(h ?? '').trim())
      .filter(Boolean)
  )];
  const rows = utils.sheet_to_json(sheet, { defval: '' });
  if (!rows.length) throw new Error('The sheet has no data rows');

  return { headers, rows };
};

const parseLevel = (value) => {
  const s = String(value ?? '').trim();
  for (const n of [1, 2, 3, 4]) {
    if (s.includes(String(n))) return { level: `Level - ${n}`, priceLevel: n };
  }
  return { level: 'Level - 4', priceLevel: 4 };
};

/**
 * Both of these answer null for a value they cannot place, and the caller then
 * files the row under the schema's default and says so.
 *
 * They used to pass the unrecognised text straight through, which the schema
 * rejected on save — so one customer typed as 'Retail', a category we do not
 * have, lost the whole record rather than the one field. A sheet is allowed to
 * contain words we have no column for; it is not allowed to cost us a customer.
 */
const parseType = (value) => {
  const s = String(value ?? '').trim().toLowerCase();
  if (!s) return 'Fabricator';
  if (s.includes('contractor')) return 'Contractor';
  if (s.includes('dealer')) return 'Dealer';
  if (s.includes('floor')) return 'Floor Covering';
  if (s.includes('designer')) return 'Designer';
  if (s.includes('builder')) return 'Builder';
  if (s.includes('fabricator')) return 'Fabricator';
  return null;
};

const parseStatus = (value) => {
  const s = String(value ?? '').trim().toLowerCase();
  if (!s) return 'Onboarded';
  if (s.includes('new') || s.includes('lead')) return 'New Lead';
  if (s.includes('try') || s.includes('onboard')) return 'Trying to Onboard';
  if (s.includes('contact') || s.includes('discuss')) return 'Contacted / In Discussion';
  if (s.includes('different') || s.includes('rep')) return 'Different Sales Person';
  if (s.includes('not interested')) return 'Not Interested';
  if (s.includes('inactive')) return 'Inactive';
  if (s.includes('onboarded')) return 'Onboarded';
  return null;
};

/**
 * Who might "Stephen Watson" be, when the staff list holds a "Steve"?
 *
 * SPS writes people's full legal names and our user records hold whatever they
 * log in as, so the two rarely match outright. Compared on first names only,
 * and offered only when exactly one person could be meant — a suggestion the
 * admin still has to accept is useful; one that quietly picks the wrong Steve
 * moves accounts onto someone who never sold them.
 */
export const suggestRep = (given, repNames) => {
  const first = importNormalize(String(given).trim().split(/\s+/)[0] || '');
  if (first.length < 3) return null;

  const hits = repNames.filter(name => {
    const theirs = importNormalize(String(name).trim().split(/\s+/)[0] || '');
    if (theirs.length < 3) return false;
    const shared = Math.min(first.length, theirs.length);
    return first.slice(0, shared) === theirs.slice(0, shared) ||
      first.slice(0, 3) === theirs.slice(0, 3);
  });

  return hits.length === 1 ? hits[0] : null;
};

/** How a customer reads in a review list, where the admin is deciding by eye. */
export const importLabel = (c = {}) => [
  c.company || '(no company)',
  c.contactName || '(no contact)',
  c.email || '(no email)',
  c.phone || '',
  c.address?.city || ''
].filter(Boolean).join(' — ');

/**
 * Work out, row by row, what importing this sheet would do.
 *
 * @param {object}  input
 * @param {string[]} input.headers    the sheet's header row
 * @param {object[]} input.rows       the sheet's data rows, keyed by heading
 * @param {object}  input.mapping     field → heading, from resolveImportMapping
 * @param {Map}     input.branchByKey normalized branch name → its stored casing
 * @param {Map}     input.repByKey    normalized alias → { salesRep, salesRepName }
 * @param {object[]} input.existing   the customers already held
 * @param {object}  input.decisions   sheet row number → 'create', or the id of
 *                                    the matched customer to update instead.
 *                                    How a flagged row stops being flagged.
 */
export const buildImportPlan = ({
  headers, rows, mapping, branchByKey, repByKey, existing, decisions = {}
}) => {
  const cell = (row, field) => (mapping[field] ? String(row[mapping[field]] ?? '').trim() : '');

  const byId = new Map(existing.map(c => [String(c._id), c]));
  const index = buildSignalIndex(existing);

  const planned = [];
  const counts = { create: 0, update: 0, review: 0, unchanged: 0, error: 0 };

  // Names the sheet used that nobody answers to, counted so the preview can ask
  // once who "Stephen Watson" is rather than once per row he appears on.
  const unresolvedReps = new Map();
  const unresolvedBranches = new Map();
  const tally = (map, given) => map.set(given, (map.get(given) || 0) + 1);

  /**
   * A email address nobody else holds, because the column is uniquely indexed
   * and a collision costs the whole record.
   *
   * Two things collide here. Reps write their own address into a customer's
   * email box — a dozen accounts carry vish@easystones.com — and the matcher
   * deliberately reads none of those as identifying, so the rows are correctly
   * planned as separate customers and then fight over one unique key. And a
   * sheet can simply name the same business twice. Neither is a reason to lose
   * a record, so an address that is already spoken for is replaced by one that
   * says plainly that this customer has no address of its own.
   */
  const takenEmails = new Set(existing.map(c => String(c.email || '').toLowerCase()).filter(Boolean));
  const claimEmail = (preferred, slug, rowNumber, warn) => {
    if (preferred && !takenEmails.has(preferred)) {
      takenEmails.add(preferred);
      return preferred;
    }
    if (preferred) warn(`${preferred} already belongs to another customer — filed without an email`);

    const base = `na+${slug || `row${rowNumber}`}`;
    let candidate = `${base}@easystones-client.com`;
    for (let n = 2; takenEmails.has(candidate); n++) candidate = `${base}-${n}@easystones-client.com`;
    takenEmails.add(candidate);
    return candidate;
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNumber = i + 2; // 1-based, and row 1 is the header
    const warnings = [];

    try {
      const contactName = cell(row, 'contactName');
      const company = cell(row, 'company') || contactName;
      const phone = cell(row, 'phone');
      const rawEmail = cell(row, 'email');

      // A row with nothing that names a business is a spacer or a stray total,
      // not a customer. Importing it would mint one more "N/A" record of exactly
      // the kind this import exists to stop creating.
      if (!company && !contactName && !rawEmail && !phone) continue;

      const branchGiven = cell(row, 'location');
      const branch = branchGiven ? (branchByKey.get(importNormalize(branchGiven)) ?? null) : '';
      if (branch === null) {
        warnings.push(`Unknown branch "${branchGiven}"`);
        tally(unresolvedBranches, branchGiven);
      }

      const repGiven = cell(row, 'salesRep');
      const rep = repGiven ? (repByKey.get(importNormalize(repGiven)) ?? null) : null;
      if (repGiven && rep === null) {
        warnings.push(`"${repGiven}" is not a selectable sales rep`);
        tally(unresolvedReps, repGiven);
      }

      // The address this row identifies the business by, which is not always
      // the one in the email column: a rep's own @easystones.com, or a previous
      // import's placeholder, says nothing about who the customer is. Blank here
      // rather than substituted, because matching has to happen on the sheet's
      // real evidence — swapping in a generated address before the comparison
      // would throw away the email signal and duplicate the customer.
      const usable = rawEmail.includes('@') && !isPlaceholderEmail(rawEmail);
      const sheetEmail = usable ? rawEmail.toLowerCase() : '';

      /**
       * The address to store, decided only once we know this row is a new
       * customer. Updates never reach here — they touch owner and branch and
       * leave the existing record's email alone.
       */
      const emailToStore = () => {
        if (rawEmail && !usable) {
          warnings.push(`"${rawEmail}" is not this customer's own address — filed without an email`);
        }
        return claimEmail(
          sheetEmail,
          importNormalize(company) || importNormalize(contactName),
          rowNumber,
          w => warnings.push(w)
        );
      };

      const type = parseType(cell(row, 'customerType'));
      if (type === null) {
        warnings.push(`Customer type "${cell(row, 'customerType')}" is not one of ours — imported as Fabricator`);
      }
      const status = parseStatus(cell(row, 'status'));
      if (status === null) {
        warnings.push(`Status "${cell(row, 'status')}" is not one of ours — imported as Onboarded`);
      }

      const candidate = {
        contactName: contactName || 'N/A',
        company: company || 'N/A',
        email: sheetEmail,
        phone,
        address: {
          street: cell(row, 'street'),
          city: cell(row, 'city'),
          state: cell(row, 'state'),
          zipCode: cell(row, 'zipCode')
        },
        ...parseLevel(cell(row, 'level')),
        customerType: type ?? 'Fabricator',
        status: status ?? 'Onboarded',
        modaDisplay: /^(yes|y|true|1)$/i.test(cell(row, 'modaDisplay')) ? 'Yes' : 'No',
        modaBinder: cell(row, 'modaBinder') || '0'
      };

      const base = {
        rowNumber,
        label: importLabel(candidate),
        company: candidate.company,
        contactName: candidate.contactName,
        email: candidate.email,
        phone: candidate.phone,
        city: candidate.address.city,
        sheetSalesRep: repGiven,
        sheetLocation: branchGiven,
        warnings
      };

      const matches = matchAgainst(index, candidate);
      const strong = matches.filter(m => m.score >= STRONG);
      const describe = (list) => list.map(m => ({
        id: m.id,
        label: importLabel(byId.get(m.id)),
        signals: m.signals,
        score: m.score,
        salesRepName: byId.get(m.id)?.salesRepName || '',
        location: byId.get(m.id)?.location || '',
        // A match against a row earlier in this same sheet, not against a
        // customer we hold. It cannot be updated — it does not exist yet.
        fromSheet: m.id.startsWith(SHEET_ROW_PREFIX)
      }));

      /** What updating this existing customer from this row would change. */
      const planUpdate = (target, matchedOn) => {
        const changes = [];

        // An account that already has an owner keeps it. A sheet is a snapshot
        // of what SPS believed on the day it was exported; a reassignment made
        // in the CRM since is the more recent fact, and quietly reverting it
        // would move commission off whoever is actually working the account.
        if (rep && !target.salesRep) {
          changes.push({ field: 'salesRep', from: '', to: rep.salesRepName });
        } else if (rep && target.salesRep && target.salesRepName !== rep.salesRepName) {
          warnings.push(`Kept existing owner ${target.salesRepName || '(assigned)'}; sheet said ${rep.salesRepName}`);
        }

        // Branch, unlike owner, is never blank — the schema defaults it to
        // Seattle — so filling only blanks would change nothing and the upload
        // could not do the job it is here to do. The sheet wins.
        if (branch && target.location !== branch) {
          changes.push({ field: 'location', from: target.location || '', to: branch });
        }

        planned.push({
          ...base,
          action: changes.length ? 'update' : 'unchanged',
          targetId: String(target._id),
          targetLabel: importLabel(target),
          matchedOn,
          changes,
          apply: changes.length
            ? {
              ...(changes.some(c => c.field === 'salesRep') ? { salesRep: rep.salesRep, salesRepName: rep.salesRepName } : {}),
              ...(changes.some(c => c.field === 'location') ? { location: branch } : {})
            }
            : null
        });
        counts[changes.length ? 'update' : 'unchanged']++;
      };

      // What the admin decided about this row last time they looked at it.
      // Only ever a choice among the records this row actually matched — a
      // decision naming anything else is ignored rather than obeyed, so nothing
      // the browser sends can direct a write at an unrelated customer.
      const decision = String(decisions[rowNumber] ?? '').trim();
      const chosen = matches.find(m => m.id === decision && !m.id.startsWith(SHEET_ROW_PREFIX));

      const needsReview = strong.length > 1
        || (strong.length === 0 && matches.length > 0)
        || strong.some(m => m.id.startsWith(SHEET_ROW_PREFIX));

      if (needsReview && !chosen && decision !== 'create') {
        const repeated = strong.find(m => m.id.startsWith(SHEET_ROW_PREFIX));
        planned.push({
          ...base,
          action: 'review',
          reason: repeated
            ? `Row ${repeated.id.slice(SHEET_ROW_PREFIX.length)} of this sheet is the same business`
            : strong.length > 1
              ? `Matches ${strong.length} existing customers`
              : 'Resembles an existing customer, but not closely enough to be sure',
          matches: describe(matches.slice(0, 6))
        });
        counts.review++;
        continue;
      }

      if (chosen) {
        planUpdate(byId.get(chosen.id), chosen.signals);
        continue;
      }

      if (!needsReview && strong.length === 1) {
        planUpdate(byId.get(strong[0].id), strong[0].signals);
        continue;
      }

      planned.push({
        ...base,
        action: 'create',
        create: {
          ...candidate,
          email: emailToStore(),
          // A blank or unrecognised branch falls through to the schema default
          // rather than being written as '', which would drop the record out of
          // every branch filter.
          ...(branch ? { location: branch } : {}),
          ...(rep || {}),
          isVerified: true
        }
      });
      counts.create++;

      // Now findable by the rows below it. Without this the sheet's own repeats
      // are invisible: each row is compared only against the database, so a
      // business listed twice is planned as two new customers, and the second
      // insert dies on whichever unique key the first one just took.
      const sheetId = `${SHEET_ROW_PREFIX}${rowNumber}`;
      addToSignalIndex(index, candidate, sheetId);
      byId.set(sheetId, candidate);
    } catch (err) {
      planned.push({ rowNumber, action: 'error', reason: err.message, warnings });
      counts.error++;
    }
  }

  const repNames = [...new Set([...repByKey.values()].map(r => r.salesRepName))];
  const unresolved = (map, suggest) => [...map]
    .map(([given, rowCount]) => ({ given, rowCount, suggestion: suggest(given) }))
    .sort((a, b) => b.rowCount - a.rowCount);

  return {
    headers,
    mapping,
    planned,
    counts,
    totalRows: rows.length,
    unresolvedReps: unresolved(unresolvedReps, given => suggestRep(given, repNames)),
    unresolvedBranches: unresolved(unresolvedBranches, () => null)
  };
};

/** Rows worth sending to the browser; 'unchanged' travels as a count alone. */
export const importRowsForClient = (planned) => planned.filter(p => p.action !== 'unchanged');

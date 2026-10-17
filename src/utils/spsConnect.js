/**
 * Connect existing customers to SPS — step 3 of the SPS import redesign (the
 * "SPS Import Redesign" artifact). Every customer already in Easy Stones needs
 * to learn which SPS customer it is (`sps.key`, src/utils/spsSheet.js) before
 * the new import can match by name instead of guessing.
 *
 * Pure and DOM-free; tested in spsConnect.test.js. It reads an SPS file's rows
 * and the customers held and says, per customer:
 *   - `auto`     its company name IS an SPS name (capitals ignored), and no
 *                other customer or SPS row competes for it → connect unasked;
 *   - `toCheck`  anything else, with the closest SPS rows (same phone / email /
 *                look-alike name) for a person to choose from, or to say "not
 *                in SPS" or "not sure";
 *   - `connected` already holds an SPS key; `notInSps` a person said SPS has no
 *                such customer (a lead, or one SPS doesn't hold).
 * Nothing here writes. The route applies what a person approved.
 */
import { buildSignalIndex, matchAgainst } from './customerMatch.js';
import { spsKey } from './spsSheet.js';

export const CONNECT_CHOICES = Object.freeze({ NOT_IN_SPS: 'none', NOT_SURE: 'later' });
const MAX_CANDIDATES = 3;

const text = (v) => String(v ?? '').trim();

/** The file's customers, one per distinct SPS name, in file order. */
export const spsRowsOf = ({ rows, mapping }) => {
  const col = (field) => mapping?.[field] || null;
  const nameCol = col('company');
  const seen = new Map();
  if (!nameCol) return [];
  rows.forEach((row, i) => {
    const key = spsKey(row[nameCol]);
    if (!key || seen.has(key)) return;
    seen.set(key, {
      key,
      rowNumber: i + 2,
      name: text(row[nameCol]),
      company: text(row[nameCol]),
      email: col('email') ? text(row[col('email')]) : '',
      phone: col('phone') ? text(row[col('phone')]) : '',
      city: col('city') ? text(row[col('city')]) : '',
      branch: col('location') ? text(row[col('location')]) : ''
    });
  });
  return [...seen.values()];
};

/**
 * @param {object[]} input.rows       the sheet's rows, keyed by heading
 * @param {object}   input.mapping    field → heading
 * @param {object[]} input.customers  customers held: { _id, company, email, phone, sps?, location? }
 */
export const planConnect = ({ rows, mapping, customers }) => {
  const sps = spsRowsOf({ rows, mapping });
  const spsByKey = new Map(sps.map((r) => [r.key, r]));

  const connected = [];
  const unconnected = [];
  let notInSps = 0;
  for (const c of customers) {
    if (c?.sps?.key) connected.push(c);
    else if (c?.sps?.reviewedAs === CONNECT_CHOICES.NOT_IN_SPS) notInSps++; // a person said SPS doesn't have it
    else unconnected.push(c);
  }

  // Which customers want each name? A name wanted by two customers (twin
  // records with the same company) connects neither unasked.
  const wantedBy = new Map();
  for (const c of unconnected) {
    const key = spsKey(c.company);
    if (key && spsByKey.has(key)) wantedBy.set(key, [...(wantedBy.get(key) || []), c]);
  }
  // A name an already-connected customer holds is taken.
  const taken = new Set(connected.map((c) => c.sps.key));

  const auto = [];
  const autoKeys = new Set();
  for (const [key, list] of wantedBy) {
    if (list.length !== 1 || taken.has(key)) continue;
    const c = list[0];
    auto.push({ customerId: String(c._id), key, spsName: spsByKey.get(key).name, company: c.company, rowNumber: spsByKey.get(key).rowNumber });
    autoKeys.add(key);
  }
  const autoIds = new Set(auto.map((a) => a.customerId));

  // Candidates come from SPS rows nobody holds and nobody is auto-connected to.
  const free = sps.filter((r) => !taken.has(r.key) && !autoKeys.has(r.key));
  const index = buildSignalIndex(free.map((r) => ({ ...r, _id: r.key })));

  const toCheck = unconnected
    .filter((c) => !autoIds.has(String(c._id)))
    .map((c) => {
      const candidates = matchAgainst(index, c)
        .slice(0, MAX_CANDIDATES)
        .map((m) => ({ ...spsByKey.get(m.id), signals: m.signals, score: m.score }));
      return {
        customerId: String(c._id),
        company: text(c.company),
        location: text(c.location),
        twin: (wantedBy.get(spsKey(c.company)) || []).length > 1,
        candidates
      };
    })
    // Customers with a real lead first, so a person starts with the easy ones.
    .sort((a, b) => (b.candidates[0]?.score || 0) - (a.candidates[0]?.score || 0)
      || a.company.localeCompare(b.company));

  return {
    total: customers.length,
    connected: connected.length,
    notInSps,
    auto,
    toCheck,
    spsRows: sps.length,
    // Names a customer already holds, so an answer can't claim one of them.
    takenKeys: [...taken],
    // SPS customers no Easy Stones customer is, or is yet claimed to be.
    spsUnclaimed: free.length
  };
};

/**
 * What a person's answers mean, checked against the plan so a request can't
 * connect a customer to a name that isn't offered or claim one name twice.
 *
 * @param {object} plan       planConnect's result
 * @param {object} answers    { customerId: spsKey | 'none' | 'later' }
 * @returns {{ connect: {customerId,key}[], notInSps: string[], rejected: {customerId,reason}[] }}
 */
export const resolveAnswers = (plan, answers = {}, spsByKey) => {
  const connect = [];
  const notInSps = [];
  const rejected = [];
  const claimed = new Set([...plan.auto.map((a) => a.key), ...(plan.takenKeys || [])]);
  const checkIds = new Set(plan.toCheck.map((t) => t.customerId));
  for (const [customerId, answer] of Object.entries(answers)) {
    if (!checkIds.has(customerId)) { rejected.push({ customerId, reason: 'not waiting for an answer' }); continue; }
    if (answer === CONNECT_CHOICES.NOT_SURE || answer == null || answer === '') continue;
    if (answer === CONNECT_CHOICES.NOT_IN_SPS) { notInSps.push(customerId); continue; }
    const key = spsKey(answer);
    if (!spsByKey.has(key)) { rejected.push({ customerId, reason: 'that name isn’t in this file' }); continue; }
    if (claimed.has(key)) { rejected.push({ customerId, reason: 'another customer already is that SPS customer' }); continue; }
    claimed.add(key);
    connect.push({ customerId, key });
  }
  return { connect, notInSps, rejected };
};

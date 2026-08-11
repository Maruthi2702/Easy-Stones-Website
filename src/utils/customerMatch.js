/**
 * One definition of "these two records are the same business".
 *
 * There were three before this file: the audit's, the bulk import's
 * (`normalizeStr`, which kept "Inc" and "and" and so let every one of the
 * known duplicates through), and none at all on the CRM's add-customer route.
 * Anything that decides whether a customer already exists imports from here, or
 * the next import quietly disagrees with the audit again.
 *
 * Nothing here touches the database. Pure functions over plain records.
 */

// Typed when someone had to put something in a required box. Not a business name.
const FILLER_NAME = /^(n\/?a|na|none|null|unknown|test|tbd|x+|-+|\.+)$/i;

/**
 * Addresses the system or a rep invented so the record would save. They are
 * unique by construction, which satisfies the unique index on email while
 * asserting nothing about who the customer is.
 */
const PLACEHOLDER_EMAIL =
  /@(temp-customer|easystones-client|example|test|invalid|local|placeholder|merged)\.|^(no-?reply|noemail|none|na|n\/a|test|placeholder|unknown)@/i;

// Shared by everyone, so two records at gmail.com are not related.
const FREE_MAIL = /^(gmail|yahoo|hotmail|outlook|aol|icloud|comcast|msn|live|me|mac|ymail|att|verizon)\./i;

/**
 * Our own address, in the customer's email field — the rep entered themselves.
 * Two customers "sharing" vishnu@easystones.com are not one business.
 */
const OWN_DOMAIN = /@easystones\.com$/i;

const fakePhone = (digits) =>
  !digits ||
  /^(\d)\1{9}$/.test(digits) ||          // 0000000000
  /^1?234567890?1?$/.test(digits) ||     // the keyboard walk everyone types
  /^555\d{7}$/.test(digits);

/**
 * "Take Me For Granite INC." and "take me for granite, inc" are one shop.
 * "and" goes with the ampersand it stands in for, so "Distinctive Tile & Stone"
 * and "DISTINCTIVE TILE AND STONE" reach the same key — the exact pair the old
 * import normalizer split.
 */
export const companyKey = (value = '') => {
  const raw = String(value).trim();
  if (!raw || FILLER_NAME.test(raw)) return '';
  const key = raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(inc|incorporated|llc|l l c|corp|corporation|co|company|ltd|limited|the|and)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return key.length < 3 ? '' : key;
};

/** Last ten digits, so (425) 606-8321 and 4256068321 are one number. */
export const phoneKey = (value = '') => {
  const digits = String(value).replace(/\D/g, '');
  const ten = digits.length >= 10 ? digits.slice(-10) : '';
  return fakePhone(ten) ? '' : ten;
};

/**
 * One field, sometimes several addresses. Thirteen records hold a comma-joined
 * list, which is why exact-match email clustering used to report nothing: one
 * record carries mikeh@ inside a pair and another carries it alone, and as
 * whole strings they never match.
 */
export const emailKeys = (value = '') =>
  String(value)
    .split(/[,;]/)
    .map(e => e.trim().toLowerCase())
    .filter(e => e.includes('@') && !PLACEHOLDER_EMAIL.test(e) && !OWN_DOMAIN.test(e));

export const domainKeys = (value = '') =>
  [...new Set(emailKeys(value).map(e => e.split('@')[1]).filter(d => d && !FREE_MAIL.test(d)))];

export const isPlaceholderEmail = (value = '') =>
  PLACEHOLDER_EMAIL.test(String(value)) || OWN_DOMAIN.test(String(value));

export const isFillerName = (value = '') => {
  const raw = String(value || '').trim();
  return !raw || FILLER_NAME.test(raw);
};

// ── the signals, and what each is worth ──────────────────────────────────────

export const SIGNALS = [
  { name: 'company name', prefix: 'c', keys: r => (companyKey(r.company) ? [companyKey(r.company)] : []) },
  { name: 'phone', prefix: 'p', keys: r => (phoneKey(r.phone) ? [phoneKey(r.phone)] : []) },
  { name: 'email', prefix: 'e', keys: r => emailKeys(r.email) },
  { name: 'email domain', prefix: 'd', keys: r => domainKeys(r.email) }
];

const BY_PREFIX = Object.fromEntries(SIGNALS.map(s => [s.prefix, s.name]));

/**
 * The signals are not equal. A shared address book entry is near proof; a shared
 * domain is barely a hint, since every branch of a four-shop dealer has one.
 */
const WEIGHT = { email: 3, 'company name': 2, phone: 2, 'email domain': 1 };

/**
 * Two independent facts agreeing. Below this a group is a question for a human,
 * not an instruction to merge — Strait Floors' four branches share a domain and
 * are four real customers.
 */
export const STRONG = 3;

export const scoreOf = (signals) => {
  const s = new Set(signals);
  // An exact email match carries its own domain; counting both scores one fact twice.
  if (s.has('email')) s.delete('email domain');
  return [...s].reduce((total, name) => total + WEIGHT[name], 0);
};

/** Every signal key a record holds, as 'prefix:key' strings. */
const keysOf = (record) =>
  SIGNALS.flatMap(sig => sig.keys(record).map(key => `${sig.prefix}:${key}`));

/**
 * 'c:acme' → Set(id). Built once, then read either way round: grouped against
 * itself to find duplicates already in the database, or probed one record at a
 * time to ask whether a row arriving from a spreadsheet is someone we hold.
 */
export const buildSignalIndex = (rows) => {
  const holders = new Map();
  for (const row of rows) addToSignalIndex(holders, row, row._id);
  return holders;
};

/**
 * Add one record to an index already built. An import needs this: a sheet can
 * name the same business on two rows, and the second row can only be recognised
 * as a repeat if the first is in the index by the time it is checked — even
 * though the first does not exist in the database yet, and so has no _id of its
 * own to be found by.
 */
export const addToSignalIndex = (index, record, id) => {
  const key_ = String(id);
  for (const key of keysOf(record)) {
    if (!index.has(key)) index.set(key, new Set());
    index.get(key).add(key_);
  }
  return index;
};

/**
 * Which indexed records does this one look like?
 *
 * Returns [{ id, signals, score }], strongest first. The record need not be in
 * the index and needs no _id — an unsaved spreadsheet row is a valid probe,
 * which is the whole point: an import decides create-vs-update on the same
 * evidence the audit uses to decide same-business-twice.
 */
export const matchAgainst = (index, record) => {
  const hits = new Map();                          // id → Set(signal name)
  for (const key of keysOf(record)) {
    for (const id of index.get(key) || []) {
      if (!hits.has(id)) hits.set(id, new Set());
      hits.get(id).add(BY_PREFIX[key[0]]);
    }
  }
  return [...hits]
    .map(([id, signals]) => ({ id, signals: [...signals], score: scoreOf(signals) }))
    .sort((a, b) => b.score - a.score);
};

/** Union-find, so a record linked by name to one and by phone to another lands in one group. */
const makeUnion = () => {
  const parent = new Map();
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x);
    while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); }
    return x;
  };
  return { find, join: (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); } };
};

/**
 * Group records that share any signal.
 * Returns [{ ids: string[], signals: string[], score, size }], strongest first.
 */
export const groupDuplicates = (rows) => {
  const holders = buildSignalIndex(rows);

  const union = makeUnion();
  for (const [, ids] of holders) {
    if (ids.size < 2) continue;
    const [first, ...rest] = ids;
    for (const id of rest) union.join(first, id);
  }

  const groups = new Map();
  for (const [key, ids] of holders) {
    if (ids.size < 2) continue;
    const root = union.find([...ids][0]);
    if (!groups.has(root)) groups.set(root, { ids: new Set(), signals: new Set() });
    const g = groups.get(root);
    ids.forEach(id => g.ids.add(id));
    g.signals.add(BY_PREFIX[key[0]]);
  }

  return [...groups.values()]
    .filter(g => g.ids.size > 1)
    .map(g => ({
      ids: [...g.ids],
      signals: [...g.signals],
      size: g.ids.size,
      score: scoreOf(g.signals)
    }))
    .sort((a, b) => b.score - a.score || b.size - a.size);
};

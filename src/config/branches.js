/**
 * The branches, and the clock each one lives on.
 *
 * The daily report belongs to a branch's own day: Dallas closes three hours
 * before Seattle does, and a job that submits "today" at 11:59 PM has to mean
 * eleven fifty-nine *there*. Kept in one place so the report API, the export and
 * the auto-submit job can't drift into disagreeing about which branches exist.
 */

// Keys must match Location.name exactly, including 'New york' (as stored —
// see the Location collection) rather than the properly-cased 'New York':
// isBranch/branchCode/branchZone below all look up by exact string, so a
// "corrected" key here would just silently miss on lookup for that branch.
export const BRANCHES = {
  'Seattle':        { code: 'SEA', timeZone: 'America/Los_Angeles' },
  'Spokane':        { code: 'SPO', timeZone: 'America/Los_Angeles' },
  'Salt Lake City': { code: 'SLC', timeZone: 'America/Denver' },
  'Dallas':         { code: 'DAL', timeZone: 'America/Chicago' },
  'Houston':        { code: 'HOU', timeZone: 'America/Chicago' },
  // Panhandle Florida, not the rest of the state — Fort Walton Beach sits
  // west of the Apalachicola River, which is Central time, not Eastern.
  'FWB':            { code: 'FWB', timeZone: 'America/Chicago' },
  'Atlanta':        { code: 'ATL', timeZone: 'America/New_York' },
  'Charleston':     { code: 'CHS', timeZone: 'America/New_York' },
  'Charlotte':      { code: 'CLT', timeZone: 'America/New_York' },
  'Greensboro':     { code: 'GSO', timeZone: 'America/New_York' },
  'Raleigh':        { code: 'RAL', timeZone: 'America/New_York' },
  'Richmond':       { code: 'RIC', timeZone: 'America/New_York' },
  'New york':       { code: 'NYC', timeZone: 'America/New_York' }
};

export const BRANCH_NAMES = Object.keys(BRANCHES);

export const isBranch = (name) => Object.prototype.hasOwnProperty.call(BRANCHES, name);

/** 'SEA' — the short form the sheet's transfer lines are written in. */
export const branchCode = (name) =>
  BRANCHES[name]?.code || String(name || '').slice(0, 3).toUpperCase();

export const branchZone = (name) => BRANCHES[name]?.timeZone || 'America/Los_Angeles';

/**
 * A branch's own wall clock right now: its calendar date and minutes past
 * midnight. Read from Intl rather than computed from a UTC offset, so daylight
 * saving is the platform's problem and not ours.
 */
export const branchNow = (name, at = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: branchZone(name),
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(at).reduce((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {});

  // Some platforms render midnight as hour 24 under hour12: false.
  const hour = Number(parts.hour) % 24;

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: hour * 60 + Number(parts.minute)
  };
};

/** 'YYYY-MM-DD' shifted by whole days, staying a calendar date throughout. */
export const shiftDate = (iso, days) => {
  const [y, m, d] = iso.split('-').map(Number);
  const at = new Date(Date.UTC(y, m - 1, d + days));
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}-${String(at.getUTCDate()).padStart(2, '0')}`;
};

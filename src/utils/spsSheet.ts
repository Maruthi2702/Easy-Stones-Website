import type { Loose } from '../types/records.ts';
/**
 * What an SPS export is, checked before it is trusted: the file check shown at
 * the top of the customer import, and the coverage line ("4,255 of 4,476 SPS
 * customers are in Easy Stones"). Step 2 of the SPS import redesign; the plan
 * is the "SPS Import Redesign" artifact.
 *
 * SPS's Name is unique on every row of its export (4,476 of 4,476 in the
 * October All Locations file, case ignored), so it is the identity: a
 * customer's `sps.key` is `spsKey(Name)`, and the database refuses two
 * customers holding the same one (the partial unique index in
 * src/models/Customer.ts). Pure and DOM-free; tested in spsSheet.test.js.
 */

/**
 * The identity of an SPS customer: its Name, trimmed and lowercase — and
 * nothing more. Spaces inside the name are kept on purpose: SPS holds two
 * different customers (Converse and Dallas) named "MARTINEZ  GRANITE AND
 * MARBLE" and "Martinez granite and marble", which differ only by a double
 * space, and folding them together would lose one. '' for no name.
 */
export const spsKey = (name: string) => String(name ?? '').trim().toLowerCase();

const names = (list: string, max = 50) => list.slice(0, max);

/**
 * Is this file safe to import from? `blocking` problems mean nothing should be
 * written; `warnings` are for a person to read.
 *
 * @param {object} input
 * @param {object[]} input.rows     the sheet's customer rows, keyed by heading
 * @param {object}   input.mapping  field → heading
 * @param {object}   [input.parse]  readCustomerSheet's `parse` ({ malformed })
 */
export const checkSheet = ({ rows, mapping, parse = {} }: Loose) => {
  const blocking = [];
  const warnings = [];
  const malformed = Array.isArray(parse.malformed) ? parse.malformed : [];

  if (malformed.length) {
    blocking.push({
      code: 'unreadable-rows',
      message: `${malformed.length} row${malformed.length === 1 ? '' : 's'} couldn't be read — their cells don't line up with the column headings. Download the file from SPS again.`,
      rows: names(malformed.map((m: Loose) => m.position))
    });
  }

  const nameColumn = mapping?.company || null;
  const keyed = new Map();
  const nameless = [];
  rows.forEach((row: Loose, i: number) => {
    const rowNumber = i + 2; // row 1 is the header
    const key = nameColumn ? spsKey(row[nameColumn]) : '';
    if (!key) { nameless.push(rowNumber); return; }
    keyed.set(key, [...(keyed.get(key) || []), rowNumber]);
  });

  if (!nameColumn) {
    blocking.push({ code: 'no-name-column', message: 'No Name column was found, so customers can’t be told apart. Choose the column that holds the customer name.', rows: [] });
  }
  const repeated = [...keyed].filter(([, list]) => list.length > 1);
  if (repeated.length) {
    warnings.push({
      code: 'repeated-names',
      message: `${repeated.length} customer name${repeated.length === 1 ? ' appears' : 's appear'} more than once in this file. SPS shouldn't produce that.`,
      rows: names(repeated.flatMap(([, list]) => list))
    });
  }
  if (nameColumn && nameless.length) {
    warnings.push({
      code: 'nameless-rows',
      message: `${nameless.length} row${nameless.length === 1 ? ' has' : 's have'} no customer name.`,
      rows: names(nameless)
    });
  }

  return {
    ok: blocking.length === 0,
    rowsRead: rows.length,
    distinctNames: keyed.size,
    blocking,
    warnings
  };
};

/**
 * How many of this file's SPS customers does Easy Stones hold already? A
 * customer counts when it carries the SPS key, or — until every customer has
 * been connected — when its company name is the SPS name (capitals ignored). Read-only; the import's own plan is unaffected.
 *
 * @param {object[]} input.existing  customers held: { company, sps? }
 */
export const spsCoverage = ({ rows, mapping, existing }: Loose) => {
  const nameColumn = mapping?.company || null;
  const held = new Set();
  for (const c of existing) {
    if (c?.sps?.key) held.add(c.sps.key);
    const byName = spsKey(c?.company);
    if (byName) held.add(byName);
  }
  let total = 0;
  const absent = [];
  rows.forEach((row: unknown, i: number) => {
    const key = nameColumn ? spsKey(row[nameColumn]) : '';
    if (!key) return;
    total++;
    if (!held.has(key)) absent.push({ rowNumber: i + 2, name: String(row[nameColumn]).trim() });
  });
  return { total, present: total - absent.length, absent: absent.length, absentRows: absent.slice(0, 200) };
};

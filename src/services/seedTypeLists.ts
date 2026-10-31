import VisitType from '../models/VisitType.ts';
import ResourceType from '../models/ResourceType.ts';
import Customer from '../models/Customer.ts';
import type { Model } from 'mongoose';
import type { Loose } from '../types/records.ts';
import type { VisitTypeFields } from '../utils/typeLists.ts';

/*
 * One-time start of the two admin-managed lists. The lists live in the
 * database (src/routes/typeLists.ts); this only fills an EMPTY collection with
 * what the app offered before they moved there, so nothing changes on the day
 * it ships. After that the database is the only source — editing this file
 * changes nothing, and a manager's changes are never overwritten.
 *
 * Names a customer's old visits / resources already carry that the starting
 * list doesn't have are added too, hidden (`active: false`): they stay known to
 * filters and reports and a manager can show them, but they don't land in
 * everyone's Add dropdown.
 */

const NO_FOLLOW_UP: VisitTypeFields = { notes: true, outcome: false, followUp: 'none' };
const FOLLOW_UP_ONLY: VisitTypeFields = { notes: false, outcome: false, followUp: 'always' };
const FULL: VisitTypeFields = { notes: true, outcome: true, followUp: 'optional' };

const STARTING_VISIT_TYPES: [string, string, VisitTypeFields][] = [
  ['Quick Note', 'Quick note', NO_FOLLOW_UP],
  ['Follow up Notes', 'Follow-up notes', FOLLOW_UP_ONLY],
  ['Scheduled in Person Sales Meeting', 'Scheduled in-person sales meeting', FULL],
  ['Unscheduled in Person Sales Call', 'Unscheduled in-person sales call', FULL],
  ['Resource Placement', 'Resource placement', FULL],
  ['Resource Update', 'Resource update', FULL],
  ['Formal Presentation', 'Formal presentation', FULL],
  ['Important Remote Meeting/Call', 'Important remote meeting / call', FULL],
  ['In Office Administration Day', 'In-office admin day', FULL],
  ['Personal Time Off', 'Personal time off', FULL]
];

const STARTING_RESOURCE_TYPES = [
  'Moda Tower 2024 version 2', 'Moda Tabletop 2024 version 1', 'Ascale Tower 2023 version1',
  'Ascale Tabletop 2023 version 1', 'Ascale A&D Box 2023 version 1', 'Radianz Tower 2023 version 1',
  'Radianz Tabletop 2023 version 1', 'Moda Tower 2023 version 1', 'Moda Misc. Samples',
  'Radianz Misc. Samples', 'Ascale Misc. Samples', 'Moda Sample Binder SouthV1 12',
  'Moda Sample Binder SouthEast V1 12', 'Moda Sample Binder NorthWest V1 12',
  '2025V3 Moda Tower Updated 24>25', '2025V3 Moda Tower'
];

/** The family the Resources list used to read from a name's words; only used to fill the starting records. */
export const startingFamilyOf = (name: unknown) => {
  const t = String(name || '').toLowerCase();
  if (/binder/.test(t)) return 'binder';
  if (/tower/.test(t)) return 'tower';
  if (/tabletop|table top/.test(t)) return 'tabletop';
  if (/sample/.test(t)) return 'samples';
  return 'other';
};

const clean = (list: unknown[] | null | undefined): string[] =>
  [...new Set((list || []).map((s) => String(s || '').trim()).filter(Boolean))];

const insert = async (Model: Model<Loose>, docs: Loose[]): Promise<number> => {
  if (!docs.length) return 0;
  try {
    const out = await Model.insertMany(docs, { ordered: false });
    return out.length;
  } catch (error) {
    // Another instance seeded at the same moment: its rows win.
    const e = error as { code?: number; writeErrors?: unknown; insertedDocs?: unknown[] };
    if (e?.code === 11000 || e?.writeErrors) return e.insertedDocs?.length || 0;
    throw error;
  }
};

export async function seedTypeLists() {
  if ((await VisitType.estimatedDocumentCount()) === 0) {
    const used = clean(await Customer.distinct('visits.purpose'))
      .filter((n) => !/^Resource Placement:/i.test(n));
    const known = new Set(STARTING_VISIT_TYPES.map(([name]) => name.toLowerCase()));
    const extra = used.filter((n) => !known.has(n.toLowerCase()));
    const docs = [
      ...STARTING_VISIT_TYPES.map(([name, label, fields], order) => ({ name, label, order, system: true, active: true, fields })),
      ...extra.map((name, i) => ({ name, label: name, order: STARTING_VISIT_TYPES.length + i, system: false, active: false, fields: FULL }))
    ];
    const n = await insert(VisitType, docs);
    if (n) console.log(`🗂️ Seeded ${n} visit types (${extra.length} hidden, from existing visits)`);
  }

  if ((await ResourceType.estimatedDocumentCount()) === 0) {
    const used = clean(await Customer.distinct('resources.resourceType'));
    const known = new Set(STARTING_RESOURCE_TYPES.map((n) => n.toLowerCase()));
    const extra = used.filter((n) => !known.has(n.toLowerCase()));
    const docs = [
      ...STARTING_RESOURCE_TYPES.map((name, order) => ({ name, label: name, order, active: true, family: startingFamilyOf(name) })),
      ...extra.map((name, i) => ({ name, label: name, order: STARTING_RESOURCE_TYPES.length + i, active: false, family: startingFamilyOf(name) }))
    ];
    const n = await insert(ResourceType, docs);
    if (n) console.log(`🗂️ Seeded ${n} resource types (${extra.length} hidden, from existing resources)`);
  }
}

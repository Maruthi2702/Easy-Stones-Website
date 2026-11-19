/**
 * One-off: import the old CRM's activity export as customer visits
 * (rules and the owner's calls: src/utils/activityImport.ts).
 *
 *   node scripts/import-activity-visits.ts <file.xlsx>                  # dry run: report only
 *   node scripts/import-activity-visits.ts <file.xlsx> --confirm c.json # also use confirmed look-alike matches
 *   node scripts/import-activity-visits.ts <file.xlsx> --apply         # write
 *   node scripts/import-activity-visits.ts <file.xlsx> --undo          # remove exactly the visits this file's plan would add
 *
 * Reads customers, visit types and staff through the data layers (MongoDB or Postgres by
 * DB_CUSTOMERS / DB_STAFF, so on Render it reads the live Postgres). Writes go through
 * `customerData.addVisit`, the Add visit route's own save, with the rep as
 * createdBy and no calendar entry. A visit's id comes from its row, so a second
 * run finds what the first saved and adds nothing. The report is written next to
 * the file as <file>.report.json: the matches to confirm, everything skipped and why.
 * `c.json` is { "account name": "customer id" } for the matches a person checked.
 */
import fs from 'node:fs';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import XLSX from 'xlsx';
import * as customerData from '../src/db/customers/index.ts';
import { newId } from '../src/db/ids.ts';
import { areaOn } from '../src/db/appDb.ts';
import * as staffData from '../src/db/staff/index.ts';
import { planActivityImport, TAG_TYPES, UNTAGGED_TYPES } from '../src/utils/activityImport.ts';

dotenv.config();
XLSX.set_fs(fs); // SheetJS's ES-module build reads files only once it is given fs

const args = process.argv.slice(2);
const confirmAt = args.indexOf('--confirm');
const confirmFile = confirmAt >= 0 ? args[confirmAt + 1] : '';
const file = args.find((a, i) => !a.startsWith('--') && i !== (confirmAt >= 0 ? confirmAt + 1 : -1)) ?? '';
const apply = args.includes('--apply');
const undo = args.includes('--undo');

const nowLocal = () => new Date().toISOString().replace('Z', '');

const main = async () => {
  if (!file || !fs.existsSync(file)) throw new Error('Give the .xlsx file as the first argument.');
  // The sheet itself, or the same rows as JSON (small enough to paste into a shell).
  const rows: Record<string, unknown>[] = file.endsWith('.json')
    ? JSON.parse(fs.readFileSync(file, 'utf8'))
    : (() => { const sheet = XLSX.readFile(file); return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet.Sheets[sheet.SheetNames[0]], { defval: '' }); })();

  // MongoDB is only needed while an area is still on it.
  const needsMongo = areaOn('customers') !== 'postgres' || areaOn('staff') !== 'postgres';
  if (needsMongo) await mongoose.connect(process.env.MONGO_URI!);
  // Staff are on Postgres since 2026-11-16 (DB_STAFF); MongoDB's users are a stale, read-only copy.
  const staff = (await staffData.findUsers({}, { select: 'username displayName isActive' }))
    .map((u) => ({ id: String(u._id), name: String(u.displayName || u.username || ''), active: u.isActive !== false }));
  const customers = (await customerData.dropdownCustomers()).map((c) => ({ id: String(c._id ?? c.id), company: c.company, contactName: c.contactName, phone: '' }));
  const wanted = [...new Set([...Object.values(TAG_TYPES), ...Object.values(UNTAGGED_TYPES)])];
  const visitTypes: string[] = [];
  for (const name of wanted) { const t = await customerData.visitTypeNamed(name); if (t && t.active !== false) visitTypes.push(name); }
  const confirmed = confirmFile ? JSON.parse(fs.readFileSync(confirmFile, 'utf8')) : {};

  const plan = planActivityImport({ rows, customers, staff: staff.filter((s) => s.active), visitTypes, confirmed });
  const missingTypes = wanted.filter((t) => !visitTypes.includes(t));

  console.log(`${rows.length} rows, ${customers.length} customers, ${staff.length} staff.`);
  if (missingTypes.length) console.log(`Visit types missing or hidden (their rows are skipped): ${missingTypes.join(', ')}`);
  console.log(`\nWould import ${plan.planned.length} visits:`);
  for (const [t, n] of Object.entries(plan.byType).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${t}`);
  const perUser: Record<string, number> = {};
  plan.planned.forEach((p) => { perUser[p.userName] = (perUser[p.userName] ?? 0) + 1; });
  console.log('By rep:', perUser);
  console.log(`Skipped ${plan.skipped.length} (${plan.repeats} exact repeats). Matches to confirm: ${plan.toConfirm.length}.`);
  if (Object.keys(plan.unknownUsers).length) console.log('No staff login for:', plan.unknownUsers);
  const reasons: Record<string, number> = {};
  plan.skipped.forEach((s) => { const k = s.reason.replace(/".*"/, '…'); reasons[k] = (reasons[k] ?? 0) + 1; });
  console.log('Skipped because:', reasons);

  fs.writeFileSync(`${file}.report.json`, JSON.stringify({ toConfirm: plan.toConfirm, skipped: plan.skipped, unknownUsers: plan.unknownUsers }, null, 2));
  console.log(`\nReport: ${file}.report.json`);

  if (undo) {
    // Only visits whose id is one this plan makes (an id comes from the row's own content), and only if still there.
    let removed = 0, gone = 0, refused = 0;
    for (const p of plan.planned) {
      if (!(await customerData.savedVisit(p.customerId, p.visit._id))) { gone++; continue; }
      const result = await customerData.deleteVisitWithResource({
        customerId: p.customerId, visitId: p.visit._id,
        actor: { id: 'activity-import-undo', permissions: ['delete_all_visits'] } as never,
        team: async () => ({}) as never,
        performer: { id: p.userId, name: p.userName }, performedByRole: 'admin', logId: newId()
      });
      if (result.outcome === 'deleted') removed++; else refused++;
    }
    console.log(`\nUndo: removed ${removed}, already gone ${gone}, refused ${refused}.`);
  } else if (!apply) { console.log('Dry run — nothing written. Re-run with --apply to save.'); }
  else {
    let saved = 0, already = 0, failed = 0;
    for (const p of plan.planned) {
      try {
        const result = await customerData.addVisit({
          customerId: p.customerId,
          visit: { ...p.visit, customerContactName: p.customerName },
          calendar: { userId: null, dropInId: newId() },
          log: { id: newId(), performedBy: p.userId, performedByName: p.userName, details: { purpose: p.visit.purpose, date: p.visit.date, source: 'activity-import' } },
          now: nowLocal
        });
        if (result.kind === 'saved') saved++; else if (result.kind === 'alreadySaved') already++; else { failed++; console.log(`  row ${p.row}: customer not found`); }
      } catch (e) { failed++; console.log(`  row ${p.row}: ${(e as Error).message}`); }
    }
    console.log(`\nSaved ${saved}, already there ${already}, failed ${failed}.`);
  }
  if (needsMongo) await mongoose.disconnect();
};

main().catch((e) => { console.error(e); process.exit(1); });

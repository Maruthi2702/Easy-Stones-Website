/**
 * Permits records (2026-10-11), in their own collections and reached only
 * through src/permits/.
 *
 *   Permit       one issued building permit that counts as a lead, keyed by
 *                source + permit number. Every field is the source's own value.
 *   PermitRun    one pull from one source: when, how far back, what it saw,
 *                and the error if it failed. The page's "last updated" line.
 *   PermitCheck  one month of one source's permits checked permit by permit:
 *                against the county's own monthly report once it's out
 *                (Whatcom, King County), and until then (the month so far)
 *                against a second, separate search of the source.
 *   Contractor   one Washington contractor license, copied from the state's
 *                L&I registry (2026-10-14): business name, phone, address,
 *                trade, active or not. Keyed by license number.
 *   ContractorName  an exact business name looked up in that registry, and
 *                the one active license it belongs to ('' when none, or more
 *                than one) — for sources that publish names, not licenses.
 */
import mongoose from 'mongoose';
import { SOURCE_IDS, CATEGORY_IDS } from './permitRules.js';

const { Schema } = mongoose;

const contactSchema = new Schema({
  role: { type: String, default: '' },
  kind: { type: String, default: 'other' },
  company: { type: String, default: '' },
  name: { type: String, default: '' },
  phone: { type: String, default: '' },
  email: { type: String, default: '' },
  address: { type: String, default: '' },
  // The contractor's WA L&I license number, when the source gives it (MyBuildingPermit).
  license: { type: String, default: undefined }
}, { _id: false });

const permitSchema = new Schema({
  source: { type: String, enum: SOURCE_IDS, required: true },
  permitNumber: { type: String, required: true },
  externalId: { type: String, default: '' },
  category: { type: String, enum: CATEGORY_IDS, required: true },
  type: { type: String, default: '' },
  subtype: { type: String, default: '' },
  status: { type: String, default: '' },
  appliedOn: { type: String, default: null },
  // Preserve a previously issued record if the source later clears its date.
  // It stays in the audit history, but is no longer an issued lead.
  issuedOn: { type: String, default: null },
  finaledOn: { type: String, default: null },
  expiresOn: { type: String, default: null },
  address: { type: String, default: '' },
  city: { type: String, default: '' },
  zip: { type: String, default: '' },
  parcel: { type: String, default: '' },
  projectName: { type: String, default: '' },
  description: { type: String, default: '' },
  valuation: { type: Number, default: null },
  sqft: { type: Number, default: null },
  units: { type: Number, default: null },
  contacts: { type: [contactSchema], default: [] },
  // Whether the county's detail record (valuation, contacts) has been read.
  detailsAt: { type: Date, default: null },
  sourceUrl: { type: String, default: '' },
  finalOnly: { type: Boolean, default: false },
  // The app's own times. (No automatic updatedAt: it would change on every
  // pull and make every permit look changed — see sync.js save().)
  firstSeenAt: { type: Date, default: Date.now },
  lastSeenAt: { type: Date, default: Date.now }
}, { collection: 'permits' });

permitSchema.index({ source: 1, permitNumber: 1 }, { unique: true });
permitSchema.index({ issuedOn: -1, permitNumber: -1 });
permitSchema.index({ category: 1, issuedOn: -1 });

const permitRunSchema = new Schema({
  source: { type: String, enum: SOURCE_IDS, required: true },
  kind: { type: String, enum: ['backfill', 'daily', 'manual'], required: true },
  since: { type: String, required: true },
  startedAt: { type: Date, required: true },
  finishedAt: { type: Date, default: null },
  ok: { type: Boolean, default: false },
  error: { type: String, default: '' },
  by: { type: String, default: '' },
  pages: { type: Number, default: 0 },
  seen: { type: Number, default: 0 },        // every permit the source returned
  leads: { type: Number, default: 0 },       // the ones that are lead types
  added: { type: Number, default: 0 },
  updated: { type: Number, default: 0 },
  detailErrors: { type: Number, default: 0 },
  // The newest issue date the source had — how current its data is.
  latestIssuedOn: { type: String, default: null },
  // Building permit types nobody has sorted into a category or the skip list yet.
  // (A sub-schema, because a plain { type: String } would declare the field's type.)
  unsortedTypes: { type: [new Schema({ type: { type: String }, count: Number }, { _id: false })], default: [] }
}, { collection: 'permit_runs' });

permitRunSchema.index({ source: 1, startedAt: -1 });

const permitCheckSchema = new Schema({
  source: { type: String, enum: SOURCE_IDS, default: 'whatcom' },
  month: { type: String, required: true },          // 'YYYY-MM'
  // 'report': against the county's published monthly report (final).
  // 'search': the month so far, against a second, separate search of the
  // source — replaced by the report check once the county posts the report.
  method: { type: String, enum: ['report', 'search'], default: 'report' },
  // Report permits whose value / city / units the report filled in (King County).
  filled: { type: Number, default: 0 },
  // Report leads the pull didn't have, saved from the report itself (King County).
  addedFromReport: { type: [String], default: [] },
  reportTitle: { type: String, default: '' },
  reportUrl: { type: String, default: '' },
  checkedAt: { type: Date, required: true },
  inReport: { type: Number, default: 0 },
  matched: { type: Number, default: 0 },
  missingFromApp: { type: [String], default: [] },
  notInReport: { type: [String], default: [] },
  // Month so far ('search'): how many the second search found, and permits it didn't find again.
  inSearch: { type: Number, default: 0 },
  notFoundAgain: { type: [String], default: [] },
  // Lead-type report permits the county's public search doesn't have at all —
  // the county's difference, not the pull's (since 2026-10-15; before, these
  // were also in missingFromApp).
  notInCountySearch: { type: [String], default: [] },
  // Leads the app has under the month that the report leaves out because the
  // county's search says they aren't issued yet ("Fees Due").
  notIssuedYet: { type: [String], default: [] },
  // Report permits whose issue date the county has changed since (the app has them under the new date).
  datesMoved: { type: [String], default: [] },
  // Report permits the public search hides that aren't lead types (fire gate permits, say).
  notPublic: { type: [String], default: [] },
  ok: { type: Boolean, default: false },
  error: { type: String, default: '' }
}, { collection: 'permit_checks' });

permitCheckSchema.index({ source: 1, month: 1 }, { unique: true });

const contractorSchema = new Schema({
  license: { type: String, required: true },
  businessName: { type: String, default: '' },
  phone: { type: String, default: '' },
  address: { type: String, default: '' },
  city: { type: String, default: '' },
  state: { type: String, default: '' },
  zip: { type: String, default: '' },
  licenseType: { type: String, default: '' },
  specialty: { type: String, default: '' },
  specialty2: { type: String, default: '' },
  status: { type: String, default: '' },          // ACTIVE, EXPIRED, SUSPENDED… as the state writes it
  expiresOn: { type: String, default: null },
  principal: { type: String, default: '' },
  ubi: { type: String, default: '' },
  // Not in the registry when last asked (a typo on the permit, or a license since removed).
  notFound: { type: Boolean, default: false },
  refreshedAt: { type: Date, required: true }
}, { collection: 'permit_contractors' });

contractorSchema.index({ license: 1 }, { unique: true });

const contractorNameSchema = new Schema({
  name: { type: String, required: true },          // the exact business name, upper case
  license: { type: String, default: '' },          // '' — no active license by that exact name, or several
  candidates: { type: Number, default: 0 },        // active licenses found under the name
  checkedAt: { type: Date, required: true }
}, { collection: 'permit_contractor_names' });

contractorNameSchema.index({ name: 1 }, { unique: true });

export const Permit = mongoose.models.Permit || mongoose.model('Permit', permitSchema);
export const PermitRun = mongoose.models.PermitRun || mongoose.model('PermitRun', permitRunSchema);
export const PermitCheck = mongoose.models.PermitCheck || mongoose.model('PermitCheck', permitCheckSchema);
export const Contractor = mongoose.models.PermitContractor || mongoose.model('PermitContractor', contractorSchema);
export const ContractorName = mongoose.models.PermitContractorName || mongoose.model('PermitContractorName', contractorNameSchema);

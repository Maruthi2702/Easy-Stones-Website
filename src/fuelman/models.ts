import mongoose from 'mongoose';
import type { Model } from 'mongoose';
import type { Assignment, CategoryOverride, CostFact, Disposition, ParsedReport, ReportReview } from './types.ts';
export interface Actor { id: string; name: string }
export interface ReportRecord {
  _id: mongoose.Types.ObjectId; __v: number; scopeKey: string; fileHash: string; contentHash: string; periodKey: string;
  filename: string; parsed: ParsedReport; revision: number; status: 'draft' | 'posted' | 'superseded' | 'reversed';
  dispositions: Disposition[]; overrides: CategoryOverride[]; importedAt: Date; importedBy: Actor;
  frozenReview?: ReportReview; publishedAt?: Date; note?: string;
}
export interface AssignmentRecord extends Omit<Assignment, 'id'> { _id: mongoose.Types.ObjectId; scopeKey: string; updatedBy: Actor; updatedAt: Date }
export interface ProfileRecord { _id: mongoose.Types.ObjectId; name: string; kind: 'driver' | 'shared'; createdBy: Actor }
export interface SourceRecord { _id: mongoose.Types.ObjectId; reportId: mongoose.Types.ObjectId; pdf: Buffer }
export interface FactRecord extends CostFact { reportId: mongoose.Types.ObjectId; month: string; scopeKey: string }
export interface StateRecord { _id: string; revision: number }
export interface PeriodRecord { _id: string; scopeKey: string; month: string; publishedReportId?: mongoose.Types.ObjectId | null; closed: boolean; closedBy?: Actor; closedAt?: Date }
export interface AuditRecord { reportId: mongoose.Types.ObjectId; scopeKey: string; action: string; at: Date; actor: Actor; note: string; detail: unknown }
const { Schema } = mongoose;
const person = { id: String, name: String };
const report = new Schema<ReportRecord>({ scopeKey: { type: String, required: true }, fileHash: { type: String, required: true, unique: true },
  contentHash: { type: String, required: true }, periodKey: { type: String, required: true }, filename: String, parsed: Schema.Types.Mixed,
  revision: Number, status: { type: String, enum: ['draft', 'posted', 'superseded', 'reversed'], default: 'draft' },
  dispositions: [Schema.Types.Mixed], overrides: [Schema.Types.Mixed], importedAt: Date, importedBy: person,
  frozenReview: Schema.Types.Mixed, publishedAt: Date, note: String,
}, { collection: 'acct_fuelman_reports', optimisticConcurrency: true });
report.index({ scopeKey: 1, contentHash: 1 }, { unique: true });
report.index({ periodKey: 1, revision: 1 }, { unique: true });
report.index({ importedAt: -1 });
// The reports list: newest month first, then newest revision.
report.index({ 'parsed.month': -1, revision: -1, importedAt: -1, _id: -1 });
const assignment = new Schema<AssignmentRecord>({ scopeKey: { type: String, required: true }, externalId: { type: String, required: true },
  reportedName: String, driverKey: String, driverName: String, from: String, to: String, allocations: [{ _id: false, location: String, basisPoints: Number }],
  updatedBy: person, updatedAt: Date,
}, { collection: 'acct_fuelman_assignments' });
assignment.index({ scopeKey: 1, externalId: 1, from: 1 }, { unique: true });
const profile = new Schema<ProfileRecord>({ name: { type: String, required: true }, kind: { type: String, enum: ['driver', 'shared'], required: true }, createdBy: person }, { collection: 'acct_fuelman_profiles' });
const source = new Schema<SourceRecord>({ reportId: { type: Schema.Types.ObjectId, required: true, unique: true }, pdf: { type: Buffer, required: true, select: false } }, { collection: 'acct_fuelman_sources' });
const fact = new Schema<FactRecord>({ reportId: { type: Schema.Types.ObjectId, required: true }, month: String, scopeKey: String,
  externalId: String, driverKey: String, driverName: String, location: String, category: String, amountCents: Number, sourceLine: Number, date: String,
}, { collection: 'acct_fuelman_expenses' });
fact.index({ reportId: 1, sourceLine: 1, location: 1 }, { unique: true });
fact.index({ month: 1, location: 1 });
fact.index({ location: 1, reportId: 1 }); // a branch reader's list
fact.index({ month: 1, reportId: 1 }); // a month's published facts
const state = new Schema<StateRecord>({ _id: String, revision: { type: Number, default: 0 } }, { collection: 'acct_fuelman_state', versionKey: false });
const period = new Schema<PeriodRecord>({ _id: String, scopeKey: String, month: String, publishedReportId: Schema.Types.ObjectId,
  closed: { type: Boolean, default: false }, closedBy: person, closedAt: Date }, { collection: 'acct_fuelman_periods', versionKey: false });
period.index({ month: 1, publishedReportId: 1 }); // which reports are published for a month
const audit = new Schema<AuditRecord>({ reportId: Schema.Types.ObjectId, scopeKey: String, action: String, at: Date, actor: person, note: String, detail: Schema.Types.Mixed }, { collection: 'acct_fuelman_history' });
audit.index({ reportId: 1, at: -1 });
const model = <T>(name: string, schema: mongoose.Schema<T>): Model<T> => (mongoose.models[name] as Model<T> | undefined) || mongoose.model<T>(name, schema);
export const FuelReport = model('FuelManReport', report);
export const FuelAssignment = model('FuelManAssignment', assignment);
export const FuelProfile = model('FuelManProfile', profile);
export const FuelSource = model('FuelManSource', source);
export const FuelExpense = model('FuelManExpense', fact);
export const FuelState = model('FuelManState', state);
export const FuelPeriod = model('FuelManPeriod', period);
export const FuelAudit = model('FuelManAudit', audit);
export const FUEL_MODELS = [FuelReport, FuelAssignment, FuelProfile, FuelSource, FuelExpense, FuelState, FuelPeriod, FuelAudit];

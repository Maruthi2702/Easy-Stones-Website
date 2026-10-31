// Legacy BSON records remain flexible; runtime schemas still validate every write.
import type { Loose } from '../types/records.ts';
import mongoose from 'mongoose';

/**
 * One Daily Work Report per branch per day — the spreadsheet the branches used
 * to keep, as a record.
 *
 * Figures the system already knows (visitor count from check-ins, assigned
 * deliveries and pick-ups from the schedule) are recomputed on read and stored
 * alongside what was typed. Storing both matters: `assigned` is what the board
 * said at the time the day was submitted, and it must not silently change
 * afterwards because someone edited a delivery in the following week.
 */

const transferLineSchema = new mongoose.Schema<Loose>({
  fromTo: { type: String, default: '' },   // 'SEA — SLC', origin first regardless of direction
  // The transfer's number ('14956'). A line is one transfer: filled from its
  // ticket on a ticket line, typed on one added by hand — so the same
  // transfer added twice shows up (src/utils/transferDirection.ts). Added
  // 2026-10-15, when ticket lines went from one per route to one per ticket.
  transferNumber: { type: String, default: '' },
  count: { type: Number, default: 0 },
  slabs: { type: Number, default: 0 },
  // Set when the line was built from transfer tickets rather than typed, so the
  // UI can mark it and a re-open can refresh it.
  auto: { type: Boolean, default: false },
  // 'out' if this branch is shipping it, 'in' if this branch is receiving it.
  // Defaults to 'out' so every line stored before this field existed keeps its
  // original meaning without a migration.
  direction: { type: String, enum: ['out', 'in'], default: 'out' },
  // Mirrored from the Delivery ticket at derive time — see receivedAt/receivedBy
  // on the Delivery model. Only meaningful on an 'in' line; frozen at whatever
  // it was the moment the report is submitted, like every other derived figure.
  received: { type: Boolean, default: false },
  receivedAt: { type: Date, default: null },
  receivedBy: { type: String, default: '' },
  // The Delivery ticket a ticket line is, so "mark received" in the UI has
  // something to act on, and so its typed slabs stay matched to it when it has
  // no transfer number (transferLineKey). Saved with the line since
  // 2026-10-15; recomputed on every load. Must be declared here — Mongoose
  // silently drops any field assigned to a subdocument that isn't in its
  // schema, so without this the derived array would arrive at the client with
  // ticketIds stripped and the button would have nothing to call.
  ticketIds: { type: [String], default: [] }
}, { _id: false });

const containerLineSchema = new mongoose.Schema<Loose>({
  poNumber: { type: String, default: '' },  // blank continues the line above
  material: { type: String, default: '' },
  slabs: { type: Number, default: 0 }
}, { _id: false });

const countPairSchema = new mongoose.Schema<Loose>({
  assigned: { type: Number, default: 0 },
  // Shown on the sheet as "Slabs" — how many went out on the day's deliveries
  // and pick-ups. Named `capacity` because that is what the column asked for
  // first, and the stored days would need migrating to rename it.
  // null until someone counts them.
  capacity: { type: Number, default: null }
}, { _id: false });

const dailyReportSchema = new mongoose.Schema<Loose>({
  // 'YYYY-MM-DD'. A calendar date, never an instant — a report belongs to the
  // branch's day, not to whoever happens to open it from another timezone.
  date: { type: String, required: true, index: true },
  location: { type: String, required: true, index: true },

  status: {
    type: String,
    enum: ['draft', 'submitted', 'closed'],
    default: 'draft',
    index: true
  },

  /**
   * null means nobody has said yet; 0 means somebody said none.
   *
   * The distinction is the whole point of the difference between a blank sheet
   * and a finished one — a day with no payments recorded is not the same fact
   * as a day on which no money was taken, and the report should not quietly
   * turn the first into the second. Figures the system derives (homeowners
   * from check-ins, assigned from the schedule) are always known, so they stay
   * plain numbers.
   */
  visitors: {
    homeowners: { type: Number, default: 0 },
    fabricators: { type: Number, default: null },
    designers: { type: Number, default: null }
  },

  deliveries: { type: countPairSchema, default: () => ({}) },
  pickups: { type: countPairSchema, default: () => ({}) },
  // How many orders came back, and how many slabs they were. Auto-filled from
  // the day's return tickets when there are any, and hand-editable either way —
  // see applyDerived in src/routes/dailyReports.ts for why a quiet day is left
  // blank rather than written as 0.
  returns: { type: Number, default: null },
  returnsSlabs: { type: Number, default: null },
  sinks: { type: Number, default: null },

  transfers: { type: [transferLineSchema], default: [] },
  containers: { type: [containerLineSchema], default: [] },

  // Methods and their order: src/utils/dailyReportPayments.ts. ACH added
  // 2026-10-15 — older reports have no ach, which reads as unsaid.
  payments: {
    ach: { count: { type: Number, default: null }, amount: { type: Number, default: null } },
    cash: { count: { type: Number, default: null }, amount: { type: Number, default: null } },
    card: { count: { type: Number, default: null }, amount: { type: Number, default: null } },
    check: { count: { type: Number, default: null }, amount: { type: Number, default: null } }
  },

  notes: { type: String, default: '' },

  // Who touched it, so a submitted report means something.
  submittedBy: { type: String, default: '' },
  submittedAt: { type: Date, default: null },
  // Signed off by the 11:59 PM job rather than by a person. Kept apart from
  // submittedBy so the UI can say so plainly: an automatic submission means the
  // figures stand as they were left, not that anybody checked them.
  autoSubmitted: { type: Boolean, default: false },
  reopenedBy: { type: String, default: '' },
  reopenedAt: { type: Date, default: null },
  reopenReason: { type: String, default: '' },
  updatedBy: { type: String, default: '' }
}, { timestamps: true });

// One report per branch per day — the constraint the whole feature rests on.
dailyReportSchema.index({ date: 1, location: 1 }, { unique: true });
// The month view reads a location's days in reverse date order.
dailyReportSchema.index({ location: 1, date: -1 });

const DailyReport = mongoose.models.DailyReport || mongoose.model('DailyReport', dailyReportSchema);
export default DailyReport;

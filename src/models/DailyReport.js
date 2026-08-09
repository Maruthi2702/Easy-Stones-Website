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

const transferLineSchema = new mongoose.Schema({
  fromTo: { type: String, default: '' },   // 'SEA — SLC'
  count: { type: Number, default: 0 },
  slabs: { type: Number, default: 0 },
  // Set when the line was built from transfer tickets rather than typed, so the
  // UI can mark it and a re-open can refresh it.
  auto: { type: Boolean, default: false }
}, { _id: false });

const containerLineSchema = new mongoose.Schema({
  poNumber: { type: String, default: '' },  // blank continues the line above
  material: { type: String, default: '' },
  slabs: { type: Number, default: 0 }
}, { _id: false });

const countPairSchema = new mongoose.Schema({
  assigned: { type: Number, default: 0 },
  capacity: { type: Number, default: 0 }
}, { _id: false });

const dailyReportSchema = new mongoose.Schema({
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

  visitors: {
    homeowners: { type: Number, default: 0 },
    fabricators: { type: Number, default: 0 },
    designers: { type: Number, default: 0 }
  },

  deliveries: { type: countPairSchema, default: () => ({}) },
  pickups: { type: countPairSchema, default: () => ({}) },
  returns: { type: Number, default: 0 },
  sinks: { type: Number, default: 0 },

  transfers: { type: [transferLineSchema], default: [] },
  containers: { type: [containerLineSchema], default: [] },

  payments: {
    cash: { count: { type: Number, default: 0 }, amount: { type: Number, default: 0 } },
    card: { count: { type: Number, default: 0 }, amount: { type: Number, default: 0 } },
    check: { count: { type: Number, default: 0 }, amount: { type: Number, default: 0 } }
  },

  notes: { type: String, default: '' },

  // Who touched it, so a submitted report means something.
  submittedBy: { type: String, default: '' },
  submittedAt: { type: Date, default: null },
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

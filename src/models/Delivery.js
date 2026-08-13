import mongoose from 'mongoose';

const deliverySchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  customerId: { type: String, default: null, index: true },
  truckId: { type: String, default: '', index: true },
  // Empty when the order is waiting on the customer for an ETA. Such deliveries
  // sit in the Pending list instead of a week on the board, and get a date the
  // moment one is agreed.
  date: { type: String, default: '', index: true },
  time: { type: String, default: '09:00 AM' },
  customerName: { type: String, required: true },
  address: { type: String, default: '' },
  salesRepName: { type: String, default: '' },
  status: { type: String, enum: ['pending', 'scheduled', 'completed', 'delayed'], default: 'pending' },
  notes: { type: String, default: '' },
  soNumber: { type: String, default: '' },
  invoiceNumber: { type: String, default: '' },
  routeNumber: { type: Number, default: 1 },
  location: { type: String, default: '' },
  driver: { type: String, default: '' },

  // New Delivery Classification & 3rd Party Freight Fields
  deliveryType: { type: String, enum: ['jobsite', 'transfer', 'will_call'], default: 'jobsite' },
  transferDestination: { type: String, default: '' },
  pickupInfo: { type: String, default: '' },
  carrierName: { type: String, default: '' },
  proNumber: { type: String, default: '' },
  freightFee: { type: Number, default: 0 },

  // How many slabs went out on this ticket. Feeds the Daily Work Report's
  // Slabs totals (see deriveFromSystem in src/routes/dailyReports.js) instead
  // of those being retyped by hand.
  numberOfSlabs: { type: Number, min: 0, default: 0 },

  // Packing List File — the original the office uploads. Never overwritten by
  // signing: re-signing has to start from a clean copy, so the signed version
  // lives separately under pod.signedPdfUrl.
  packingListUrl: { type: String, default: '' },
  packingListFilename: { type: String, default: '' },
  packingListPublicId: { type: String, default: '' },

  // Proof of Delivery (ePOD) Digital Signatures & Photos
  pod: {
    signeeName: { type: String, default: '' },
    driverName: { type: String, default: '' },
    customerSignature: { type: String, default: '' },
    driverSignature: { type: String, default: '' },
    // Each pad stamps its own time when the pen lifts, so the certificate can
    // show when the customer signed and when the driver countersigned rather
    // than one shared submission time.
    customerSignedAt: { type: Date, default: null },
    driverSignedAt: { type: Date, default: null },
    signedAt: { type: Date, default: null },
    photos: [{ type: String }],
    notes: { type: String, default: '' },
    // Signed PDF = original packing list with signatures stamped on last page
    signedPdfUrl: { type: String, default: '' },
    signedPdfFilename: { type: String, default: '' },
    signedPdfPublicId: { type: String, default: '' },

    // Whether a real, complete proof exists. Derived server-side on every write
    // and never accepted from a client — the board's list projection strips the
    // signature fields, so this is what lets a card render an honest badge
    // without shipping signature data to every open board.
    verified: { type: Boolean, default: false, index: true },

    // Set when someone with clear_pod_signatures wipes a wrong signature. The
    // delivery stays 'completed' (the material did arrive); the card reads
    // "Awaiting re-sign" until a new signature replaces it.
    clearedAt: { type: Date, default: null },
    clearedBy: { type: String, default: '' },
    clearReason: { type: String, default: '' }
  }
}, {
  timestamps: true,
  strict: false
});

const Delivery = mongoose.models.Delivery || mongoose.model('Delivery', deliverySchema);
export default Delivery;

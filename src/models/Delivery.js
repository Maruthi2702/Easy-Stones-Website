import mongoose from 'mongoose';

const deliverySchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  customerId: { type: String, default: null, index: true },
  truckId: { type: String, default: '', index: true },
  date: { type: String, required: true, index: true },
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

  // Packing List File
  packingListUrl: { type: String, default: '' },
  packingListFilename: { type: String, default: '' },

  // Proof of Delivery (ePOD) Digital Signatures & Photos
  pod: {
    signeeName: { type: String, default: '' },
    driverName: { type: String, default: '' },
    customerSignature: { type: String, default: '' },
    driverSignature: { type: String, default: '' },
    signedAt: { type: Date, default: null },
    photos: [{ type: String }],
    notes: { type: String, default: '' },
    // Signed PDF = original packing list with signatures stamped on last page
    signedPdfUrl: { type: String, default: '' },
    signedPdfFilename: { type: String, default: '' }
  }
}, {
  timestamps: true,
  strict: false
});

const Delivery = mongoose.models.Delivery || mongoose.model('Delivery', deliverySchema);
export default Delivery;

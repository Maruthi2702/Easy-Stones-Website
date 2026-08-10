import mongoose from 'mongoose';

const lostSaleSchema = new mongoose.Schema({
  customerName: {
    type: String,
    required: true,
    trim: true
  },
  customerId: {
    type: String,
    default: null
  },
  productName: {
    type: String,
    required: true,
    trim: true
  },
  productId: {
    type: String,
    default: null
  },
  lengthInches: {
    type: Number,
    default: 0
  },
  widthInches: {
    type: Number,
    default: 0
  },
  sfPerSlab: {
    type: Number,
    default: 0
  },
  slabsCount: {
    type: Number,
    default: 1
  },
  totalSf: {
    type: Number,
    default: 0
  },
  pricePerSf: {
    type: Number,
    default: 0
  },
  totalLostValue: {
    type: Number,
    default: 0
  },
  reason: {
    type: String,
    // Keep in step with REASON_OPTIONS in components/sales/LostSaleModal.jsx.
    enum: ['Out of Stock', 'Price Too High', 'Lead Time', 'Color / Pattern Match', 'Quality / Spec Issue', 'Competitor Discount', 'Customer Cancelled', 'Other'],
    default: 'Out of Stock'
  },
  location: {
    type: String,
    default: 'Seattle'
  },
  competitorName: {
    type: String,
    default: ''
  },
  notes: {
    type: String,
    default: ''
  },
  salesRepName: {
    type: String,
    default: ''
  },
  salesRepId: {
    type: String,
    default: null
  },
  date: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

lostSaleSchema.index({ date: -1 });
lostSaleSchema.index({ location: 1 });
lostSaleSchema.index({ reason: 1 });

export default mongoose.model('LostSale', lostSaleSchema);

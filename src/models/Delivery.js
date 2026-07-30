import mongoose from 'mongoose';

const deliverySchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  truckId: { type: String, required: true, index: true },
  date: { type: String, required: true, index: true },
  time: { type: String, default: '09:00 AM' },
  customerName: { type: String, required: true },
  address: { type: String, default: '' },
  salesRepName: { type: String, default: '' },
  status: { type: String, enum: ['pending', 'scheduled', 'completed', 'delayed'], default: 'pending' },
  notes: { type: String, default: '' },
  soNumber: { type: String, required: true },
  invoiceNumber: { type: String, default: '' },
  routeNumber: { type: Number, default: 1 },
  location: { type: String, default: '' },
  driver: { type: String, default: '' }
}, {
  timestamps: true
});

const Delivery = mongoose.models.Delivery || mongoose.model('Delivery', deliverySchema);
export default Delivery;

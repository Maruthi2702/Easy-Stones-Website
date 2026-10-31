// Legacy BSON records remain flexible; runtime schemas still validate every write.
import type { Loose } from '../types/records.ts';
import mongoose from 'mongoose';

const truckSchema = new mongoose.Schema<Loose>({
  id: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true },
  driver: { type: String, default: '' },
  color: { type: String, default: '#D4AF37' },
  location: { type: String, default: '' }
}, {
  timestamps: true
});

const Truck = mongoose.models.Truck || mongoose.model('Truck', truckSchema);
export default Truck;

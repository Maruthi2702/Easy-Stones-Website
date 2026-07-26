import mongoose from 'mongoose';

const truckSchema = new mongoose.Schema({
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

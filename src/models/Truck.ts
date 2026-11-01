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

const Truck: mongoose.Model<mongoose.InferSchemaType<typeof truckSchema>> = (mongoose.models.Truck as mongoose.Model<mongoose.InferSchemaType<typeof truckSchema>> | undefined) || mongoose.model('Truck', truckSchema);
export default Truck;

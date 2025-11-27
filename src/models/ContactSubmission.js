import mongoose from 'mongoose';

const contactSchema = new mongoose.Schema({
  name: { type: String, required: true },
  company: { type: String },
  email: { type: String, required: true },
  phone: { type: String },
  message: { type: String, required: true },
  status: { type: String, enum: ['new', 'read', 'replied'], default: 'new' },
  emailSent: { type: Boolean, default: false }
}, { timestamps: true });

export default mongoose.model('ContactSubmission', contactSchema, 'contact-us');

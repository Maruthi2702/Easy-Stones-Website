import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const visitSchema = new mongoose.Schema({
  date: { type: Date },
  createdBy: String,
  createdAt: { type: Date }
});

const customerSchema = new mongoose.Schema({
  company: String,
  visits: [visitSchema]
});

const Customer = mongoose.model('Customer', customerSchema);

async function check() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected');
  
  const customer = await Customer.findOne({ company: '360 Marble and Granite LLC' });
  if (!customer) {
    console.log('Customer not found');
    process.exit(1);
  }
  
  console.log('Customer ID:', customer._id);
  console.log('Visits found:', customer.visits.length);
  
  const today = new Date('2026-02-03');
  customer.visits.forEach(v => {
    console.log('---');
    console.log('Visit ID:', v._id);
    console.log('Date:', v.date);
    console.log('Date Type:', typeof v.date);
    console.log('isDateObj:', v.date instanceof Date);
    console.log('CreatedBy:', v.createdBy);
    console.log('CreatedBy Type:', typeof v.createdBy);
    console.log('CreatedAt:', v.createdAt);
  });
  
  process.exit(0);
}

check();

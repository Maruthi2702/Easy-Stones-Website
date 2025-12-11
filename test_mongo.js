import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;

console.log('Testing MongoDB connection...');
console.log('URI (masked):', MONGO_URI.replace(/\/\/.*:.*@/, '//***:***@'));

mongoose.connect(MONGO_URI, {
  serverSelectionTimeoutMS: 10000,
})
.then(() => {
  console.log('✅ MongoDB connected successfully!');
  process.exit(0);
})
.catch(err => {
  console.error('❌ MongoDB connection failed:', err.message);
  console.error('Error name:', err.name);
  if (err.reason) {
    console.error('Reason:', err.reason);
  }
  process.exit(1);
});

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Customer from './src/models/Customer.js';

dotenv.config();

const mongoOptions = {
  serverSelectionTimeoutMS: 5000,
};

async function checkCustomers() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/easy-stones', mongoOptions);
    console.log('Connected.');

    const count = await Customer.countDocuments();
    console.log(`Total Customers: ${count}`);

    if (count > 0) {
      const customers = await Customer.find().limit(3);
      console.log('Sample Customers:', JSON.stringify(customers, null, 2));
    }

    await mongoose.disconnect();
  } catch (error) {
    console.error('Error:', error);
  }
}

checkCustomers();

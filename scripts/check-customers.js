import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Customer from '../src/models/Customer.js';

dotenv.config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/easy-stones')
  .then(async () => {
    console.log('✅ Connected to MongoDB');
    
    try {
      const customers = await Customer.find({});
      console.log(`Found ${customers.length} customers:`);
      customers.forEach(c => {
        console.log(`- ${c.firstName} ${c.lastName} (${c.email})`);
      });
    } catch (error) {
      console.error('Error fetching customers:', error);
    } finally {
      mongoose.disconnect();
    }
  })
  .catch(err => console.error('❌ MongoDB connection error:', err));

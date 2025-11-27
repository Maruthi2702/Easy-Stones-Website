import mongoose from 'mongoose';
import Customer from '../src/models/Customer.js';
import dotenv from 'dotenv';

dotenv.config();

const checkCustomers = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    const customers = await Customer.find({});
    console.log(`Found ${customers.length} customers`);

    customers.forEach((c, i) => {
      console.log(`Customer ${i + 1}:`, {
        id: c._id,
        firstName: c.firstName,
        lastName: c.lastName,
        email: c.email
      });

      if (!c.firstName || !c.lastName || !c.email) {
        console.error('⚠️ INVALID DATA FOUND:', c);
      }
    });

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
};

checkCustomers();

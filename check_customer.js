import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Customer from './src/models/Customer.js';

dotenv.config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/easy-stones')
  .then(async () => {
    console.log('Connected to MongoDB');
    
    const customer = await Customer.findOne({ 
      $or: [{ email: 'krish@easystones.com' }, { email: 'krish' }] 
    });
    
    if (customer) {
      console.log('Found Customer:', { id: customer._id, email: customer.email });
    } else {
      console.log('No Customer found with email krish@easystones.com or krish');
    }

    process.exit();
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });

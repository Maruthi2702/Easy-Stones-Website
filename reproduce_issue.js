import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Customer from './src/models/Customer.js';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/easy-stones';

mongoose.connect(MONGO_URI, {
  serverSelectionTimeoutMS: 30000,
  connectTimeoutMS: 30000,
  family: 4,
})
  .then(async () => {
    console.log('Connected to MongoDB');

    try {
        console.log('Finding customer (lean)...');
        // Fetch visits field specifically to check size
        const customer = await Customer.findOne({}).select('visits');
        
        if (!customer) {
            console.log('No customers found');
            process.exit(0);
        }
        console.log('Found customer:', customer._id);
        console.log('Visits Array Length:', customer.visits ? customer.visits.length : 0);

        // Check if any visit has huge data
        if (customer.visits) {
             let maxImageSize = 0;
             customer.visits.forEach(v => {
                 if (v.image && JSON.stringify(v.image).length > maxImageSize) {
                     maxImageSize = JSON.stringify(v.image).length;
                 }
             });
             console.log('Max Visit Image Size (approx chars):', maxImageSize);
        }
        
    } catch (err) {
        console.error('Operation failed:', err);
    } finally {
        process.exit();
    }
  })
  .catch(err => {
    console.error('Connection error:', err);
    process.exit(1);
  });

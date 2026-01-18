import mongoose from 'mongoose';
import Customer from './src/models/Customer.js';
import dotenv from 'dotenv';
dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/easy-stones';

async function findVisitWithImage() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');
    
    const customers = await Customer.find({ 'visits.image': { $exists: true, $not: { $size: 0 }, $ne: null } });
    
    if (customers.length === 0) {
      console.log('No customers found with visits having images.');
    } else {
      for (const customer of customers) {
        for (const visit of customer.visits) {
          if (visit.image && (Array.isArray(visit.image) ? visit.image.length > 0 : true)) {
            console.log(`Customer: ${customer.company || customer.contactName} (${customer._id})`);
            console.log(`Visit ID: ${visit._id}`);
            console.log(`Image Type: ${typeof visit.image}`);
            if (Array.isArray(visit.image)) {
              console.log(`Image Count: ${visit.image.length}`);
              console.log(`First Image Start: ${visit.image[0].substring(0, 50)}...`);
            } else {
              console.log(`Image Start: ${visit.image.substring(0, 50)}...`);
            }
            console.log('---');
          }
        }
      }
    }
    
    await mongoose.disconnect();
  } catch (error) {
    console.error('Error:', error);
  }
}

findVisitWithImage();

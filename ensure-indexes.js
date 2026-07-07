import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import Customer from './src/models/Customer.js';
import Product from './src/models/Product.js';
import User from './src/models/User.js';
import OfficeCheckIn from './src/models/OfficeCheckIn.js';
import ActivityLog from './src/models/ActivityLog.js';
import Schedule from './src/models/Schedule.js';

const mongoOptions = {
  serverSelectionTimeoutMS: 5000,
};

async function ensureIndexes() {
  try {
    console.log('🔗 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/easy-stones', mongoOptions);
    console.log('✅ Connected to MongoDB');

    console.log('🔨 Creating Customer indexes...');
    await Customer.createIndexes();
    console.log('✅ Customer indexes created successfully');

    console.log('🔨 Creating Product indexes...');
    await Product.createIndexes();
    console.log('✅ Product indexes created successfully');

    console.log('🔨 Creating User indexes...');
    await User.createIndexes();
    console.log('✅ User indexes created successfully');

    console.log('🔨 Creating OfficeCheckIn indexes...');
    await OfficeCheckIn.createIndexes();
    console.log('✅ OfficeCheckIn indexes created successfully');

    console.log('🔨 Creating ActivityLog indexes...');
    await ActivityLog.createIndexes();
    console.log('✅ ActivityLog indexes created successfully');

    console.log('🔨 Creating Schedule indexes...');
    await Schedule.createIndexes();
    console.log('✅ Schedule indexes created successfully');

    const customerIdx = await Customer.collection.getIndexes();
    const productIdx = await Product.collection.getIndexes();
    const userIdx = await User.collection.getIndexes();
    const checkinIdx = await OfficeCheckIn.collection.getIndexes();
    const logIdx = await ActivityLog.collection.getIndexes();
    const scheduleIdx = await Schedule.collection.getIndexes();

    console.log('📋 Customer Indexes:', Object.keys(customerIdx));
    console.log('📋 Product Indexes:', Object.keys(productIdx));
    console.log('📋 User Indexes:', Object.keys(userIdx));
    console.log('📋 OfficeCheckIn Indexes:', Object.keys(checkinIdx));
    console.log('📋 ActivityLog Indexes:', Object.keys(logIdx));
    console.log('📋 Schedule Indexes:', Object.keys(scheduleIdx));

    await mongoose.disconnect();
    console.log('👋 Disconnected from MongoDB');
  } catch (error) {
    console.error('❌ Error creating indexes:', error);
    process.exit(1);
  }
}

ensureIndexes();

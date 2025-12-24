import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import Customer from './src/models/Customer.js';

const mongoOptions = {
  serverSelectionTimeoutMS: 5000,
};

async function ensureIndexes() {
  try {
    console.log('🔗 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/easy-stones', mongoOptions);
    console.log('✅ Connected to MongoDB');

    console.log('🔨 Creating indexes...');
    await Customer.createIndexes();
    console.log('✅ All indexes created successfully');

    const indexes = await Customer.collection.getIndexes();
    console.log('📋 Current indexes:', Object.keys(indexes));

    await mongoose.disconnect();
    console.log('👋 Disconnected from MongoDB');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

ensureIndexes();

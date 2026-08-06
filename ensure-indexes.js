import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import Customer from './src/models/Customer.js';
import Product from './src/models/Product.js';
import User from './src/models/User.js';
import OfficeCheckIn from './src/models/OfficeCheckIn.js';
import ActivityLog from './src/models/ActivityLog.js';
import Schedule from './src/models/Schedule.js';
import Delivery from './src/models/Delivery.js';
import Truck from './src/models/Truck.js';
import LostSale from './src/models/LostSale.js';
import Location from './src/models/Location.js';
import Role from './src/models/Role.js';

const mongoOptions = {
  serverSelectionTimeoutMS: 5000,
};

// Keep this list in step with the index sync in server.js startup — a model
// missing from both runs with no indexes at all, since autoIndex is disabled.
const MODELS = [
  ['Customer', Customer],
  ['Product', Product],
  ['User', User],
  ['OfficeCheckIn', OfficeCheckIn],
  ['ActivityLog', ActivityLog],
  ['Schedule', Schedule],
  ['Delivery', Delivery],
  ['Truck', Truck],
  ['LostSale', LostSale],
  ['Location', Location],
  ['Role', Role]
];

async function ensureIndexes() {
  let failures = 0;
  try {
    console.log('🔗 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/easy-stones', mongoOptions);
    console.log('✅ Connected to MongoDB');

    for (const [name, model] of MODELS) {
      console.log(`🔨 Creating ${name} indexes...`);
      try {
        await model.createIndexes();
        console.log(`✅ ${name} indexes created successfully`);
      } catch (err) {
        failures++;
        console.error(`⚠️ ${name} index creation failed: ${err.message}`);
      }
    }

    console.log('');
    for (const [name, model] of MODELS) {
      const idx = await model.collection.getIndexes();
      console.log(`📋 ${name} Indexes:`, Object.keys(idx));
    }

    await mongoose.disconnect();
    console.log('👋 Disconnected from MongoDB');
    if (failures > 0) {
      console.log(`\n⚠️ Completed with ${failures} model(s) failing — see warnings above.`);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error creating indexes:', error);
    process.exit(1);
  }
}

ensureIndexes();

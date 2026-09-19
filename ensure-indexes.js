import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
// The one list of models needing indexes, shared with server.js's own startup
// sync — see src/config/indexedModels.js for why this used to be two
// hand-maintained arrays that had already drifted apart (this file was
// missing DailyReport, InventoryItem, InventorySalesRecord, ContactSubmission,
// SalesResource and SalesDashboardResource; server.js's own list was missing
// some of the same ones).
import { INDEXED_MODELS } from './src/config/indexedModels.js';

const mongoOptions = {
  serverSelectionTimeoutMS: 5000,
};

async function ensureIndexes() {
  let failures = 0;
  try {
    console.log('🔗 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/easy-stones', mongoOptions);
    console.log('✅ Connected to MongoDB');

    for (const [name, model] of INDEXED_MODELS) {
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
    for (const [name, model] of INDEXED_MODELS) {
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

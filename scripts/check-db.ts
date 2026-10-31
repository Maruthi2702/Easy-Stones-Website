import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const checkDb = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');
    
    const dbName = mongoose.connection.db.databaseName;
    console.log(`📂 Database Name: ${dbName}`);
    
    const collections = await mongoose.connection.db.listCollections().toArray();
    console.log('📚 Collections:', collections.map(c => c.name));
    
    // Check count in products collection
    const count = await mongoose.connection.db.collection('products').countDocuments();
    console.log(`🔢 Products count: ${count}`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
};

checkDb();

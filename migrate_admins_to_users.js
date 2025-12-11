import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/easy-stones')
  .then(async () => {
    console.log('Connected to MongoDB');
    
    try {
      const db = mongoose.connection.db;
      
      // Check if 'admins' collection exists
      const collections = await db.listCollections().toArray();
      const hasAdmins = collections.some(c => c.name === 'admins');
      const hasUsers = collections.some(c => c.name === 'users');

      if (hasAdmins) {
        if (hasUsers) {
          console.log('Both "admins" and "users" collections exist. Merging or skipping...');
          // For safety, we won't drop users. We'll just log.
          // In a real scenario, we might want to merge.
          // But here, we assume we want to RENAME.
          console.log('Skipping rename to avoid overwriting "users".');
        } else {
          console.log('Renaming "admins" to "users"...');
          await db.collection('admins').rename('users');
          console.log('✅ Collection renamed successfully.');
        }
      } else {
        console.log('"admins" collection not found. Maybe already renamed?');
      }
    } catch (error) {
      console.error('Migration error:', error);
    }

    process.exit();
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });

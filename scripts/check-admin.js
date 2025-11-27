import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Admin from '../src/models/Admin.js';

dotenv.config();

async function checkAdmin() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    const admins = await Admin.find({});
    console.log(`Found ${admins.length} admin(s):`);
    
    admins.forEach(admin => {
      console.log({
        id: admin._id,
        username: admin.username,
        email: admin.email,
        passwordHash: admin.password.substring(0, 15) + '...', // Show partial hash
        createdAt: admin.createdAt
      });
    });

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkAdmin();

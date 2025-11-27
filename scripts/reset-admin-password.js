import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import Admin from '../src/models/Admin.js';
import dotenv from 'dotenv';

dotenv.config();

const resetPassword = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const username = process.argv[2] || 'krish';
    const newPassword = process.argv[3] || 'password123';
    
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    const result = await Admin.findOneAndUpdate(
      { username },
      { password: hashedPassword, loginAttempts: 0 },
      { new: true, upsert: true }
    );

    if (result) {
      console.log(`✓ Password for '${username}' reset successfully.`);
      console.log(`  New password: ${newPassword}`);
    } else {
      console.log('Admin user not found.');
    }

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('Error resetting password:', error);
    process.exit(1);
  }
};

resetPassword();

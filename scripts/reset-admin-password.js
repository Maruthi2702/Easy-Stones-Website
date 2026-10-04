import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import Admin from '../src/models/Admin.js';
import dotenv from 'dotenv';

dotenv.config();

const resetPassword = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    // Both are required: this used to fall back to resetting 'krish' to
    // 'password123' (and to create that account if it didn't exist) when run
    // without arguments, and printed the new password to the terminal.
    const [username, newPassword] = process.argv.slice(2);
    if (!username || !newPassword) {
      console.error('Usage: node scripts/reset-admin-password.js <username> <new-password>');
      await mongoose.disconnect();
      process.exit(1);
    }
    if (newPassword.length < 8) {
      console.error('Choose a password of at least 8 characters.');
      await mongoose.disconnect();
      process.exit(1);
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Never creates an account — a typo in the username shouldn't make a new admin.
    const result = await Admin.findOneAndUpdate(
      { username },
      { password: hashedPassword, loginAttempts: 0 },
      { new: true }
    );

    if (result) {
      console.log(`✓ Password for '${username}' reset.`);
    } else {
      console.log(`No admin named '${username}' — nothing changed.`);
    }

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('Error resetting password:', error);
    process.exit(1);
  }
};

resetPassword();

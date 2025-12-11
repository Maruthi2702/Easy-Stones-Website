import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from './src/models/User.js';

dotenv.config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/easy-stones', {
  serverSelectionTimeoutMS: 30000,
  connectTimeoutMS: 30000,
  family: 4,
})
  .then(async () => {
    console.log('Connected to MongoDB');
    
    const user = await User.findOne({ username: 'krish' });
    if (!user) {
      console.log('User krish not found');
      process.exit(1);
    }

    console.log('Resetting password for krish...');
    user.password = 'admin123'; // Temporary password
    // The pre-save hook in User.js will hash this
    await user.save();
    
    console.log('✅ Password reset successfully to: admin123');
    process.exit();
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });

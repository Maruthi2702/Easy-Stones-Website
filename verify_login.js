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
    
    const username = 'krish';
    const password = 'admin123';
    
    console.log(`Attempting to verify user: ${username} with password: ${password}`);
    
    const user = await User.findOne({ username: username.toLowerCase() });
    
    if (!user) {
      console.log('❌ User not found');
      process.exit(1);
    }
    
    console.log('User found:', user.username);
    console.log('Stored hash:', user.password);
    
    const isMatch = await user.comparePassword(password);
    
    if (isMatch) {
      console.log('✅ Password verification SUCCESSFUL');
    } else {
      console.log('❌ Password verification FAILED');
    }
    
    process.exit();
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });

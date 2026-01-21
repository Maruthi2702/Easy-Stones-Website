import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from './src/models/User.js';

dotenv.config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/easy-stones')
  .then(async () => {
    console.log('Connected to MongoDB');
    
    const result = await User.updateOne(
      { username: 'krish' },
      { $set: { role: 'admin' } }
    );
    
    console.log('Update result:', result);
    
    const updatedUser = await User.findOne({ username: 'krish' });
    console.log('Updated User:', { username: updatedUser ? updatedUser.username : 'Not found', role: updatedUser ? updatedUser.role : 'N/A' });

    process.exit();
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });

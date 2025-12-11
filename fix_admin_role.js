import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Admin from './src/models/Admin.js';

dotenv.config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/easy-stones')
  .then(async () => {
    console.log('Connected to MongoDB');
    
    const result = await Admin.updateOne(
      { username: 'krish' },
      { $set: { role: 'admin' } }
    );
    
    console.log('Update result:', result);
    
    const updatedUser = await Admin.findOne({ username: 'krish' });
    console.log('Updated User:', { username: updatedUser.username, role: updatedUser.role });

    process.exit();
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });

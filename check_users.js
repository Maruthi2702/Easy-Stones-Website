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
    
    const users = await User.find({});
    console.log('Found Users:', users.length);
    
    users.forEach(u => {
      console.log('User:', {
        id: u._id,
        username: u.username,
        email: u.email,
        role: u.role,
        hasPassword: !!u.password,
        passwordHashStart: u.password ? u.password.substring(0, 10) : 'N/A'
      });
    });

    process.exit();
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });

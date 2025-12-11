import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Admin from './src/models/Admin.js';

dotenv.config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/easy-stones')
  .then(async () => {
    console.log('Connected to MongoDB');
    
    const admins = await Admin.find({});
    console.log('Current Admins:', admins.map(a => ({ 
      username: a.username, 
      role: a.role, 
      id: a._id 
    })));

    // Fix: If any admin has no role or 'sales_rep' (and they should be admin), update them.
    // For now, I'll just list them.
    
    process.exit();
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Admin from '../src/models/Admin.js';
import readline from 'readline';

dotenv.config();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function setupAdmin() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/easy-stones');
    console.log('✅ Connected to MongoDB');

    // Check if admin already exists
    const existingAdmin = await Admin.findOne({});
    if (existingAdmin) {
      console.log('⚠️  Admin user already exists!');
      console.log(`Username: ${existingAdmin.username}`);
      
      rl.question('Do you want to create another admin? (y/n): ', async (answer) => {
        if (answer.toLowerCase() !== 'y') {
          console.log('Setup cancelled.');
          process.exit(0);
        }
        await promptForCredentials();
      });
    } else {
      await promptForCredentials();
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

async function promptForCredentials() {
  rl.question('Enter admin username: ', (username) => {
    rl.question('Enter admin password (min 6 characters): ', async (password) => {
      rl.question('Enter admin email (optional): ', async (email) => {
        try {
          if (!username || !password) {
            console.log('❌ Username and password are required!');
            process.exit(1);
          }

          if (password.length < 6) {
            console.log('❌ Password must be at least 6 characters!');
            process.exit(1);
          }

          const admin = new Admin({
            username: username.trim(),
            password: password,
            email: email.trim() || undefined
          });

          await admin.save();
          console.log('✅ Admin user created successfully!');
          console.log(`Username: ${admin.username}`);
          console.log('Password is hashed and stored securely.');
          
          process.exit(0);
        } catch (error) {
          console.error('❌ Error creating admin:', error.message);
          process.exit(1);
        }
      });
    });
  });
}

setupAdmin();

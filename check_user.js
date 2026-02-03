import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const userSchema = new mongoose.Schema({
  username: String
});

const User = mongoose.model('User', userSchema);

async function check() {
  await mongoose.connect(process.env.MONGO_URI);
  const user = await User.findOne({ username: 'maruthi' });
  if (user) {
    console.log('User ID:', user._id);
  } else {
    console.log('User not found');
  }
  process.exit(0);
}

check();

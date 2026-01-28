import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Product from './src/models/Product.js';

dotenv.config();

async function checkProduct() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    const product = await Product.findOne({ name: /Taj Mahal Polish/i });
    if (!product) {
      console.log('Product not found');
    } else {
      console.log('Product Found:', product.name);
      console.log('Bundles:', JSON.stringify(product.bundles, null, 2));
    }
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await mongoose.disconnect();
  }
}

checkProduct();

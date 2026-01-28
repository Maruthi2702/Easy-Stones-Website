import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Product from './src/models/Product.js';

dotenv.config();

async function testSave() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    const product = await Product.findOne({ name: /Taj Mahal Polish/i });
    if (!product) {
      console.log('Product not found');
      return;
    }

    console.log('Original Product found');
    
    // Add a test bundle with location and avgSize
    const testBundle = {
      bundleNumber: 'TEST-123',
      location: 'DALLAS, TX',
      avgSize: '100" X 50"',
      images: []
    };

    product.bundles.push(testBundle);
    await product.save();
    console.log('Saved product with test bundle');

    // Fetch again to verify
    const updated = await Product.findOne({ name: /Taj Mahal Polish/i });
    const savedBundle = updated.bundles.find(b => b.bundleNumber === 'TEST-123');
    console.log('Saved Bundle Details:', JSON.stringify(savedBundle, null, 2));

    if (savedBundle.location === 'DALLAS, TX' && savedBundle.avgSize === '100" X 50"') {
      console.log('✅ SUCCESS: Schema supports location and avgSize');
    } else {
      console.log('❌ FAILURE: Fields were stripped!');
    }

    // Cleanup: remove the test bundle
    updated.bundles = updated.bundles.filter(b => b.bundleNumber !== 'TEST-123');
    await updated.save();
    console.log('Cleanup complete');

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await mongoose.disconnect();
  }
}

testSave();

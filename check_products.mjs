import mongoose from 'mongoose';
import Product from './src/models/Product.js';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/easystones';

mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('Connected to MongoDB');
    
    // Get all products with their color variants
    const products = await Product.find({
      name: { $in: ['Enigma', 'Enigma Gold', 'Giotto'] }
    }).lean();
    
    console.log('\n=== PRODUCTS FOUND ===\n');
    
    products.forEach(product => {
      console.log(`\nProduct: ${product.name}`);
      console.log(`Colors available: ${product.colors?.length || 0}`);
      
      if (product.colors && product.colors.length > 0) {
        product.colors.forEach((color, index) => {
          console.log(`\n  Color ${index + 1}: ${color.name}`);
          console.log(`  Image: ${color.image ? 'YES ✓' : 'NO ✗'}`);
          if (color.image) {
            console.log(`  Image path: ${color.image.substring(0, 50)}...`);
          }
        });
      } else {
        console.log('  No colors found!');
      }
    });
    
    process.exit(0);
  })
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });

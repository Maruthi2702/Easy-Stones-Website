import mongoose from 'mongoose';

const productSchema = new mongoose.Schema({
  id: { type: Number, required: true, unique: true },
  name: { type: String, required: true },
  category: { type: String, required: true },
  collectionType: { type: String },
  availability: { type: String, default: 'In Stock' },
  image: { type: String },
  colors: [{
    name: { type: String, required: true },
    image: { type: String }
  }],
  installedImages: [{ type: String }], // Array to store up to 2 installed images
  isNewArrival: { type: Boolean, default: false },
  showInSlider: { type: Boolean, default: false },
  thickness: [{ type: String }],
  sizes: [{ type: String }],
  description: { type: String },
  primaryColor: { type: String },
  accentColor: { type: String },
  style: { type: String },
  variations: { type: String, default: 'Low' },
  finishes: [{ type: String }],
  applications: [{ type: String }],
  bookMatch: { type: String, default: 'N/A', enum: ['N/A', 'Yes', 'No'] },
  landingCost: { type: Number },
  priceLevels: {
    level1: { type: Number }, // 40% margin
    level2: { type: Number }, // 30% margin
    level3: { type: Number }, // 20% margin
    level4: { type: Number }  // 10% margin
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for performance optimization
productSchema.index({ id: 1 }, { unique: true }); // Unique index on id
productSchema.index({ category: 1 }); // Index for category filtering
productSchema.index({ name: 1 }); // Index for search
productSchema.index({ category: 1, availability: 1 }); // Compound index for filtered queries
productSchema.index({ showInSlider: 1 }); // Index for slider products

// Virtual property to map 'collection' to 'collectionType'
productSchema.virtual('collection').get(function() {
  return this.collectionType;
}).set(function(value) {
  this.collectionType = value;
});

// Virtual property for 'price' - returns level1 formatted as price
productSchema.virtual('price').get(function() {
  if (this.priceLevels && this.priceLevels.level1) {
    return `$${this.priceLevels.level1.toFixed(2)}/sqft`;
  }
  return '$0.00/sqft';
});

// Ensure virtuals are included when converting to JSON
productSchema.set('toJSON', {
  virtuals: true,
  transform: function (doc, ret) {
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

const Product = mongoose.model('Product', productSchema);

export default Product;

import mongoose from 'mongoose';

const productSchema = new mongoose.Schema({
  id: { type: Number, required: true, unique: true },
  name: { type: String, required: true },
  category: { type: String, required: true },
  price: { type: String },
  collectionType: { type: String },
  availability: { type: String, default: 'In Stock' },
  image: { type: String },
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
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual property to map 'collection' to 'collectionType'
productSchema.virtual('collection').get(function() {
  return this.collectionType;
}).set(function(value) {
  this.collectionType = value;
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

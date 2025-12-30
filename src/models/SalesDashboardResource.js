import mongoose from 'mongoose';

const salesDashboardResourceSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  type: {
    type: String, // 'file' or 'link'
    required: true,
    default: 'file'
  },
  content: {
    type: String, // Base64 string for files, URL for links, or empty for folders
    required: function() { return !this.isFolder; } // Not required for folders
  },
  thumbnail: {
    type: String, // Base64 string for image thumbnail
    default: ''
  },
  contentType: {
    type: String, 
    default: 'application/octet-stream'
  },
  isFolder: {
    type: Boolean,
    default: false
  },
  parentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SalesDashboardResource',
    default: null
  },
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

export default mongoose.model('SalesDashboardResource', salesDashboardResourceSchema);

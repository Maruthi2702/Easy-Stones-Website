import mongoose from 'mongoose';

const salesResourceSchema = new mongoose.Schema({
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
    type: String, // Base64 string for files or URL for links
    required: true
  },
  contentType: {
    type: String, // MIME type (e.g., 'application/pdf', 'image/jpeg')
    default: 'application/octet-stream'
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

export default mongoose.model('SalesResource', salesResourceSchema);

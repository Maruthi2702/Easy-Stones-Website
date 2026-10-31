// Legacy BSON records remain flexible; runtime schemas still validate every write.
import type { Loose } from '../types/records.ts';
import mongoose from 'mongoose';

const salesDashboardResourceSchema = new mongoose.Schema<Loose>({
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
    type: String
  },
  // Team Files page (2026-10-30, src/routes/teamFiles.ts). Missing on records
  // saved before it: size shows "—", Modified falls back to createdAt.
  // Bytes, read from the upload (files only).
  size: { type: Number, default: undefined },
  // One pinned list for the whole team, newest pin first.
  pinned: { type: Boolean, default: false },
  pinnedAt: { type: String, default: undefined },
  pinnedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: undefined },
  // Who last renamed, moved or replaced it. uploadedBy stays who added it
  // (the old PUT overwrote it on every edit).
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: undefined },
  updatedAt: { type: String, default: undefined }
});

// A folder's contents (the page's main read), and the Pinned list.
salesDashboardResourceSchema.index({ parentId: 1, isFolder: -1, createdAt: -1 });
salesDashboardResourceSchema.index({ pinned: 1, pinnedAt: -1 });

export default mongoose.model('SalesDashboardResource', salesDashboardResourceSchema);

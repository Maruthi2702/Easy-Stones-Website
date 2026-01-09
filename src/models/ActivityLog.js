import mongoose from 'mongoose';

const activityLogSchema = new mongoose.Schema({
    entityType: {
        type: String,
        required: true,
        enum: ['Visit', 'Customer', 'Resource', 'Contact', 'User']
    },
    entityId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true
    },
    customerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Customer'
    },
    action: {
        type: String,
        required: true,
        enum: ['CREATE', 'UPDATE', 'DELETE', 'REACTION_ADD', 'REACTION_REMOVE']
    },
    performedBy: {
        type: String, // User ID or Customer ID
        required: true
    },
    performedByName: {
        type: String,
        required: true
    },
    performedByRole: {
        type: String,
        enum: ['admin', 'customer']
    },
    details: {
        type: mongoose.Schema.Types.Mixed
    },
    timestamp: {
        type: Date,
        default: Date.now
    }
});

// Indexes for common queries
activityLogSchema.index({ entityType: 1, entityId: 1 });
activityLogSchema.index({ customerId: 1 });
activityLogSchema.index({ timestamp: -1 });

export default mongoose.model('ActivityLog', activityLogSchema);

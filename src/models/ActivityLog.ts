import mongoose from 'mongoose';

export interface ActivityLogRecord {
    entityType: 'Visit' | 'Customer' | 'Resource' | 'Contact' | 'User' | 'Delivery';
    entityId: mongoose.Types.ObjectId;
    customerId?: mongoose.Types.ObjectId | null;
    action: 'CREATE' | 'UPDATE' | 'DELETE' | 'REACTION_ADD' | 'REACTION_REMOVE';
    performedBy: string;
    performedByName: string;
    performedByRole?: 'admin' | 'customer' | null;
    // Activity kinds have different details; readers must inspect their shape.
    details?: Record<string, unknown> | null;
    timestamp?: string | null;
}

const activityLogSchema = new mongoose.Schema<ActivityLogRecord>({
    entityType: {
        type: String,
        required: true,
        enum: ['Visit', 'Customer', 'Resource', 'Contact', 'User', 'Delivery']
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
        type: String, // Stored as Local ISO
    }
});

// Indexes for common queries
activityLogSchema.index({ entityType: 1, entityId: 1 });
activityLogSchema.index({ customerId: 1 });
activityLogSchema.index({ timestamp: -1 });

export default mongoose.model('ActivityLog', activityLogSchema);

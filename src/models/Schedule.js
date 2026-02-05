import mongoose from 'mongoose';

const scheduleSchema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true,
    index: true
  },
  customerId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Customer', 
    required: true,
    index: true
  },
  startTime: { 
    type: String, 
    required: true,
    index: true
  },
  endTime: { 
    type: String 
  },
  activityType: { 
    type: String, 
    enum: ['Visit', 'Call', 'Drop-off', 'Other'], 
    default: 'Visit' 
  },
  notes: {
    type: String,
    default: ''
  },
  status: { 
    type: String, 
    enum: ['Scheduled', 'Completed', 'Cancelled'], 
    default: 'Scheduled',
    index: true
  },
  linkedVisitId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Customer.visits' 
  }
}, { 
  timestamps: true,
  autoIndex: false,
  bufferCommands: false
});

// Compound index for getting a user's schedule for a specific date range
scheduleSchema.index({ userId: 1, startTime: 1 });

const Schedule = mongoose.model('Schedule', scheduleSchema);

export default Schedule;

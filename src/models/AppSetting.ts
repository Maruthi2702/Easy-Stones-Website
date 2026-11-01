import mongoose from 'mongoose';

/**
 * Site-wide settings that belong to no one user: one document per `key`.
 * The first is 'navOrder' — the side nav's admin-set order
 * (src/routes/navOrder.ts, src/utils/navPins.ts).
 */
/** Settings may hold differently shaped values; callers validate each key's value. */
export interface AppSettingRecord {
  key: string;
  value: unknown;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const appSettingSchema = new mongoose.Schema<AppSettingRecord>({
  key: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  value: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  updatedBy: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

export default ((mongoose.models.AppSetting as mongoose.Model<mongoose.InferSchemaType<typeof appSettingSchema>> | undefined) || mongoose.model('AppSetting', appSettingSchema)) as mongoose.Model<mongoose.InferSchemaType<typeof appSettingSchema>>;

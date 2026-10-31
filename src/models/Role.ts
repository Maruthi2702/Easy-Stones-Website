// Legacy BSON records remain flexible; runtime schemas still validate every write.
import type { Loose } from '../types/records.ts';
import mongoose from 'mongoose';

const roleSchema = new mongoose.Schema<Loose>({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  displayName: {
    type: String,
    required: true,
    trim: true
  },
  permissions: {
    type: [String],
    default: []
  },
  // Permissions the boot-time grants in server.ts (NEW_PERMISSION_GRANTS) have
  // already given this role. A grant is never reapplied once recorded here, so
  // a permission an admin removes under Users & Roles stays removed.
  seededPermissions: {
    type: [String],
    default: []
  },
  // Team access (src/utils/teamAccess.ts): the roles whose people this role's
  // holders may deactivate, reactivate and unlock at their own locations, when
  // the role has manage_team_users. Set per role in Roles & Permissions.
  manageableRoles: {
    type: [String],
    default: []
  },
  isSystem: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

const Role = mongoose.model('Role', roleSchema);

export default Role;

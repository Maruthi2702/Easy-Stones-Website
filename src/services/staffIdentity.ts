import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import User from '../models/User.ts';
import Role from '../models/Role.ts';
import { sessionIsCurrent } from './staffSession.ts';

// Optional authentication for public reads and socket joins. Invalid sessions
// are anonymous; database failures still propagate rather than granting access.
export function readSessionToken(token: string | null | undefined, secret: string) {
  if (!token) return null;
  try { return jwt.verify(token, secret) as jwt.JwtPayload; } catch { return null; }
}

export async function resolveStaffToken(token: string | null | undefined, secret: string) {
  const decoded = readSessionToken(token, secret);
  if (!decoded || (decoded.type !== 'internal' && !(decoded.userId && !decoded.type))) return null;
  const id = decoded.userId || decoded.id;
  if (!mongoose.isValidObjectId(id)) return null;
  const user = await User.findById(id, 'role assignedLocations isActive mustChangePassword sessionVersion').lean();
  if (!user || user.isActive === false || user.mustChangePassword || !sessionIsCurrent(decoded, user)) return null;
  const role = await Role.findOne({ name: String(user.role || '').trim().toLowerCase() }, 'permissions').lean();
  return { ...user, permissions: role?.permissions || [] };
}

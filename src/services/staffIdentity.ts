import jwt from 'jsonwebtoken';
import * as staffData from '../db/staff/index.ts';
import mongoose from 'mongoose';
import type { Loose } from '../types/records.ts';
import { sessionIsCurrent } from './staffSession.ts';

// Optional authentication for public reads and socket joins. Invalid sessions
// are anonymous; database failures still propagate rather than granting access.
export function readSessionToken(token: string | null | undefined, secret: string) {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, secret);
    return typeof decoded === 'string' ? null : decoded;
  } catch { return null; }
}

export async function resolveStaffToken(token: string | null | undefined, secret: string) {
  const decoded = readSessionToken(token, secret);
  if (!decoded || (decoded.type !== 'internal' && !(decoded.userId && !decoded.type))) return null;
  const id = decoded.userId || decoded.id;
  if (!mongoose.isValidObjectId(id)) return null;
  const user = await staffData.userById(id, { select: 'role assignedLocations isActive mustChangePassword sessionVersion' });
  if (!user || user.isActive === false || user.mustChangePassword || !sessionIsCurrent(decoded, user)) return null;
  const role = await staffData.findRole({ name: String(user.role || '').trim().toLowerCase() }, { select: 'permissions' });
  return { ...user, permissions: (role?.permissions || []) as string[] } as Loose & { role?: string; permissions: string[] };
}

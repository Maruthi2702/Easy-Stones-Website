import type { ClientSession } from 'mongoose';
import LocationModel from '../models/Location.js';
import UserModel from '../models/User.js';
import RoleModel from '../models/Role.js';
import { displayNameOf } from '../utils/salesReps.js';
import { HttpError } from './http.ts';
import type { DriverOption } from './types.ts';
interface UserAccess { assignedLocations?: string[]; permissions?: string[] }
const Location = LocationModel;
const User = UserModel;
const Role = RoleModel;
export async function access(user: UserAccess, session: ClientSession | null = null) {
  const all = (await Location.find({}, 'name').session(session).sort({ name: 1 }).lean()).map(l => l.name);
  const assigned = user.assignedLocations || [];
  const global = assigned.includes('*') || (all.length > 0 && all.every(name => assigned.includes(name)));
  return { global, locations: global ? all : all.filter(name => assigned.includes(name)), permissions: user.permissions || [] };
}
export async function requireGlobal(user: UserAccess, session: ClientSession | null = null) {
  const a = await access(user, session);
  if (!a.global) throw new HttpError(403, 'Company-wide report imports and reviews require access to every company location. Branch users can view their published totals.');
  return a;
}
export async function driverOptions(session: ClientSession | null = null): Promise<DriverOption[]> {
  const roles = await Role.find({ permissions: 'delivery_driver_view' }, 'name').session(session).lean();
  const people = await User.find({ role: { $in: roles.map(r => r.name) } }, 'username displayName location assignedLocations isActive').session(session).sort({ displayName: 1, username: 1 }).lean();
  return people.map(u => {
    const locations = u.assignedLocations?.length ? u.assignedLocations : u.location ? [u.location] : [];
    const homeLocation = u.location && (locations.includes('*') || locations.includes(u.location)) ? u.location : locations.length === 1 && locations[0] !== '*' ? locations[0]! : '';
    return { key: `user:${u._id}`, name: displayNameOf(u), active: u.isActive !== false, locations, homeLocation, kind: 'user' as const };
  }).sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
}

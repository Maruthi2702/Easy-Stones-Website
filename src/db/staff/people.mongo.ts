/** Users and roles on MongoDB: the Mongoose model calls the routes used to make, in one place. */
import mongoose from 'mongoose';
import User from '../../models/User.ts';
import Role from '../../models/Role.ts';
import type { Loose } from '../../types/records.ts';
import type { ReadOptions } from './users.postgres.ts';

export interface MongoReadOptions extends ReadOptions { session?: mongoose.ClientSession | null }
type Model = typeof User | typeof Role;

const find = (M: Model, filter: Loose, o: MongoReadOptions) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = (M as any).find(filter);
  if (o.select) q = q.select(o.select);
  if (o.sort) q = q.sort(o.sort);
  if (o.session) q = q.session(o.session);
  return q;
};
const findOne = (M: Model, filter: Loose, o: MongoReadOptions) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = (M as any).findOne(filter);
  if (o.select) q = q.select(o.select);
  if (o.sort) q = q.sort(o.sort);
  if (o.session) q = q.session(o.session);
  return q;
};

export const findUsers = async (filter: Loose = {}, o: MongoReadOptions = {}): Promise<Loose[]> => find(User, filter, o).lean();
export const findUser = async (filter: Loose, o: MongoReadOptions = {}): Promise<Loose | null> => findOne(User, filter, o).lean();
export const userExists = async (filter: Loose) => (await User.exists(filter as never))?._id ?? null;
export const countUsers = () => User.countDocuments();
export const userDoc = async (filter: Loose, o: MongoReadOptions = {}) => findOne(User, filter, o);
export const newUserDoc = (fields: Loose) => new User(fields as never);
export const updateUser = async (filter: Loose, update: Loose) => {
  const r = await User.updateOne(filter as never, update as never);
  return { matchedCount: r.matchedCount, modifiedCount: r.modifiedCount };
};
export const findUserAndUpdate = async (filter: Loose, update: Loose, o: MongoReadOptions = {}): Promise<Loose | null> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = User.findOneAndUpdate(filter as never, update as never, { returnDocument: 'after' });
  if (o.select) q = q.select(o.select);
  return q.lean();
};
export const deleteUser = async (id: string) => !!(mongoose.isValidObjectId(id) && await User.findByIdAndDelete(id));
export const touchLastSeen = (id: string, at: Date) => User.updateOne({ _id: id }, { $set: { lastSeenAt: at } }).then(() => undefined);

export const findRoles = async (filter: Loose = {}, o: MongoReadOptions = {}): Promise<Loose[]> => find(Role, filter, o).lean();
export const findRole = async (filter: Loose, o: MongoReadOptions = {}): Promise<Loose | null> => findOne(Role, filter, o).lean();
export const roleExists = async (filter: Loose) => (await Role.exists(filter as never))?._id ?? null;
export const roleDocFor = async (filter: Loose) => findOne(Role, filter, {});
export const newRoleDoc = (fields: Loose) => new Role(fields as never);
export const deleteRole = async (id: string) => !!(mongoose.isValidObjectId(id) && await Role.findByIdAndDelete(id));

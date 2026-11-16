/** Staff sign-in and role reads on Postgres, answering in MongoDB's shape (staffDoc.ts). */
import { asc, eq, sql } from 'drizzle-orm';
import type { Db } from '../copy/plan.ts';
import { users, roles, locations, userLocations } from '../schema/reference.ts';
import { authIdentityDoc, roleDoc } from './staffDoc.ts';
import type { Loose } from '../../types/records.ts';

const isId = (v: string) => /^[0-9a-f]{24}$/.test(v);

/** The user, their home branch's name, assigned names and role permissions in one trip. */
export async function authIdentity(db: Db, userId: string): Promise<Loose | null> {
  if (!isId(userId)) return null;
  const [row] = await db.select({
    user: users,
    homeName: locations.name,
    permissions: roles.permissions,
    assigned: sql<string[]>`coalesce((select array_agg(l.name) from user_locations ul join locations l on l.id = ul.location_id where ul.user_id = ${users.id}), '{}')`
  }).from(users)
    .leftJoin(locations, eq(locations.id, users.homeLocationId))
    .leftJoin(roles, eq(roles.name, users.role))
    .where(eq(users.id, userId)).limit(1);
  if (!row) return null;
  return authIdentityDoc(row.user, { homeName: row.homeName, assignedNames: row.assigned }, row.permissions ?? []);
}

export async function roleByName(db: Db, name: string): Promise<Loose | null> {
  const [r] = await db.select().from(roles).where(eq(roles.name, name.trim().toLowerCase())).limit(1);
  return r ? roleDoc(r) : null;
}

export async function rolesList(db: Db): Promise<Loose[]> {
  return (await db.select().from(roles).orderBy(asc(roles.name))).map(roleDoc);
}

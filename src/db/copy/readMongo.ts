/**
 * Read the customer area out of MongoDB — reads only, from a secondary when there is one.
 * Shared by scripts/pg-copy-customers.ts (straight into Postgres) and
 * scripts/pg-copy-aws.ts (into a snapshot for the copy Lambda).
 */
import { MongoClient } from 'mongodb';
import type { CustomerAreaSource } from './customerArea.ts';

/** Source key → MongoDB collection. */
export const CUSTOMER_AREA_COLLECTIONS: Record<keyof CustomerAreaSource, string> = {
  locations: 'locations',
  roles: 'roles',
  users: 'users',
  visitTypes: 'visittypes',
  resourceFamilies: 'resourcefamilies',
  resourceTypes: 'resourcetypes',
  customers: 'customers',
  schedules: 'schedules',
  activityLogs: 'activitylogs',
  customerDeleteBackups: 'customerdeletebackups',
  customerMergeBackups: 'customermergebackups'
};

export async function readMongo(uri: string, appName = 'pg-copy-customers'): Promise<CustomerAreaSource> {
  const client = new MongoClient(uri, { readPreference: 'secondaryPreferred', appName });
  await client.connect();
  try {
    const db = client.db();
    const entries = await Promise.all(Object.entries(CUSTOMER_AREA_COLLECTIONS)
      .map(async ([key, name]) => [key, await db.collection(name).find({}).toArray()] as const));
    return Object.fromEntries(entries) as unknown as CustomerAreaSource;
  } finally {
    await client.close();
  }
}

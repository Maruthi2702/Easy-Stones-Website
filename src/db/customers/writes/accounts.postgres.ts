/**
 * Accounts saves on Postgres. Each writes what the copy would make of the MongoDB
 * record after the same save (src/db/copy/customerRows.ts) and answers what its twin in
 * accounts.mongo.ts answers (accounts.parity.test.ts proves both).
 *
 * None of these routes writes an activity-log line today, so none is written here.
 */
import bcrypt from 'bcryptjs';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import type { Db } from '../../copy/plan.ts';
import { toLocalTime } from '../../copy/values.ts';
import { branchZone } from '../../../config/branches.ts';
import { isId } from '../../ids.ts';
import { customers, customerContacts, customerLinks, customerLogins } from '../../schema/customers.ts';
import { locations } from '../../schema/reference.ts';
import type {
  NewContact, ContactFields, RegisterInput, RegisteredCustomer, PasswordReset,
  CustomerSignIn, CustomerAccount, GeocodeCandidate, GeocodeResult
} from './accounts.types.ts';

// ── What Mongoose would refuse ──

/** A malformed id: MongoDB's cast error, same words. */
function castIdError(value: unknown): Error {
  return new Error(`Cast to ObjectId failed for value "${String(value)}" (type ${typeof value}) at path "_id" for model "Customer"`);
}

const idArg = (value: unknown): string => {
  if (!isId(value)) throw castIdError(value);
  return value.toLowerCase();
};

/** Mongoose casts a String path: lists and plain objects are refused, null / undefined pass. */
function castText(value: unknown): string | null | undefined {
  if (value == null) return value as null | undefined;
  if (typeof value === 'object' && (Array.isArray(value) || value.toString === Object.prototype.toString)) {
    throw new Error('Cast to string failed');
  }
  return String(value);
}

const textOrBlank = (value: string | null | undefined) => value ?? '';

const CONTACT_TEXT_FIELDS = ['name', 'phone', 'email', 'role', 'notes'] as const;
const CONTACT_FIELDS = [...CONTACT_TEXT_FIELDS, 'createdAt', '_id'];

/** The columns a contact's fields set: what Mongoose's strict update keeps (name trimmed, the rest cast to text). */
function contactColumns(fields: Record<string, unknown>) {
  const set: { name?: string; phone?: string; email?: string; role?: string; notes?: string; createdAtRaw?: string | null; id?: string } = {};
  for (const key of Object.keys(fields)) {
    const value = fields[key];
    // A sub-path of a text field (name.x): MongoDB refuses to create it.
    const head = key.split('.')[0];
    if (key.includes('.')) {
      if (CONTACT_FIELDS.includes(head)) throw new Error(`Cannot create field in contact ${head}`);
      continue;
    }
    if (key === '_id') { set.id = idArg(value); continue; }
    if (key === 'createdAt') { set.createdAtRaw = castText(value) ?? null; continue; }
    if ((CONTACT_TEXT_FIELDS as readonly string[]).includes(key)) {
      const text = castText(value);
      set[key as (typeof CONTACT_TEXT_FIELDS)[number]] = textOrBlank(key === 'name' ? text?.trim() : text);
    }
  }
  return set;
}

/** The customer's branch clock, or null when there is no such customer. */
async function zoneOfCustomer(db: Db, customerId: string): Promise<string | null> {
  const [row] = await db.select({ name: locations.name }).from(customers)
    .innerJoin(locations, eq(customers.locationId, locations.id)).where(eq(customers.id, customerId));
  return row ? branchZone(row.name) : null;
}

const localTimeOf = (value: string | null | undefined, zone: string): string | null => {
  const r = toLocalTime(value, zone);
  return r.ok ? r.value : null;
};

// ── Contacts ──

/** POST /api/customers/:customerId/contacts. false = no such customer. */
export async function addContact(db: Db, customerId: string, contactId: string, newContact: NewContact): Promise<boolean> {
  const customer = idArg(customerId);
  const set = contactColumns({ name: newContact.name, phone: newContact.phone, email: newContact.email, role: newContact.role, notes: newContact.notes, createdAt: newContact.createdAt });
  return db.transaction(async tx => {
    const zone = await zoneOfCustomer(tx, customer);
    if (!zone) return false;
    const [{ next }] = await tx.select({ next: sql<number>`coalesce(max(${customerContacts.position}), -1) + 1` })
      .from(customerContacts).where(eq(customerContacts.customerId, customer));
    await tx.insert(customerContacts).values({
      id: contactId, customerId: customer, position: Number(next),
      name: set.name ?? '', phone: set.phone ?? '', email: set.email ?? '', role: set.role ?? '', notes: set.notes ?? '',
      isPrimary: false, createdAt: localTimeOf(set.createdAtRaw, zone)
    });
    await tx.update(customers).set({ updatedAt: new Date() }).where(eq(customers.id, customer));
    return true;
  });
}

/** PUT /api/customers/:customerId/contacts/:contactId. false = no such customer or contact. */
export async function updateContact(db: Db, customerId: string, contactId: string, fields: ContactFields, _updatedBy: string): Promise<boolean> {
  const customer = idArg(customerId);
  const contact = idArg(contactId);
  const set = contactColumns(fields);
  return db.transaction(async tx => {
    const zone = await zoneOfCustomer(tx, customer);
    if (!zone) return false;
    const [there] = await tx.select({ id: customerContacts.id }).from(customerContacts)
      .where(and(eq(customerContacts.customerId, customer), eq(customerContacts.id, contact)));
    if (!there) return false;
    const { createdAtRaw, id, ...text } = set;
    const columns: Partial<typeof customerContacts.$inferInsert> = { ...text };
    if (id) columns.id = id;
    if ('createdAtRaw' in set) columns.createdAt = localTimeOf(createdAtRaw, zone);
    if (Object.keys(columns).length) await tx.update(customerContacts).set(columns).where(eq(customerContacts.id, contact));
    await tx.update(customers).set({ updatedAt: new Date() }).where(eq(customers.id, customer));
    return true;
  });
}

// ── Partners ──

/** Positions run 0, 1, 2… in the order they were linked (the copy numbers them so). */
async function renumberAssociated(db: Db, ids: string[]) {
  await db.execute(sql`
    update customer_links l set position = r.n - 1
    from (select customer_id, other_customer_id,
                 row_number() over (partition by customer_id order by position) as n
          from customer_links where kind = 'associated' and customer_id in (${sql.join(ids.map(i => sql`${i}`), sql`, `)})) r
    where l.kind = 'associated' and l.customer_id = r.customer_id and l.other_customer_id = r.other_customer_id`);
}

/** POST /api/customers/:customerId/associations. false = one or both customers not found. */
export async function linkPartners(db: Db, customerId: string, partnerId: string): Promise<boolean> {
  const a = idArg(customerId);
  const b = idArg(partnerId);
  return db.transaction(async tx => {
    const found = await tx.select({ id: customers.id }).from(customers).where(inArray(customers.id, [a, b]));
    if (found.length < new Set([a, b]).size) return false;
    for (const [from, to] of [[a, b], [b, a]]) {
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(customerLinks)
        .where(and(eq(customerLinks.customerId, from), eq(customerLinks.kind, 'associated')));
      await tx.insert(customerLinks).values({ customerId: from, otherCustomerId: to, kind: 'associated', position: Number(n) }).onConflictDoNothing();
    }
    await tx.update(customers).set({ updatedAt: new Date() }).where(inArray(customers.id, [a, b]));
    return true;
  });
}

/** DELETE /api/customers/:customerId/associations/:partnerId. */
export async function unlinkPartners(db: Db, customerId: string, partnerId: string): Promise<void> {
  const a = idArg(customerId);
  const b = idArg(partnerId);
  await db.transaction(async tx => {
    await tx.delete(customerLinks).where(and(
      eq(customerLinks.kind, 'associated'),
      or(
        and(eq(customerLinks.customerId, a), eq(customerLinks.otherCustomerId, b)),
        and(eq(customerLinks.customerId, b), eq(customerLinks.otherCustomerId, a))
      )
    ));
    await renumberAssociated(tx, [a, b]);
    await tx.update(customers).set({ updatedAt: new Date() }).where(inArray(customers.id, [a, b]));
  });
}

// ── Website sign-in and password ──

const hashPassword = async (password: string) => bcrypt.hash(password, await bcrypt.genSalt(10));

const STATUSES = ['New Lead', 'Trying to Onboard', 'Contacted / In Discussion', 'Onboarded', 'Different Sales Person', 'Not Interested', 'Inactive'];
const TYPES = ['Fabricator', 'Contractor', 'Dealer', 'Floor Covering', 'Designer', 'Builder'];
const LEVELS = ['Level - 1', 'Level - 2', 'Level - 3', 'Level - 4'];

/** PUT /api/customers/:id/password. null = no such customer. */
export async function resetCustomerPassword(db: Db, id: string, password: string): Promise<PasswordReset | null> {
  const customerId = idArg(id);
  const hash = await hashPassword(password);
  return db.transaction(async tx => {
    const [c] = await tx.select().from(customers).where(eq(customers.id, customerId));
    if (!c) return null;
    // customer.save() validates the whole record first, as the model's enums say.
    if (!STATUSES.includes(c.status) || !LEVELS.includes(c.level) || (c.customerType != null && !TYPES.includes(c.customerType))) {
      throw new Error('Customer validation failed');
    }
    // ...and writes the defaults an old record never had.
    await tx.update(customers).set({
      customerType: c.customerType ?? 'Fabricator', modaDisplay: c.modaDisplay ?? false, updatedAt: new Date()
    }).where(eq(customers.id, customerId));
    await tx.insert(customerLogins).values({ customerId, passwordHash: hash, loginAttempts: 0, loginIps: [] })
      .onConflictDoUpdate({ target: customerLogins.customerId, set: { passwordHash: hash, loginAttempts: 0, lockUntil: null } });
    return { id: c.id, contactName: c.contactName, email: c.email };
  });
}

/** POST /api/customer/register. 'taken' = the email is already registered. */
export async function registerCustomer(db: Db, id: string, input: RegisterInput): Promise<RegisteredCustomer | 'taken'> {
  const email = castText(input.email)?.toLowerCase();
  const contactName = castText(input.contactName);
  const phone = castText(input.phone);
  const company = castText(input.company);
  const password = castText(input.password);

  return db.transaction(async tx => {
    if (email) {
      const [there] = await tx.select({ id: customers.id }).from(customers).where(eq(customers.email, email.trim()));
      if (there) return 'taken' as const;
    }
    // The model requires both, and hashes a password that is there (an absent one throws).
    if (!contactName) throw new Error('Customer validation failed: contactName is required');
    if (!email) throw new Error('Customer validation failed: email is required');
    if (password == null) throw new Error('Illegal arguments: undefined, string');
    const hash = await hashPassword(password);
    const [seattle] = await tx.select({ id: locations.id }).from(locations).where(eq(locations.name, 'Seattle'));
    if (!seattle) throw new Error('No Seattle location for a new customer');
    const now = new Date();
    await tx.insert(customers).values({
      id, contactName, email: email.trim(), phone: textOrBlank(phone), company: textOrBlank(company),
      customerType: 'Fabricator', modaDisplay: false, locationId: seattle.id, createdAt: now, updatedAt: now
    });
    await tx.insert(customerLogins).values({ customerId: id, passwordHash: hash, loginAttempts: 0, loginIps: [] });
    return { _id: id, contactName, email };
  });
}

/** POST /api/customer/login: the customer an email signs in as, with the model's lock methods. */
export async function findCustomerForSignIn(db: Db, email: string): Promise<CustomerSignIn | null> {
  const [row] = await db.select({
    c: customers, hash: customerLogins.passwordHash, attempts: customerLogins.loginAttempts, lock: customerLogins.lockUntil
  }).from(customers).leftJoin(customerLogins, eq(customerLogins.customerId, customers.id)).where(eq(customers.email, email));
  if (!row) return null;
  const id = row.c.id;
  const loginAttempts = row.attempts ?? 0;
  const lockUntil = row.lock;
  const isLocked = () => !!(lockUntil && lockUntil.getTime() > Date.now());

  return {
    _id: id, contactName: row.c.contactName, email: row.c.email, company: row.c.company, isActive: row.c.isActive,
    isLocked,
    // No password on record: bcrypt refuses, as it does for the model.
    comparePassword: (candidate: string) => bcrypt.compare(candidate, (row.hash ?? undefined) as string),
    incLoginAttempts: async () => {
      let attempts: number | ReturnType<typeof sql>; let lock: Date | null;
      if (lockUntil && lockUntil.getTime() < Date.now()) {
        // The lock has run out: start counting again.
        attempts = 1; lock = null;
      } else {
        attempts = sql`${customerLogins.loginAttempts} + 1`;
        lock = lockUntil ?? null;
        if (loginAttempts + 1 >= 5 && !isLocked()) lock = new Date(Date.now() + 15 * 60 * 1000);
      }
      await db.transaction(async tx => {
        await tx.insert(customerLogins).values({ customerId: id, loginAttempts: 1, lockUntil: lock, loginIps: [] })
          .onConflictDoUpdate({ target: customerLogins.customerId, set: { loginAttempts: attempts as number, lockUntil: lock } });
        await tx.update(customers).set({ updatedAt: new Date() }).where(eq(customers.id, id));
      });
    }
  };
}

/** POST /api/customer/login, after the right password: clear failed attempts, keep the last 3 IPs. */
export async function recordCustomerSignIn(db: Db, id: string, ip: unknown): Promise<void> {
  const customerId = idArg(id);
  await db.transaction(async tx => {
    const [c] = await tx.select({ id: customers.id }).from(customers).where(eq(customers.id, customerId));
    if (!c) return;
    const [login] = await tx.select({ ips: customerLogins.loginIps }).from(customerLogins).where(eq(customerLogins.customerId, customerId));
    const ips = [...(login?.ips ?? []), ...(ip == null ? [] : [String(ip)])].slice(-3);
    await tx.insert(customerLogins).values({ customerId, loginAttempts: 0, lockUntil: null, loginIps: ips })
      .onConflictDoUpdate({ target: customerLogins.customerId, set: { loginAttempts: 0, lockUntil: null, loginIps: ips } });
    await tx.update(customers).set({ updatedAt: new Date() }).where(eq(customers.id, customerId));
  });
}

/** GET /api/customer/me (a customer's own token). */
export async function customerAccount(db: Db, id: string): Promise<CustomerAccount | null> {
  const [row] = await db.select({
    _id: customers.id, contactName: customers.contactName, email: customers.email, company: customers.company
  }).from(customers).where(eq(customers.id, idArg(id)));
  return row ?? null;
}

// ── The geocoding job (src/services/customerGeocoding.ts) ──

/** Customers among these ids still waiting for a point (pending). */
export async function customersToGeocode(db: Db, ids: string[]): Promise<GeocodeCandidate[]> {
  const wanted = [...new Set(ids.map(String))].filter(isId).map(i => i.toLowerCase());
  if (!wanted.length) return [];
  const rows = await db.select({
    id: customers.id, street: customers.street, city: customers.city, state: customers.state, zipCode: customers.zipCode,
    addressKey: customers.geocodeAddressKey
  }).from(customers).where(and(inArray(customers.id, wanted), eq(customers.geocodeStatus, 'pending')));
  return rows.map(r => ({
    _id: r.id, address: { street: r.street, city: r.city, state: r.state, zipCode: r.zipCode }, geocode: { addressKey: r.addressKey }
  }));
}

/** The geocoder's answer for one customer. Like the raw MongoDB write, it leaves updatedAt alone. */
export async function saveCustomerGeocode(db: Db, id: string, result: GeocodeResult): Promise<void> {
  const g = result.geocode;
  await db.update(customers).set({
    lat: result.coordinates.lat, lng: result.coordinates.lng,
    geocodeStatus: g.status, geocodePrecision: g.precision ?? '', geocodeFormattedAddress: g.formattedAddress ?? '',
    geocodeAddressKey: g.addressKey ?? '', geocodeUpdatedAt: g.updatedAt, geocodeError: g.error == null ? '' : String(g.error)
  }).where(eq(customers.id, idArg(id)));
}

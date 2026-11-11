/**
 * Accounts saves on MongoDB — contacts, partners, the website sign-in and password,
 * and the geocoding job's map point: the routes' own code, moved here unchanged.
 * Its Postgres twin is accounts.postgres.ts; pick between them through accounts.ts.
 */
import mongoose from 'mongoose';
import Customer from '../../../models/Customer.ts';
import type { Loose } from '../../../types/records.ts';
import type {
  NewContact, ContactFields, RegisterInput, RegisteredCustomer, PasswordReset,
  CustomerSignIn, CustomerAccount, GeocodeCandidate, GeocodeResult
} from './accounts.types.ts';

// ── Contacts ──

/** POST /api/customers/:customerId/contacts. false = no such customer. */
export async function addContact(customerId: string, contactId: string, newContact: NewContact): Promise<boolean> {
  const result = await Customer.updateOne(
    { _id: customerId },
    { $push: { contacts: { ...newContact, _id: contactId } } }
  );
  return result.matchedCount > 0;
}

/** PUT /api/customers/:customerId/contacts/:contactId. false = no such customer or contact. */
export async function updateContact(customerId: string, contactId: string, fields: ContactFields, updatedBy: string): Promise<boolean> {
  const updateData: Loose = {};
  updateData[`contacts.$.updatedBy`] = updatedBy;

  Object.keys(fields).forEach(key => {
    updateData[`contacts.$.${key}`] = fields[key];
  });

  const result = await Customer.updateOne(
    { _id: customerId, 'contacts._id': contactId },
    { $set: updateData }
  );
  return result.matchedCount > 0;
}

// ── Partners ──

/** POST /api/customers/:customerId/associations. false = one or both customers not found. */
export async function linkPartners(customerId: string, partnerId: string): Promise<boolean> {
  // Check if both exist
  const [customer, partner] = await Promise.all([
    Customer.findById(customerId),
    Customer.findById(partnerId)
  ]);

  if (!customer || !partner) return false;

  // Bi-directional link using $addToSet to avoid duplicates
  await Promise.all([
    Customer.findByIdAndUpdate(customerId, { $addToSet: { associatedCustomers: partnerId } }),
    Customer.findByIdAndUpdate(partnerId, { $addToSet: { associatedCustomers: customerId } })
  ]);
  return true;
}

/** DELETE /api/customers/:customerId/associations/:partnerId. */
export async function unlinkPartners(customerId: string, partnerId: string): Promise<void> {
  // Bi-directional unlink using $pull
  await Promise.all([
    Customer.findByIdAndUpdate(customerId, { $pull: { associatedCustomers: partnerId } }),
    Customer.findByIdAndUpdate(partnerId, { $pull: { associatedCustomers: customerId } })
  ]);
}

// ── Website sign-in and password ──

/** PUT /api/customers/:id/password. null = no such customer. customer.save() runs the bcrypt hook. */
export async function resetCustomerPassword(id: string, password: string): Promise<PasswordReset | null> {
  const customer = await Customer.findById(id);
  if (!customer) return null;

  customer.password = password;
  // A reset also lifts the sign-in lock and the failed-attempt count (owner, 2026-11-11).
  customer.loginAttempts = 0;
  customer.lockUntil = undefined;
  await customer.save();
  return { id: String(customer._id), contactName: customer.contactName, email: customer.email };
}

/** POST /api/customer/register. 'taken' = the email is already registered. */
export async function registerCustomer(id: string, input: RegisterInput): Promise<RegisteredCustomer | 'taken'> {
  const { contactName, email, password, phone, company } = input;

  // Check if customer already exists
  const existingCustomer = await Customer.findOne({ email: email as string });
  if (existingCustomer) return 'taken';

  // Create new customer
  const customer = new Customer({
    _id: id,
    contactName,
    email,
    password,
    phone,
    company
  });

  await customer.save();
  return { _id: String(customer._id), contactName: customer.contactName, email: customer.email };
}

/** POST /api/customer/login: the customer an email signs in as (the document itself, with its lock methods). */
export async function findCustomerForSignIn(email: string): Promise<CustomerSignIn | null> {
  return Customer.findOne({ email }).select('-visits -resources') as unknown as Promise<CustomerSignIn | null>;
}

/** POST /api/customer/login, after the right password: clear failed attempts, keep the last 3 IPs. */
export async function recordCustomerSignIn(id: string, ip: unknown): Promise<void> {
  await Customer.updateOne({ _id: id }, {
    $set: {
      loginAttempts: 0,
      lastLoginIp: ip
    },
    $unset: { lockUntil: 1 },
    $push: {
      loginIps: {
        $each: [ip],
        $slice: -3
      }
    }
  });
}

/** GET /api/customer/me (a customer's own token). */
export async function customerAccount(id: string): Promise<CustomerAccount | null> {
  return Customer.findById(id).select('-password -visits -resources') as unknown as Promise<CustomerAccount | null>;
}

// ── The geocoding job (src/services/customerGeocoding.ts) ──

/** Customers among these ids still waiting for a point (pending, or no status). */
export async function customersToGeocode(ids: string[]): Promise<GeocodeCandidate[]> {
  const objectIds = [...new Set(ids.map(String))]
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));
  if (!objectIds.length) return [];

  const rows = await Customer.collection.find(
    { _id: { $in: objectIds }, 'geocode.status': { $in: ['pending', null] } },
    { projection: { address: 1, geocode: 1 } }
  ).toArray();
  return rows.map(c => ({ _id: String(c._id), address: c.address, geocode: c.geocode }));
}

/** The geocoder's answer for one customer (no updatedAt: the job writes past Mongoose). */
export async function saveCustomerGeocode(id: string, result: GeocodeResult): Promise<void> {
  await Customer.collection.updateOne({ _id: new mongoose.Types.ObjectId(id) }, { $set: result });
}

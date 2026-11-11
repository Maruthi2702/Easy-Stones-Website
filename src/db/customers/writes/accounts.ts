/**
 * Accounts saves (contacts, partners, the website sign-in and password, the geocoding
 * job's map point): MongoDB or Postgres by the area's switch (`DB_CUSTOMERS`,
 * src/db/appDb.ts). Routes call these, never the twins directly. See ./README.md.
 */
import { appDb, areaOn } from '../../appDb.ts';
import * as mongo from './accounts.mongo.ts';
import * as pg from './accounts.postgres.ts';
import type { NewContact, ContactFields, RegisterInput, GeocodeResult } from './accounts.types.ts';

export type { NewContact, ContactFields, RegisterInput, RegisteredCustomer, PasswordReset, CustomerSignIn, CustomerAccount, GeocodeCandidate, GeocodeResult } from './accounts.types.ts';

const onPostgres = () => areaOn('customers') === 'postgres';

export async function addContact(customerId: string, contactId: string, newContact: NewContact) {
  return onPostgres() ? pg.addContact(await appDb(), customerId, contactId, newContact) : mongo.addContact(customerId, contactId, newContact);
}

export async function updateContact(customerId: string, contactId: string, fields: ContactFields, updatedBy: string) {
  return onPostgres() ? pg.updateContact(await appDb(), customerId, contactId, fields, updatedBy) : mongo.updateContact(customerId, contactId, fields, updatedBy);
}

export async function linkPartners(customerId: string, partnerId: string) {
  return onPostgres() ? pg.linkPartners(await appDb(), customerId, partnerId) : mongo.linkPartners(customerId, partnerId);
}

export async function unlinkPartners(customerId: string, partnerId: string) {
  return onPostgres() ? pg.unlinkPartners(await appDb(), customerId, partnerId) : mongo.unlinkPartners(customerId, partnerId);
}

export async function resetCustomerPassword(id: string, password: string) {
  return onPostgres() ? pg.resetCustomerPassword(await appDb(), id, password) : mongo.resetCustomerPassword(id, password);
}

export async function registerCustomer(id: string, input: RegisterInput) {
  return onPostgres() ? pg.registerCustomer(await appDb(), id, input) : mongo.registerCustomer(id, input);
}

export async function findCustomerForSignIn(email: string) {
  return onPostgres() ? pg.findCustomerForSignIn(await appDb(), email) : mongo.findCustomerForSignIn(email);
}

export async function recordCustomerSignIn(id: string, ip: unknown) {
  return onPostgres() ? pg.recordCustomerSignIn(await appDb(), id, ip) : mongo.recordCustomerSignIn(id, ip);
}

export async function customerAccount(id: string) {
  return onPostgres() ? pg.customerAccount(await appDb(), id) : mongo.customerAccount(id);
}

export async function customersToGeocode(ids: string[]) {
  return onPostgres() ? pg.customersToGeocode(await appDb(), ids) : mongo.customersToGeocode(ids);
}

export async function saveCustomerGeocode(id: string, result: GeocodeResult) {
  return onPostgres() ? pg.saveCustomerGeocode(await appDb(), id, result) : mongo.saveCustomerGeocode(id, result);
}

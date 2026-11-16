/**
 * A Postgres location row (+ its report recipients) → the record MongoDB held: nested
 * `primaryContact.address`, `coordinates`, `geocode`, `salesDefaults`, `costOverrides`,
 * `dailyReportEmail`. The reverse of the copy's `referenceRows` (src/db/copy/referenceRows.ts).
 */
import type { locations } from '../schema/reference.ts';
import type { Loose } from '../../types/records.ts';

type LocationRow = typeof locations.$inferSelect;

const numOrNull = (v: string | null) => (v == null ? null : Number(v));

export function locationDoc(r: LocationRow, recipientIds: string[]): Loose {
  return {
    _id: r.id, name: r.name, shortCode: r.shortCode, fullName: r.fullName, region: r.region, rdc: r.rdc,
    profitCenter: r.profitCenter, warehouse: r.warehouse,
    primaryContact: {
      name: r.primaryName, email: r.primaryEmail, phone: r.primaryPhone, fax: r.primaryFax, website: r.primaryWebsite,
      address: { street: r.street, suite: r.suite, city: r.city, state: r.state, zipCode: r.zipCode }
    },
    coordinates: { lat: r.lat, lng: r.lng },
    geocode: {
      status: r.geocodeStatus, precision: r.geocodePrecision, formattedAddress: r.geocodeFormattedAddress,
      addressKey: r.geocodeAddressKey, updatedAt: r.geocodeUpdatedAt, error: r.geocodeError
    },
    accountingSameAsPrimary: r.accountingSameAsPrimary,
    accountingContact: {
      name: r.accountingName, email: r.accountingEmail, phone: r.accountingPhone,
      address: { street: r.accountingStreet, suite: r.accountingSuite, city: r.accountingCity, state: r.accountingState, zipCode: r.accountingZipCode }
    },
    salesDefaults: {
      salesRep: r.defaultSalesRepName, priceLevel: r.defaultPriceLevel, paymentTerms: r.paymentTerms,
      salesTaxArea: r.salesTaxArea, salesTaxRate: numOrNull(r.salesTaxRate)
    },
    costOverrides: { avgUnitFreight: numOrNull(r.avgUnitFreight), unitOverheadPct: numOrNull(r.unitOverheadPct) },
    dailyReportEmail: { userIds: recipientIds, extraEmails: r.reportExtraEmails },
    deliveryColumns: r.deliveryColumns,
    editedBy: r.editedBy, editedAt: r.editedAt, createdAt: r.createdAt, updatedAt: r.updatedAt
  };
}

/**
 * Mongoose's `doc.set(patch)` as the location routes use it: every key in the patch replaces
 * what was there, a nested path (`primaryContact`, `salesDefaults`…) included. The form always
 * sends the whole record, so nothing is lost in practice; Postgres does exactly what MongoDB does.
 */
export const mergeRecord = (current: Loose, patch: Loose): Loose => ({ ...current, ...patch });

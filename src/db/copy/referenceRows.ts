/**
 * MongoDB → Postgres rows for the reference tables: locations, roles, users,
 * the visit / resource type lists (src/db/schema/reference.ts).
 */
import type { Loose } from '../../types/records.ts';
import { branchZone } from '../../config/branches.ts';
import type {
  locations, roles, users, userLocations, locationReportRecipients,
  visitTypes, resourceFamilies, resourceTypes
} from '../schema/reference.ts';
import { idOf, idTime, textOf, rowConverter, type CopyProblem } from './values.ts';

type Row<T extends { $inferInsert: unknown }> = T['$inferInsert'];

const numOrNull = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : null;
const decimal = (v: unknown): string | null => numOrNull(v) == null ? null : String(v);
const strings = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

export interface ReferenceRows {
  locations: Row<typeof locations>[];
  locationReportRecipients: Row<typeof locationReportRecipients>[];
  roles: Row<typeof roles>[];
  users: Row<typeof users>[];
  userLocations: Row<typeof userLocations>[];
  visitTypes: Row<typeof visitTypes>[];
  resourceFamilies: Row<typeof resourceFamilies>[];
  resourceTypes: Row<typeof resourceTypes>[];
}

export interface ReferenceSource {
  locations: Loose[];
  roles: Loose[];
  users: Loose[];
  visitTypes: Loose[];
  resourceFamilies: Loose[];
  resourceTypes: Loose[];
}

/** What later rows look up: ids that exist and each branch's / person's clock. */
export interface ReferenceIndex {
  locationIdByName: Map<string, string>;
  zoneOfLocation: (name: unknown) => string;
  userIds: Set<string>;
  /** A person's clock: their home location's. */
  zoneOfUser: (id: string | null) => string;
  resourceTypeNames: Set<string>;
  visitTypeNames: Set<string>;
}

/** createdAt / updatedAt; a record saved without them gets its id's own creation time. */
export const stamp = (c: ReturnType<typeof rowConverter>, d: Loose) => {
  const created = c.moment('created_at', d.createdAt) ?? idTime(d._id);
  return { createdAt: created, updatedAt: c.moment('updated_at', d.updatedAt) ?? created };
};

export function referenceRows(src: ReferenceSource, problems: CopyProblem[]): { rows: ReferenceRows; index: ReferenceIndex } {
  const rows: ReferenceRows = {
    locations: [], locationReportRecipients: [], roles: [], users: [], userLocations: [],
    visitTypes: [], resourceFamilies: [], resourceTypes: []
  };

  const locationIdByName = new Map<string, string>();
  for (const d of src.locations) {
    const id = idOf(d._id);
    if (!id || !d.name) { problems.push({ table: 'locations', id: String(d._id), field: 'id', reason: 'no id or name', outcome: 'skipped' }); continue; }
    const c = rowConverter(problems, 'locations', id);
    const p = d.primaryContact || {}; const pa = p.address || {};
    const a = d.accountingContact || {}; const aa = a.address || {};
    const g = d.geocode || {}; const sd = d.salesDefaults || {}; const co = d.costOverrides || {};
    locationIdByName.set(d.name, id);
    rows.locations.push({
      id, name: d.name, shortCode: textOf(d.shortCode), fullName: textOf(d.fullName), region: textOf(d.region),
      timeZone: branchZone(d.name), rdc: textOf(d.rdc),
      profitCenter: !!d.profitCenter, warehouse: !!d.warehouse,
      primaryName: textOf(p.name), primaryEmail: textOf(p.email), primaryPhone: textOf(p.phone),
      primaryFax: textOf(p.fax), primaryWebsite: textOf(p.website),
      street: textOf(pa.street), suite: textOf(pa.suite), city: textOf(pa.city), state: textOf(pa.state), zipCode: textOf(pa.zipCode),
      lat: numOrNull(d.coordinates?.lat), lng: numOrNull(d.coordinates?.lng),
      geocodeStatus: textOf(g.status), geocodePrecision: textOf(g.precision),
      geocodeFormattedAddress: textOf(g.formattedAddress), geocodeAddressKey: textOf(g.addressKey),
      geocodeUpdatedAt: c.moment('geocode_updated_at', g.updatedAt), geocodeError: textOf(g.error),
      accountingSameAsPrimary: d.accountingSameAsPrimary !== false,
      accountingName: textOf(a.name), accountingEmail: textOf(a.email), accountingPhone: textOf(a.phone),
      accountingStreet: textOf(aa.street), accountingSuite: textOf(aa.suite), accountingCity: textOf(aa.city),
      accountingState: textOf(aa.state), accountingZipCode: textOf(aa.zipCode),
      defaultSalesRepName: textOf(sd.salesRep), defaultPriceLevel: numOrNull(sd.priceLevel),
      paymentTerms: textOf(sd.paymentTerms), salesTaxArea: textOf(sd.salesTaxArea), salesTaxRate: decimal(sd.salesTaxRate),
      avgUnitFreight: decimal(co.avgUnitFreight), unitOverheadPct: decimal(co.unitOverheadPct),
      reportExtraEmails: strings(d.dailyReportEmail?.extraEmails), deliveryColumns: strings(d.deliveryColumns),
      editedBy: textOf(d.editedBy), editedAt: c.moment('edited_at', d.editedAt),
      ...stamp(c, d)
    });
  }
  const zoneOfLocation = (name: unknown) => branchZone(typeof name === 'string' ? name : '');

  for (const d of src.roles) {
    const id = idOf(d._id);
    if (!id || !d.name) { problems.push({ table: 'roles', id: String(d._id), field: 'id', reason: 'no id or name', outcome: 'skipped' }); continue; }
    const c = rowConverter(problems, 'roles', id);
    rows.roles.push({
      id, name: d.name, displayName: textOf(d.displayName) || d.name,
      permissions: strings(d.permissions), seededPermissions: strings(d.seededPermissions),
      manageableRoles: strings(d.manageableRoles), approvesCardReceiptsOf: strings(d.approvesCardReceiptsOf),
      isSystem: !!d.isSystem, ...stamp(c, d)
    });
  }
  const roleNames = new Set(rows.roles.map(r => r.name));

  const userIds = new Set<string>();
  const homeOf = new Map<string, string>();
  for (const d of src.users) {
    const id = idOf(d._id);
    if (!id || !d.username || !d.password) {
      problems.push({ table: 'users', id: String(d._id), field: 'id', reason: 'no id, username or password', outcome: 'skipped' });
      continue;
    }
    const c = rowConverter(problems, 'users', id);
    if (!roleNames.has(d.role)) { c.problem('role', 'not a role', 'skipped'); continue; }
    let homeLocationId: string | null = null;
    if (d.location) {
      homeLocationId = locationIdByName.get(d.location) ?? null;
      if (!homeLocationId) c.problem('home_location_id', 'home location is not a location', 'blanked');
      else homeOf.set(id, d.location);
    }
    const assigned = strings(d.assignedLocations);
    for (const name of assigned) {
      if (name === '*') continue;
      const locationId = locationIdByName.get(name);
      if (locationId) rows.userLocations.push({ userId: id, locationId });
      else c.problem('user_locations', 'assigned location is not a location', 'skipped');
    }
    userIds.add(id);
    rows.users.push({
      id, username: d.username, displayName: textOf(d.displayName), passwordHash: d.password,
      email: d.email ? String(d.email) : null, role: d.role, homeLocationId, allLocations: assigned.includes('*'),
      isActive: d.isActive !== false, deactivatedAt: c.moment('deactivated_at', d.deactivatedAt),
      deactivatedBy: textOf(d.deactivatedBy), joiningDate: c.moment('joining_date', d.joiningDate),
      loginAttempts: numOrNull(d.loginAttempts) ?? 0, lockUntil: c.moment('lock_until', d.lockUntil),
      mustChangePassword: !!d.mustChangePassword, tempPasswordExpiresAt: c.moment('temp_password_expires_at', d.tempPasswordExpiresAt),
      sessionVersion: numOrNull(d.sessionVersion) ?? 0, inviteTokenHash: d.inviteTokenHash ?? null,
      inviteExpiresAt: c.moment('invite_expires_at', d.inviteExpiresAt), calendarFeedKey: d.calendarFeedKey ?? null,
      googleAccessToken: d.googleAccessToken ?? null, googleRefreshToken: d.googleRefreshToken ?? null,
      googleEmail: d.googleEmail ?? null, googleCalendarSyncEnabled: !!d.googleCalendarSyncEnabled,
      icloudUsername: d.icloudUsername ?? null, icloudPassword: d.icloudPassword ?? null,
      icloudCalendarUrl: d.icloudCalendarUrl ?? null, icloudCalendarName: d.icloudCalendarName ?? null,
      icloudSyncEnabled: !!d.icloudSyncEnabled,
      routePlannerFilters: d.routePlannerFilters && typeof d.routePlannerFilters === 'object' ? d.routePlannerFilters : {},
      pinnedTabs: strings(d.pinnedTabs), editedBy: textOf(d.editedBy), editedAt: c.moment('edited_at', d.editedAt),
      lastSeenAt: c.moment('last_seen_at', d.lastSeenAt), lastLoginAt: c.moment('last_login_at', d.lastLoginAt),
      ...stamp(c, d)
    });
  }

  // Report recipients need both the location and the user to exist.
  for (const d of src.locations) {
    const locationId = idOf(d._id);
    if (!locationId || !locationIdByName.has(d.name)) continue;
    const seen = new Set<string>();
    strings(d.dailyReportEmail?.userIds).forEach(raw => {
      const userId = idOf(raw);
      if (!userId || !userIds.has(userId)) { problems.push({ table: 'location_report_recipients', id: locationId, field: 'user_id', reason: 'recipient is not a user', outcome: 'skipped' }); return; }
      if (seen.has(userId)) return;
      seen.add(userId);
      rows.locationReportRecipients.push({ locationId, userId, position: seen.size - 1 });
    });
  }

  for (const d of src.visitTypes) {
    const id = idOf(d._id);
    if (!id || !d.name) continue;
    const c = rowConverter(problems, 'visit_types', id);
    const f = d.fields || {};
    rows.visitTypes.push({
      id, name: d.name, label: textOf(d.label) || d.name, sortOrder: numOrNull(d.order) ?? 0,
      active: d.active !== false, system: !!d.system, usesNotes: f.notes !== false, usesOutcome: f.outcome !== false,
      followUp: ['none', 'optional', 'always'].includes(f.followUp) ? f.followUp : 'optional',
      updatedBy: textOf(d.updatedBy), ...stamp(c, d)
    });
  }
  for (const d of src.resourceFamilies) {
    const id = idOf(d._id);
    if (!id || !d.name) continue;
    const c = rowConverter(problems, 'resource_families', id);
    rows.resourceFamilies.push({
      id, name: d.name, label: textOf(d.label) || d.name, sortOrder: numOrNull(d.order) ?? 0,
      active: d.active !== false, system: !!d.system, updatedBy: textOf(d.updatedBy), ...stamp(c, d)
    });
  }
  const familyNames = new Set(rows.resourceFamilies.map(f => f.name));
  for (const d of src.resourceTypes) {
    const id = idOf(d._id);
    if (!id || !d.name) continue;
    const c = rowConverter(problems, 'resource_types', id);
    const family = textOf(d.family) || 'other';
    if (!familyNames.has(family)) { c.problem('family', 'not a resource family', 'skipped'); continue; }
    rows.resourceTypes.push({
      id, name: d.name, label: textOf(d.label) || d.name, sortOrder: numOrNull(d.order) ?? 0,
      active: d.active !== false, family, updatedBy: textOf(d.updatedBy), ...stamp(c, d)
    });
  }

  return {
    rows,
    index: {
      locationIdByName, zoneOfLocation, userIds,
      zoneOfUser: id => zoneOfLocation(id ? homeOf.get(id) : ''),
      resourceTypeNames: new Set(rows.resourceTypes.map(t => t.name)),
      visitTypeNames: new Set(rows.visitTypes.map(t => t.name))
    }
  };
}

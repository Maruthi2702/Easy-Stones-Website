/**
 * Postgres check-in rows → the check-in as MongoDB held it (`_id`, the branch's name in
 * `location`, the sheet's lines in `selections`, `loggedBy`), so the routes, the emails and
 * the screens never learn which database answered.
 */
import type { officeCheckIns, checkInSelections } from '../schema/checkInsHolds.ts';
import type { Loose } from '../../types/records.ts';

export function checkInDoc(c: typeof officeCheckIns.$inferSelect, locationName: string | null,
  lines: (typeof checkInSelections.$inferSelect)[]): Loose {
  return {
    _id: c.id,
    name: c.name,
    // Empty only when its stored branch wasn't a location when copied.
    location: locationName ?? '',
    phone: c.phone,
    email: c.email,
    fabricatorCompany: c.fabricatorCompany,
    fabricatorName: c.fabricatorName,
    fabricatorPhone: c.fabricatorPhone,
    status: c.status,
    builderName: c.builderName,
    builderPhone: c.builderPhone,
    selections: [...lines].sort((a, b) => a.position - b.position).map(s => ({
      _id: s.id, material: s.material, details: s.details, size: s.size, lot: s.lot, priceCentsPerSf: s.priceCentsPerSf
    })),
    specialNotes: c.specialNotes,
    internalNotes: c.internalNotes,
    salesRep: c.salesRepName,
    salesRepEmail: c.salesRepEmail,
    sheetEditedBy: c.sheetEditedBy,
    sheetEditedAt: c.sheetEditedAt,
    loggedBy: {
      ...(c.loggedByUserId ? { userId: c.loggedByUserId } : {}),
      displayName: c.loggedByDisplayName,
      username: c.loggedByUsername
    },
    createdAt: c.createdAt,
    updatedAt: c.updatedAt
  };
}

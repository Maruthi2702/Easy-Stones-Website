/** MongoDB → Postgres rows for Permits (src/db/schema/permits.ts). */
import type { Loose } from '../../types/records.ts';
import type { permits, permitContacts, permitRuns, permitChecks, permitContractors, permitContractorNames } from '../schema/permits.ts';
import { plainJson } from './linkedRows.ts';
import { idOf, idTime, textOf, rowConverter, intOf, pickOf, decimalOf, stringsOf, boolOf, type CopyProblem } from './values.ts';

type Row<T extends { $inferInsert: unknown }> = T['$inferInsert'];

export interface PermitsSource {
  permits: Loose[];
  permitRuns: Loose[];
  permitChecks: Loose[];
  permitContractors: Loose[];
  permitContractorNames: Loose[];
}

export interface PermitsRows {
  permits: Row<typeof permits>[];
  permitContacts: Row<typeof permitContacts>[];
  permitRuns: Row<typeof permitRuns>[];
  permitChecks: Row<typeof permitChecks>[];
  permitContractors: Row<typeof permitContractors>[];
  permitContractorNames: Row<typeof permitContractorNames>[];
}

/** Every office read is in Washington. */
const ZONE = 'America/Los_Angeles';

export function permitsRows(src: PermitsSource, problems: CopyProblem[]): PermitsRows {
  const rows: PermitsRows = { permits: [], permitContacts: [], permitRuns: [], permitChecks: [], permitContractors: [], permitContractorNames: [] };

  for (const d of src.permits) {
    const id = idOf(d._id);
    if (!id) continue;
    const c = rowConverter(problems, 'permits', id);
    rows.permits.push({
      id, source: textOf(d.source), permitNumber: textOf(d.permitNumber), externalId: textOf(d.externalId),
      category: textOf(d.category), type: textOf(d.type), subtype: textOf(d.subtype), status: textOf(d.status),
      appliedOn: c.day('applied_on', d.appliedOn, ZONE), issuedOn: c.day('issued_on', d.issuedOn, ZONE),
      finaledOn: c.day('finaled_on', d.finaledOn, ZONE), expiresOn: c.day('expires_on', d.expiresOn, ZONE),
      address: textOf(d.address), city: textOf(d.city), zip: textOf(d.zip), parcel: textOf(d.parcel),
      projectName: textOf(d.projectName), description: textOf(d.description),
      valuation: decimalOf(d.valuation), sqft: decimalOf(d.sqft), units: decimalOf(d.units),
      detailsAt: c.moment('details_at', d.detailsAt), sourceUrl: textOf(d.sourceUrl), finalOnly: boolOf(d.finalOnly),
      firstSeenAt: c.moment('first_seen_at', d.firstSeenAt) ?? idTime(d._id),
      lastSeenAt: c.moment('last_seen_at', d.lastSeenAt) ?? idTime(d._id),
      createdAt: c.moment('created_at', d.createdAt), updatedAt: c.moment('updated_at', d.updatedAt)
    });
    (Array.isArray(d.contacts) ? d.contacts : []).forEach((x: Loose, position: number) => {
      rows.permitContacts.push({
        permitId: id, position, role: textOf(x.role), kind: textOf(x.kind) || 'other', company: textOf(x.company),
        name: textOf(x.name), phone: textOf(x.phone), email: textOf(x.email), address: textOf(x.address),
        license: x.license == null ? null : String(x.license)
      });
    });
  }

  for (const d of src.permitRuns) {
    const id = idOf(d._id);
    if (!id) continue;
    const c = rowConverter(problems, 'permit_runs', id);
    const kind = pickOf(c, 'kind', d.kind, ['backfill', 'daily', 'manual'] as const, null);
    const since = c.day('since', d.since, ZONE), startedAt = c.moment('started_at', d.startedAt);
    if (!kind || !since || !startedAt) { c.problem('id', 'no kind, since or start', 'skipped'); continue; }
    const count = (f: string, v: unknown) => intOf(c, f, v) ?? 0;
    rows.permitRuns.push({
      id, source: textOf(d.source), kind, since, startedAt, finishedAt: c.moment('finished_at', d.finishedAt),
      ok: boolOf(d.ok), error: textOf(d.error), by: textOf(d.by), pages: count('pages', d.pages), seen: count('seen', d.seen),
      leads: count('leads', d.leads), added: count('added', d.added), updated: count('updated', d.updated),
      detailErrors: count('detail_errors', d.detailErrors), latestIssuedOn: c.day('latest_issued_on', d.latestIssuedOn, ZONE),
      unsortedTypes: (Array.isArray(d.unsortedTypes) ? d.unsortedTypes : []).map((u: Loose) => plainJson({ type: u?.type ?? null, count: u?.count ?? null }))
    });
  }

  for (const d of src.permitChecks) {
    const id = idOf(d._id);
    if (!id) continue;
    const c = rowConverter(problems, 'permit_checks', id);
    const checkedAt = c.moment('checked_at', d.checkedAt);
    if (!checkedAt || !d.month) { c.problem('id', 'no month or check time', 'skipped'); continue; }
    const count = (f: string, v: unknown) => intOf(c, f, v) ?? 0;
    rows.permitChecks.push({
      id, source: textOf(d.source) || 'whatcom', month: textOf(d.month),
      method: pickOf(c, 'method', d.method, ['report', 'search'] as const, 'report'), filled: count('filled', d.filled),
      addedFromReport: stringsOf(d.addedFromReport), reportTitle: textOf(d.reportTitle), reportUrl: textOf(d.reportUrl), checkedAt,
      inReport: count('in_report', d.inReport), matched: count('matched', d.matched), missingFromApp: stringsOf(d.missingFromApp),
      notInReport: stringsOf(d.notInReport), inSearch: count('in_search', d.inSearch), notFoundAgain: stringsOf(d.notFoundAgain),
      notInCountySearch: stringsOf(d.notInCountySearch), notIssuedYet: stringsOf(d.notIssuedYet),
      datesMoved: stringsOf(d.datesMoved), notPublic: stringsOf(d.notPublic), ok: boolOf(d.ok), error: textOf(d.error)
    });
  }

  for (const d of src.permitContractors) {
    const id = idOf(d._id);
    if (!id) continue;
    const c = rowConverter(problems, 'permit_contractors', id);
    rows.permitContractors.push({
      id, license: textOf(d.license), businessName: textOf(d.businessName), phone: textOf(d.phone), address: textOf(d.address),
      city: textOf(d.city), state: textOf(d.state), zip: textOf(d.zip), licenseType: textOf(d.licenseType),
      specialty: textOf(d.specialty), specialty2: textOf(d.specialty2), status: textOf(d.status),
      expiresOn: c.day('expires_on', d.expiresOn, ZONE), principal: textOf(d.principal), ubi: textOf(d.ubi),
      notFound: boolOf(d.notFound), refreshedAt: c.moment('refreshed_at', d.refreshedAt) ?? idTime(d._id)
    });
  }

  for (const d of src.permitContractorNames) {
    const id = idOf(d._id);
    if (!id) continue;
    const c = rowConverter(problems, 'permit_contractor_names', id);
    rows.permitContractorNames.push({
      id, name: textOf(d.name), license: textOf(d.license), candidates: intOf(c, 'candidates', d.candidates) ?? 0,
      checkedAt: c.moment('checked_at', d.checkedAt) ?? idTime(d._id)
    });
  }

  return rows;
}

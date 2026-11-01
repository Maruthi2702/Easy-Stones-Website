import type { Loose } from '../../types/records.ts';
/**
 * Lakewood's permits, from the city's public permit portal (a Clariti /
 * OnCamino Public Portal; rules/lakewood.ts). The portal's pages call a public
 * GraphQL API with no login, and this makes the same calls (checked 2026-11-01):
 *
 *   1. `publicProjectTypes` → the ids of every type under "Building Applications"
 *   2. `publicEntryList` for those types, **newest change first**, 500 to a page,
 *      read until a page reaches permits last changed before `since`. The order
 *      is checked as it is read — an entry newer than the one before it stops the
 *      run rather than risk a permit being missed.
 *   3. for each permit that is issued (or since finaled / closed), last changed
 *      since `since`, and of a lead type or one nobody has sorted: its
 *      `statusHistory`, whose first "Issued" is the day it was issued (the list
 *      has no issue date). One issued before `since` is dropped.
 *   4. `details(id)`: the permit's page — description, applicant, owner,
 *      contractor, units, parcel and expiry.
 *
 * Server-only. `fetchImpl` and `sleep` are injectable for tests.
 */
import { cleanText, dayOf, isDay } from '../common.ts';
import lakewood, { typeTail, LAKEWOOD_API, LAKEWOOD_ORG_ID, LAKEWOOD_TYPE_ROOT, LAKEWOOD_ISSUED_STATUSES } from '../rules/lakewood.ts';
import { fetchJson } from './http.ts';

const NAME = 'Lakewood’s permit portal';
const PAGE_SIZE = 500;
const MAX_PAGES = 40;
const HISTORY_CONCURRENCY = 3;

const TYPES_QUERY = `query ProjectTypeTree($organizationId: ID!) {
  publicProjectTypes(type: SubmissionType, organizationId: $organizationId) { projectTypes { id fullName } }
}`;
const LIST_QUERY = `query PublicEntryList($organizationId: ID!, $page: Int, $perPage: Int, $filters: PublicPortalEntriesFilterInput) {
  publicEntryList(organizationId: $organizationId, page: $page, perPage: $perPage, filters: $filters) {
    items { id entryName entryNumber fullLocation projectTypeFullName workflowStatus createdAt updatedAt }
    metadata { total hasNextPage }
  }
}`;
const HISTORY_QUERY = `query StatusHistory($organizationId: ID!, $entryId: ID!) {
  publicEntryFullDetails(organizationId: $organizationId, entryId: $entryId, entryName: submission) {
    statusHistory { workflowStatus updatedAt }
  }
}`;
const DETAILS_QUERY = `query Details($organizationId: ID!, $entryId: ID!) {
  publicEntryFullDetails(organizationId: $organizationId, entryId: $entryId, entryName: submission) {
    entryDetails { entryNumber expiresAt }
    entryMiscDetails { dataFieldValues { formattedValue } miscDetail { ... on PublicPortalSubmissionMiscDetail { dataField { friendlyName } } } }
    primaryLocation { apn }
  }
}`;

const statusOf = (s: unknown) => cleanText(s);
const ISSUED = new Set(LAKEWOOD_ISSUED_STATUSES.map((s) => s.toLowerCase()));

export function createLakewoodSource({ fetchImpl = globalThis.fetch, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)), pauseMs = 250 }: Loose = {}) {
  const query = async (text: string, variables: Loose) => {
    const data = await fetchJson(LAKEWOOD_API, {
      fetchImpl, sleep, pauseMs, name: NAME,
      errorOf: (d: Loose) => (d?.errors?.length ? cleanText(d.errors[0]?.message) || 'error' : null),
      init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: text, variables: { organizationId: LAKEWOOD_ORG_ID, ...variables } }) }
    });
    if (!data?.data) throw new Error(`${NAME} answered without data`);
    return data.data;
  };

  async function buildingTypeIds() {
    const data = await query(TYPES_QUERY, {});
    const ids = (data.publicProjectTypes?.projectTypes || [])
      .filter((t: Loose) => cleanText(t.fullName?.[0]) === LAKEWOOD_TYPE_ROOT)
      .map((t: Loose) => String(t.id));
    if (!ids.length) throw new Error(`${NAME} has no "${LAKEWOOD_TYPE_ROOT}" types — it may have changed`);
    return ids;
  }

  /** Every building permit last changed on or after `since`, newest change first. */
  async function listChangedSince(since: string) {
    const typeIds = await buildingTypeIds();
    const items: Loose[] = [];
    let total = 0;
    let pages = 0;
    let previous = Infinity;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const data = await query(LIST_QUERY, { page, perPage: PAGE_SIZE, filters: { showCases: false, showSubmissions: true, projectTypeIds: typeIds } });
      const list = data.publicEntryList;
      if (!list?.items || !list.metadata) throw new Error(`${NAME}’s permit list had no items — it may have changed`);
      pages++;
      total = list.metadata.total;
      let reachedOlder = false;
      for (const item of list.items) {
        const changed = dayOf(item.updatedAt);
        if (!changed) throw new Error(`${NAME} sent permit ${item.entryNumber} with no change date`);
        const at = Date.parse(item.updatedAt);
        if (at > previous) throw new Error(`${NAME}’s list is no longer newest-first (permit ${item.entryNumber}) — stopped so nothing is missed`);
        previous = at;
        if (changed < since) { reachedOlder = true; break; }
        items.push(item);
      }
      if (reachedOlder || !list.metadata.hasNextPage) return { items, total, pages };
      if (page === MAX_PAGES) throw new Error(`${NAME} still had permits after ${MAX_PAGES} pages — stopped`);
    }
    return { items, total, pages };
  }

  /** The day a permit first became "Issued", or null. */
  async function issuedDay(entryId: string) {
    const data = await query(HISTORY_QUERY, { entryId });
    const history = data.publicEntryFullDetails?.statusHistory;
    if (!Array.isArray(history)) throw new Error(`${NAME} had no status history for permit ${entryId}`);
    const days = history.filter((h: Loose) => statusOf(h.workflowStatus).toLowerCase() === 'issued').map((h: Loose) => dayOf(h.updatedAt)).filter(Boolean).sort();
    return days[0] || null;
  }

  /** Every building permit issued on or after `since` (YYYY-MM-DD), one row each. */
  async function issuedSince(since: string) {
    if (!isDay(since)) throw new Error(`Not a date: ${since}`);
    const { items, total, pages } = await listChangedSince(since);
    const candidates = items.filter((item) => {
      if (!ISSUED.has(statusOf(item.workflowStatus).toLowerCase())) return false;
      const [klass, type] = typeTail(item.projectTypeFullName);
      return Boolean(lakewood.categoryFor(klass, type)) || lakewood.isUnsorted(klass, type);
    });
    const rows: Loose[] = [];
    let next = 0;
    const worker = async () => {
      while (next < candidates.length) {
        const item = candidates[next++];
        await sleep(pauseMs);
        const issuedOn = await issuedDay(String(item.id));
        if (!issuedOn || issuedOn < since) continue;
        rows.push({
          id: String(item.id), number: cleanText(item.entryNumber), address: cleanText(item.fullLocation), tree: item.projectTypeFullName,
          status: statusOf(item.workflowStatus), createdOn: dayOf(item.createdAt), issuedOn
        });
      }
    };
    await Promise.all(Array.from({ length: Math.min(HISTORY_CONCURRENCY, candidates.length) }, worker));
    rows.sort((a, b) => (a.issuedOn < b.issuedOn ? 1 : a.issuedOn > b.issuedOn ? -1 : a.number.localeCompare(b.number)));
    return { rows, pages, total };
  }

  /** One permit's page: the people, description, units, parcel and expiry. */
  async function details(entryId: string | number) {
    await sleep(pauseMs);
    const data = await query(DETAILS_QUERY, { entryId: String(entryId) });
    const full = data.publicEntryFullDetails;
    if (!full?.entryDetails?.entryNumber) throw new Error(`${NAME} had no record for permit ${entryId}`);
    const field = (label: string) => {
      for (const m of full.entryMiscDetails || []) {
        if (cleanText(m.miscDetail?.dataField?.friendlyName).toLowerCase() !== label.toLowerCase()) continue;
        const value = (m.dataFieldValues || []).map((v: Loose) => cleanText(v.formattedValue)).find(Boolean);
        if (value) return value;
      }
      return '';
    };
    return {
      description: field('Project Description'),
      applicant: field('Applicant Name'),
      owner: field('Property Owner Name'),
      contractor: field('Contractor Name'),
      sqft: field('Square Footage'),
      units: field('Total Number of Units'),
      parcel: cleanText(full.primaryLocation?.apn),
      expiresOn: full.entryDetails.expiresAt
    };
  }

  return { issuedSince, details };
}

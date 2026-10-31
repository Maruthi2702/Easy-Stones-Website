import type { Loose } from '../../types/records.ts';
/**
 * Permits from a Tyler EnerGov self-service site (the search an office's own
 * public pages run — no login): Whatcom County and Renton (2026-10-14).
 *
 *   GET  /api/energov/search/criteria         the empty search the site starts from
 *   POST /api/energov/search/search           one page of results
 *   GET  /api/energov/permits/permit/:caseId  one permit: valuation, sq ft, contacts
 *
 * The search's date and type filters are ignored by the county's server
 * (checked 2026-10-11 — every variant still answered all 140,801 records), so
 * this never relies on them. It asks for everything newest-issued first and
 * reads page after page until the issue dates fall before `since`. A permit
 * issued while it reads only pushes rows down a page, so one can be seen twice
 * (dropped by id) but not skipped.
 *
 * Server-only. `fetchImpl` and `sleep` are injectable for tests.
 */
import { dayOf } from '../common.ts';
import { WHATCOM_PORTAL } from '../rules/whatcom.ts';
import { RENTON_PORTAL, RENTON_TENANT } from '../rules/renton.ts';
import { BROWSER_UA, fetchJson } from './http.ts';

const headersFor = (tenant: unknown) => Object.freeze({
  Accept: 'application/json',
  'Content-Type': 'application/json;charset=utf-8',
  tenantId: '1',
  'Tyler-TenantUrl': tenant,
  'Tyler-Tenant-Culture': 'en-US',
  'User-Agent': BROWSER_UA
});
const PAGE_SIZE = 100;
// Six months is ~20 pages; this only stops a runaway loop.
const MAX_PAGES = 400;

/**
 * One EnerGov site's reader. `name` is how errors name it ("Renton answered
 * 503…"); `tenant` is the site's Tyler tenant (its /api/tenants list).
 */
export function createEnergovSource({ name, tenant, base, modern = false, fetchImpl = globalThis.fetch, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)), pauseMs = 250 }: Loose) {
  const HEADERS = headersFor(tenant);
  const call = (path: unknown, { method = 'GET', body }: Loose = {}) => fetchJson(`${base}${path}`, {
    fetchImpl, sleep, pauseMs, name,
    errorOf: (data: Loose) => (data?.Success === false ? data.ErrorMessage || data.Message || 'error' : null),
    init: { method, headers: HEADERS, ...(body !== undefined && { body: JSON.stringify(body) }) }
  });

  let template = null;
  async function criteria() {
    if (!template) {
      const data = await call('/api/energov/search/criteria');
      if (!data?.Result?.PermitCriteria) throw new Error(`${name}’s search form has changed — no permit criteria in it`);
      template = data.Result;
    }
    return structuredClone(template);
  }

  async function searchPage(page: unknown, keyword = '') {
    const c = await criteria();
    // The site's own permit search: module "All" filtered to permits, newest issued first.
    Object.assign(c, { Keyword: keyword, SearchModule: 1, FilterModule: 2, SortBy: 'IssueDate', SortAscending: false, PageNumber: page, PageSize: PAGE_SIZE });
    Object.assign(c.PermitCriteria, { SortBy: 'IssueDate', SortAscending: false, PageNumber: page, PageSize: PAGE_SIZE });
    const data = await call('/api/energov/search/search', { method: 'POST', body: c });
    const result = data?.Result;
    if (!result || !Array.isArray(result.EntityResults)) throw new Error(`${name}’s search answered without a result list`);
    return result;
  }

  /**
   * Every permit issued on or after `since` (YYYY-MM-DD), all types, as the
   * site's search rows. `pages` and `total` are for the run log. With
   * `keyword` (a permit-number code like 'SFR2026'), only the permits the
   * site's text search matches — the month-to-date accuracy check's second,
   * independent way into the same records.
   */
  async function issuedSince(since: string, { keyword = '' }: Loose = {}) {
    const rows = [];
    const seen = new Set();
    let pages = 0;
    let total = null;
    let lastDay = null;
    for (let page = 1; page <= MAX_PAGES; page++) {
      if (page > 1) await sleep(pauseMs);
      const result = await searchPage(page, keyword);
      pages += 1;
      total = result.TotalFound ?? total;
      const list = result.EntityResults;
      let reachedEnd = !list.length;
      for (const row of list) {
        const day = dayOf(row.IssueDate);
        // Newest first: the first row without an issue date, or older than
        // `since`, means everything after it is older too.
        if (!day || day < since) { reachedEnd = true; break; }
        if (lastDay && day > lastDay) {
          throw new Error(`${name}’s results weren’t newest-first (page ${page}: ${day} after ${lastDay}) — stopped so nothing is missed`);
        }
        lastDay = day;
        if (seen.has(row.CaseId)) continue;
        seen.add(row.CaseId);
        rows.push(row);
      }
      if (reachedEnd) return { rows, pages, total };
    }
    throw new Error(`${name}: still finding permits after ${MAX_PAGES} pages — stopped`);
  }

  /**
   * One permit's full record (valuation, square feet, contacts). A `modern`
   * site (the City of Snohomish's newer EnerGov) keeps them apart: the permit
   * at /api/energov/permits/:id (`Value`, `SquareFeet`, no contacts) and its
   * people from /api/energov/entity/contacts/search/search (names and roles,
   * no phone or email) — both read here into the shape the older sites send.
   */
  async function modernDetails(caseId: string | number) {
    await sleep(pauseMs);
    const data = await call(`/api/energov/permits/${encodeURIComponent(caseId)}`);
    if (!data?.Result || data.Result.PermitNumber === undefined) throw new Error(`${name} had no record for permit ${caseId}`);
    await sleep(pauseMs);
    const people = await call('/api/energov/entity/contacts/search/search', { method: 'POST', body: { EntityId: caseId, ModuleId: 1, PageNumber: 1, PageSize: 100 } })
      .catch((err) => { if (/answered 200/.test((err as Error).message)) return { Result: [] }; throw err; });
    return {
      ...data.Result,
      ValuationValue: data.Result.Value,
      Contacts: (people?.Result || []).map((c: string) => ({
        ContactTypeName: c.ContactTypeName, GlobalEntityName: c.GlobalEntityName, FirstName: c.FirstName, LastName: c.LastName
      }))
    };
  }

  async function details(caseId: string | number) {
    if (modern) return modernDetails(caseId);
    await sleep(pauseMs);
    const data = await call(`/api/energov/permits/permit/${encodeURIComponent(caseId)}`);
    if (!data?.Result || data.Result.PermitNumber === undefined) throw new Error(`${name} had no record for permit ${caseId}`);
    return data.Result;
  }

  return { issuedSince, details };
}

/** Whatcom County (unincorporated areas). */
export const createWhatcomSource = (opts: Loose = {}) => createEnergovSource({ name: 'Whatcom County', tenant: 'WhatcomCountyWAProd', base: WHATCOM_PORTAL, ...opts });

/** City of Renton. */
export const createRentonSource = (opts: Loose = {}) => createEnergovSource({ name: 'Renton', tenant: RENTON_TENANT, base: RENTON_PORTAL, ...opts });

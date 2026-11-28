/**
 * Multifamily leads (2026-11-20, on `feat/project-leads`): construction projects from a
 * ConstructConnect export, with the companies on each (architect, owner, general
 * contractor…), so sales can contact them to onboard or send samples to specify our
 * stone. Rules shared by the server (import, list) and the screen.
 *
 * The file is the export "Design Team" sheet: one row per company per project, the
 * project's own columns repeating. An optional second sheet, "Custom", adds the unit
 * count and owner type and is matched by title + street address.
 */

export const LEAD_STATUSES = ['new', 'contacted', 'samples', 'onboarded', 'not_a_fit'] as const;
export type LeadStatus = typeof LEAD_STATUSES[number];

export const STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  samples: 'Samples sent',
  onboarded: 'Onboarded',
  not_a_fit: 'Not a fit'
};

export const isLeadStatus = (v: unknown): v is LeadStatus => LEAD_STATUSES.includes(v as LeadStatus);

/** Who on a project is worth a call: they choose or buy the stone. Engineers and the like are "other". */
export const ROLE_GROUPS = ['architect', 'designer', 'owner', 'contractor', 'other'] as const;
export type RoleGroup = typeof ROLE_GROUPS[number];

export const ROLE_GROUP_LABELS: Record<RoleGroup, string> = {
  architect: 'Architects',
  designer: 'Interior designers',
  owner: 'Owners & developers',
  contractor: 'Contractors',
  other: 'Engineers & others'
};

/**
 * The group of a ConstructConnect role ("Awarded - General Contractor - Bidder", "Architect's
 * Representative"…). Engineers and consultants are checked first so "Mechanical and Electrical
 * Engineer" is never taken for a contractor.
 */
export function roleGroup(role: string): RoleGroup {
  const r = role.toLowerCase();
  if (/engineer|consultant|geotechnical|acoustical|lighting|waterproofing|food service|water feature|plans representative/.test(r)) return 'other';
  if (/interior designer/.test(r)) return 'designer';
  if (/landscape/.test(r)) return 'other';
  if (/architect/.test(r)) return 'architect';
  if (/designer/.test(r)) return 'designer';
  if (/owner|developer|tenant/.test(r)) return 'owner';
  if (/contractor|construction manager|bidder|roofing|windows|doors|site work|demolition|concrete|painting|fire protection|plumbing|hvac|mechanical/.test(r)) return 'contractor';
  return 'other';
}

export type LeadCompany = {
  companyId: string;
  name: string;
  role: string;
  group: RoleGroup;
  address: string;
  city: string;
  state: string;
  zip: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
};

export type LeadProject = {
  id: string;
  title: string;
  value: number | null;
  stage: string;
  subcategory: string;
  bidDate: string;
  listedOn: string;
  updatedOn: string;
  address: string;
  city: string;
  county: string;
  state: string;
  zip: string;
  floors: number | null;
  floorArea: number | null;
  floorAreaUnit: string;
  siteArea: number | null;
  siteAreaUnit: string;
  stageNote: string;
  units: number | null;
  ownerType: string;
  companies: LeadCompany[];
};

export type ReadLeads = { projects: LeadProject[]; problems: string[]; skippedRows: number };

type Cells = Record<string, unknown>;

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** The export writes names HTML-escaped ("Gorman &amp; Company Inc."); the screens show them as typed. One pass only. */
export function decodeEntities(s: string): string {
  return s.replace(/&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|([a-z]+));/gi, (whole, dec, hex, name) => {
    if (name) return NAMED_ENTITIES[name.toLowerCase()] ?? whole;
    const code = dec ? Number(dec) : parseInt(hex, 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

const text = (v: unknown) => (v == null ? '' : decodeEntities(String(v)).trim());
const number = (v: unknown): number | null => {
  const s = text(v).replace(/[$,]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const whole = (v: unknown) => { const n = number(v); return n == null ? null : Math.round(n); };

/** '10/3/2012 5:44:38 AM' (or an Excel Date) → '2012-10-03'; anything else → ''. */
export function dayOf(v: unknown): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`;
  }
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(text(v));
  if (!m) return '';
  const [mo, da, yr] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || da < 1 || da > 31) return '';
  return `${yr}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`;
}

/** Ten digits, or '' when the cell isn't a phone number. */
export function phoneDigits(v: unknown): string {
  const d = text(v).replace(/\D/g, '');
  const ten = d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
  return ten.length === 10 ? ten : '';
}

/** '2065551234' → '(206) 555-1234'; anything else as it is. */
export function formatPhone(p: string): string {
  return /^\d{10}$/.test(p) ? `(${p.slice(0, 3)}) ${p.slice(3, 6)}-${p.slice(6)}` : p;
}

const looksLikeEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

/** "Bidder - General Contractor - Bidder" → "General Contractor (bidder)" for the screen; unknown roles pass through. */
export function roleLabel(role: string): string {
  const parts = role.split(',').map(p => p.trim()).filter(Boolean);
  return parts.map(p => {
    const m = /^(Awarded|Bidder|Prospective Bidder|Prospective|Apparent Low|Withdrawn|Invited|Negotiated|Short Listed|Pre-Qualified|Self-Performing)\s+-\s+(.+?)(?:\s+-\s+Bidder)?$/i.exec(p);
    if (m) return `${m[2]} (${m[1].toLowerCase()})`;
    return p.replace(/\s+-\s+Bidder$/i, ' (bidder)');
  }).join(', ');
}

/** What the project's key is when matching the "Custom" sheet to it. */
const projectKey = (title: unknown, street: unknown) => `${text(title).toLowerCase()}|${text(street).toLowerCase()}`;

const REQUIRED = ['Project Id', 'Project Title', 'Project Stage', 'Project City', 'Project State/Province', 'Company Name', 'Company Classification/Role'];

/**
 * Reads the export. `designRows` are the "Design Team" rows as objects keyed by the header;
 * `customRows` (optional) the "Custom" sheet's. Refuses a file that isn't the export, and
 * skips rows with no project id. Companies repeated on a project (same company, role and
 * contact) are kept once.
 */
export function readConstructConnect(designRows: Cells[], customRows: Cells[] = []): ReadLeads {
  const problems: string[] = [];
  if (!designRows.length) return { projects: [], problems: ['The Design Team sheet is empty.'], skippedRows: 0 };
  const have = new Set(Object.keys(designRows[0]));
  const missing = REQUIRED.filter(h => !have.has(h));
  if (missing.length) {
    return { projects: [], problems: [`This isn't the ConstructConnect export: no column called ${missing.map(m => `“${m}”`).join(', ')}.`], skippedRows: 0 };
  }

  const extras = new Map<string, { units: number | null; ownerType: string }>();
  for (const r of customRows) {
    const key = projectKey(r['Project Title'], r['Street Address']);
    if (!extras.has(key)) extras.set(key, { units: whole(r['Units']), ownerType: text(r['Owner Type']) });
  }

  const byId = new Map<string, LeadProject>();
  const seen = new Set<string>();
  let skippedRows = 0;
  for (const r of designRows) {
    const id = text(r['Project Id']);
    if (!/^\d+$/.test(id)) { skippedRows++; continue; }
    let p = byId.get(id);
    if (!p) {
      const extra = extras.get(projectKey(r['Project Title'], r['Project Street Address']));
      p = {
        id,
        title: text(r['Project Title']),
        value: number(r['Project Value']),
        stage: text(r['Project Stage']).replace(/^POST BID\s*-\s*/i, ''),
        subcategory: text(r['Project Subcategory']),
        bidDate: dayOf(r['Project Bid Date']),
        listedOn: dayOf(r['Project List Date']),
        updatedOn: dayOf(r['Project Last Updated']),
        address: text(r['Project Street Address']),
        city: text(r['Project City']),
        county: text(r['Project County']),
        state: text(r['Project State/Province']),
        zip: text(r['Project Postal Code']),
        floors: whole(r['Project Floors']),
        floorArea: number(r['Project Floor Area']),
        floorAreaUnit: text(r['Project Floor Area Unit of Measure']),
        siteArea: number(r['Project Site Area']),
        siteAreaUnit: text(r['Project Site Area Unit of Measure']),
        stageNote: text(r['Project Stage Comments 1']),
        units: extra?.units ?? null,
        ownerType: extra?.ownerType ?? '',
        companies: []
      };
      byId.set(id, p);
    }
    const name = text(r['Company Name']);
    if (!name) continue;
    const role = text(r['Company Classification/Role']);
    const email = text(r['Company Email']).toLowerCase();
    const c: LeadCompany = {
      companyId: text(r['Company Id']),
      name,
      role,
      group: roleGroup(role),
      address: text(r['Company Address']),
      city: text(r['Company City']),
      state: text(r['Company State/Province']),
      zip: text(r['Company Postal Code']),
      firstName: text(r['Company Contact First Name']),
      lastName: text(r['Company Contact Last Name']),
      phone: phoneDigits(r['Company Phone Number']),
      email: looksLikeEmail(email) ? email : ''
    };
    const dupe = `${id}|${c.companyId || c.name}|${role}|${c.firstName}|${c.lastName}`.toLowerCase();
    if (seen.has(dupe)) continue;
    seen.add(dupe);
    p.companies.push(c);
  }
  if (!byId.size) problems.push('No rows with a project id were found.');
  return { projects: [...byId.values()], problems, skippedRows };
}

/** The companies worth contacting first: owners, developers, architects, designers and contractors, with a way to reach them. */
export function reachable(c: LeadCompany): boolean {
  return c.group !== 'other' && !!(c.phone || c.email);
}

/** Best first: owners / developers decide, then architects and designers who specify, then contractors. */
const GROUP_ORDER: Record<RoleGroup, number> = { owner: 0, architect: 1, designer: 2, contractor: 3, other: 4 };
export function orderCompanies(list: LeadCompany[]): LeadCompany[] {
  return list.map((c, i) => ({ c, i }))
    .sort((a, b) => GROUP_ORDER[a.c.group] - GROUP_ORDER[b.c.group] || a.i - b.i)
    .map(x => x.c);
}

export function formatValue(v: number | null | undefined): string {
  if (v == null) return '—';
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M`;
  if (v >= 1e3) return `$${Math.round(v / 1e3)}K`;
  return `$${v}`;
}

/** The customer type (Add customer's TYPE_OPTIONS) a company's role most likely is. */
const TYPE_OF_GROUP: Partial<Record<RoleGroup, string>> = { architect: 'Designer', designer: 'Designer', contractor: 'Contractor', owner: 'Builder' };

/** Capitalises each all-caps or all-lowercase word ("ann LEE" → "Ann Lee"); a word that already has mixed case (McDonald) is left alone. */
const titleCase = (s: string) => s.replace(/[^\s]+/g, w => (w === w.toUpperCase() || w === w.toLowerCase()
  ? w.toLowerCase().replace(/(^|[-/.(])([a-z])/g, (_, a, b) => a + b.toUpperCase())
  : w));

/** "Ann Lee", or '' when the export names nobody. */
export const contactName = (c: Pick<LeadCompany, 'firstName' | 'lastName'>) => `${c.firstName} ${c.lastName}`.trim();

/**
 * What Add customer opens with when staff turn a company on a project into a customer
 * (the same shape the Permits contractor pop-up passes). Everything stays editable in the form.
 */
export function customerPrefillForCompany(
  project: Pick<LeadProject, 'id' | 'title' | 'city' | 'state'>,
  c: LeadCompany
) {
  const place = [project.city, project.state].filter(Boolean).join(', ');
  const type = TYPE_OF_GROUP[c.group];
  return {
    company: titleCase(c.name),
    customerName: titleCase(contactName(c)),
    phone: formatPhone(c.phone),
    email: c.email,
    marketingEmail: c.email,
    address: { street: titleCase(c.address), city: titleCase(c.city), state: c.state, zipCode: c.zip.slice(0, 5) },
    ...(type ? { customerType: type } : {}),
    status: 'New Lead',
    notes: [`${roleLabel(c.role)} on “${project.title}”${place ? ` (${place})` : ''}`, 'Added from Multifamily Leads'].join(' · ')
  };
}

/** Days before today (a YYYY-MM-DD in the caller's own calendar) for the "Updated" presets. */
export const UPDATED_RANGES = [
  { id: 'all', label: 'Any time', days: 0 },
  { id: '90', label: 'Last 90 days', days: 90 },
  { id: '365', label: 'Last 12 months', days: 365 },
  { id: '730', label: 'Last 2 years', days: 730 }
] as const;

export function updatedFromFor(rangeId: string, today: Date = new Date()): string {
  const r = UPDATED_RANGES.find(x => x.id === rangeId);
  if (!r || !r.days) return '';
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - r.days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const MIN_VALUES = [
  { value: '', label: 'Any value' },
  { value: '1000000', label: '$1M +' },
  { value: '5000000', label: '$5M +' },
  { value: '10000000', label: '$10M +' },
  { value: '25000000', label: '$25M +' },
  { value: '50000000', label: '$50M +' }
] as const;

/** "Jun 25, 2026" from a YYYY-MM-DD, or '—'. */
export function formatDayShort(day: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day ?? '');
  if (!m) return '—';
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

/** The Excel export: one row per company on each project, so a list can be worked down by phone or email. */
export function leadExportRows(items: (Omit<LeadProject, 'companies'> & { status: LeadStatus; assignedTo: string; companies: LeadCompany[] })[]) {
  return items.flatMap(p => {
    const base = {
      Project: p.title, Address: p.address, City: p.city, State: p.state, Zip: p.zip,
      Value: p.value ?? '', Stage: p.stage, Type: p.subcategory, Units: p.units ?? '', Updated: p.updatedOn,
      'Lead Status': STATUS_LABELS[p.status] ?? p.status, 'Assigned To': p.assignedTo
    };
    const list = p.companies.length ? p.companies : [null];
    return list.map(c => ({
      ...base,
      Company: c?.name ?? '', Role: c ? roleLabel(c.role) : '', Contact: c ? contactName(c) : '',
      Phone: c ? formatPhone(c.phone) : '', Email: c?.email ?? ''
    }));
  });
}

/** What the closed States dropdown says: "All states", "Texas", "Texas + Washington", "3 states". */
export function statesSummary(selected: string[]): string {
  if (!selected.length) return 'All states';
  if (selected.length === 1) return selected[0];
  if (selected.length === 2) return `${selected[0]} + ${selected[1]}`;
  return `${selected.length} states`;
}

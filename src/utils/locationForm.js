/**
 * Add / Edit location (Users & Roles → Locations): the rules shared by the
 * form (src/components/sales/locations/LocationForm.jsx) and the server
 * (POST/PATCH /api/admin/locations in server.js), so a location can't pass
 * one and fail the other. Pure functions only — no React, no database.
 *
 * Two shapes:
 *  - form values: flat strings/booleans, one per field on screen
 *  - the record:  the nested Location document (src/models/Location.js)
 * locationToFormValues / locationRecordFromValues convert between them; the
 * server validates by converting a request body to form values and back, so
 * it runs exactly the checks the form does.
 *
 * `name` (the short name, e.g. "Charlotte") is the key every other record
 * uses — users' assignedLocations, check-ins, daily reports — so it is set
 * once on create and never renamed. `fullName` ("Easy Stones - Charlotte") is
 * what prints.
 */
import { normalizeLocationCode } from './locationCode.js';
import { formatPhoneForDisplay, stripPhone } from './phoneUtils.js';

export const PRICE_LEVELS = [1, 2, 3, 4];
export const priceLevelLabel = (level) => (level ? `Price ${level}` : '');
// C.O.D is the only payment term for now (owner, 2026-10-04) — new locations
// start on it. Add terms here when there are more; the API accepts only
// what's listed.
export const PAYMENT_TERMS = ['C.O.D'];
export const DEFAULT_PAYMENT_TERMS = 'C.O.D';

// Every field the form can flag, in on-screen order — the error banner lists
// them in this order and "Go to first" goes to the first.
export const FIELD_LABELS = {
  fullName: 'Full name',
  name: 'Short name',
  shortCode: 'Short code',
  region: 'Region',
  rdc: 'RDC',
  contactName: 'Contact name',
  email: 'Email address',
  street: 'Street address',
  suite: 'Suite / unit',
  city: 'City',
  state: 'State',
  zip: 'ZIP code',
  phone: 'Phone number',
  fax: 'Fax number',
  website: 'Website',
  acctName: 'Accounting contact name',
  acctEmail: 'Accounting email',
  acctStreet: 'Accounting street address',
  acctSuite: 'Accounting suite / unit',
  acctCity: 'Accounting city',
  acctState: 'Accounting state',
  acctZip: 'Accounting ZIP code',
  acctPhone: 'Accounting phone',
  salesRep: 'Sales person',
  priceLevel: 'Price level',
  paymentTerms: 'Payment terms',
  salesTaxArea: 'Sales tax area',
  salesTaxRate: 'Sales tax rate',
  avgUnitFreight: 'Avg unit freight',
  unitOverheadPct: 'Unit overhead cost'
};

const BOOLEAN_FIELDS = ['profitCenter', 'warehouse', 'acctSameAsPrimary'];
export const ADDRESS_FIELDS = ['street', 'suite', 'city', 'state', 'zip'];

const str = (v) => (v === null || v === undefined ? '' : String(v));
const trim = (v) => str(v).trim();
const numText = (v) => (v === null || v === undefined || v === '' ? '' : String(v));

export const emptyLocationValues = () => ({
  fullName: '', name: '', shortCode: '', region: '', rdc: '',
  profitCenter: false, warehouse: false,
  contactName: '', email: '', street: '', suite: '', city: '', state: '', zip: '',
  phone: '', fax: '', website: '',
  acctSameAsPrimary: true,
  acctName: '', acctEmail: '', acctStreet: '', acctSuite: '', acctCity: '', acctState: '', acctZip: '', acctPhone: '',
  salesRep: '', priceLevel: '', paymentTerms: DEFAULT_PAYMENT_TERMS, salesTaxArea: '', salesTaxRate: '',
  avgUnitFreight: '', unitOverheadPct: ''
});

/** A Location record (or a request body in the same shape) → form values. */
export const locationToFormValues = (loc = {}) => {
  const pc = loc.primaryContact || {};
  const pa = pc.address || {};
  const ac = loc.accountingContact || {};
  const aa = ac.address || {};
  const sd = loc.salesDefaults || {};
  const co = loc.costOverrides || {};
  return {
    fullName: str(loc.fullName),
    name: str(loc.name),
    shortCode: str(loc.shortCode),
    region: str(loc.region),
    rdc: str(loc.rdc),
    profitCenter: Boolean(loc.profitCenter),
    warehouse: Boolean(loc.warehouse),
    contactName: str(pc.name),
    email: str(pc.email),
    street: str(pa.street),
    suite: str(pa.suite),
    city: str(pa.city),
    state: str(pa.state),
    zip: str(pa.zipCode),
    phone: str(pc.phone),
    fax: str(pc.fax),
    website: str(pc.website),
    acctSameAsPrimary: loc.accountingSameAsPrimary !== false,
    acctName: str(ac.name),
    acctEmail: str(ac.email),
    acctStreet: str(aa.street),
    acctSuite: str(aa.suite),
    acctCity: str(aa.city),
    acctState: str(aa.state),
    acctZip: str(aa.zipCode),
    acctPhone: str(ac.phone),
    salesRep: str(sd.salesRep),
    priceLevel: numText(sd.priceLevel),
    paymentTerms: str(sd.paymentTerms),
    salesTaxArea: str(sd.salesTaxArea),
    salesTaxRate: numText(sd.salesTaxRate),
    avgUnitFreight: numText(co.avgUnitFreight),
    unitOverheadPct: numText(co.unitOverheadPct)
  };
};

const toNumber = (v) => (trim(v) === '' ? null : Number(trim(v)));
const phoneOut = (v) => (trim(v) ? formatPhoneForDisplay(trim(v)) : '');
const stateOut = (v) => trim(v).toUpperCase();

/** Form values → the nested record the API stores. Call after validating. */
export const locationRecordFromValues = (v) => {
  const same = v.acctSameAsPrimary !== false;
  return {
    fullName: trim(v.fullName),
    name: trim(v.name),
    shortCode: trim(v.shortCode).toUpperCase(),
    region: trim(v.region),
    rdc: trim(v.rdc),
    profitCenter: Boolean(v.profitCenter),
    warehouse: Boolean(v.warehouse),
    primaryContact: {
      name: trim(v.contactName),
      email: trim(v.email),
      phone: phoneOut(v.phone),
      fax: phoneOut(v.fax),
      website: trim(v.website),
      address: { street: trim(v.street), suite: trim(v.suite), city: trim(v.city), state: stateOut(v.state), zipCode: trim(v.zip) }
    },
    accountingSameAsPrimary: same,
    // Cleared when "same as primary" is ticked, so a stale second address
    // can't resurface if someone unticks it later.
    accountingContact: same
      ? { name: '', email: '', phone: '', address: { street: '', suite: '', city: '', state: '', zipCode: '' } }
      : {
          name: trim(v.acctName),
          email: trim(v.acctEmail),
          phone: phoneOut(v.acctPhone),
          address: { street: trim(v.acctStreet), suite: trim(v.acctSuite), city: trim(v.acctCity), state: stateOut(v.acctState), zipCode: trim(v.acctZip) }
        },
    salesDefaults: {
      salesRep: trim(v.salesRep),
      priceLevel: toNumber(v.priceLevel),
      paymentTerms: trim(v.paymentTerms),
      salesTaxArea: trim(v.salesTaxArea),
      salesTaxRate: toNumber(v.salesTaxRate)
    },
    costOverrides: {
      avgUnitFreight: toNumber(v.avgUnitFreight),
      unitOverheadPct: toNumber(v.unitOverheadPct)
    }
  };
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STATE_RE = /^[A-Za-z]{2}$/;
const ZIP_RE = /^\d{5}(-\d{4})?$/;
const WEBSITE_RE = /^(https?:\/\/)?[^\s./]+(\.[^\s./]+)+(\/\S*)?$/i;
const NUM_RE = /^\d+(\.\d+)?$/;
const tenDigits = (v) => stripPhone(trim(v)).length === 10;

/**
 * Field → message for everything wrong with these values.
 *
 * `others` is every other location ({ _id, name, shortCode }) — for the
 * unique short name / short code checks and the RDC list. On edit, pass
 * `isEdit` and `selfId`; the short name can't change then, so it isn't
 * checked for clashes.
 */
export const validateLocationValues = (v, { isEdit = false, selfId = null, others = [] } = {}) => {
  const e = {};
  const rest = others.filter((l) => !selfId || String(l._id) !== String(selfId));
  const sameName = (a, b) => trim(a).toLowerCase() === trim(b).toLowerCase();

  if (!trim(v.fullName)) e.fullName = 'Enter the full name';

  const name = trim(v.name);
  if (!name) e.name = 'Enter the short name';
  else if (!isEdit && rest.some((l) => sameName(l.name, name))) e.name = `${name} already exists`;

  const { code, error: codeError } = normalizeLocationCode(v.shortCode);
  if (codeError) e.shortCode = codeError;
  else if (code && rest.some((l) => trim(l.shortCode).toUpperCase() === code)) e.shortCode = `${code} is already used by another location`;

  const rdc = trim(v.rdc);
  if (rdc && (sameName(rdc, name) || !rest.some((l) => sameName(l.name, rdc)))) e.rdc = 'Choose another location';

  if (trim(v.email) && !EMAIL_RE.test(trim(v.email))) e.email = 'Enter a full email, like name@easystones.com';
  if (!trim(v.street)) e.street = 'Enter the street address';
  if (!trim(v.city)) e.city = 'Enter the city';
  if (!trim(v.state)) e.state = 'Enter the state';
  else if (!STATE_RE.test(trim(v.state))) e.state = 'Use the 2-letter state code, like NC';
  if (!trim(v.zip)) e.zip = 'Enter the ZIP code';
  else if (!ZIP_RE.test(trim(v.zip))) e.zip = 'Enter a 5-digit ZIP code';
  if (trim(v.phone) && !tenDigits(v.phone)) e.phone = 'Enter a 10-digit phone number';
  if (trim(v.fax) && !tenDigits(v.fax)) e.fax = 'Enter a 10-digit fax number';
  if (trim(v.website) && !WEBSITE_RE.test(trim(v.website))) e.website = 'Enter a website, like easystones.com';

  if (v.acctSameAsPrimary === false) {
    if (trim(v.acctEmail) && !EMAIL_RE.test(trim(v.acctEmail))) e.acctEmail = 'Enter a full email, like name@easystones.com';
    if (trim(v.acctState) && !STATE_RE.test(trim(v.acctState))) e.acctState = 'Use the 2-letter state code, like NC';
    if (trim(v.acctZip) && !ZIP_RE.test(trim(v.acctZip))) e.acctZip = 'Enter a 5-digit ZIP code';
    if (trim(v.acctPhone) && !tenDigits(v.acctPhone)) e.acctPhone = 'Enter a 10-digit phone number';
  }

  if (trim(v.priceLevel) && !PRICE_LEVELS.includes(Number(v.priceLevel))) e.priceLevel = 'Choose a price level';
  if (trim(v.paymentTerms) && !PAYMENT_TERMS.includes(trim(v.paymentTerms))) e.paymentTerms = 'Choose payment terms';
  if (trim(v.salesTaxRate) && !(NUM_RE.test(trim(v.salesTaxRate)) && Number(v.salesTaxRate) <= 20)) e.salesTaxRate = 'Enter a rate between 0 and 20';
  if (trim(v.avgUnitFreight) && !(NUM_RE.test(trim(v.avgUnitFreight)) && Number(v.avgUnitFreight) <= 10000)) e.avgUnitFreight = 'Enter an amount, like 1.50';
  if (trim(v.unitOverheadPct) && !(NUM_RE.test(trim(v.unitOverheadPct)) && Number(v.unitOverheadPct) <= 100)) e.unitOverheadPct = 'Enter a percent between 0 and 100';

  // Every string field has a ceiling, so the API can't be used to stuff a
  // record with megabytes of text.
  for (const [k, val] of Object.entries(v)) {
    if (!BOOLEAN_FIELDS.includes(k) && !e[k] && str(val).length > 300) e[k] = 'Too long';
  }
  return e;
};

/** How many fields differ — the number the unsaved-changes check reports. */
export const countLocationChanges = (values, initial) =>
  Object.keys(initial).filter((k) => (typeof initial[k] === 'boolean'
    ? Boolean(values[k]) !== initial[k]
    : trim(values[k]) !== trim(initial[k]))).length;

/**
 * What a request body means, for the server: the record to store, or the
 * errors the form would have shown. The short name is taken from the stored
 * record on edit, whatever the body says.
 */
export const parseLocationBody = (body, { isEdit = false, current = null, others = [] } = {}) => {
  const values = locationToFormValues(body || {});
  if (isEdit && current) values.name = str(current.name);
  const errors = validateLocationValues(values, { isEdit, selfId: current?._id, others });
  if (Object.keys(errors).length) return { errors };
  return { record: locationRecordFromValues(values) };
};

/** "City, ST 12345" — or as much of it as is there. */
const cityLine = (a = {}) => {
  const cityState = [trim(a.city), trim(a.state)].filter(Boolean).join(', ');
  return [cityState, trim(a.zipCode)].filter(Boolean).join(' ');
};

/** The address as display lines: street, suite, city line. Empty parts dropped. */
export const addressLines = (address = {}) =>
  [trim(address.street), trim(address.suite), cityLine(address)].filter(Boolean);

/** Whether a location has enough of an address to print. */
export const hasPrintableAddress = (loc) => {
  const a = loc?.primaryContact?.address || {};
  return Boolean(trim(a.street) && (trim(a.city) || trim(a.zipCode)));
};

// What every selection sheet printed before locations had addresses, and
// still prints for one that has none yet.
export const DEFAULT_LETTERHEAD = { addressLine: '6012 S 196th St, Kent, WA 98032', contactLine: '' };

/**
 * The address and contact line under "EASY STONES" on a printed or emailed
 * selection sheet, for the check-in's location.
 */
export const letterheadFor = (loc) => {
  if (!hasPrintableAddress(loc)) return { ...DEFAULT_LETTERHEAD };
  const pc = loc.primaryContact || {};
  return {
    addressLine: addressLines(pc.address).join(', '),
    contactLine: [trim(pc.phone), trim(pc.email)].filter(Boolean).join(' · ')
  };
};

/**
 * The parts of a location anyone signed in may read: what prints on sheets
 * and what the location filters need. Accounting contact, sales defaults and
 * cost overrides are for people who can manage locations only —
 * GET /api/admin/locations also answers customer logins.
 */
export const publicLocationFields = (loc = {}) => ({
  _id: loc._id,
  name: loc.name,
  shortCode: loc.shortCode || '',
  fullName: loc.fullName || '',
  primaryContact: loc.primaryContact,
  createdAt: loc.createdAt,
  updatedAt: loc.updatedAt
});

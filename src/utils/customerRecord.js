/**
 * What a create or an edit is allowed to write to a Customer, for the one set
 * of /api/customers write routes in server.js.
 *
 * Until 2026-10-06 a customer could be created two ways with different rules:
 * POST /api/sales/customers (Add customer, the visit form's "New customer",
 * the route planner) made up an email and a password, dropped the marketing
 * email and never placed the address on the map; POST /api/partners (the
 * customer list) geocoded but saved whatever the body held. Edits spread the
 * body straight into findByIdAndUpdate, so a password sent that way skipped
 * the schema's bcrypt hook. These rules are the merged version, pure so they
 * can be tested without a database.
 */

/**
 * Never written from a request body. Credentials and login state have their
 * own routes (password reset, active/inactive); the map point and the rep's
 * name are derived on the server; the arrays have their own sub-routes.
 */
export const PROTECTED_CUSTOMER_FIELDS = Object.freeze([
    '_id', '__v', 'createdAt', 'updatedAt', 'createdBy',
    'password', 'isVerified', 'isActive', 'loginAttempts', 'lockUntil', 'loginIps',
    'coordinates', 'geocode', 'salesRepName',
    'contacts', 'visits', 'resources', 'associatedCustomers', 'notDuplicateOf'
]);

const str = (v) => (v === undefined || v === null ? '' : String(v).trim());

/** "Level - 3" → 3; anything without a number → null. */
export const priceLevelOf = (level) => {
    const m = str(level).match(/\d+/);
    return m ? parseInt(m[0], 10) : null;
};

/** The four address parts, from `address` or a bare `city` (older screens). */
export const addressFrom = (body = {}) => ({
    street: str(body.address?.street),
    city: str(body.address?.city) || str(body.city),
    state: str(body.address?.state),
    zipCode: str(body.address?.zipCode)
});

/**
 * A point the caller already has (the route planner saves a Google Places
 * result with its coordinates), checked because it never went through the
 * geocoder. null when missing or out of range — the address is geocoded then.
 */
export const suppliedPoint = (coordinates) => {
    const lat = Number(coordinates?.lat);
    const lng = Number(coordinates?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    if (lat === 0 && lng === 0) return null;
    return { lat, lng };
};

/** Placeholder for a customer saved without an email (the schema needs a unique one). */
export const placeholderEmail = (now = Date.now(), random = Math.random) =>
    `sales_${now}_${random().toString(36).slice(2, 8)}@temp-customer.com`;

/**
 * The fields of a new customer, from a create body. Returns { error } when it
 * can't be saved. Rep, location defaulting beyond the string, the map point
 * and createdBy are added by the route.
 */
export const newCustomerFields = (body = {}, { now, random } = {}) => {
    const company = str(body.company);
    if (!company) return { error: 'Company name is required' };
    const realEmail = str(body.email).toLowerCase();
    const level = str(body.level) || 'Level - 3';
    const fields = {
        company,
        // contactName is required by the schema; the company stands in, as the
        // Add customer route always did, rather than a made-up "Unknown".
        contactName: str(body.customerName) || str(body.contactName) || str(body.name) || company,
        email: realEmail || placeholderEmail(now, random),
        marketingEmail: str(body.marketingEmail).toLowerCase() || realEmail,
        receiveMarketing: body.receiveMarketing !== undefined ? Boolean(body.receiveMarketing) : true,
        phone: str(body.phone),
        quickNote: str(body.notes ?? body.quickNote),
        level,
        priceLevel: priceLevelOf(level) || Number(body.priceLevel) || 1,
        customerType: str(body.customerType) || 'Fabricator',
        modaDisplay: str(body.modaDisplay) || 'No',
        modaBinder: str(body.modaBinder) || '0',
        location: str(body.location) || 'Seattle',
        address: addressFrom(body)
    };
    // Left to the schema default when not sent.
    if (str(body.status)) fields.status = str(body.status);
    if (body.followUpDate !== undefined) fields.followUpDate = body.followUpDate;
    return { fields };
};

/**
 * An edit body with everything protected removed and the old screens' aliases
 * mapped (name / customerName → contactName, notes → quickNote, level →
 * priceLevel). Rep, location and address are finished by the route, which
 * needs the stored record for them.
 */
export const customerUpdateFields = (body = {}) => {
    const update = { ...body };
    for (const key of PROTECTED_CUSTOMER_FIELDS) delete update[key];
    delete update.name;
    delete update.customerName;
    delete update.notes;
    delete update.city;
    const contactName = str(body.contactName) || str(body.customerName) || str(body.name);
    if (contactName) update.contactName = contactName;
    if (body.notes !== undefined && body.quickNote === undefined) update.quickNote = str(body.notes);
    if (body.level) {
        const p = priceLevelOf(body.level);
        if (p) update.priceLevel = p;
    }
    if (body.email !== undefined) update.email = str(body.email).toLowerCase();
    if (body.marketingEmail !== undefined) update.marketingEmail = str(body.marketingEmail).toLowerCase();
    if (body.location !== undefined) update.location = str(body.location) || 'Seattle';
    // salesRep and address are resolved by the route.
    delete update.salesRep;
    delete update.address;
    return update;
};

/**
 * One definition of "where is this customer".
 *
 * Shared by the API (which geocodes a customer as it is saved) and
 * scripts/geocode-customers.js (which backfills the ones already held), so a
 * point written by the backfill and one written by an edit can never come from
 * different rules. Nothing here touches the database or reads a request.
 *
 * The key is read at call time rather than at import, so a caller that loads
 * dotenv after this module — every script does — still finds it.
 */

/** Google's location_type, in our own words. See Customer.geocode.precision. */
export const GEOCODE_PRECISION = {
  ROOFTOP: 'rooftop',
  RANGE_INTERPOLATED: 'range',
  GEOMETRIC_CENTER: 'geometric',
  APPROXIMATE: 'approximate'
};

/**
 * The address as one comparable string — both what the geocoder is asked and
 * the record of what a stored point was derived from. Saving a customer without
 * touching the address then costs no geocoding call, and any edit that does
 * touch it always re-runs.
 */
export const addressKeyOf = (address = {}) =>
  [address.street, address.city, address.state, address.zipCode]
    .map(part => String(part || '').trim())
    .filter(Boolean)
    .join(', ')
    .replace(/\s+/g, ' ')
    .toLowerCase();

// Separate from the browser key: this one is called server-side and so can be
// IP-restricted, where VITE_GOOGLE_MAPS_API_KEY is public by nature and must be
// referrer-restricted instead. Falls back to a single shared key if that is how
// the deployment is set up.
const geocodingKey = () =>
  process.env.GOOGLE_GEOCODING_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '';

export const hasGeocodingKey = () => Boolean(geocodingKey());

const noPoint = { coordinates: { lat: null, lng: null } };

const failure = (status, error, addressKey = '') => ({
  ...noPoint,
  geocode: { status, precision: '', formattedAddress: '', addressKey, updatedAt: new Date(), error }
});

/**
 * An address turned into a point, or an honest record of why not.
 *
 * Never throws. A customer has to save whether or not Google answers, so every
 * failure comes back as fields the record can hold. The distinction that
 * matters is 'failed' vs 'pending': 'failed' means the geocoder ran and found
 * nothing, which is an address someone needs to fix, while 'pending' means we
 * could not ask and it is worth asking again.
 */
export const geocodeAddress = async (address) => {
  const query = addressKeyOf(address);

  if (!query) return failure('failed', 'no address on record');

  // Some records carry a contact's name where the street belongs — "kelvin fong",
  // "victor monjaras/ juana abundis". Sent alone, a geocoder answers those with
  // whatever business happens to match somewhere in the world, and a confident
  // pin in the wrong state is worse than no pin. A town or a postcode is what
  // makes an address answerable, so without either we do not ask.
  const hasPlace = Boolean(String(address?.city || '').trim() || String(address?.zipCode || '').trim());
  if (!hasPlace) return failure('failed', 'no city or postcode — cannot place this address', query);
  // Deliberately 'pending', not 'failed': nothing is wrong with the address, so
  // the backfill should pick it up once a key exists.
  if (!hasGeocodingKey()) return failure('pending', 'GOOGLE_GEOCODING_API_KEY not configured');

  try {
    // Constrained to the country, and to the state when the record names one:
    // a junk street line then falls back to the right town instead of matching
    // a same-named business elsewhere. Google returns ZERO_RESULTS rather than
    // reaching outside these, which is the answer we want in that case.
    const state = String(address?.state || '').trim();
    const components = ['country:US', state && `administrative_area:${state}`].filter(Boolean).join('|');
    const url = `https://maps.googleapis.com/maps/api/geocode/json`
      + `?address=${encodeURIComponent(query)}`
      + `&components=${encodeURIComponent(components)}`
      + `&key=${geocodingKey()}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const body = await response.json();

    if (body.status === 'OK' && body.results?.[0]) {
      const hit = body.results[0];
      return {
        coordinates: { lat: hit.geometry.location.lat, lng: hit.geometry.location.lng },
        geocode: {
          status: 'ok',
          precision: GEOCODE_PRECISION[hit.geometry.location_type] || 'approximate',
          formattedAddress: hit.formatted_address || '',
          addressKey: query,
          updatedAt: new Date(),
          error: ''
        }
      };
    }

    // ZERO_RESULTS is the address's fault and will not fix itself, so it is
    // recorded against this exact address and not asked again. A quota, key or
    // network problem is ours, and leaving the key empty makes the next run retry.
    const retryable = body.status !== 'ZERO_RESULTS';
    return failure(
      retryable ? 'pending' : 'failed',
      body.error_message || body.status || 'no result',
      retryable ? '' : query
    );
  } catch (error) {
    return failure('pending', String(error?.message || error));
  }
};

/**
 * The geocode fields to write alongside an address, or null when the point we
 * already hold was derived from this very address and so still stands.
 */
export const geocodePatchFor = async (address, storedKey = '') => {
  const query = addressKeyOf(address);
  if (query && query === storedKey) return null;
  return geocodeAddress(address);
};

/**
 * City/state for a bare 5-digit ZIP — the Add Customer form's autofill.
 * Reverse of geocodeAddress above (postal code in, place names out, no
 * coordinates), so it gets its own small result shape rather than reusing
 * the coordinate-shaped one: 'invalid' (not 5 digits, no call made),
 * 'not_found' (Google has no such ZIP), 'pending' (network/quota/config —
 * worth a retry), or 'ok' with { city, state }.
 */
export const zipToCityState = async (zip) => {
  const cleanZip = String(zip || '').trim();
  if (!/^\d{5}$/.test(cleanZip)) {
    return { status: 'invalid', error: 'ZIP code must be 5 digits' };
  }
  if (!hasGeocodingKey()) {
    return { status: 'pending', error: 'GOOGLE_GEOCODING_API_KEY not configured' };
  }

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json`
      + `?components=${encodeURIComponent(`postal_code:${cleanZip}|country:US`)}`
      + `&key=${geocodingKey()}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const body = await response.json();

    if (body.status === 'OK' && body.results?.[0]) {
      const components = body.results[0].address_components || [];
      const find = (type) => components.find(c => c.types.includes(type));
      // Some ZIPs (rural areas, some PO boxes) have no 'locality' — postal_town
      // and sublocality are the same field under different names elsewhere.
      const city = find('locality')?.long_name
        || find('postal_town')?.long_name
        || find('sublocality')?.long_name
        || '';
      const state = find('administrative_area_level_1')?.short_name || '';
      if (!city && !state) return { status: 'not_found', error: 'No city/state on record for this ZIP' };
      return { status: 'ok', city, state };
    }

    const retryable = body.status !== 'ZERO_RESULTS' && body.status !== 'INVALID_REQUEST';
    return {
      status: retryable ? 'pending' : 'not_found',
      error: body.error_message || body.status || 'no result'
    };
  } catch (error) {
    return { status: 'pending', error: String(error?.message || error) };
  }
};

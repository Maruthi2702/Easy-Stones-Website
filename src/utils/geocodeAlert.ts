import type { Loose } from '../types/records.ts';
import { addressKeyOf } from './geocode.ts';
import { escapeHtml } from './selectionSheet.ts';

/**
 * The email that says a new customer saved without a map point. Pure — the
 * sending, recipient and throttle are src/services/geocodeAlert.ts.
 *
 * Two kinds: `address` (Google answered and found nothing — the address needs
 * fixing, once per customer) and `setup` (the key, billing, quota or network —
 * it affects every customer until it's fixed, so it is throttled).
 */
export type GeocodeAlert = { kind: 'address' | 'setup'; subject: string; html: string; throttleKey: string };

export function geocodeAlertFor({ company, address, geocode, customerId }: { company?: string; address?: Loose; geocode?: Loose; customerId?: string }): GeocodeAlert | null {
  if (!geocode || geocode.status === 'ok') return null;
  // A customer saved with no address at all has nothing to place — not a failure.
  if (!addressKeyOf(address)) return null;

  const name = String(company || 'A new customer').trim() || 'A new customer';
  const reason = String(geocode.error || geocode.status || 'unknown');
  const kind = geocode.status === 'failed' ? 'address' : 'setup';
  // As typed (addressKeyOf is lowercased, for comparing).
  const where = [address?.street, address?.city, [address?.state, address?.zipCode].filter(Boolean).join(' ')]
    .map(part => String(part || '').trim()).filter(Boolean).join(', ');

  const what = kind === 'address'
    ? 'Google could not place this address, so the customer is saved without a pin. Check the address in Edit customer; saving a corrected address tries again.'
    : 'The customer saved fine, but the map lookup itself failed, so it has no pin yet. Other new customers will fail the same way until this is fixed (Google Cloud billing, the geocoding key in Render, or a quota). Saving the customer again once it works adds the pin.';

  const row = (label: string, value: string) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#666;white-space:nowrap;vertical-align:top">${label}</td><td style="padding:4px 0">${escapeHtml(value)}</td></tr>`;

  return {
    kind,
    throttleKey: kind === 'setup' ? `setup:${reason}` : `address:${customerId || name}`,
    subject: `Map location failed for new customer: ${name}`,
    html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:560px">
<p><strong>${escapeHtml(name)}</strong> was added without a map location.</p>
<table style="border-collapse:collapse">${row('Address', where)}${row('Google said', reason)}${customerId ? row('Customer id', customerId) : ''}</table>
<p>${escapeHtml(what)}</p>
</div>`
  };
}

/** One summary for a bulk write (Excel / SPS import) — never one email per row. */
export type GeocodeFailure = { address?: Loose; geocode?: Loose; customerId?: string };
const SHOWN = 20;

export function geocodeBatchAlertFor(failures: GeocodeFailure[], total: number): GeocodeAlert | null {
  const real = failures.filter(f => f.geocode && f.geocode.status !== 'ok' && addressKeyOf(f.address));
  if (!real.length) return null;

  const setup = real.filter(f => f.geocode!.status !== 'failed');
  const reasons = [...new Set(setup.map(f => String(f.geocode!.error || f.geocode!.status)))];
  const kind = setup.length ? 'setup' : 'address';
  const typed = (a?: Loose) => [a?.street, a?.city, [a?.state, a?.zipCode].filter(Boolean).join(' ')]
    .map(part => String(part || '').trim()).filter(Boolean).join(', ');
  const item = (f: GeocodeFailure) =>
    `<li>${escapeHtml(typed(f.address))} <span style="color:#666">— ${escapeHtml(String(f.geocode!.error || f.geocode!.status))}</span></li>`;

  const intro = `<p><strong>${real.length} of ${total}</strong> customers from a bulk save were added without a map location.</p>`;
  const why = setup.length
    ? `<p>The lookup itself failed (${escapeHtml(reasons.join('; '))}). Until that is fixed (Google Cloud billing, the geocoding key in Render, or a quota), every new customer will fail the same way. Save each one again once it works.</p>`
    : '<p>Google could not place these addresses. Check them in Edit customer; saving a corrected address tries again.</p>';

  return {
    kind,
    throttleKey: kind === 'setup' ? `setup:${reasons.join('|')}` : `batch:${real.map(f => f.customerId).join(',')}`,
    subject: `Map location failed for ${real.length} imported customer${real.length === 1 ? '' : 's'}`,
    html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:560px">${intro}${why}`
      + `<ul style="padding-left:18px">${real.slice(0, SHOWN).map(item).join('')}</ul>`
      + (real.length > SHOWN ? `<p>…and ${real.length - SHOWN} more.</p>` : '') + '</div>'
  };
}

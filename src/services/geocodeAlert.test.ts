import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendEmail = vi.fn(async (_options: { to: string[] }) => ({ success: true, error: null, via: 'smtp' }));
vi.mock('./emailService.ts', () => ({ sendEmail }));

const { alertGeocodeFailure, resetGeocodeAlertThrottle } = await import('./geocodeAlert.ts');
const { geocodeAlertFor } = await import('../utils/geocodeAlert.ts');

const address = { street: '9312 W 10th Ave', city: 'Kennewick', state: 'WA', zipCode: '99336' };
const billing = { status: 'pending', error: 'You must enable Billing on the Google Cloud Project' };
const noResult = { status: 'failed', error: 'ZERO_RESULTS' };

describe('geocodeAlertFor', () => {
  it('says nothing for a pin that was found', () => {
    expect(geocodeAlertFor({ company: 'A', address, geocode: { status: 'ok' } })).toBeNull();
  });
  it('says nothing for a customer with no address to place', () => {
    expect(geocodeAlertFor({ company: 'A', address: {}, geocode: { status: 'failed', error: 'no address on record' } })).toBeNull();
  });
  it('names the customer, the address and what Google said', () => {
    const a = geocodeAlertFor({ company: 'Cedar & Sage Homes, LLC', address, geocode: billing })!;
    expect(a.kind).toBe('setup');
    expect(a.subject).toContain('Cedar & Sage Homes, LLC');
    expect(a.html).toContain('Cedar &amp; Sage Homes, LLC');
    expect(a.html).toContain('Billing');
    expect(a.html).toContain('Kennewick');
  });
  it('treats ZERO_RESULTS as the address', () => {
    expect(geocodeAlertFor({ company: 'A', address, geocode: noResult })!.kind).toBe('address');
  });
});

describe('alertGeocodeFailure', () => {
  beforeEach(() => { sendEmail.mockClear(); resetGeocodeAlertThrottle(); process.env.GEOCODE_ALERT_EMAIL = 'a@example.com, b@example.com'; });

  it('emails every recipient', async () => {
    await alertGeocodeFailure({ company: 'A', address, geocode: billing });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0].to).toEqual(['a@example.com', 'b@example.com']);
  });
  it('sends nothing while no recipient is set', async () => {
    delete process.env.GEOCODE_ALERT_EMAIL;
    await alertGeocodeFailure({ company: 'A', address, geocode: billing });
    expect(sendEmail).not.toHaveBeenCalled();
  });
  it('sends one email an hour for the same setup problem, not one per customer', async () => {
    await alertGeocodeFailure({ company: 'A', address, geocode: billing }, 0);
    await alertGeocodeFailure({ company: 'B', address, geocode: billing }, 5 * 60_000);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    await alertGeocodeFailure({ company: 'C', address, geocode: billing }, 61 * 60_000);
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });
  it('emails each customer whose address Google could not find', async () => {
    await alertGeocodeFailure({ company: 'A', address, geocode: noResult, customerId: '1' });
    await alertGeocodeFailure({ company: 'B', address, geocode: noResult, customerId: '2' });
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });
  it('never throws when the mailer does', async () => {
    sendEmail.mockRejectedValueOnce(new Error('smtp down'));
    await expect(alertGeocodeFailure({ company: 'A', address, geocode: billing })).resolves.toBeUndefined();
  });
});

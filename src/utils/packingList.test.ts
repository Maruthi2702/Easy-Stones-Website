import { describe, expect, it } from 'vitest';
import { downloadUrlFor } from './packingList';

describe('downloadUrlFor', () => {
  it('asks Cloudinary for an attachment, without the extension (as before)', () => {
    expect(downloadUrlFor('https://res.cloudinary.com/acct/raw/upload/v1/deliveries/pod/D1/signed.pdf', '145994_signed.pdf')).toBe(
      'https://res.cloudinary.com/acct/raw/upload/fl_attachment:145994_signed/v1/deliveries/pod/D1/signed.pdf',
    );
  });

  it('asks the CDN for an attachment with ?download=, extension kept', () => {
    expect(downloadUrlFor('https://d1abc.cloudfront.net/deliveries/pod/D1/signed.pdf', '145994 signed.pdf')).toBe(
      'https://d1abc.cloudfront.net/deliveries/pod/D1/signed.pdf?download=145994_signed.pdf',
    );
    expect(downloadUrlFor('https://d1abc.cloudfront.net/deliveries/packing_lists/D1.pdf', '145994')).toBe(
      'https://d1abc.cloudfront.net/deliveries/packing_lists/D1.pdf?download=145994.pdf',
    );
  });

  it('leaves other URLs alone', () => {
    expect(downloadUrlFor('/uploads/packing_lists/a.pdf', 'x.pdf')).toBe('/uploads/packing_lists/a.pdf');
  });
});

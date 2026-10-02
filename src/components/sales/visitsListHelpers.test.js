import { describe, it, expect } from 'vitest';
import { splitCustomer } from './visitsListHelpers.js';

describe('splitCustomer', () => {
  it('uses the separate company and contact fields when present', () => {
    expect(splitCustomer({ company: "Bella's Flooring LLC", contactName: 'David Le/Bo' }))
      .toEqual({ company: "Bella's Flooring LLC", contact: 'David Le/Bo' });
  });

  it('falls back to the contact as the title when there is no company', () => {
    expect(splitCustomer({ company: '', contactName: 'Jane Homeowner' })).toEqual({ company: 'Jane Homeowner', contact: '' });
  });

  it('splits the older joined customerName on the first " - "', () => {
    expect(splitCustomer({ customerName: '1st Ave Kitchen & Bath INC., - Robert Wu' }))
      .toEqual({ company: '1st Ave Kitchen & Bath INC.,', contact: 'Robert Wu' });
    expect(splitCustomer({ customerName: 'LAMBERT STONEWORKS - JOHN LAMBERT /AARON SPENCER' }))
      .toEqual({ company: 'LAMBERT STONEWORKS', contact: 'JOHN LAMBERT /AARON SPENCER' });
  });

  it('copes with a name that has no contact part, or nothing at all', () => {
    expect(splitCustomer({ customerName: 'Cascade Counters' })).toEqual({ company: 'Cascade Counters', contact: '' });
    expect(splitCustomer({})).toEqual({ company: 'Unknown customer', contact: '' });
  });
});

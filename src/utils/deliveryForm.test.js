import { describe, it, expect } from 'vitest';
import {
  DELIVERY_TYPE_OPTIONS, STATUS_OPTIONS, CUSTOMER_DROPOFF_VALUE, isPendingOrder, dateLabelFor,
  needsFreightDetails, deliveryToFormValues, validateDeliveryValues, countDeliveryChanges, bookedOn,
  driverOptions, driverPickerValue, applyDriverPick, applyTypeChange, applyDateChange, applyCustomerPick,
  applyCustomName, buildDeliveryPayload, formWording, deliveryLastChangedText, repOptions,
  salesRepNamesFor, customerOptionFromRecord, fieldLabelsFor
} from './deliveryForm.js';

const TRUCKS = [
  { id: 'trk_3rd_party', name: '3rd Party' },
  { id: 'mike', driver: 'Mike Torres' },
  { id: 'dave', driver: 'Dave Kim' },
  { id: 'old', driver: 'Sam Old', inactive: true }
];

const form = (over = {}) => ({
  ...deliveryToFormValues({ truckId: 'mike', date: '2026-10-06' }, { todayStr: '2026-10-05' }),
  customerName: 'Cascade', selectedCustomerId: 'c1',
  ...over
});

describe('options', () => {
  it('keep the stored values', () => {
    expect(DELIVERY_TYPE_OPTIONS.map((o) => o.value)).toEqual(['jobsite', 'transfer', 'will_call', 'return']);
    expect(STATUS_OPTIONS.map((o) => o.value)).toEqual(['pending', 'scheduled', 'delayed', 'completed', 'cancelled']);
  });
});

describe('pending and the date label', () => {
  it('no driver is Pending, except a will call or a customer drop-off', () => {
    expect(isPendingOrder({ truckId: '', deliveryType: 'jobsite' })).toBe(true);
    expect(isPendingOrder({ truckId: 'mike', deliveryType: 'jobsite' })).toBe(false);
    expect(isPendingOrder({ truckId: '', deliveryType: 'will_call' })).toBe(false);
    expect(isPendingOrder({ truckId: '', deliveryType: 'return', customerDropOff: true })).toBe(false);
    expect(isPendingOrder({ truckId: '', deliveryType: 'return' })).toBe(true);
  });

  it('names the date for what happens on it', () => {
    expect(dateLabelFor({ deliveryType: 'jobsite' })).toBe('Delivery date');
    expect(dateLabelFor({ deliveryType: 'transfer' })).toBe('Ship date');
    expect(dateLabelFor({ deliveryType: 'will_call' })).toBe('Pickup date');
    expect(dateLabelFor({ deliveryType: 'return', truckId: 'mike' })).toBe('Pickup date');
    expect(dateLabelFor({ deliveryType: 'return', truckId: '', customerDropOff: true })).toBe('Drop-off date');
    expect(fieldLabelsFor({ deliveryType: 'transfer' }).date).toBe('Ship date');
  });
});

describe('deliveryToFormValues', () => {
  it('opens a saved ticket as stored, with the old fallbacks', () => {
    const v = deliveryToFormValues({
      id: 'd1', deliveryType: 'transfer', date: '2026-10-08T00:00:00.000Z', truckId: 'trk_3rd_party', status: 'pending',
      location: 'Seattle', transferDestination: 'Spokane', invoiceNumber: 'TRF-1', freightFee: 1250, numberOfSlabs: 14, routeNumber: 3
    }, { todayStr: '2026-10-05' });
    expect(v.date).toBe('2026-10-08');
    expect(v.status).toBe('pending');
    expect(v.transferOrigin).toBe('Seattle');
    expect(v.expectedArrivalDate).toBe('2026-10-08');
    expect(v.soNumber).toBe('TRF-1');
    expect(v.freightFee).toBe('1,250.00');
    expect(v.numberOfSlabs).toBe('14');
    expect(v.routeNumber).toBe('3');
  });

  it('a new ticket takes the board prefill, today, and the user as rep', () => {
    const v = deliveryToFormValues({ truckId: 'mike', date: '' }, { currentUser: { name: 'Krish', location: 'Kent' }, todayStr: '2026-10-05' });
    expect(v.date).toBe('2026-10-05');
    expect(v.salesRepName).toBe('Krish');
    expect(v.transferOrigin).toBe('Kent');
    expect(v.freightFee).toBe('');
    expect(v.numberOfSlabs).toBe('0');
  });

  it('opens a transfer drawn on its arrival day with its real ship date, and saves that', () => {
    const stored = { id: 't1', deliveryType: 'transfer', date: '2026-10-05', expectedArrivalDate: '2026-10-07', location: 'Seattle', transferDestination: 'Spokane', truckId: 'trk_3rd_party' };
    // What the receiving branch's board (or the arrival week) holds — see showOnArrivalDay.
    const onArrivalDay = { ...stored, date: '2026-10-07', isIncomingView: true, shipDate: '2026-10-05', viewedAs: 'destination' };
    const v = deliveryToFormValues(onArrivalDay, { todayStr: '2026-10-05' });
    expect(v.date).toBe('2026-10-05');
    expect(v.expectedArrivalDate).toBe('2026-10-07');
    const p = buildDeliveryPayload({ ...v, notes: 'edited' }, { savedTicket: onArrivalDay, makeId: () => 'x' });
    expect(p).toMatchObject({ id: 't1', date: '2026-10-05', expectedArrivalDate: '2026-10-07' });
    // A normal ticket is unchanged.
    expect(deliveryToFormValues(stored).date).toBe('2026-10-05');
  });

  it('links a saved customer name to its record when the id is missing', () => {
    const v = deliveryToFormValues({ id: 'd', customerName: 'cascade' }, { customerOptions: [{ value: 'c1', label: 'Cascade' }] });
    expect(v.selectedCustomerId).toBe('c1');
  });
});

describe('validateDeliveryValues', () => {
  it('needs a customer, and a date unless Pending', () => {
    expect(validateDeliveryValues(form())).toEqual({});
    expect(validateDeliveryValues(form({ customerName: '', selectedCustomerId: '', date: '' }))).toEqual({
      date: 'Pick a date, or set Driver to Pending', customer: 'Pick a customer'
    });
    expect(validateDeliveryValues(form({ truckId: '', date: '' }))).toEqual({});
  });

  it('a will call needs its pickup date', () => {
    expect(validateDeliveryValues(form({ deliveryType: 'will_call', truckId: '', date: '' })).date).toBe('Pick the date the customer is collecting it');
  });

  it('checks a transfer’s branches and arrival, in form order', () => {
    const e = validateDeliveryValues(form({ deliveryType: 'transfer', customerName: '', selectedCustomerId: '', transferOrigin: 'Seattle', transferDestination: 'Seattle', expectedArrivalDate: '2026-10-01' }));
    expect(Object.keys(e)).toEqual(['transferDestination', 'expectedArrivalDate']);
    expect(e.transferDestination).toBe('Can’t be the same branch as From');
    expect(e.expectedArrivalDate).toBe('Can’t be before the ship date');
    expect(validateDeliveryValues(form({ deliveryType: 'transfer', transferOrigin: '', transferDestination: '', expectedArrivalDate: '' }))).toEqual({
      transferOrigin: 'Pick the branch it’s coming from', transferDestination: 'Pick the branch it’s going to', expectedArrivalDate: 'Pick the arrival date'
    });
  });

  it('a 3rd-party truck asks for carrier, BOL and the agreed price — transfers too — but none is required', () => {
    const third = form({ truckId: 'trk_3rd_party' });
    expect(needsFreightDetails(third, TRUCKS)).toBe(true);
    expect(validateDeliveryValues(third)).toEqual({});
    const transfer = form({ deliveryType: 'transfer', truckId: 'trk_3rd_party', transferOrigin: 'Seattle', transferDestination: 'Spokane', expectedArrivalDate: '2026-10-07' });
    expect(needsFreightDetails(transfer, TRUCKS)).toBe(true);
    expect(validateDeliveryValues(transfer)).toEqual({});
    expect(needsFreightDetails(form({ truckId: 'mike' }), TRUCKS)).toBe(false);
    expect(needsFreightDetails(form({ deliveryType: 'will_call', truckId: 'trk_3rd_party' }), TRUCKS)).toBe(false);
  });
});

describe('drivers', () => {
  const deliveries = [
    ...Array.from({ length: 12 }, (_, i) => ({ id: `x${i}`, truckId: 'dave', date: '2026-10-06' })),
    { id: 'w', truckId: 'mike', date: '2026-10-06', deliveryType: 'will_call' },
    { id: 'self', truckId: 'mike', date: '2026-10-06' }
  ];

  it('counts a truck’s load without this ticket or will calls', () => {
    expect(bookedOn(deliveries, 'mike', '2026-10-06', 'self')).toBe(0);
    expect(bookedOn(deliveries, 'dave', '2026-10-06')).toBe(12);
  });

  it('lists our drivers with their load, a full one greyed out, then contract freight, then Pending', () => {
    const opts = driverOptions(TRUCKS, form(), { deliveries, exceptId: 'self' });
    expect(opts.map((o) => o.value)).toEqual(['mike', 'dave', 'trk_3rd_party', '']);
    expect(opts[0]).toMatchObject({ label: 'Mike Torres', description: '0 of 12 booked' });
    expect(opts[1]).toMatchObject({ description: 'Full · 12 of 12', disabled: true });
    expect(opts[2].label).toBe('3rd party · contract freight');
  });

  it('keeps a former driver on their own ticket, and offers drop-off on a return', () => {
    expect(driverOptions(TRUCKS, form({ truckId: 'old' })).some((o) => o.value === 'old')).toBe(true);
    expect(driverOptions(TRUCKS, form({ deliveryType: 'return' })).map((o) => o.value)).toContain(CUSTOMER_DROPOFF_VALUE);
  });

  it('picking a driver schedules it; Pending or drop-off clears the truck', () => {
    expect(applyDriverPick(form({ truckId: '', status: 'pending' }), 'mike').status).toBe('scheduled');
    expect(applyDriverPick(form({ status: 'scheduled' }), '').status).toBe('pending');
    const drop = applyDriverPick(form({ deliveryType: 'return' }), CUSTOMER_DROPOFF_VALUE);
    expect(drop).toMatchObject({ truckId: '', customerDropOff: true, status: 'scheduled' });
    expect(driverPickerValue(drop)).toBe(CUSTOMER_DROPOFF_VALUE);
    expect(applyDriverPick(form({ status: 'completed' }), '').status).toBe('completed');
  });
});

describe('changes', () => {
  it('a new transfer swaps the column’s driver for contract freight and starts arrival at the ship date', () => {
    const v = applyTypeChange(form(), 'transfer', { isNew: true, thirdPartyTruckId: 'trk_3rd_party' });
    expect(v.truckId).toBe('trk_3rd_party');
    expect(v.expectedArrivalDate).toBe('2026-10-06');
    expect(applyTypeChange(form({ truckId: '' }), 'transfer', { isNew: true, thirdPartyTruckId: 'trk_3rd_party' }).truckId).toBe('');
    expect(applyTypeChange(form(), 'transfer', { isNew: false, thirdPartyTruckId: 'trk_3rd_party' }).truckId).toBe('mike');
  });

  it('a transfer’s arrival follows the ship date forward', () => {
    const t = form({ deliveryType: 'transfer', expectedArrivalDate: '2026-10-07' });
    expect(applyDateChange(t, '2026-10-09').expectedArrivalDate).toBe('2026-10-09');
    expect(applyDateChange(t, '2026-10-06').expectedArrivalDate).toBe('2026-10-07');
    expect(applyDateChange(form({ expectedArrivalDate: '' }), '2026-10-09').expectedArrivalDate).toBe('');
  });

  it('picking a customer brings their address and rep; a typed name stands alone', () => {
    const v = applyCustomerPick(form({ salesRepName: 'Krish' }), { value: 'c2', label: 'NW Granite', city: 'Seattle', salesRepName: 'Sam' });
    expect(v).toMatchObject({ customerName: 'NW Granite', selectedCustomerId: 'c2', address: 'Seattle', salesRepName: 'Sam' });
    expect(applyCustomerPick(form({ salesRepName: 'Krish' }), { value: 'c3', label: 'X' }).salesRepName).toBe('Krish');
    expect(applyCustomName(form(), 'new co', (s) => s.toUpperCase())).toMatchObject({ customerName: 'NEW CO', selectedCustomerId: 'NEW CO' });
  });

  it('keeps an address someone typed or the packing list filled in', () => {
    const nw = { value: 'c2', label: 'NW Granite', city: 'Seattle' };
    const kent = { value: 'c1', label: 'Cascade', city: 'Kent' };
    expect(applyCustomerPick(form({ address: '1234 Main St, Bellevue, WA' }), nw).address).toBe('1234 Main St, Bellevue, WA');
    // …but swaps the one the previous customer filled in
    expect(applyCustomerPick(form({ address: 'Kent' }), nw, kent).address).toBe('Seattle');
    expect(applyCustomerPick(form({ address: '' }), nw).address).toBe('Seattle');
  });

  it('counts changed fields', () => {
    const a = form();
    expect(countDeliveryChanges(a, a)).toBe(0);
    expect(countDeliveryChanges({ ...a, notes: 'x', soNumber: '1' }, a)).toBe(2);
  });
});

describe('buildDeliveryPayload', () => {
  const opts = { trucks: TRUCKS, makeId: () => 'del_new', now: new Date('2026-10-05T12:00:00Z'), currentUser: { location: 'Kent' } };

  it('saves a delivery', () => {
    const p = buildDeliveryPayload(form({ soNumber: ' SO-1 ', numberOfSlabs: '8', routeNumber: '2', address: ' 1 Main ' }), opts);
    expect(p).toMatchObject({
      id: 'del_new', customerId: 'c1', customerName: 'Cascade', soNumber: 'SO-1', invoiceNumber: 'SO-1', address: '1 Main',
      routeNumber: 2, numberOfSlabs: 8, truckId: 'mike', location: 'Kent', expectedArrivalDate: '', updatedAt: '2026-10-05T12:00:00.000Z'
    });
  });

  it('a will call has no truck, stop or address', () => {
    const p = buildDeliveryPayload(form({ deliveryType: 'will_call', address: 'x', routeNumber: '4' }), opts);
    expect(p).toMatchObject({ truckId: '', routeNumber: 1, address: '' });
  });

  it('a transfer names both branches and is filed under the one it leaves', () => {
    const p = buildDeliveryPayload(form({ deliveryType: 'transfer', transferOrigin: 'Seattle', transferDestination: 'Spokane', expectedArrivalDate: '2026-10-07', carrierName: 'R+L' }), opts);
    expect(p).toMatchObject({ customerName: 'Transfer: Seattle → Spokane', customerId: null, location: 'Seattle', expectedArrivalDate: '2026-10-07', carrierName: '' });
  });

  it('keeps a 3rd-party transfer’s carrier, BOL and price', () => {
    const p = buildDeliveryPayload(form({
      deliveryType: 'transfer', truckId: 'trk_3rd_party', transferOrigin: 'Seattle', transferDestination: 'Spokane',
      carrierName: ' R+L ', proNumber: 'BOL-7', freightFee: '1,250.00'
    }), opts);
    expect(p).toMatchObject({ carrierName: 'R+L', proNumber: 'BOL-7', freightFee: 1250 });
  });

  it('keeps an edit’s id and branch, and only a driverless return keeps drop-off', () => {
    const p = buildDeliveryPayload(form({ customerDropOff: true }), { ...opts, savedTicket: { id: 'd9', location: 'Spokane' } });
    expect(p).toMatchObject({ id: 'd9', location: 'Spokane', customerDropOff: false });
    expect(buildDeliveryPayload(form({ deliveryType: 'return', truckId: '', customerDropOff: true }), opts).customerDropOff).toBe(true);
  });
});

describe('wording', () => {
  it('says what kind of ticket it is', () => {
    expect(formWording(form())).toMatchObject({ title: 'Add a delivery', submitLabel: 'Add delivery', discardTitle: 'Discard this delivery?' });
    expect(formWording(form({ deliveryType: 'will_call' })).submitLabel).toBe('Add will call');
    const saved = form({ deliveryType: 'transfer', transferOrigin: 'Seattle', transferDestination: 'Spokane' });
    expect(formWording(saved, { isEdit: true, saved })).toMatchObject({ title: 'Edit transfer', titleSub: 'Seattle → Spokane', submitLabel: 'Save changes', deleteLabel: 'Delete transfer' });
    expect(formWording(form(), { isEdit: true }).titleSub).toBe('Cascade');
  });

  it('notes when it last changed', () => {
    expect(deliveryLastChangedText({})).toBe(null);
    expect(deliveryLastChangedText({ updatedAt: '2026-10-03T23:12:00Z' })).toMatch(/^Last changed Oct \d, /);
  });
});

describe('lists', () => {
  it('keeps the ticket’s own rep in the list', () => {
    expect(repOptions(['Admin', 'Krish'], 'Gone Rep').map((o) => o.value)).toEqual(['Admin', 'Krish', 'Gone Rep']);
  });

  it('offers reps on the user’s branches in a sales role', () => {
    const list = [
      { name: 'A', role: 'Sales Rep', assignedLocations: ['Kent'] },
      { name: 'B', role: 'Driver', assignedLocations: ['Kent'] },
      { name: 'C', role: 'Sales Rep', location: 'Spokane' },
      { name: 'D', role: 'Admin', assignedLocations: ['*'] }
    ];
    expect(salesRepNamesFor(list, { assignedLocations: ['Kent'] })).toEqual(['Admin', 'A', 'D']);
    expect(salesRepNamesFor(list, { assignedLocations: ['*'] })).toEqual(['Admin', 'A', 'C', 'D']);
  });

  it('reads a customer record’s address in its different shapes', () => {
    expect(customerOptionFromRecord({ _id: '1', company: 'Co', address: { street: '1 Main', city: 'Kent' }, state: 'WA', salesRepName: 'Sam' }))
      .toMatchObject({ value: '1', label: 'Co', city: 'Kent', address: '1 Main', fullAddress: '1 Main, Kent, WA', salesRepName: 'Sam' });
    expect(customerOptionFromRecord({ _id: '2', firstName: 'Ann', lastName: 'Lee', city: 'Spokane' }))
      .toMatchObject({ label: 'Ann Lee', city: 'Spokane', address: 'Spokane' });
  });
});

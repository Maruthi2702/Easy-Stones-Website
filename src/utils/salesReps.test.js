import { describe, it, expect } from 'vitest';
import { toSalesRepList, isSalesRep, salesRepNameOptions, branchesOf, worksAtAny, startingRepFor, branchSalesRepOf, displayNameOf, groupRepOptions } from './salesReps.js';

describe('toSalesRepList', () => {
  const staff = [
    { _id: '1', username: 'kim', name: 'Kim', role: 'sales_rep', location: 'Seattle' },
    { _id: '2', username: 'sergio', name: 'Sergio', role: 'driver', location: 'Seattle' },
    { _id: '3', username: 'ann', name: 'Ann', role: 'manager', location: 'Seattle', isActive: false },
    { _id: '4', username: 'admin', name: 'Admin', role: 'admin', location: 'Seattle' },
    { _id: '5', username: 'bo', name: 'Bo', role: 'sales_rep', location: 'Spokane' }
  ];

  it('offers account owners only, by branch then name', () => {
    expect(toSalesRepList({ data: staff.filter(u => u.isActive !== false) }).map(u => u.name)).toEqual(['Kim', 'Bo']);
  });

  it('keeps a deactivated rep, marked and listed last, so their customers still show and can be handed over', () => {
    const list = toSalesRepList(staff);
    expect(list.map(u => u.name)).toEqual(['Kim', 'Bo', 'Ann (inactive)']);
    expect(list[2].inactive).toBe(true);
  });

  it('returns nothing usable from a server that sends no ids', () => {
    expect(toSalesRepList([{ username: 'kim', role: 'sales_rep' }])).toEqual([]);
  });

  it('never offers the shared admin login', () => {
    expect(isSalesRep({ _id: '4', username: 'admin', role: 'admin' })).toBe(false);
  });
});

describe('salesRepNameOptions — every dropdown that saves a rep\'s name', () => {
  const staff = [
    { _id: '1', username: 'kim', name: 'Kim', email: 'kim@x.com', role: 'sales_rep', location: 'Seattle' },
    { _id: '2', username: 'sergio', name: 'Sergio', role: 'driver', location: 'Seattle' },
    { _id: '3', username: 'ann', name: 'Ann', role: 'manager', location: 'Seattle', isActive: false },
    { _id: '4', username: 'admin', name: 'Admin', role: 'admin', assignedLocations: ['*'] },
    { _id: '5', username: 'bo', name: 'Bo', role: 'sales_rep', location: 'Spokane' },
    { _id: '6', username: 'dee', name: 'Dee', role: 'director', assignedLocations: ['*'] },
    { _id: '7', username: 'cara', name: 'Cara', role: 'csr', location: 'Seattle' },
    { _id: '8', username: 'eve', name: 'Eve', role: 'sales_rep', location: 'Kent', assignedLocations: ['Kent', 'Seattle'] }
  ];
  const names = (opts) => opts.map((o) => o.label);

  it('offers the same people as the customer rep picker, active only, A–Z', () => {
    expect(names(salesRepNameOptions({ success: true, data: staff }))).toEqual(['Bo', 'Dee', 'Eve', 'Kim']);
  });

  it('narrows to a branch: home, assigned or every branch', () => {
    expect(names(salesRepNameOptions(staff, { branches: ['Seattle'] }))).toEqual(['Dee', 'Eve', 'Kim']);
    expect(names(salesRepNameOptions(staff, { branches: ['Seattle', 'Spokane'] }))).toEqual(['Bo', 'Dee', 'Eve', 'Kim']);
    expect(names(salesRepNameOptions(staff, { branches: ['*'] }))).toEqual(['Bo', 'Dee', 'Eve', 'Kim']);
  });

  it('never offers drivers, CSRs, the shared admin login or anyone deactivated', () => {
    const offered = names(salesRepNameOptions(staff));
    for (const n of ['Sergio', 'Cara', 'Admin', 'Ann', 'Ann (inactive)']) expect(offered).not.toContain(n);
  });

  it('keeps whoever is already saved at the top, marked if deactivated', () => {
    const gone = salesRepNameOptions(staff, { current: { name: 'Ann', email: 'ann@x.com' } });
    expect(gone[0]).toMatchObject({ value: 'Ann', label: 'Ann (inactive)', email: 'ann@x.com', id: '3' });
    expect(salesRepNameOptions(staff, { current: { name: 'Admin' } })[0]).toMatchObject({ value: 'Admin', label: 'Admin' });
    expect(salesRepNameOptions(staff, { branches: ['Spokane'], current: { name: 'Kim' } }).map((o) => o.value)).toEqual(['Kim', 'Bo', 'Dee']);
    expect(salesRepNameOptions(staff, { current: { name: 'Kim' } }).filter((o) => o.value === 'Kim')).toHaveLength(1);
  });

  it('carries each rep\'s email (the Selection Sheet emails its rep)', () => {
    expect(salesRepNameOptions(staff).find((o) => o.value === 'Kim').email).toBe('kim@x.com');
  });
});

describe('branchesOf / worksAtAny', () => {
  it('reads a signed-in person\'s branches; every branch is []', () => {
    expect(branchesOf({ assignedLocations: ['Kent', 'Seattle'] })).toEqual(['Kent', 'Seattle']);
    expect(branchesOf({ assignedLocations: ['*'] })).toEqual([]);
    expect(branchesOf({ location: 'Spokane' })).toEqual(['Spokane']);
    expect(branchesOf(null)).toEqual([]);
  });
  it('matches home, assigned or every-branch staff', () => {
    expect(worksAtAny({ location: 'Kent' }, ['Kent'])).toBe(true);
    expect(worksAtAny({ location: 'Kent', assignedLocations: ['Seattle'] }, ['Seattle'])).toBe(true);
    expect(worksAtAny({ assignedLocations: ['*'] }, ['Spokane'])).toBe(true);
    expect(worksAtAny({ location: 'Kent' }, ['Spokane'])).toBe(false);
    expect(worksAtAny({ location: 'Kent' }, [])).toBe(true);
  });
});

describe('startingRepFor — who something new at a branch starts with', () => {
  const staff = [
    { _id: 'k', username: 'krish', name: 'Krish', role: 'admin' },
    { _id: 'j', username: 'jeremy', name: 'Jeremy Earnest', role: 'manager' },
    { _id: 'c', username: 'cara', name: 'Cara', role: 'csr' },
    { _id: 'g', username: 'gone', name: 'Gone Rep', role: 'sales_rep', isActive: false },
    { _id: 'd', username: 'dan', name: 'Dan', role: 'driver' }
  ];
  const branchReps = { Seattle: 'Krish', Spokane: 'Jeremy Earnest', Kent: 'Gone Rep', Tacoma: 'Dan' };

  it('is you when you\'re a sales rep', () => {
    expect(startingRepFor({ staff, branch: 'Spokane', branchReps, creator: { id: 'k' } })._id).toBe('k');
  });
  it('is the branch\'s sales person otherwise — a CSR, or a self check-in', () => {
    expect(startingRepFor({ staff, branch: 'Spokane', branchReps, creator: { id: 'c' } })._id).toBe('j');
    expect(startingRepFor({ staff: { data: staff }, branch: 'Seattle', branchReps })._id).toBe('k');
  });
  it('is nobody when the branch has none, or theirs is deactivated or not a sales role', () => {
    expect(startingRepFor({ staff, branch: 'Salt Lake City', branchReps, creator: { id: 'c' } })).toBe(null);
    expect(startingRepFor({ staff, branch: 'Kent', branchReps })).toBe(null);
    expect(startingRepFor({ staff, branch: 'Tacoma', branchReps })).toBe(null);
  });
  it('matches a name the way the staff list shows it', () => {
    const raw = [{ _id: 'p', username: 'pat.lee', role: 'sales_rep' }];
    expect(startingRepFor({ staff: raw, branch: 'X', branchReps: { X: 'Pat Lee' } })._id).toBe('p');
  });
});

describe('branchSalesRepOf / displayNameOf', () => {
  it('reads the branch\'s sales person from a full or a staff location record', () => {
    expect(branchSalesRepOf({ salesDefaults: { salesRep: ' Krish ' } })).toBe('Krish');
    expect(branchSalesRepOf({ defaultSalesRep: 'Jeremy' })).toBe('Jeremy');
    expect(branchSalesRepOf({})).toBe('');
  });
  it('names staff by Display Name, else a tidied username', () => {
    expect(displayNameOf({ displayName: 'Krish P', username: 'krish' })).toBe('Krish P');
    expect(displayNameOf({ username: '3rd party - delivery' })).toBe('3rd Party Delivery');
  });
});

describe('groupRepOptions — the format every rep dropdown and filter shares', () => {
  const opts = [
    { value: 'Vishnu', label: 'Vishnu', location: 'Seattle', id: 'v' },
    { value: 'Asha', label: 'Asha', location: 'Dallas', id: 'a' },
    { value: 'Krish', label: 'Krish', location: 'Seattle', id: 'k' },
    { value: '', label: 'None' },
    { value: 'Jeremy', label: 'Jeremy', location: '' },
    { value: 'Babu', label: 'Babu', location: 'Dallas', id: 'b' },
    { value: 'Sree', label: 'Sree', location: 'Atlanta', id: 's' }
  ];
  const shape = (groups) => groups.map((g) => `${g.group}: ${g.options.map((o) => o.label).join(', ')}`);

  it('groups under each branch, branches A–Z with "Other" last, names A–Z; the blank choice is left out', () => {
    expect(shape(groupRepOptions(opts))).toEqual([
      'Atlanta: Sree', 'Dallas: Asha, Babu', 'Seattle: Krish, Vishnu', 'Other: Jeremy'
    ]);
  });
  it('marks you, by id or value', () => {
    expect(shape(groupRepOptions(opts, { you: 'k' }))[2]).toBe('Seattle: Krish (you), Vishnu');
    expect(groupRepOptions(opts, { you: 'Asha' })[1].options[0]).toMatchObject({ label: 'Asha (you)', you: true });
  });
  it('searches by name or branch', () => {
    expect(shape(groupRepOptions(opts, { query: 'dal' }))).toEqual(['Dallas: Asha, Babu']);
    expect(shape(groupRepOptions(opts, { query: 'kri' }))).toEqual(['Seattle: Krish']);
    expect(groupRepOptions(opts, { query: 'zzz' })).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import {
  parseEmailList, cleanUserIds, recipientEmails, userRecipientProblem, seedFromAddresses,
  SEATTLE_RECIPIENTS_BEFORE_2026_10_15
} from './dailyReportRecipients.ts';

const id = (n: number) => String(n).padStart(24, 'a');
const users = [
  { _id: id(1), email: 'Sree@EasyStones.com', isActive: true },
  { _id: id(2), email: 'gone@easystones.com', isActive: false },
  { _id: id(3), email: '', isActive: true },
  { _id: id(4), email: 'vish@easystones.com' }
];

describe('typed addresses', () => {
  it('splits on commas, semicolons, spaces and new lines; lower-cases; drops repeats', () => {
    expect(parseEmailList('a@x.com, B@x.com;\nb@x.com  c@y.org')).toEqual({ emails: ['a@x.com', 'b@x.com', 'c@y.org'], bad: [] });
  });
  it('reports what isn’t an email', () => {
    expect(parseEmailList('a@x.com, bob, c@').bad).toEqual(['bob', 'c@']);
    expect(parseEmailList('')).toEqual({ emails: [], bad: [] });
  });
});

describe('who it goes to', () => {
  it('sends to active listed users with an email, then typed addresses, no repeats', () => {
    const setting = { userIds: [id(1), id(2), id(3), id(4), id(9)], extraEmails: ['owner@example.com', 'sree@easystones.com'] };
    expect(recipientEmails(setting, users)).toEqual(['sree@easystones.com', 'vish@easystones.com', 'owner@example.com']);
  });
  it('is nobody when the location has no list (no email sent)', () => {
    expect(recipientEmails(undefined, users)).toEqual([]);
    expect(recipientEmails({ userIds: [], extraEmails: [] }, users)).toEqual([]);
  });
  it('keeps only real user ids', () => {
    expect(cleanUserIds([id(1), id(1), 'nope', null, ` ${id(4)} `])).toEqual([id(1), id(4)]);
  });
  it('says why a listed user won’t get it', () => {
    expect(userRecipientProblem(users[0])).toBe('');
    expect(userRecipientProblem(users[1])).toBe('deactivated — not sent');
    expect(userRecipientProblem(users[2])).toBe('no email on file');
    expect(userRecipientProblem(undefined)).toBe('no longer a user');
  });
});

describe('Seattle’s one-time copy', () => {
  it('turns the old addresses into users where one has that email, the rest typed', () => {
    const seeded = seedFromAddresses(SEATTLE_RECIPIENTS_BEFORE_2026_10_15, users);
    expect(seeded).toEqual({
      userIds: [id(1), id(4)],
      extraEmails: ['jeremy@easystones.com', 'krish@easystones.com']
    });
    // Same four addresses either way.
    expect(recipientEmails(seeded, users).sort()).toEqual([...SEATTLE_RECIPIENTS_BEFORE_2026_10_15].sort());
  });
  it('keeps a deactivated user’s address typed rather than linking them', () => {
    const seeded = seedFromAddresses(['gone@easystones.com'], users);
    expect(seeded).toEqual({ userIds: [], extraEmails: ['gone@easystones.com'] });
  });
});

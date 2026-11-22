import { describe, expect, it } from 'vitest';
import { MAX_RECIPIENTS, MESSAGE_MAX, canSendNotifications, cleanMessage, cleanRecipients, sentLine } from './pushSend';

describe('send notifications rules', () => {
  it('needs the switch', () => {
    expect(canSendNotifications({ permissions: ['send_notifications'] })).toBe(true);
    expect(canSendNotifications({ permissions: ['manage_users'] })).toBe(false);
    expect(canSendNotifications(null)).toBe(false);
  });
  it('cleans the message', () => {
    expect(cleanMessage('  Hi   Maruthi ').message).toBe('Hi Maruthi');
    expect(cleanMessage('   ').problem).toMatch(/Write the message/);
    expect(cleanMessage(undefined).problem).not.toBe('');
    expect(cleanMessage('x'.repeat(MESSAGE_MAX)).problem).toBe('');
    expect(cleanMessage('x'.repeat(MESSAGE_MAX + 1)).problem).toMatch(/under/);
  });
  it('cleans the recipients', () => {
    expect(cleanRecipients(['a', 'b', 'a', '', ' c ', null]).ids).toEqual(['a', 'b', 'c']);
    expect(cleanRecipients([]).problem).toMatch(/at least one/);
    expect(cleanRecipients('a').problem).toMatch(/at least one/);
    expect(cleanRecipients(Array.from({ length: MAX_RECIPIENTS + 1 }, (_, i) => String(i))).problem).toMatch(/at most/);
  });
  it('words the result', () => {
    expect(sentLine(1, 1, 0)).toBe('Sent to 1 person.');
    expect(sentLine(3, 2, 1)).toBe('Sent to 2 people. 1 person has no phone set up, so it didn’t get it.');
    expect(sentLine(1, 0, 1)).toMatch(/Not sent/);
    expect(sentLine(4, 0, 4)).toMatch(/none of them/);
  });
});

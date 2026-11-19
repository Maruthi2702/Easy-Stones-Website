import { describe, it, expect, vi } from 'vitest';
import { addContactOnce, isDuplicateKey } from './contactAdd.ts';

const SENT = 'AABBCCDDEEFF001122334455';

describe('addContactOnce', () => {
  it('adds under the id the screen sent (lower-cased)', async () => {
    const add = vi.fn().mockResolvedValue(true);
    expect(await addContactOnce(add, SENT)).toEqual({ kind: 'added', id: SENT.toLowerCase() });
    expect(add).toHaveBeenCalledWith(SENT.toLowerCase());
  });

  it('makes its own id when none, or a bad one, was sent', async () => {
    for (const sent of [undefined, 'nope', 42, {}]) {
      const add = vi.fn().mockResolvedValue(true);
      const r = await addContactOnce(add, sent);
      expect(r.kind).toBe('added');
      expect(r.id).toMatch(/^[0-9a-f]{24}$/);
    }
  });

  it('says noCustomer when the customer is not there', async () => {
    expect((await addContactOnce(async () => false, SENT)).kind).toBe('noCustomer');
  });

  it('answers alreadySaved when the same id comes in again (duplicate key, plain or wrapped)', async () => {
    expect((await addContactOnce(async () => { throw Object.assign(new Error('dup'), { code: '23505' }); }, SENT)).kind).toBe('alreadySaved');
    expect((await addContactOnce(async () => { throw Object.assign(new Error('wrapped'), { cause: { code: '23505' } }); }, SENT)).kind).toBe('alreadySaved');
  });

  it('does not hide a duplicate key on an id the server made, or any other error', async () => {
    await expect(addContactOnce(async () => { throw Object.assign(new Error('dup'), { code: '23505' }); }, undefined)).rejects.toThrow('dup');
    await expect(addContactOnce(async () => { throw new Error('db down'); }, SENT)).rejects.toThrow('db down');
  });

  it('recognises only 23505', () => {
    expect(isDuplicateKey({ code: '40P01' })).toBe(false);
    expect(isDuplicateKey(null)).toBe(false);
  });
});

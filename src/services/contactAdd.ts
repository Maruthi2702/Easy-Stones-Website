import { isId, newId } from '../db/ids.ts';

/** Postgres refused a second row with the same primary key (the error may be wrapped by the driver). */
export function isDuplicateKey(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } } | null;
  return (e?.code ?? e?.cause?.code) === '23505';
}

export type AddContactResult = { kind: 'added' | 'alreadySaved' | 'noCustomer'; id: string };

/**
 * POST /api/customers/:id/contacts: the screen sends its own contact id, so a save repeated after
 * a dropped answer finds the contact it already added instead of adding a second one. Without a
 * valid id the server makes one, as before. Any other error is the caller's to handle.
 */
export async function addContactOnce(
  add: (contactId: string) => Promise<boolean>,
  sentId: unknown
): Promise<AddContactResult> {
  const fromScreen = isId(sentId);
  const id = fromScreen ? sentId.toLowerCase() : newId();
  try {
    return { kind: (await add(id)) ? 'added' : 'noCustomer', id };
  } catch (error) {
    if (fromScreen && isDuplicateKey(error)) return { kind: 'alreadySaved', id };
    throw error;
  }
}

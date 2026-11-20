/**
 * Answering "Locate now" asks (src/utils/locationRequests.ts) on the phone: for each open ask
 * for this person, take ONE position and send it. Pure with its three calls injected, so it is
 * tested without a phone. An ask is tried once per run; one that can't be answered (no
 * position, no signal) stays open on the server and is tried again at the next run, until it expires.
 */
export type OpenRequest = { id: string; requestedByName: string };
export type Position = { lat: number; lng: number; accuracy?: number | null };

export async function answerOpenRequests(
  { load, position, send, done }: {
    load: () => Promise<OpenRequest[]>;
    position: () => Promise<Position | null>;
    send: (id: string, at: Position) => Promise<boolean>;
    /** Ids already answered from this phone, so a slow server answer can't send twice. */
    done: Set<string>;
  }
): Promise<string[]> {
  const open = (await load().catch(() => [])).filter((r) => !done.has(r.id));
  if (!open.length) return [];
  const at = await position().catch(() => null);
  if (!at) return [];
  const names: string[] = [];
  for (const r of open) {
    if (await send(r.id, at).catch(() => false)) { done.add(r.id); names.push(r.requestedByName || 'your manager'); }
  }
  return names;
}

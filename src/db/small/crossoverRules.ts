/** Crossover Sheet rules both databases share (they were inline in server.ts). */
export const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** True if one of `crossovers` already maps the same distributor + distributor colour (case-insensitive); `excludeId` skips the entry being edited. */
export function hasDuplicateMapping(
  crossovers: { _id?: unknown; distributorName: string; distributorColorName: string }[] | undefined,
  distributorName: string, distributorColorName: string, excludeId?: unknown
) {
  const dName = distributorName.toLowerCase();
  const dColor = distributorColorName.toLowerCase();
  return (crossovers || []).some(c =>
    (!excludeId || String(c._id) !== String(excludeId)) &&
    c.distributorName.toLowerCase() === dName && c.distributorColorName.toLowerCase() === dColor);
}

export type CrossoverResult = { status: number; body: unknown; message?: undefined } | { status: number; message: string; body?: undefined };

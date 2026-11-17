/** A referenced record stays in place; the caller can resolve the conflict without losing history. */
export function staffDeletionError(error: unknown, kind: 'user' | 'location'): { status: number; body: { message: string; error?: string } } {
  const seen = new Set<unknown>();
  let cause = error;
  while (cause && typeof cause === 'object' && !seen.has(cause)) {
    seen.add(cause);
    const current = cause as { code?: string; cause?: unknown };
    if (current.code === '23503') return {
      status: 409,
      body: { message: kind === 'user'
        ? 'This account has linked calendar entries or card receipts. Deactivate it to keep its history.'
        : 'This location is used by existing records. Reassign those records before deleting it.' }
    };
    cause = current.cause;
  }
  return { status: 500, body: { message: `Failed to delete ${kind}`, ...(kind === 'location' && error instanceof Error ? { error: error.message } : {}) } };
}

import type { Loose } from '../../types/records.ts';

/** A read of tickets: a MongoDB-style filter (see filter.ts), what to leave out or keep, and the order. */
export interface DeliveryFind {
  filter?: Loose;
  /** `{ 'pod.photos': 0 }` leaves fields out; `{ id: 1, date: 1 }` keeps only those. */
  projection?: Record<string, number>;
  /** The two orders the schedule uses: newest created first / oldest first, or by day. */
  sort?: { createdAt?: 1 | -1; date?: 1 | -1 };
  limit?: number;
}

/**
 * A request-count store for express-rate-limit that keeps its counts in Postgres, so every server
 * instance shares them (review S8, 2026-11-24). The default store lives in the process: on Lambda each
 * instance would have its own counters and a per-person cap on paid AI reads would not hold.
 *
 *   rateLimit({ ..., store: new PostgresRateLimitStore('receipt-scan-burst'), passOnStoreError: true })
 *
 * `passOnStoreError` lets a request through if the database can't be reached (the routes need it anyway,
 * so that is only a blip) rather than answering 500 for a limit.
 */
import type { Store, Options, IncrementResponse } from 'express-rate-limit';
import * as counters from '../db/rateLimits/index.ts';

export class PostgresRateLimitStore implements Store {
  /** Keys are shared across instances, so they are not kept per process. */
  localKeys = false;
  prefix: string;
  private windowMs = 60_000;

  constructor(prefix: string) { this.prefix = prefix; }

  init(options: Options): void { this.windowMs = options.windowMs; }

  private keyOf(key: string) { return `${this.prefix}:${key}`; }

  async increment(key: string): Promise<IncrementResponse> {
    const { hits, resetsAt } = await counters.hit(this.keyOf(key), this.windowMs);
    return { totalHits: hits, resetTime: resetsAt };
  }

  async decrement(key: string): Promise<void> { await counters.giveBack(this.keyOf(key)); }

  async resetKey(key: string): Promise<void> { await counters.reset(this.keyOf(key)); }
}

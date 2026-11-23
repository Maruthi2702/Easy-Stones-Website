import { answerOpenRequests, type OpenRequest, type Position } from '../../../src/features/locationCollector/answerRequests';

/** At most one look for an open "Locate now" ask this often, however many places call for one (the collector's timer, the app coming to the front). */
export const ASK_EVERY_MS = 60 * 1000;

export interface LocatePorts {
  now(): number;
  load(): Promise<OpenRequest[]>;
  /** One fresh position, or null. */
  position(): Promise<Position | null>;
  send(id: string, at: Position): Promise<boolean>;
}

/**
 * Answers an admin's "Locate now" ask (src/utils/locationRequests.ts) from the phone, with no page and no screen: one position per
 * run, sent for every open ask, silently (the person is not notified — owner, 2026-11-22; the agreement says a manager may request
 * it). Safe to call from several places: one run at a time, and no sooner than `ASK_EVERY_MS` after the last unless `force`. An ask
 * that can't be answered (no position, no signal) stays open on the server and is tried again, until it expires.
 */
export function makeAnswerer(ports: LocatePorts) {
  const done = new Set<string>();
  let running = false;
  let lastAt = 0;
  return async function run(force = false): Promise<number> {
    if (running) return 0;
    if (!force && lastAt && ports.now() - lastAt < ASK_EVERY_MS) return 0;
    running = true;
    lastAt = ports.now();
    try {
      const answered = await answerOpenRequests({ load: ports.load, position: ports.position, send: ports.send, done });
      return answered.length;
    } finally { running = false; }
  };
}

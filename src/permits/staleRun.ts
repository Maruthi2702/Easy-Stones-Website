// A run still "going" after this long died with its server; the next one may start.
// (src/permits/sync.ts on Render, and syncOnLambda.ts's "running" on Lambda.)
export const STALE_RUN_MS = 45 * 60 * 1000;

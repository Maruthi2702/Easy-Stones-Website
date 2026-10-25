import { validDay } from './planning.ts';
import type { SalesCoverageConfirmation } from './types.ts';

interface CoverageScope {
  cohortId?: string;
  observedThrough: string;
  salesCoverageConfirmation?: SalesCoverageConfirmation | null;
}
/** Evidence applies only to the exact report revision and observed date. */
export function hasConfirmedSalesThrough(scope: CoverageScope, cohortId: string): boolean {
  const evidence = scope.salesCoverageConfirmation;
  return !!evidence && scope.cohortId === cohortId && evidence.cohortId === cohortId &&
    evidence.through === scope.observedThrough && validDay(evidence.through) &&
    ['scope-form', 'owner-confirmation'].includes(evidence.source) && !!evidence.confirmedBy.name &&
    Number.isFinite(new Date(evidence.confirmedAt).getTime());
}
export function confirmSalesThrough(cohortId: string, through: string,
  actor: SalesCoverageConfirmation['confirmedBy'], source: SalesCoverageConfirmation['source'],
  now = new Date()): SalesCoverageConfirmation {
  if (!cohortId || !validDay(through) || !actor.name || !Number.isFinite(now.getTime()))
    throw new Error('A report revision, valid observed date and confirmation actor are required');
  return { cohortId, through, confirmedAt: now.toISOString(), confirmedBy: actor, source };
}

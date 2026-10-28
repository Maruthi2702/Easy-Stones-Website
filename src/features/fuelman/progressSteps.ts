import type { ReportDetail } from '../../fuelman/types';
import type { ReviewTab } from './urlState';
export type StepKey = 'match' | 'missing' | 'unknown' | 'approve';
export interface Step { key: StepKey; label: string; left: number; done: boolean; status: string; tab: ReviewTab }
// What stands between a draft and "Approve", in the order a person does it.
export function reviewSteps(report: ReportDetail): Step[] {
  const { drivers, missing, ready } = report.review;
  const match = drivers.filter(d => !d.driverKey).length, absent = missing.filter(m => !m.resolved).length;
  const unknown = drivers.filter(d => d.amounts.other !== 0).length;
  const step = (key: StepKey, label: string, left: number, tab: ReviewTab): Step =>
    ({ key, label, left, tab, done: left === 0, status: left ? `${left} left` : 'Done' });
  return [
    step('match', 'Match drivers', match, 'drivers'),
    step('missing', 'Explain absences', absent, 'missing'),
    step('unknown', 'Check unknown charges', unknown, 'lines'),
    { key: 'approve', label: 'Approve', left: ready ? 0 : 1, done: report.status !== 'draft', tab: 'allocations', status: report.status !== 'draft' ? 'Done' : ready ? 'Ready' : 'Not yet' },
  ];
}
// The first step that still has work; the strip lights it.
export const currentStep = (steps: Step[]) => steps.find(s => !s.done)?.key;
// "Next: match 6 drivers" for the card on the Reports page.
export function nextAction(report: ReportDetail): string {
  const steps = reviewSteps(report), now = currentStep(steps);
  const n = (key: StepKey) => steps.find(s => s.key === key)!.left;
  if (now === 'match') return `match ${n('match')} ${n('match') === 1 ? 'driver' : 'drivers'}`;
  if (now === 'missing') return `explain ${n('missing')} ${n('missing') === 1 ? 'absence' : 'absences'}`;
  if (now === 'unknown') return 'sort the unknown charges';
  return report.status === 'draft' ? 'approve it' : 'nothing, it is approved';
}

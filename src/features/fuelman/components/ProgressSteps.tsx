import type { ReportDetail } from '../../../fuelman/types';
import { currentStep, reviewSteps } from '../progressSteps';
import type { StepKey } from '../progressSteps';
import type { ReviewTab } from '../urlState';
// "What is left before I can approve?" Each step jumps to where it is done.
export default function ProgressSteps({ report, onStep }: { report: ReportDetail; onStep: (key: StepKey, tab: ReviewTab) => void }) {
  const steps = reviewSteps(report), now = currentStep(steps);
  return <ol className="fuel-steps" aria-label="Steps to approve this report">
    {steps.map((s, i) => <li key={s.key} className={`${s.done ? 'done' : ''} ${s.key === now ? 'current' : ''}`} aria-current={s.key === now ? 'step' : undefined}>
      <button type="button" onClick={() => onStep(s.key, s.tab)}><b>{s.done ? '✓' : i + 1}</b><span>{s.label}</span><small>{s.status}</small></button>
    </li>)}
  </ol>;
}

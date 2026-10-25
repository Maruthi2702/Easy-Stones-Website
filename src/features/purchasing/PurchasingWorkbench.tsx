import { useState } from 'react';
import type { Scope, PlanRow } from '../../purchasing/types';
import { usePurchasingData } from './usePurchasingData';
import { exportPlan } from './purchasingApi';
import BuyerQueue from './components/BuyerQueue';
import PlanDetails from './components/PlanDetails';
import ScopeForm from './components/ScopeForm';
import InboundForm from './components/InboundForm';
import DraftForm from './components/DraftForm';
import DraftList from './components/DraftList';
import './PurchasingWorkbench.css';
export default function PurchasingWorkbench({
  currentUser,
  refreshSignal = 0,
}: {
  currentUser?: { permissions?: string[] } | null;
  refreshSignal?: number;
}) {
  const d = usePurchasingData(refreshSignal),
    [tab, setTab] = useState('queue'),
    [scopeForm, setScopeForm] = useState<{ scope?: Scope } | null>(null),
    [inboundForm, setInboundForm] = useState(false),
    [details, setDetails] = useState<PlanRow | null>(null),
    [draftRows, setDraftRows] = useState<PlanRow[] | null>(null);
  const canEdit = !!currentUser?.permissions?.includes('manage_purchasing'),
    canApprove = !!currentUser?.permissions?.includes('approve_purchasing');
  const buy =
    d.plan?.rows.filter(
      (r) =>
        r.protective &&
        (r.protective.proposedSlabs > 0 || r.protective.bridgeShortfall > 0) &&
        r.policy?.active,
    ).length || 0;
  const scope = d.plan?.scope || d.metadata?.scopes.find((s) => s._id === d.scopeId);
  const refresh = () => {
    setInboundForm(false);
    setDraftRows(null);
    d.refresh();
  };
  return (
    <section className="purchase-workbench" aria-label="Purchasing workbench">
      <header className="purchase-heading">
        <div>
          <span className="purchase-eyebrow">Purchasing · container replenishment</span>
          <h2>Buy with a reason. Order with a date.</h2>
          <p>60–90-day usable-receipt lead time · weekly review · exact variant planning</p>
        </div>
        <div className="purchase-actions">
          <button onClick={d.refresh}>Refresh</button>
          {canEdit && (
            <button disabled={!d.metadata?.cohorts.length} onClick={() => setScopeForm({})}>
              New planning scope
            </button>
          )}
        </div>
      </header>
      {d.error && (
        <p role="alert" className="purchase-error">
          {d.error}
        </p>
      )}
      {d.metadata && (
        <div className="purchase-toolbar">
          <label>
            Planning scope{' '}
            <select
              aria-label="Planning scope"
              value={d.scopeId}
              onChange={(e) => {
                d.setScopeId(e.target.value);
                setDetails(null);
              }}
            >
              {!d.metadata.scopes.length && <option value="">No scopes configured</option>}
              {d.metadata.scopes.map((s) => (
                <option key={s._id} value={s._id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          {scope && canEdit && (
            <>
              <button onClick={() => setScopeForm({ scope })}>Edit scope & variant policies</button>
              <button onClick={() => setInboundForm(true)}>Import SPS PO / transit</button>
            </>
          )}
          {d.plan && <button onClick={() => exportPlan(d.plan!)}>Export review CSV</button>}
        </div>
      )}
      {!d.loading && !d.scopeId && (
        <div className="purchase-panel purchase-empty">
          <h3>Start with a verified planning scope</h3>
          <p>
            Import stock and Fast Moving sales through Inventory Analysis, then choose the report's actual
            branches and observed-through date. Unknown coverage is not treated as zero demand or zero
            inbound.
          </p>
          {!canEdit && <p>A purchasing manager can configure scopes and incoming supply.</p>}
        </div>
      )}
      {d.loading && <p role="status">Loading purchasing inputs…</p>}
      {d.plan && (
        <>
          <div className="purchase-stats">
            <div>
              <span>Variants in scope</span>
              <strong>{d.plan.rows.length}</strong>
            </div>
            <div>
              <span>Ready for buyer review</span>
              <strong>{buy}</strong>
            </div>
            <div>
              <span>Need input validation</span>
              <strong>{d.plan.rows.filter((r) => r.blockers.length).length}</strong>
            </div>
            <div>
              <span>Active draft reservations</span>
              <strong>{d.plan.draftIds.length}</strong>
            </div>
          </div>
          {!!d.plan.blockers.length && (
            <div className="purchase-warning">
              <h3>Resolve these inputs before approving buy quantities</h3>
              <ul>
                {d.plan.blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          )}
          <nav className="purchase-tabs" aria-label="Purchasing views">
            {[
              ['queue', 'Buyer queue'],
              ['performance', 'Color performance'],
              ['drafts', 'Container drafts'],
              ['rules', 'Data & planning rules'],
            ].map(([id, label]) => (
              <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </nav>
          {(tab === 'queue' || tab === 'performance') && (
            <>
              {tab === 'performance' && (
                <p className="purchase-muted">
                  Reported totals are not a recent trend. 30/90/180-day trend and statistical XYZ are
                  unavailable until comparable history exists. Buy quantities use one verified cohort, without
                  adding overlapping reports. This view ranks SF variants by reported volume; EA items remain
                  separate in the buyer queue.
                </p>
              )}
              <BuyerQueue
                plan={d.plan}
                performance={tab === 'performance'}
                onInspect={setDetails}
                onDraft={setDraftRows}
                canEdit={tab === 'queue' && canEdit}
              />
            </>
          )}
          {tab === 'drafts' && (
            <DraftList drafts={d.drafts} inbound={d.inbound} canApprove={canApprove} onChanged={d.refresh} />
          )}
          {tab === 'rules' && (
            <div className="purchase-panel purchase-form">
              <h3>Source coverage</h3>
              <dl className="purchase-facts">
                <dt>Branches</dt>
                <dd>{d.plan.scope.branches.join(' / ')}</dd>
                <dt>Report source label</dt>
                <dd>{d.plan.cohort?.location || 'Unavailable'}</dd>
                <dt>Observed through</dt>
                <dd>{d.plan.scope.observedThrough}</dd>
                <dt>Stock snapshot</dt>
                <dd>
                  {d.plan.stockImportedAt ? new Date(d.plan.stockImportedAt).toLocaleString() : 'Missing'}
                </dd>
                <dt>SPS incoming snapshot</dt>
                <dd>
                  {d.plan.inboundImportedAt ? new Date(d.plan.inboundImportedAt).toLocaleString() : 'Missing'}
                </dd>
                <dt>Review / safety buffer</dt>
                <dd>
                  {d.plan.scope.reviewDays} / {d.plan.scope.bufferDays} days
                </dd>
              </dl>
              <h3>How recommendations work</h3>
              <p>
                Target = daily demand × (lead time + review interval + buffer). Net need subtracts ready full
                slabs and confirmed receipts due within the lead + review horizon, then rounds to the supplier
                bundle/minimum. The 60-day case is a comparison; drafts default to the protective 90-day case.
              </p>
              <p>
                Held, committed, transfer and remnant rows are excluded from ready stock. App reservations are
                reconciled by serial. Missing stock becomes zero only with full coverage and an explicit
                variant policy. No fuzzy color matching.
              </p>
              <p>
                Open POs and transit share one PO-line identity. Past-due/unconfirmed ETAs block the affected
                variant. Incoming supply outside the horizon does not cover today's replenishment need. Source
                changes invalidate approval/export.
              </p>
              <p>
                Container loads keep supplier, destination and approved mix groups together. Both gross
                payload (including racks) and supplier-confirmed slab-slot/layout constraints must pass.
                Packing is deterministic, not an optimal loading claim.
              </p>
              <p>
                Approvals remain internal. An approved draft reserves variants until cancelled or linked to
                the resulting SPS PO lines. No order is automatically sent to SPS.
              </p>
            </div>
          )}
          <p className="purchase-muted">
            Calculated {new Date(d.plan.generatedAt).toLocaleString()}. Source data revalidates every 30
            seconds; the server rechecks before drafting and approval.
          </p>
        </>
      )}
      {scopeForm && d.metadata && (
        <ScopeForm
          metadata={d.metadata}
          scope={scopeForm.scope}
          onClose={() => setScopeForm(null)}
          onSaved={(saved) => {
            setScopeForm(null);
            d.setScopeId(saved._id);
            d.refresh();
          }}
        />
      )}
      {inboundForm && d.scopeId && (
        <InboundForm scopeId={d.scopeId} onClose={() => setInboundForm(false)} onSaved={refresh} />
      )}
      {details && d.plan && (
        <PlanDetails
          row={
            d.plan.rows.find((row) => row.key === details.key) || {
              ...details,
              baseline: null,
              protective: null,
              blockers: ['This variant is no longer present in the current planning inputs'],
            }
          }
          plan={d.plan}
          onClose={() => setDetails(null)}
          onConfigure={
            canEdit
              ? () => {
                  const existing = d.plan!.scope;
                  setDetails(null);
                  setScopeForm({
                    scope: existing.policies.some((p) => p.product === details.product)
                      ? existing
                      : {
                          ...existing,
                          policies: [
                            ...existing.policies,
                            {
                              product: details.product,
                              supplier: '',
                              bundleSlabs: 0,
                              minimumSlabs: 0,
                              sfPerSlab: 0,
                              weightKg: 0,
                              mixGroup: '',
                              active: true,
                            },
                          ],
                        },
                  });
                }
              : undefined
          }
        />
      )}
      {draftRows && d.plan && (
        <DraftForm
          plan={d.plan}
          rows={draftRows}
          onClose={() => setDraftRows(null)}
          onSaved={() => {
            refresh();
            setTab('drafts');
          }}
        />
      )}
    </section>
  );
}

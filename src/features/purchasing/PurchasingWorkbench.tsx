import { useState } from 'react';
import type { Scope, PlanRow } from '../../purchasing/types';
import { usePurchasingData } from './usePurchasingData';
import IncomingContainers from './components/IncomingContainers';
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
  onImportTransit,
}: {
  currentUser?: { permissions?: string[] } | null;
  refreshSignal?: number;
  onImportTransit?: () => void;
}) {
  const d = usePurchasingData(refreshSignal),
    [tab, setTab] = useState('queue'),
    [scopeForm, setScopeForm] = useState<{ scope?: Scope } | null>(null),
    [inboundForm, setInboundForm] = useState(false),
    [details, setDetails] = useState<PlanRow | null>(null),
    [detailForecastDays, setDetailForecastDays] = useState(10),
    [draftRows, setDraftRows] = useState<PlanRow[] | null>(null);
  const canEdit = !!currentUser?.permissions?.includes('manage_purchasing'),
    canApprove = !!currentUser?.permissions?.includes('approve_purchasing');
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
          <h2>Purchasing</h2>
          <p>See available stock, days of supply and incoming containers. Plan purchases from the same reports.</p>
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
            Warehouse view{' '}
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
          {d.plan?.cohort && <span className="purchase-muted">Sales period: {d.plan.cohort.start} – {d.plan.scope.observedThrough}</span>}

        </div>
      )}
      {!d.loading && !d.scopeId && (
        <div className="purchase-panel purchase-empty">
          <h3>Set up your warehouse view</h3>
          <p>
            Import stock and Fast Moving sales through Inventory Analysis, then choose the report's actual
            branches. The completed report supplies its own sales period. Unknown coverage is not treated as zero demand or zero
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
              <span>Short within 30 days</span>
              <strong>{d.plan.rows.filter(r => r.coverage?.days != null && r.coverage.days < 30).length}</strong>
            </div>
            <div>
              <span>Need source data</span>
              <strong>{d.plan.rows.filter(r => !r.coverage || r.coverage.state === 'unknown').length}</strong>
            </div>
            <div>
              <span>Active draft reservations</span>
              <strong>{d.plan.draftIds.length}</strong>
            </div>
          </div>
          {d.plan.transitImportedAt && <p role="status" className="purchase-muted">
            Reading {d.plan.transitLineCount} imported in-transit product lines for {d.plan.scope.branches.join(' / ')}.
            Last container import: {new Date(d.plan.transitImportedAt).toLocaleString()}.
          </p>}
          {!!d.plan.blockers.length && (
            <details className="purchase-planning-requirements">
              <summary>Purchase planning requirements ({d.plan.blockers.length})</summary>
              <p>These settings apply to purchase recommendations and approvals. Stock evaluation uses the uploaded reports.</p>
              <ul>
                {d.plan.blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
              {canEdit && scope && <button onClick={() => setScopeForm({ scope })}>Review planning inputs</button>}
            </details>
          )}
          <nav className="purchase-tabs" aria-label="Purchasing views">
            {[
              ['queue', 'Stock overview'],
              ['incoming', 'Incoming containers'],
              ['drafts', 'Purchase drafts'],
              ['rules', 'Settings & sources'],
            ].map(([id, label]) => (
              <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </nav>
          {tab === 'queue' && (
            <>
              <BuyerQueue
                plan={d.plan}
                onInspect={(row, days) => { setDetails(row); setDetailForecastDays(days || 10); }}
                onDraft={setDraftRows}
                canEdit={canEdit}
                onReviewCoverage={canEdit && scope ? () => setScopeForm({ scope }) : undefined}
              />
            </>
          )}
          {tab === 'incoming' && <IncomingContainers plan={d.plan} canEdit={canEdit} onImport={onImportTransit} onChanged={d.refresh} />}
          {tab === 'drafts' && d.errors.drafts && <p role="alert" className="purchase-error">Drafts could not be loaded: {d.errors.drafts} <button onClick={d.refresh}>Retry</button></p>}
          {tab === 'drafts' && d.errors.inbound && <p role="alert">SPS order lines could not be loaded. Stock results remain available. <button onClick={d.refresh}>Retry</button></p>}
          {tab === 'drafts' && (
            <DraftList drafts={d.drafts} inbound={d.inbound} canApprove={canApprove} onChanged={d.refresh} nextCursor={d.nextCursor} onLoadMore={d.loadMore} loadingMore={d.loadingMore} />
          )}
          {tab === 'rules' && (
            <div className="purchase-panel purchase-form">
              <h3>Source coverage</h3>
              <div className="purchase-actions">{canEdit && scope && <>
                <button onClick={() => setScopeForm({ scope })}>Edit scope & variant policies</button>
                <button onClick={() => setInboundForm(true)}>Import open PO snapshot</button>
              </>}</div>

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
                Open POs and transit share one PO-line identity. Past-due/unconfirmed receiving dates block the affected
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
            Calculated {new Date(d.plan.generatedAt).toLocaleString()}. Changes are checked every 30 seconds. Drafting and approval recheck current source data.
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
          forecastDays={detailForecastDays}
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

import { useState } from 'react';
import FormModal from '../../../components/shared/form/FormModal';
import { DatePicker } from '../../../components/shared/calendar/Calendar';
import type { Metadata, Scope, Policy } from '../../../purchasing/types';
import { purchasingApi, download, csv } from '../purchasingApi';
import { parsePolicyCsv, policyHeaders } from '../policyCsv';
const emptyPolicy = (): Policy => ({
  product: '',
  supplier: '',
  bundleSlabs: 0,
  minimumSlabs: 0,
  sfPerSlab: 0,
  weightKg: 0,
  mixGroup: '',
  active: true,
});
const initial = (meta: Metadata, scope?: Scope) => ({
  name: scope?.name || '',
  branches: scope?.branches || [],
  cohortId: scope?.cohortId || meta.cohorts[0]?.id || '',
  observedThrough: scope?.observedThrough || '',
  fullSalesCoverage: scope?.fullSalesCoverage || false,
  stockCoverageConfirmed: false,
  freeStockValidated: scope?.freeStockValidated || false,
  policyConfirmed: scope?.policyConfirmed || false,
  reviewDays: scope?.reviewDays ?? 7,
  bufferDays: scope?.bufferDays ?? 21,
  stockMaxHours: scope?.stockMaxHours ?? 24,
  salesMaxDays: scope?.salesMaxDays ?? 14,
  aliases: scope?.aliases || [],
  policies: scope?.policies || [],
  container: scope?.container || {
    payloadKg: 0,
    tareKg: 0,
    maxSlabs: 0,
    layoutConfirmed: false,
    mixingConfirmed: false,
  },
});
export default function ScopeForm({
  metadata,
  scope,
  onClose,
  onSaved,
}: {
  metadata: Metadata;
  scope?: Scope;
  onClose: () => void;
  onSaved: (scope: Scope) => void;
}) {
  const [snapshotAtOpen] = useState(metadata.stockSnapshotId);
  const [value, setValue] = useState(() => initial(metadata, scope)),
    [error, setError] = useState(''),
    [saving, setSaving] = useState(false);
  const change = <K extends keyof typeof value>(key: K, next: (typeof value)[K]) =>
    setValue((v) => ({ ...v, [key]: next }));
  const policy = (i: number, key: keyof Policy, next: string | number | boolean) =>
    change(
      'policies',
      value.policies.map((p, n) => (n === i ? { ...p, [key]: next } : p)),
    );
  const cohort = metadata.cohorts.find((c) => c.id === value.cohortId);
  async function submit() {
    setSaving(true);
    setError('');
    try {
      const saved = await purchasingApi.saveScope(
        { ...value, stockSnapshotId: snapshotAtOpen, ...(scope ? { version: scope.__v } : {}) },
        scope?._id,
      );
      onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }
  return (
    <FormModal
      title={scope ? 'Edit purchasing scope' : 'New purchasing scope'}
      size="l"
      onClose={onClose}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      saving={saving}
      submitLabel="Save planning scope"
      dirtyCount={1}
    >
      <div className="purchase-form">
        {error && (
          <p role="alert" className="purchase-error">
            {error}
          </p>
        )}
        <label>
          Scope name
          <input
            required
            value={value.name}
            onChange={(e) => change('name', e.target.value)}
            placeholder="Seattle purchasing"
          />
        </label>
        <fieldset>
          <legend>Warehouse branches covered by this report</legend>
          {metadata.branches.map((b) => (
            <label className="purchase-check" key={b}>
              <input
                type="checkbox"
                checked={value.branches.includes(b)}
                onChange={(e) =>
                  change(
                    'branches',
                    e.target.checked ? [...value.branches, b] : value.branches.filter((x) => x !== b),
                  )
                }
              />
              {b}
            </label>
          ))}
        </fieldset>
        <label>
          Sales report
          <select
            value={value.cohortId}
            onChange={(e) => {
              change('cohortId', e.target.value);
              change('observedThrough', '');
              change('fullSalesCoverage', false);
            }}
          >
            {metadata.cohorts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.location} · {c.start} → {c.end} · {c.count} rows
              </option>
            ))}
          </select>
        </label>
        <p className="purchase-muted">
          Imported {cohort ? new Date(cohort.importedAt).toLocaleString() : '—'}. Requested end is not proof
          of actual coverage. Enter the last observed sales day from the source.
        </p>
        <div>
          <span>Observed through</span>
          <DatePicker
            value={value.observedThrough}
            onChange={(v) => change('observedThrough', v)}
            ariaLabel="Observed sales cutoff"
          />
        </div>
        {(
          ['fullSalesCoverage', 'stockCoverageConfirmed', 'freeStockValidated', 'policyConfirmed'] as const
        ).map((field, i) => (
          <label className="purchase-check" key={field}>
            <input type="checkbox" checked={value[field]} onChange={(e) => change(field, e.target.checked)} />
            {
              [
                'I verified the report covers exactly these branches and all products, not only top sellers.',
                'I verified this current stock snapshot completely covers the selected warehouses, including zero-stock variants.',
                'I verified SPS available stock already excludes commitments; app-held slabs are reconciled by serial.',
                'I confirmed the 60–90-day range ends at usable receipt, supplier bundles/minimums, and the review cadence and buffer below.',
              ][i]
            }
          </label>
        ))}
        <div className="purchase-fields">
          {(['reviewDays', 'bufferDays', 'stockMaxHours', 'salesMaxDays'] as const).map((field, i) => (
            <label key={field}>
              {
                [
                  'Review interval (days)',
                  'Safety buffer (days)',
                  'Maximum stock/inbound age (hours)',
                  'Maximum sales lag (days)',
                ][i]
              }
              <input
                type="number"
                required
                min={field === 'bufferDays' ? 0 : 1}
                max={field === 'stockMaxHours' ? 168 : field === 'reviewDays' ? 30 : 90}
                value={value[field]}
                onChange={(e) => change(field, Number(e.target.value))}
              />
            </label>
          ))}
        </div>
        <h3>Exact variant policies</h3>
        <div className="purchase-actions">
          <button
            type="button"
            onClick={() =>
              download(
                'variant-policies.csv',
                csv([
                  policyHeaders,
                  ...(value.policies.length
                    ? value.policies.map((p) => policyHeaders.map((k) => p[k as keyof Policy]))
                    : (cohort?.products?.length ? cohort.products : ['Exact product name']).map((product) => [
                        product,
                        '',
                        6,
                        0,
                        '',
                        '',
                        '',
                        'true',
                      ])),
                ]),
              )
            }
          >
            Download variant policy template
          </button>
          <label>
            Import completed policies CSV
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={async (e) => {
                setError('');
                try {
                  const file = e.target.files?.[0];
                  if (file) change('policies', parsePolicyCsv(await file.text()));
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Could not read policy CSV');
                }
              }}
            />
          </label>
        </div>

        <p className="purchase-muted">
          Keep thickness, size and finish separate. Set supplier-specific SF/slab and weights; these are not
          cross-color averages. Missing policies keep that color blocked.
        </p>
        {value.policies.map((p, i) => (
          <fieldset key={i}>
            <legend>Variant {i + 1}</legend>
            <div className="purchase-fields">
              {(['product', 'supplier', 'mixGroup'] as const).map((field) => (
                <label key={field}>
                  {field === 'product'
                    ? 'Exact sales product'
                    : field === 'mixGroup'
                      ? 'Approved mix group (same origin / ship window)'
                      : 'Supplier'}
                  <input
                    value={p[field]}
                    required={field !== 'mixGroup'}
                    onChange={(e) => policy(i, field, e.target.value)}
                  />
                </label>
              ))}
              {(['bundleSlabs', 'minimumSlabs', 'sfPerSlab', 'weightKg'] as const).map((field, n) => (
                <label key={field}>
                  {['Slabs / bundle', 'Minimum slabs', 'Usable SF / purchased slab', 'Weight kg / slab'][n]}
                  <input
                    type="number"
                    min={field === 'minimumSlabs' ? 0 : 0.01}
                    step={['sfPerSlab', 'weightKg'].includes(field) ? '0.01' : '1'}
                    required
                    value={p[field]}
                    onChange={(e) => policy(i, field, Number(e.target.value))}
                  />
                </label>
              ))}
            </div>
            <label className="purchase-check">
              <input
                type="checkbox"
                checked={p.active}
                onChange={(e) => policy(i, 'active', e.target.checked)}
              />
              Active purchasing variant
            </label>
            <button
              type="button"
              onClick={() =>
                change(
                  'policies',
                  value.policies.filter((_, n) => n !== i),
                )
              }
            >
              Remove variant
            </button>
          </fieldset>
        ))}
        <button type="button" onClick={() => change('policies', [...value.policies, emptyPolicy()])}>
          Add variant policy
        </button>
        <h3>Approved exact-name aliases</h3>
        <p className="purchase-muted">
          Use only verified names for the same physical variant. No automatic fuzzy matching.
        </p>
        {value.aliases.map((a, i) => (
          <div className="purchase-fields" key={i}>
            <label>
              Sales product
              <input
                required
                value={a.salesProduct}
                onChange={(e) =>
                  change(
                    'aliases',
                    value.aliases.map((x, n) => (n === i ? { ...x, salesProduct: e.target.value } : x)),
                  )
                }
              />
            </label>
            <label>
              Equivalent stock product
              <input
                required
                value={a.stockProduct}
                onChange={(e) =>
                  change(
                    'aliases',
                    value.aliases.map((x, n) => (n === i ? { ...x, stockProduct: e.target.value } : x)),
                  )
                }
              />
            </label>
            <button
              type="button"
              onClick={() =>
                change(
                  'aliases',
                  value.aliases.filter((_, n) => n !== i),
                )
              }
            >
              Remove alias
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => change('aliases', [...value.aliases, { salesProduct: '', stockProduct: '' }])}
        >
          Add verified alias
        </button>
        <h3>Container limits</h3>
        <p className="purchase-muted">
          Leave limits at zero until the supplier confirms them. The review queue remains usable; container
          drafting stays blocked.
        </p>
        <div className="purchase-fields">
          {(['payloadKg', 'tareKg', 'maxSlabs'] as const).map((field, i) => (
            <label key={field}>
              {['Maximum gross load kg', 'Rack / crate tare kg', 'Approved slab-slot limit'][i]}
              <input
                required
                type="number"
                min={0}
                value={value.container[field]}
                onChange={(e) => change('container', { ...value.container, [field]: Number(e.target.value) })}
              />
            </label>
          ))}
        </div>
        <label className="purchase-check">
          <input
            type="checkbox"
            checked={value.container.layoutConfirmed}
            onChange={(e) => change('container', { ...value.container, layoutConfirmed: e.target.checked })}
          />
          The supplier verified these payload and physical layout limits for the selected slab specifications.
        </label>
        <label className="purchase-check">
          <input
            type="checkbox"
            checked={value.container.mixingConfirmed}
            onChange={(e) => change('container', { ...value.container, mixingConfirmed: e.target.checked })}
          />
          Different colors may share loads only within the same supplier, destination and approved mix group.
        </label>
      </div>
    </FormModal>
  );
}

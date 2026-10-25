import { useState } from 'react';
import FormModal from '../../../components/shared/form/FormModal';
import { parseInboundCsv, inboundHeaders } from '../inboundCsv';
import { download, csv, purchasingApi } from '../purchasingApi';
import type { InboundRow } from '../../../purchasing/types';
export default function InboundForm({
  scopeId,
  onClose,
  onSaved,
}: {
  scopeId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [rows, setRows] = useState<InboundRow[] | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [empty, setEmpty] = useState(false),
    [error, setError] = useState(''),
    [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    setError('');
    try {
      await purchasingApi.importInbound(scopeId, empty ? [] : rows || []);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setSaving(false);
    }
  }
  return (
    <FormModal
      title="Import SPS open POs & transit"
      size="m"
      onClose={onClose}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      saving={saving}
      submitLabel="Save complete supply snapshot"
      submitDisabled={!confirmed || (!empty && !rows?.length)}
      dirtyCount={1}
    >
      <div className="purchase-form">
        {error && (
          <p className="purchase-error" role="alert">
            {error}
          </p>
        )}
        <p>
          Use the adapter template to combine the SPS open-PO and transit reports. Repeated shipment rows
          share the same PO and line totals. Transit fulfills its parent PO; it is not another order.
        </p>
        <button
          type="button"
          onClick={() =>
            download(
              'sps-inbound-template.csv',
              csv([
                inboundHeaders,
                [
                  'PO-example',
                  '1',
                  'Exact sales product',
                  'Warehouse branch',
                  'Supplier',
                  120,
                  0,
                  0,
                  'YYYY-MM-DD',
                  'false',
                  'Shipment-1',
                  60,
                  0,
                  'YYYY-MM-DD',
                ],
              ]),
            )
          }
        >
          Download CSV adapter template
        </button>
        <p className="purchase-muted">
          All quantities are full slabs. Dates are usable destination receipt dates (YYYY-MM-DD). Include
          ordered, received and cancelled totals; each shipment ID appears once per PO line. Parent ETA covers
          the unshipped balance. Mark confirmed true only for dependable receiving dates. This import does not
          connect to SPS automatically.
        </p>
        <label>
          SPS adapter CSV
          <input
            type="file"
            accept=".csv,text/csv"
            disabled={empty}
            onChange={async (e) => {
              setConfirmed(false);
              setRows(null);
              setError('');
              try {
                const file = e.target.files?.[0];
                if (file) setRows(parseInboundCsv(await file.text()));
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Could not read file');
              }
            }}
          />
        </label>
        {rows && <p>{rows.length} rows parsed. The server checks PO and shipment totals before saving.</p>}
        <label className="purchase-check">
          <input
            type="checkbox"
            checked={empty}
            onChange={(e) => {
              setEmpty(e.target.checked);
              setConfirmed(false);
            }}
          />
          I checked SPS and there is no remaining PO or transit supply for this entire scope.
        </label>
        <label className="purchase-check">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          This is a complete current snapshot for every branch in the scope, with linked PO/transit identities
          and receiving ETAs verified.
        </label>
      </div>
    </FormModal>
  );
}

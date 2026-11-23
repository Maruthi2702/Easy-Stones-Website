import { useState } from 'react';
import FormModal from '../../../components/shared/form/FormModal';
import { FormSection, FormField, FormPicker } from '../../../components/shared/form/FormControls';
import { BANK_FILTERS, monthLabel } from '../../../utils/cardReceipts';
import {
  allMonthsAllowed, exportFileName, pdfAllowed, showMonths, startingChoice, thisMonthAllowed,
  type ExportChoice, type ExportFormat, type ExportMonths
} from '../../../utils/cardReceiptsExport';

/**
 * Export… (2026-11-23): Card, Months and Format in one small pop-up, in place of
 * a menu item for every mix. Design: claude.ai artifact "Card Receipts Export
 * Pop-up". Which choices are open follows the login's two switches
 * (`cardReceiptsExport.ts`); the file's name shows under the fields.
 */
export default function ExportDialog({ month, canExport, canExportAll, startBank, onExport, onClose }: {
  month: string;
  canExport: boolean;
  canExportAll: boolean;
  /** The Card filter's bank on the page ('' = both). */
  startBank: string;
  onExport: (choice: ExportChoice) => Promise<void>;
  onClose: () => void;
}) {
  const perms = { canExport, canExportAll };
  const [choice, setChoice] = useState<ExportChoice>(() => startingChoice(perms, startBank));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const monthText = month ? monthLabel(month) : 'this month';

  return (
    <FormModal
      title="Export"
      size="s"
      onClose={onClose}
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        setError('');
        try {
          await onExport(choice);
          onClose();
        } catch (err) {
          setError((err as Error).message || 'Could not build the file.');
          setSaving(false);
        }
      }}
      submitLabel="Download"
      savingLabel="Preparing…"
      saving={saving}
      footerNote={exportFileName(choice, month)}
    >
      {error ? <div className="ccr-form-error" role="alert">{error}</div> : null}
      <FormSection>
        <FormField name="bank" id="ccr-ex-bank" label="Card">
          <FormPicker id="ccr-ex-bank" value={choice.bank} onChange={(bank) => setChoice((c) => ({ ...c, bank }))}
            options={[{ value: '', label: 'Amex and Encore' }, ...BANK_FILTERS.map((b) => ({ value: b.key, label: b.label }))]}
            sheetTitle="Card" keepInForm disabled={saving} />
        </FormField>
        {showMonths(perms) ? (
          <FormField name="months" id="ccr-ex-months" label="Months">
            <FormPicker<ExportMonths> id="ccr-ex-months" value={choice.months} onChange={(months) => setChoice((c) => ({ ...c, months }))}
              options={[
                { value: 'month', label: `This month (${monthText})`, disabled: !thisMonthAllowed(perms) },
                { value: 'all', label: 'All months', disabled: !allMonthsAllowed(choice, perms) }
              ]}
              sheetTitle="Months" keepInForm disabled={saving} />
          </FormField>
        ) : null}
        <FormField name="format" id="ccr-ex-format" label="Format">
          <FormPicker<ExportFormat> id="ccr-ex-format" value={choice.format} onChange={(format) => setChoice((c) => ({ ...c, format }))}
            options={[
              { value: 'xlsx', label: 'Excel (.xlsx)' },
              { value: 'pdf', label: 'PDF', disabled: !pdfAllowed(choice, perms) }
            ]}
            sheetTitle="Format" keepInForm disabled={saving} />
        </FormField>
      </FormSection>
    </FormModal>
  );
}

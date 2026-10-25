import { useState } from 'react';
import { freightExportRows, todayIso } from './freightView';
import * as api from './freightApi';
import type { FreightToast } from './types';

/** More › Export to Excel: every charge in the current view (the server caps it), as an .xlsx file. */
export function useFreightExport({ tab, debounced, location, carrierId, setError, setToast }: {
  tab: string; debounced: string; location: string; carrierId: string;
  setError: (message: string) => void; setToast: (toast: FreightToast) => void;
}) {
  const [exporting, setExporting] = useState(false);

  const exportExcel = async () => {
    setExporting(true);
    try {
      const r = await api.exportCharges({ status: tab, search: debounced, location, carrierId });
      const XLSX = await import('xlsx');
      const ws = XLSX.utils.json_to_sheet(freightExportRows(r.items));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '3rd-Party Freight');
      XLSX.writeFile(wb, `freight-${tab.replace('_', '-')}${location ? `-${location.replace(/\s+/g, '_')}` : ''}-${todayIso()}.xlsx`);
      if (r.truncated) setToast({ text: `Exported the first ${r.items.length.toLocaleString()} of ${r.total.toLocaleString()} — pick a branch or carrier for the rest.` });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setExporting(false);
    }
  };

  return { exporting, exportExcel };
}

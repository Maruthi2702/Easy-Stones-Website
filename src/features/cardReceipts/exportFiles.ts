import { exportRows } from '../../utils/cardReceipts';
import type { CategoryLike } from '../../utils/cardReceipts';
import { buildCardReceiptsPdf } from '../../utils/cardReceiptsPdf';
import type { Expense } from './types';

/** A private receipt's link is this site's own address: it opens only for someone signed in who may see it. */
const withSite = (u: string) => (u.startsWith('/') ? `${window.location.origin}${u}` : u);

export async function writeExcel(list: readonly Expense[], categories: readonly CategoryLike[], file: string) {
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.json_to_sheet(exportRows(list.map((e) => ({ ...e, receiptUrl: e.receiptUrl ? withSite(e.receiptUrl) : e.receiptUrl })), categories));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Card receipts');
  XLSX.writeFile(wb, file);
}

const loadLogo = async () => {
  try {
    const res = await fetch('/logo.png');
    return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
  } catch {
    return null;
  }
};

export async function writePdf(list: readonly Expense[], categories: readonly CategoryLike[], scope: string, file: string) {
  const generated = `Generated ${new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`;
  const bytes = await buildCardReceiptsPdf({ list, categories, scope, generated, logo: await loadLogo() });
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = file;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

import { createHash } from 'node:crypto';
import { money, validDay } from './parserRows.ts';
import { emptyAmounts } from './types.ts';
import type { Category, EmployeeSummary, ExpenseLine, ParsedReport, PdfPage, PdfRow } from './types.ts';
export const PARSER_VERSION = 'fuelman-fn03-v1';
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
interface EmployeeState { name: string; pages: Set<number>; subtotals: { cents: number; count: number; fuel: boolean }[]; printedTotal: number | null }
function header(pages: PdfPage[]) {
  const text = pages.flatMap(p => p.rows.map(r => r.text)).join('\n');
  if (!/EMPLOYEE MANAGEMENT REPORT/i.test(text)) throw new Error('Upload a Fuelman Employee Management Report');
  const period = /EMPLOYEE MANAGEMENT REPORT FOR\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\s*[–—-]\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i.exec(text);
  const account = /Account\s*#\s*(\d+)/i.exec(text)?.[1], fleet = /FLEET\s*#\s*(\d+)/i.exec(text)?.[1];
  const company = /(?:^|\n)Name:\s*([^\n]+)/i.exec(text)?.[1]?.trim();
  if (!period || !account || !fleet || !company) throw new Error('The report is missing its account, fleet, company or reporting period');
  const date = (y: string, m: string, d: string) => `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  const start = date(period[3]!, period[1]!, period[2]!), end = date(period[6]!, period[4]!, period[5]!);
  if (!validDay(start) || !validDay(end) || start.slice(0, 7) !== end.slice(0, 7) || !start.endsWith('-01') ||
      new Date(Date.parse(end) + 86400000).getUTCDate() !== 1) throw new Error('Use a complete calendar-month Employee Management Report');
  for (const page of pages) {
    const footer = page.rows.map(r => r.text).join(' ').match(/Page:\s*(\d+)\s+of\s+(\d+)/i);
    if (!footer || Number(footer[1]) !== page.number || Number(footer[2]) !== pages.length)
      throw new Error(`Page ${page.number}: report pages are missing, out of order or incomplete`);
  }
  return { account, fleet, company, start, end, month: start.slice(0, 7) };
}
function fields(row: PdfRow, columns: Map<string, number>) {
  const read = (label: string, next?: string) => {
    const x = columns.get(label), until = next ? columns.get(next) : Infinity;
    if (x === undefined) return '';
    return row.parts.filter(p => p.x >= x - 6 && p.x < (until ?? Infinity) - 6).map(p => p.text).join(' ');
  };
  return { vehicle: read('VEHICLE', 'ODOM'), site: read('SITE', 'VEHICLE'), fuelCode: read('TYPE', 'QTY'),
    quantity: read('QTY', 'PRICE'), netPrice: read('PRICE', 'TAXES'), taxRate: read('TAXES', 'AMT'), codes: read('CODE**') };
}
export function parseReport(pages: PdfPage[]): ParsedReport {
  if (!pages.length || pages.length > 100) throw new Error('The PDF must contain between 1 and 100 pages');
  const meta = header(pages), employees = new Map<string, EmployeeState>(), lines: ExpenseLine[] = [];
  let current = '', fuel = true, columns = new Map<string, number>();
  for (const page of pages) for (const row of page.rows) {
    const text = row.text.trim();
    const employee = /^Employee Name:\s*(.*?)\s*Employee Number\s*:\s*(.*?)(?:\s*\(continued\))?$/.exec(text);
    if (employee) {
      const name = employee[1]!.trim(), id = employee[2]!.trim();
      if (!name || !id || id.length > 150) throw new Error(`Page ${page.number}: invalid employee identity`);
      const previous = employees.get(id);
      if (previous && previous.name !== name) throw new Error(`Employee ${id} has conflicting names in this report`);
      if (!previous) { employees.set(id, { name, pages: new Set(), subtotals: [], printedTotal: null }); fuel = true; }
      current = id; employees.get(id)!.pages.add(page.number);
      continue;
    }
    if (!current) continue; // The exception-only first page never becomes expense data.
    if (text === 'Fuel Transactions') fuel = true;
    if (text === 'Non-Fuel Transactions') fuel = false;
    if (/^DATE\s+TIME\s+SITE\b/.test(text)) columns = new Map(row.parts.map(p => [p.text, p.x]));
    const cash = money(text), state = employees.get(current)!;
    if (/^\d{2}\/\d{2}\s+\d{2}:\d{2}\b/.test(text)) {
      if (cash.length !== 1) throw new Error(`Page ${page.number}, employee ${current}: transaction amount is missing or ambiguous`);
      const at = /^(\d{2})\/(\d{2})\s+(\d{2}:\d{2})/.exec(text)!;
      const year = Number(meta.start.slice(0, 4)) - (Number(at[1]) > Number(meta.start.slice(5, 7)) ? 1 : 0);
      const day = `${year}-${at[1]}-${at[2]}`;
      if (!validDay(day)) throw new Error(`Page ${page.number}: invalid transaction date`);
      const f = fields(row, columns);
      if (!f.vehicle || !f.site) throw new Error(`Page ${page.number}: transaction columns were not recognized`);
      let category: Category = fuel ? (/^DEF\b/.test(f.fuelCode) ? 'def' : 'fuel') : 'other';
      if (fuel && (!f.fuelCode || !/^\d+\.\d+$/.test(f.quantity))) throw new Error(`Page ${page.number}: fuel type or quantity is missing`);
      if (!fuel) {
        if (/Automotive Supplies|Antifreeze/i.test(text)) category = 'supplies';
        if (/Local and State Tax/i.test(text)) category = 'tax';
        if (/Transaction Adjustment Amount/i.test(text) || cash[0]! < 0) category = 'adjustment';
      }
      lines.push({ index: lines.length, externalId: current, reportedName: state.name, date: day, time: at[3]!,
        site: f.site, vehicle: f.vehicle, description: text, category, fuelCode: fuel ? f.fuelCode : '',
        quantity: fuel ? f.quantity : '', netPrice: fuel ? f.netPrice : '', taxRate: fuel ? f.taxRate : '',
        amountCents: cash[0]!, exceptionCodes: f.codes.match(/\d+/g) || [], page: page.number, y: row.y });
      if (lines.length > 50000) throw new Error('The report contains too many transaction lines');
    } else if (/No\. Transactions\s+\d+/.test(text)) {
      if (!cash.length) throw new Error(`Page ${page.number}, employee ${current}: section subtotal is missing`);
      state.subtotals.push({ cents: cash.at(-1)!, count: Number(/No\. Transactions\s+(\d+)/.exec(text)![1]), fuel });
    } else if (/Employee Total:/.test(text)) {
      if (cash.length !== 1 || state.printedTotal !== null) throw new Error(`Page ${page.number}: employee total is ambiguous`);
      state.printedTotal = cash[0]!;
    }
  }
  if (!lines.length || !employees.size) throw new Error('No employee expense detail was found; an exception summary alone is not a complete report');
  const amounts = emptyAmounts(), summaries: EmployeeSummary[] = [];
  for (const [id, state] of employees) {
    const entries = lines.filter(line => line.externalId === id), total = entries.reduce((s, l) => s + l.amountCents, 0);
    const reported = state.printedTotal ?? state.subtotals.reduce((s, t) => s + t.cents, 0);
    if (!state.subtotals.length || total !== reported || entries.length !== state.subtotals.reduce((s, t) => s + t.count, 0))
      throw new Error(`Employee ${id}: detail count or amount does not reconcile to the printed totals`);
    const fuelTotal = entries.filter(l => l.fuelCode).reduce((s, l) => s + l.amountCents, 0);
    const fuelPrinted = state.subtotals.filter(t => t.fuel).reduce((s, t) => s + t.cents, 0);
    if (fuelTotal !== fuelPrinted || total - fuelTotal !== state.subtotals.filter(t => !t.fuel).reduce((s, t) => s + t.cents, 0))
      throw new Error(`Employee ${id}: fuel and non-fuel subtotals do not reconcile`);
    const categories = emptyAmounts();
    for (const line of entries) { categories[line.category] += line.amountCents; amounts[line.category] += line.amountCents; }
    summaries.push({ externalId: id, name: state.name, totalCents: total, reportedTotalCents: reported,
      lineCount: entries.length, amounts: categories, pages: [...state.pages] });
  }
  return { ...meta, pageCount: pages.length, parserVersion: PARSER_VERSION, lines, employees: summaries,
    totalCents: summaries.reduce((s, d) => s + d.totalCents, 0), amounts,
    warnings: [...(lines.some(l => l.date < meta.start) ? ['Some transactions predate this statement. Review them before approving expenses to the statement month.'] : []), 'The first page is an exception summary. All employee detail pages are used.',
      'Odometer and MPG exceptions are retained as source flags; they do not remove expenses.'] };
}
export function contentSignature(report: ParsedReport): string {
  // A multiset preserves legitimate repeated purchases, without depending on PDF page layout.
  return digest([report.account, report.fleet, report.start, report.end, report.company,
    report.lines.map(l => JSON.stringify([l.externalId, l.reportedName, l.date, l.time, l.site, l.vehicle,
      l.category, l.fuelCode, l.quantity, l.amountCents])).sort()]);
}

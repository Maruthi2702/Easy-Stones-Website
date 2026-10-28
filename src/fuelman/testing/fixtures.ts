import { parseReport } from '../parseReport.ts';
import type { ParsedReport, PdfRow, PdfPart, PdfPage } from '../types.ts';
import { emptyAmounts } from '../types.ts';
const row = (text: string, parts: PdfPart[] = []): PdfRow => ({ text, parts, y: 500 });
const part = (x: number, text: string): PdfPart => ({ x, text, y: 500, width: 30, height: 8 });
export function fixturePages(): PdfPage[] {
  const headers = [['DATE', 28], ['TIME', 69], ['SITE', 109], ['VEHICLE', 141], ['ODOM', 231], ['MPG', 268], ['TYPE', 326], ['QTY', 366], ['PRICE', 403], ['TAXES', 440], ['AMT', 483], ['CODE**', 530]] as const;
  const transaction = (category: 'fuel' | 'nonfuel', amount: string, code = 'UDSL*', description = '') => {
    const parts = [part(28, '07/01'), part(69, '10:00'), part(105, '100001'), part(141, 'Truck 1'), part(232, '10000'),
      ...(category === 'fuel' ? [part(325, code), part(366, '10.000'), part(401, '4.00000'), part(440, '0.20000')] : [part(283, description)]), part(481, amount)];
    return row(parts.map(p => p.text).join(' '), parts);
  };
  return [{ number: 1, width: 612, height: 792, rows: [row('EMPLOYEE MANAGEMENT REPORT'), row('Account #12345'), row('FLEET #67890'), row('Name: Test Fleet'),
    row('EMPLOYEE MANAGEMENT REPORT FOR 7/1/2026 – 7/31/2026'), row('SUMMARY OF TRANSACTIONS THIS REPORTING PERIOD FOR ALL EMPLOYEES WITH EXCEPTIONS'), row('Driver Alpha No Department 1 $999.99'), row('Page: 1 of 2')] },
  { number: 2, width: 612, height: 792, rows: [row('Employee Name: Driver Alp Employee Number :A'), row(headers.map(h => h[0]).join(' '), headers.map(([text, x]) => part(x, text))), row('Fuel Transactions'),
    transaction('fuel', '$42.00'), transaction('fuel', '$6.00', 'DEF'), row('No. Transactions 2 Total Miles: 100 Price/Gallon: $4.00 $48.00'),
    row('Non-Fuel Transactions'), transaction('nonfuel', '$5.00', '', 'Automotive Supplies'), transaction('nonfuel', '$0.50', '', 'Local and State Tax'), transaction('nonfuel', '-$1.00', '', 'Transaction Adjustment Amount'),
    row('No. Transactions 3 $4.50'), row('Employee Total: $52.50'), row('Page: 2 of 2')] }];
}
export function fixtureReport(month = '2026-07', ids = ['A'], extraCents = 0): ParsedReport {
  const base = parseReport(fixturePages()), start = `${month}-01`, end = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const lines = ids.flatMap((externalId, idIndex) => base.lines.map((l, index) => ({ ...l, index: idIndex * base.lines.length + index,
    externalId, reportedName: externalId === 'A' ? 'Driver Alp' : `Driver ${externalId}`, date: `${month}-01`, amountCents: l.amountCents + (index === 0 ? extraCents : 0) })));
  const employees = ids.map(externalId => { const entries = lines.filter(l => l.externalId === externalId), amounts = emptyAmounts(); entries.forEach(l => { amounts[l.category] += l.amountCents; });
    return { externalId, name: entries[0]!.reportedName, totalCents: entries.reduce((s, l) => s + l.amountCents, 0), reportedTotalCents: entries.reduce((s, l) => s + l.amountCents, 0), amounts, lineCount: entries.length, pages: [2] }; });
  const amounts = emptyAmounts(); lines.forEach(l => { amounts[l.category] += l.amountCents; });
  return { ...base, start, end, month, lines, employees, amounts, totalCents: employees.reduce((s, e) => s + e.totalCents, 0) };
}

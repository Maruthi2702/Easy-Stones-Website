import type { PdfPage, PdfPart, PdfRow } from './types.ts';
interface TextItem { str: string; transform: number[]; width: number; height: number }
export function pageRows(number: number, width: number, height: number, items: TextItem[]): PdfPage {
  const sorted = items.filter(item => item.str.trim()).map(item => ({
    text: item.str.trim(), x: item.transform[4]!, y: item.transform[5]!, width: item.width, height: item.height,
  })).sort((a, b) => b.y - a.y || a.x - b.x);
  const groups: { y: number; parts: PdfPart[] }[] = [];
  for (const part of sorted) {
    const previous = groups.at(-1);
    if (previous && Math.abs(previous.y - part.y) <= 2) previous.parts.push(part);
    else groups.push({ y: part.y, parts: [part] });
  }
  const rows: PdfRow[] = groups.map(group => ({ y: group.y,
    parts: group.parts.sort((a, b) => a.x - b.x), text: group.parts.sort((a, b) => a.x - b.x).map(p => p.text).join(' '),
  }));
  return { number, width, height, rows };
}
export function money(text: string): number[] {
  return [...text.matchAll(/(-?)\$(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})\b/g)].map(m => {
    const cents = Number(m[2]!.replaceAll(',', '')) * 100 + Number(m[3]);
    if (!Number.isSafeInteger(cents) || cents > 100_000_000_00) throw new Error('An amount is outside the supported range');
    return m[1] ? -cents : cents;
  });
}
export function validDay(day: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day;
}

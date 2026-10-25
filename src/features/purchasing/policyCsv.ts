import type { Policy } from '../../purchasing/types';
import { parseCsv } from './inboundCsv';
export const policyHeaders = [
  'product',
  'supplier',
  'bundleSlabs',
  'minimumSlabs',
  'sfPerSlab',
  'weightKg',
  'mixGroup',
  'active',
];
export function parsePolicyCsv(text: string): Policy[] {
  const [head, ...rows] = parseCsv(text.replace(/^\uFEFF/, ''));
  if (!head) throw new Error('Policy CSV is empty');
  const headers = head.map((h) => h.trim().toLowerCase());
  if (new Set(headers).size !== headers.length) throw new Error('Duplicate policy columns');
  for (const h of policyHeaders)
    if (!headers.includes(h.toLowerCase())) throw new Error(`Missing policy column ${h}`);
  if (rows.length > 1000) throw new Error('Use at most 1,000 variant policies');
  return rows.map((r, i) => {
    const get = (key: string) => r[headers.indexOf(key.toLowerCase())]?.trim() || '';
    const number = (key: string, min: number, whole = false) => {
      const raw = get(key),
        n = Number(raw);
      if (!raw || !Number.isFinite(n) || n < min || (whole && !Number.isSafeInteger(n)))
        throw new Error(`Policy row ${i + 2}: check ${key}`);
      return n;
    };
    if (!get('product') || !get('supplier'))
      throw new Error(`Policy row ${i + 2}: product and supplier are required`);
    const active = get('active').toLowerCase();
    if (!['true', 'false', 'yes', 'no', '1', '0'].includes(active))
      throw new Error(`Policy row ${i + 2}: active must be true or false`);
    return {
      product: get('product'),
      supplier: get('supplier'),
      bundleSlabs: number('bundleSlabs', 1, true),
      minimumSlabs: number('minimumSlabs', 0, true),
      sfPerSlab: number('sfPerSlab', 0.01),
      weightKg: number('weightKg', 0.01),
      mixGroup: get('mixGroup'),
      active: ['true', 'yes', '1'].includes(active),
    };
  });
}

import { API_URL } from '../../../config/api';
import { authFetch } from '../../../api/authFetch';
import type { ErrorBody } from '../../../types/api';
import type { LineKind, LineStatus } from '../../../utils/amexStatement';

/** The Amex check's calls to /api/card-receipts/statements (src/routes/cardReceiptStatements.ts). */

export type StatementLine = {
  reference: string; date: string; description: string; cardMember: string; digits: string; cents: number; kind: LineKind;
  amexCategory: string; cityState: string; cardId: string | null; cardLabel: string; holderId: string; holderName: string;
  expenseId: string | null; expenseStatus: string | null; status: LineStatus;
};
export type UnknownCard = { digits: string; cardMember: string; charges: number; cents: number; first: string; last: string; suggestedUserId: string };
export type StaffPerson = { id: string; name: string; role: string; location: string; active: boolean; card: string };
export type StatementUpload = {
  id: string; fileName: string; periodFrom: string | null; periodTo: string | null; lines: number; added: number;
  chargesCents: number; byName: string; at: string;
};
export type StatementsView = {
  lines: StatementLine[]; unknownCards: UnknownCard[]; missingNow: { count: number; cents: number };
  imports: StatementUpload[]; people: StaffPerson[]; missingFrom: string;
};
export type CheckResult = { linked: number; created: number; retired: number; cardsFound: number };
export type UploadResult = {
  preview: boolean; lines: number; added: number; known: number; charges: number; chargesCents: number;
  counts: Record<LineStatus, { count: number; cents: number }>; unknownCards: UnknownCard[]; people: StaffPerson[];
  check: CheckResult; period: { from: string; to: string } | null; missingFrom: string;
};

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await authFetch(`${API_URL}/api/card-receipts/statements${path}`, init);
  } catch {
    throw Object.assign(new Error('Couldn’t reach the server. Check your connection and try again.'), { status: 0 });
  }
  const data: ErrorBody & { problems?: string[]; more?: number; digits?: string } = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(data.message || data.error || `Something went wrong (${res.status}).`), {
      status: res.status, problems: data.problems || [], more: data.more || 0, digits: data.digits || ''
    });
  }
  return data as T;
}

export const loadStatements = (month: string) => call<StatementsView>(`?month=${encodeURIComponent(month)}`);

const form = (file: File, picks: Record<string, string>, replace: string[] = []) => {
  const body = new FormData();
  body.append('file', file);
  const cards = Object.entries(picks).filter(([, userId]) => userId).map(([digits, userId]) => ({ digits, userId, replace: replace.includes(digits) }));
  if (cards.length) body.append('cards', JSON.stringify(cards));
  return body;
};
export const previewUpload = (file: File, picks: Record<string, string>, replace: string[] = []) => call<UploadResult>('/preview', { method: 'POST', body: form(file, picks, replace) });
export const importUpload = (file: File, picks: Record<string, string>, replace: string[] = []) => call<UploadResult>('/import', { method: 'POST', body: form(file, picks, replace) });
export const setUpCard = (digits: string, userId: string, replace = false) =>
  call<{ check: CheckResult }>('/cards', { method: 'POST', body: JSON.stringify({ digits, userId, replace }) });

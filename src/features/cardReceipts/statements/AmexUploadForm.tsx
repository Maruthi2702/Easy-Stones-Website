import { useEffect, useMemo, useRef, useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import FormModal from '../../../components/shared/form/FormModal';
import { FormSection, FormField, FormSearchPicker } from '../../../components/shared/form/FormControls';
import { formatMoney, usDate } from '../../../utils/cardReceipts';
import * as api from './statementsApi';
import { periodLabel, personOptions } from './statementsView';
import type { UploadResult } from './statementsApi';
import type { Issuer } from '../../../utils/amexStatement';

type Problem = Error & { problems?: string[]; more?: number; digits?: string };

const BANKS: { key: Issuer; label: string; file: string; hint: string }[] = [
  { key: 'amex', label: 'Amex', file: 'Amex activity export', hint: 'Amex → Statements & Activity → Download → Excel, with “Include all additional transaction details”' },
  { key: 'encore', label: 'Encore', file: 'Encore transactions export', hint: 'Encore → Transactions → Export → Excel (.xlsx), one row per transaction' }
];

/**
 * Upload a bank's export (Amex's activity or Encore's transactions): pick the file and it's checked at once (nothing kept) — what it
 * would match, the Missing receipt rows it would make, the cards it can't place. A card can be
 * set up right here by picking its holder (the preview runs again with the pick). Upload and
 * check keeps it.
 */
export default function AmexUploadForm({ onDone, onClose, initialIssuer = 'amex' }: { onDone: (r: UploadResult) => void; onClose: () => void; initialIssuer?: Issuer }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [issuer, setIssuer] = useState<Issuer>(initialIssuer);
  const [file, setFile] = useState<File | null>(null);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<UploadResult | null>(null);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  /** A card pick the server refused (its holder already has a card…): the pick is dropped, the reason stays. */
  const [cardNotes, setCardNotes] = useState<Record<string, string>>({});
  const asked = useRef(0);

  // Every change of file or pick checks again; only the newest answer counts.
  useEffect(() => {
    if (!file) return;
    const n = ++asked.current;
    setReading(true);
    setProblem(null);
    api.previewUpload(file, picks, Object.keys(picks), issuer)
      .then((r) => {
        if (n !== asked.current) return;
        setPreview(r);
        // A suggested holder (the one staff name with the bank's first and last name) starts picked.
        setPicks((cur) => {
          const next = { ...cur };
          for (const c of r.unknownCards) if (!(c.digits in next) && c.suggestedUserId) next[c.digits] = c.suggestedUserId;
          return Object.keys(next).length === Object.keys(cur).length ? cur : next;
        });
      })
      .catch((e: Problem) => {
        if (n !== asked.current) return;
        if (e.digits) {
          setCardNotes((cur) => ({ ...cur, [e.digits!]: e.message }));
          setPicks((p) => ({ ...p, [e.digits!]: '' }));
          return;
        }
        setPreview(null);
        setProblem(e);
      })
      .finally(() => { if (n === asked.current) setReading(false); });
  }, [file, picks, issuer]);

  const bank = BANKS.find((b) => b.key === issuer)!;
  const people = useMemo(() => personOptions(preview?.people || [], issuer), [preview?.people, issuer]);
  const cardOf = (id: string) => { const p = preview?.people.find((x) => x.id === id); return (issuer === 'encore' ? p?.encoreCard : p?.card) || ''; };
  const nameOf = (id: string) => preview?.people.find((p) => p.id === id)?.name || '';
  const c = preview?.counts;
  const picked = Object.values(picks).filter(Boolean).length;

  return (
    <FormModal
      title="Upload statement"
      size="m"
      onClose={onClose}
      onSubmit={async () => {
        if (!file || !preview) return;
        // A pick whose person already has a card replaces it: the old card is deactivated, so ask first.
        const replacing = Object.entries(picks).filter(([, id]) => id && cardOf(id))
          .map(([digits, id]) => ({ digits, name: nameOf(id), card: cardOf(id) }));
        if (replacing.length && !window.confirm(`Replace ${replacing.length === 1 ? 'a card' : `${replacing.length} cards`}? ${replacing.map((r) => `${r.name}'s card ${r.card} will be deactivated and …${r.digits} set up instead`).join('; ')}.`)) return;
        setSaving(true);
        setProblem(null);
        // Only the cards the person just agreed to replace are sent as replacements (review B8): a card that gained a holder meanwhile is refused, not swapped silently.
        try { onDone(await api.importUpload(file, picks, replacing.map((r) => r.digits), issuer)); } catch (e) {
          const err = e as Problem;
          if (err.digits) { setCardNotes((cur) => ({ ...cur, [err.digits!]: err.message })); setPicks((p) => ({ ...p, [err.digits!]: '' })); } else setProblem(err);
          setSaving(false);
        }
      }}
      submitLabel="Upload and check"
      savingLabel="Checking…"
      saving={saving}
      submitDisabled={!preview || reading}
      dirtyCount={file ? 1 : 0}
      footerNote={file ? 'Nothing is kept until you upload.' : ''}
    >
      {problem ? (
        <div className="ccr-form-error" role="alert">
          {problem.message}
          {problem.problems && problem.problems.length > 1 ? (
            <ul className="ccr-st-problems">{problem.problems.slice(1).map((p) => <li key={p}>{p}</li>)}{problem.more ? <li>…and {problem.more} more</li> : null}</ul>
          ) : null}
        </div>
      ) : null}
      <FormSection>
        <FormField name="bank" id="ccr-st-bank" label="Bank" required>
          <div className="ccr-seg" role="radiogroup" aria-label="Bank" id="ccr-st-bank">
            {BANKS.map((b) => (
              <button key={b.key} type="button" role="radio" aria-checked={issuer === b.key} className={issuer === b.key ? 'is-on' : ''} disabled={saving}
                onClick={() => { if (b.key !== issuer) { setIssuer(b.key); setFile(null); setPicks({}); setCardNotes({}); setPreview(null); setProblem(null); } }}>{b.label}</button>
            ))}
          </div>
        </FormField>
        <FormField name="file" id="ccr-st-file" label={bank.file} required>
          <button id="ccr-st-file" type="button" className="ccr-st-drop" onClick={() => fileInput.current?.click()} disabled={saving}>
            <FileSpreadsheet size={20} aria-hidden="true" />
            <b>{reading && !preview ? 'Reading the file…' : file ? file.name : 'Choose the .xlsx file'}</b>
            <span>{bank.hint}</span>
          </button>
          <input ref={fileInput} type="file" accept=".xlsx,.xls" hidden aria-label={`${bank.label} file`}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) { setFile(f); setPicks({}); setCardNotes({}); setPreview(null); } e.target.value = ''; }} />
        </FormField>
      </FormSection>

      {preview && c ? (
        <FormSection title={periodLabel(preview.period?.from, preview.period?.to) || 'What the file holds'}>
          <p className="ccr-st-lead">
            <b>{preview.lines.toLocaleString()}</b> lines · {preview.added.toLocaleString()} new
            {preview.known ? <>, {preview.known.toLocaleString()} uploaded before (kept, not added again)</> : null}
            {' '}· {formatMoney(preview.chargesCents)} in charges
          </p>
          <ul className="ccr-st-outcomes">
            <li><span className="ccr-dot is-ok" aria-hidden="true" /><b>{c.matched.count.toLocaleString()}</b> have their receipt uploaded</li>
            <li><span className="ccr-dot is-miss" aria-hidden="true" /><b>{c.missing.count.toLocaleString()}</b> become Missing receipt for their cardholder · {formatMoney(c.missing.cents)}</li>
            {c.before_start.count ? (
              <li><span className="ccr-dot is-draft" aria-hidden="true" /><b>{c.before_start.count.toLocaleString()}</b> are before {usDate(preview.missingFrom)}: listed, no receipt asked for</li>
            ) : null}
            <li><span className="ccr-dot is-draft" aria-hidden="true" /><b>{c.no_receipt.count.toLocaleString()}</b> need no receipt (payments, credits, refunds, interest, fees)</li>
            {c.unassigned?.count ? (
              <li><span className="ccr-dot is-back" aria-hidden="true" /><b>{c.unassigned.count.toLocaleString()}</b> are on cards with no login yet: shown as Missing receipt until the card is assigned</li>
            ) : null}
            {c.no_card.count ? (
              <li><span className="ccr-dot is-back" aria-hidden="true" /><b>{c.no_card.count.toLocaleString()}</b> are on cards not set up yet</li>
            ) : null}
          </ul>
        </FormSection>
      ) : null}

      {preview && preview.unknownCards.length ? (
        <FormSection title={`Cards not set up · ${preview.unknownCards.length}`}>
          <p className="ccr-st-lead">Pick whose card each one is and it’s set up with this upload ({picked} of {preview.unknownCards.length} picked). Left blank, its charges wait under Cards not set up.</p>
          <div className="ccr-st-cards">
            {preview.unknownCards.map((u) => (
              <FormField key={`${u.issuer}${u.digits}`} name={`card-${u.digits}`} id={`ccr-st-card-${u.digits}`} error={cardNotes[u.digits] || ''}
                label={`${u.cardMember} · …${u.digits} · ${u.charges} ${u.charges === 1 ? 'charge' : 'charges'}, ${formatMoney(u.cents)}`}>
                <FormSearchPicker id={`ccr-st-card-${u.digits}`} value={picks[u.digits] || ''} selectedLabel={picks[u.digits] ? nameOf(picks[u.digits]!) : 'Leave it for now'}
                  onChange={(id) => { setCardNotes(({ [u.digits]: _gone, ...rest }) => rest); setPicks((p) => ({ ...p, [u.digits]: id })); }} options={people}
                  placeholder="Not set up yet" searchPlaceholder="Search people" sheetTitle={`Card …${u.digits}`} keepInForm />
              </FormField>
            ))}
          </div>
        </FormSection>
      ) : null}
    </FormModal>
  );
}

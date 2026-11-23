import { useMemo, useState } from 'react';
import { CreditCard } from 'lucide-react';
import { FormSearchPicker } from '../../../components/shared/form/FormControls';
import { formatMoney, usDate } from '../../../utils/cardReceipts';
import type { Issuer } from '../../../utils/amexStatement';
import { BANK_NAMES, personOptions } from './statementsView';
import type { StatementsView, UnknownCard } from './statementsApi';
import './Statements.css';

/**
 * Cards a bank's statements name that nobody has set up (both banks, each with its badge): pick the
 * holder, Set up card, and their charges are checked. Lives at the top of the Cards tab (2026-11-23);
 * the Statements tab only says how many there are.
 */
export default function UnknownCards({ cards, people, onSetUp }: {
  cards: UnknownCard[]; people: StatementsView['people']; onSetUp: (digits: string, userId: string, replace: boolean, issuer: Issuer) => Promise<void>;
}) {
  const key = (c: UnknownCard) => `${c.issuer}${c.digits}`;
  const [picks, setPicks] = useState<Record<string, string>>(() => Object.fromEntries(cards.map((c) => [key(c), c.suggestedUserId])));
  const [busy, setBusy] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const optionsFor = useMemo(() => ({ amex: personOptions(people, 'amex'), encore: personOptions(people, 'encore') }), [people]);
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name || '';
  return (
    <div className="ccr-box ccr-st-unset">
      <h2 className="ccr-st-h"><CreditCard size={16} aria-hidden="true" /> Cards not set up · {cards.length}</h2>
      <div className="ccr-st-unknown">
        {cards.map((c) => {
          const k = key(c);
          return (
            <div key={k} className="ccr-st-urow">
              <div className="ccr-who">
                <b>{c.cardMember}</b>
                <span><span className={`ccr-bank is-${c.issuer}`}>{BANK_NAMES[c.issuer]}</span> …{c.digits} · {c.charges} {c.charges === 1 ? 'charge' : 'charges'}, {formatMoney(c.cents)} · {usDate(c.first)} to {usDate(c.last)}</span>
                {notes[k] ? <span className="ccr-st-note" role="alert">{notes[k]}</span> : null}
              </div>
              <div className="ccr-st-pick fm-tokens">
                <FormSearchPicker id={`ccr-st-u-${k}`} value={picks[k] || ''} selectedLabel={picks[k] ? nameOf(picks[k]!) : 'Choose the cardholder'}
                  onChange={(id) => setPicks((p) => ({ ...p, [k]: id }))} options={optionsFor[c.issuer].slice(1)}
                  placeholder="Choose the cardholder" searchPlaceholder="Search people" sheetTitle={`Card …${c.digits}`} keepInForm />
              </div>
              <button type="button" className="ccr-btn" disabled={!picks[k] || Boolean(busy)} onClick={async () => {
                setBusy(k);
                setNotes(({ [k]: _gone, ...rest }) => rest);
                const holder = people.find((p) => p.id === picks[k]);
                const had = c.issuer === 'encore' ? holder?.encoreCard : holder?.card;
                if (had && !window.confirm(`${nameOf(picks[k]!)} already has card ${had}. Deactivate it and set up …${c.digits} instead?`)) { setBusy(''); return; }
                try { await onSetUp(c.digits, picks[k]!, Boolean(had), c.issuer); } catch (e) { setNotes((n) => ({ ...n, [k]: (e as Error).message })); } finally { setBusy(''); }
              }}>{busy === k ? 'Setting up…' : 'Set up card'}</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

import { bankName } from '../cardChoice';
import type { Card } from '../types';

/**
 * "Which card did you pay with?" for a person who holds more than one (design: claude.ai artifact
 * **Receipt Card Choice**, two-button toggle): both cards in one track, the chosen one lifted with a tick.
 * The card ID already ends in the last digits, so only the bank and the ID are shown.
 */
export default function CardToggle({ cards, value, onChange, lastId, error = '' }: {
  cards: Card[]; value: string; onChange: (id: string) => void; lastId: string; error?: string;
}) {
  const index = Math.max(0, cards.findIndex((c) => c._id === value));
  const last = cards.find((c) => c._id === lastId);
  return (
    <div className="fm-field">
      <span className="fm-label" id="ccr-card-label">Which card did you pay with?</span>
      <div className="ccr-tg" role="radiogroup" aria-labelledby="ccr-card-label" style={{ ['--n' as string]: cards.length, ['--i' as string]: index }}>
        <span className="ccr-tg-thumb" aria-hidden="true" />
        {cards.map((c) => (
          <button key={c._id} type="button" role="radio" aria-checked={c._id === value} className={`ccr-tg-b is-${c.issuer}`} onClick={() => onChange(c._id)}>
            <span className="ccr-tg-logo">{bankName(c.issuer).toUpperCase()}</span>
            <span className="ccr-tg-tx"><b>{bankName(c.issuer)}</b><span>{c.label}</span></span>
            <span className="ccr-tg-tick" aria-hidden="true">✓</span>
          </button>
        ))}
      </div>
      {error ? <span className="fm-error" role="alert">{error}</span> : last ? <span className="ccr-sub">Last used: {bankName(last.issuer)}</span> : null}
    </div>
  );
}

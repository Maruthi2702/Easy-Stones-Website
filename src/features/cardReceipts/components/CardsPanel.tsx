import { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import FormModal from '../../../components/shared/form/FormModal';
import { FormSection, FormRow, FormField, FormPicker, FormSearchPicker } from '../../../components/shared/form/FormControls';
import { ISSUERS, cleanCard, suggestCardLabel } from '../../../utils/cardReceipts';
import * as api from '../cardReceiptsApi';
import type { Card, Person } from '../types';

type CardValues = { userId: string; issuer: 'amex' | 'other'; lastDigits: string; label: string };

function CardForm({ card, people, onSave, onClose }: {
  card: Card | null; people: Person[]; onSave: (v: CardValues & { active?: boolean }) => Promise<unknown>; onClose: () => void;
}) {
  const start: CardValues = card ? { userId: card.userId, issuer: card.issuer, lastDigits: card.lastDigits, label: card.label } : { userId: '', issuer: 'amex', lastDigits: '', label: '' };
  const [v, setV] = useState(start);
  const [labelTouched, setLabelTouched] = useState(Boolean(card));
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState('');
  const [serverProblems, setServerProblems] = useState<Record<string, string>>({});
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name || '';
  const set = (patch: Partial<CardValues>) => {
    setServerProblems({});
    setV((cur) => {
      const next = { ...cur, ...patch };
      // The card ID follows the name and digits until someone types their own.
      if (!labelTouched && (patch.userId !== undefined || patch.lastDigits !== undefined)) next.label = suggestCardLabel(nameOf(next.userId), next.lastDigits);
      return next;
    });
  };
  const problems = { ...cleanCard(v).problems, ...serverProblems };
  const errors = submitted ? problems : {};
  const dirty = (Object.keys(start) as (keyof CardValues)[]).filter((k) => v[k] !== start[k]).length;
  const personOptions = useMemo(() => people.filter((p) => p.active || p.id === start.userId).map((p) => ({
    value: p.id, label: p.name, description: [p.role.replace(/_/g, ' '), p.location].filter(Boolean).join(' · '), keywords: `${p.name} ${p.location}`
  })), [people, start.userId]);

  return (
    <FormModal
      title={card ? <>Edit card <span className="fm-title-sub">· {card.label}</span></> : 'Add company card'}
      size="s"
      onClose={onClose}
      onSubmit={async () => {
        setSubmitted(true);
        if (Object.keys(problems).length) return;
        setSaving(true);
        setServerError('');
        try { await onSave(v); } catch (e) {
          const err = e as Error & { problems?: Record<string, string> };
          setServerProblems(err.problems || {});
          setServerError(err.message);
          setSaving(false);
        }
      }}
      submitLabel={card ? 'Save changes' : 'Add card'}
      saving={saving}
      submitDisabled={Boolean(card) && !dirty}
      dirtyCount={dirty}
      errors={errors}
      showErrors={submitted}
      fieldLabels={{ userId: 'Cardholder', lastDigits: 'Last digits', label: 'Card ID' }}
    >
      {serverError ? <div className="ccr-form-error" role="alert">{serverError}</div> : null}
      <FormSection>
        <FormField name="userId" id="ccr-card-user" label="Cardholder" required error={errors.userId}>
          <FormSearchPicker id="ccr-card-user" value={v.userId} selectedLabel={nameOf(v.userId)} onChange={(id) => set({ userId: id })}
            options={personOptions} placeholder="Choose a person" searchPlaceholder="Search people" sheetTitle="Cardholder" error={errors.userId} keepInForm />
        </FormField>
        <FormRow>
          <FormField name="issuer" id="ccr-card-issuer" label="Card">
            <FormPicker id="ccr-card-issuer" value={v.issuer} onChange={(i) => set({ issuer: i as CardValues['issuer'] })}
              options={ISSUERS.map((i) => ({ value: i.key, label: i.label }))} sheetTitle="Card" keepInForm />
          </FormField>
          <FormField name="lastDigits" id="ccr-card-digits" label="Last digits" required error={errors.lastDigits}>
            <input id="ccr-card-digits" className="fm-input" inputMode="numeric" maxLength={5} autoComplete="off" placeholder="Last 4 or 5"
              value={v.lastDigits} onChange={(e) => set({ lastDigits: e.target.value.replace(/\D/g, '') })} />
          </FormField>
        </FormRow>
        <FormField name="label" id="ccr-card-label" label="Card ID" required error={errors.label}>
          <input id="ccr-card-label" className="fm-input ccr-mono" autoComplete="off" maxLength={20} placeholder="Name letters + digits"
            value={v.label} onChange={(e) => { setLabelTouched(true); setV((cur) => ({ ...cur, label: e.target.value.toUpperCase() })); }} />
        </FormField>
      </FormSection>
    </FormModal>
  );
}

/**
 * Cards: one per person, the card ID accounting uses (first 4 letters of the
 * name + the last 5 digits). With Manage cards: add, edit, deactivate — a
 * person needs their old card deactivated before they get a new one.
 */
export default function CardsPanel({ canManage, onSaved }: { canManage: boolean; onSaved: (text: string) => void }) {
  const [cards, setCards] = useState<Card[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<Card | 'new' | null>(null);

  useEffect(() => {
    api.listCards().then((r) => { setCards(r.cards); setPeople(r.people); }).catch((e: Error) => setError(e.message)).finally(() => setLoading(false));
  }, []);

  const nameOf = (id: string) => people.find((p) => p.id === id)?.name || 'Someone who left';
  const placeOf = (id: string) => people.find((p) => p.id === id)?.location || '';
  const replace = (card: Card) => setCards((list) => [card, ...list.filter((c) => c._id !== card._id)].sort((a, b) => Number(b.active) - Number(a.active) || a.label.localeCompare(b.label)));

  const toggle = async (card: Card) => {
    try { replace((await api.editCard(card._id, { active: !card.active })).card); onSaved(card.active ? `${card.label} deactivated` : `${card.label} active again`); } catch (e) { setError((e as Error).message); }
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="ccr-cards-head">
        <h2>Company cards</h2>
        <span className="ccr-sub">{cards.filter((c) => c.active).length} active</span>
        {canManage ? <button type="button" className="ccr-btn gold" style={{ marginLeft: 'auto' }} onClick={() => setOpen('new')}><Plus size={16} aria-hidden="true" /> Add card</button> : null}
      </div>
      {error ? <div className="ccr-note is-error" role="alert">{error}</div> : null}
      <div className={`ccr-box${loading ? ' is-loading' : ''}`}>
        {cards.length ? (
          <div className="ccr-table-wrap">
            <table className="ccr-table">
              <thead><tr><th>Card ID</th><th>Cardholder</th><th className="ccr-col-wide">Location</th><th>Card</th><th>Status</th>{canManage ? <th aria-label="Actions" /> : null}</tr></thead>
              <tbody>
                {cards.map((c) => (
                  <tr key={c._id} style={{ cursor: 'default', opacity: c.active ? 1 : 0.6 }}>
                    <td className="ccr-mono">{c.label}</td>
                    <td>{nameOf(c.userId)}</td>
                    <td className="ccr-col-wide">{placeOf(c.userId)}</td>
                    <td>{c.issuer === 'amex' ? 'Amex' : 'Other'} ···{c.lastDigits}</td>
                    <td>{c.active ? <span className="ccr-chip is-ok">Active</span> : <span className="ccr-chip is-draft">Deactivated</span>}</td>
                    {canManage ? (
                      <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                        <button type="button" className="ccr-btn" style={{ height: 34 }} onClick={() => setOpen(c)}>Edit</button>{' '}
                        <button type="button" className="ccr-btn" style={{ height: 34 }} onClick={() => toggle(c)}>{c.active ? 'Deactivate' : 'Reactivate'}</button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="ccr-empty">{loading ? 'Loading…' : <><h3>No company cards yet</h3><span>Add each person’s card so they can upload receipts.</span></>}</div>
        )}
      </div>
      {open ? (
        <CardForm
          card={open === 'new' ? null : open}
          people={people}
          onClose={() => setOpen(null)}
          onSave={async (v) => {
            const saved = open === 'new' ? (await api.addCard(v)).card : (await api.editCard(open._id, v)).card;
            replace(saved);
            setOpen(null);
            onSaved(open === 'new' ? `Card ${saved.label} added` : `Card ${saved.label} saved`);
          }}
        />
      ) : null}
    </div>
  );
}

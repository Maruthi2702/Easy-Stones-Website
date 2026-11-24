import { useEffect, useMemo, useState } from 'react';
import { Ban, Pencil, Plus, RotateCcw } from 'lucide-react';
import RowMenu from '../../../components/shared/RowMenu';
import type { RowMenuItem } from '../../../components/shared/RowMenu';
import useIsPhone from '../../../components/shared/form/useIsPhone';
import FormModal from '../../../components/shared/form/FormModal';
import { FormSection, FormRow, FormField, FormPicker, FormSearchPicker } from '../../../components/shared/form/FormControls';
import LocationPicker from '../../../components/shared/form/LocationPicker';
import { ISSUERS, cleanCard, suggestCardLabel } from '../../../utils/cardReceipts';
import * as api from '../cardReceiptsApi';
import * as statementsApi from '../statements/statementsApi';
import UnknownCards from '../statements/UnknownCards';
import type { StatementsView, UnknownCard } from '../statements/statementsApi';
import type { Card, Person } from '../types';

type CardValues = { userId: string; issuer: 'amex' | 'encore' | 'other'; lastDigits: string; label: string; amexName: string; location: string };

/** The switch for the hourly Missing-receipt emails and pushes. Off until someone turns it on. */
function AutoRemindersSwitch() {
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { api.getAutoReminders().then((r) => setOn(r.on)).catch((e) => setError((e as Error).message)); }, []);
  const flip = async () => {
    if (on === null || busy) return;
    if (!on && !window.confirm('Turn on automatic reminders? Every cardholder with a Missing receipt older than 2 days gets an email and a phone notification on the next hourly check, and managers, Accounting and Admins from day 3.')) return;
    setBusy(true); setError('');
    try { setOn((await api.setAutoReminders(!on)).on); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="ccr-note" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
        <input type="checkbox" role="switch" checked={on === true} disabled={on === null || busy} onChange={flip} />
        <b>Automatic missing-receipt reminders: {on === null ? '…' : on ? 'On' : 'Off'}</b>
      </label>
      <span className="ccr-sub">Emails and phone notifications on day 2 and day 3. Send reminder by hand always works.</span>
      {error ? <span role="alert">{error}</span> : null}
    </div>
  );
}

function CardForm({ card, people, onSave, onClose }: {
  card: Card | null; people: Person[]; onSave: (v: CardValues & { active?: boolean }) => Promise<unknown>; onClose: () => void;
}) {
  const start: CardValues = card ? { userId: card.userId, issuer: card.issuer, lastDigits: card.lastDigits, label: card.label, amexName: card.amexName || '', location: card.location || '' } : { userId: '', issuer: 'amex', lastDigits: '', label: '', amexName: '', location: '' };
  // The name starts as what the uploaded statements print for this card, until one is typed and saved.
  const [v, setV] = useState<CardValues>({ ...start, amexName: start.amexName || card?.statementName || '' });
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
  // The branches the staff list knows, plus the one already on the card.
  const branchNames = useMemo(() => [...new Set([...people.map((p) => p.location), card?.location || ''].filter(Boolean))], [people, card]);
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
        <FormField name="location" id="ccr-card-location" label="Location">
          <LocationPicker id="ccr-card-location" value={v.location} onChange={(location) => set({ location })} options={branchNames}
            noneLabel="None" sheetTitle="Location" />
        </FormField>
        <FormField name="amexName" id="ccr-card-amex" label="Amex card member">
          <input id="ccr-card-amex" className="fm-input ccr-mono" autoComplete="off" maxLength={120} placeholder="As Amex prints it"
            value={v.amexName} onChange={(e) => set({ amexName: e.target.value.toUpperCase() })} />
        </FormField>
      </FormSection>
    </FormModal>
  );
}

/**
 * Cards: one active card per person per bank (Amex, Encore), shown together under the
 * person; the card ID is the first 4 letters of the name + the last 4 or 5 digits. With Manage cards: add, edit, deactivate — a
 * person needs their old card deactivated before they get a new one.
 */
export default function CardsPanel({ canManage, canSetUp = false, month = '', onSaved }: { canManage: boolean; canSetUp?: boolean; month?: string; onSaved: (text: string) => void }) {
  const [cards, setCards] = useState<Card[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<Card | 'new' | null>(null);
  /** Cards the bank statements name that nobody has set up, from the Statements check (needs its switch). */
  const [unset, setUnset] = useState<{ cards: UnknownCard[]; people: StatementsView['people'] } | null>(null);

  const reload = () => api.listCards().then((r) => { setCards(r.cards); setPeople(r.people); }).catch((e: Error) => setError(e.message)).finally(() => setLoading(false));
  const loadUnset = () => (canSetUp && month ? statementsApi.loadStatements(month).then((v) => setUnset({ cards: v.unknownCards, people: v.people })).catch(() => setUnset(null)) : Promise.resolve());
  useEffect(() => { reload(); }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadUnset(); }, [canSetUp, month]);

  // A card set up from the Amex check before its holder has a login has no one yet: Edit assigns it.
  const nameOf = (id: string) => (id ? people.find((p) => p.id === id)?.name || 'Someone who left' : 'Not assigned yet');
  // The holder's own location, else the branch kept on the card (a card with no holder yet).
  const placeOf = (c: Card) => (c.userId ? people.find((p) => p.id === c.userId)?.location : '') || c.location || '';
  // A saved card keeps the statement name the list was loaded with (the save's answer doesn't carry it).
  const replace = (card: Card) => setCards((list) => [{ statementName: list.find((c) => c._id === card._id)?.statementName, ...card }, ...list.filter((c) => c._id !== card._id)].sort((a, b) => Number(b.active) - Number(a.active) || a.label.localeCompare(b.label)));

  const isPhone = useIsPhone();
  /** Edit and Deactivate / Reactivate, in the row's ⋯ like the other screens. */
  const menu = (c: Card) => {
    if (!canManage) return null;
    const items: RowMenuItem[] = [
      { key: 'edit', label: c.userId ? 'Edit' : 'Assign to a person', icon: Pencil, onClick: () => setOpen(c) },
      c.active
        ? { key: 'off', label: 'Deactivate', icon: Ban, danger: true, onClick: () => toggle(c) }
        : { key: 'on', label: 'Reactivate', icon: RotateCcw, onClick: () => toggle(c) }
    ];
    return <RowMenu items={items} label={`Actions for card ${c.label}`} />;
  };
  const status = (c: Card) => (c.active ? <span className="ccr-chip is-ok">Active</span> : <span className="ccr-chip is-draft">Deactivated</span>);

  const toggle = async (card: Card) => {
    try { replace((await api.editCard(card._id, { active: !card.active })).card); onSaved(card.active ? `${card.label} deactivated` : `${card.label} active again`); } catch (e) { setError((e as Error).message); }
  };

  // One entry per person: their Amex and Encore cards sit together (a card with no holder yet stands alone).
  const BANK_ORDER: Record<string, number> = { amex: 0, encore: 1, other: 2 };
  const bankName = (c: Card) => (c.issuer === 'amex' ? 'Amex' : c.issuer === 'encore' ? 'Encore' : 'Other card');
  const groups = useMemo(() => {
    const by = new Map<string, Card[]>();
    for (const c of cards) by.set(c.userId || `none:${c._id}`, [...(by.get(c.userId || `none:${c._id}`) || []), c]);
    return [...by.entries()].map(([key, list]) => ({
      key, userId: list[0]!.userId,
      cards: [...list].sort((a, b) => Number(b.active) - Number(a.active) || (BANK_ORDER[a.issuer] ?? 3) - (BANK_ORDER[b.issuer] ?? 3) || a.label.localeCompare(b.label))
    })).sort((a, b) => Number(b.cards.some((c) => c.active)) - Number(a.cards.some((c) => c.active))
      || (a.userId ? 0 : 1) - (b.userId ? 0 : 1)
      || nameOf(a.userId).localeCompare(nameOf(b.userId)) || a.cards[0]!.label.localeCompare(b.cards[0]!.label));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, people]);
  const cardLine = (c: Card) => (
    <div key={c._id} className="ccr-cardline" style={{ opacity: c.active ? 1 : 0.6 }}>
      <span className="ccr-cardline-main">
        <b>{c.label}</b>
        <span className="ccr-card-meta">{bankName(c)} ···{c.lastDigits}{c.amexName || c.statementName ? ` · ${c.amexName || c.statementName}` : ''}</span>
      </span>
      {status(c)}
      {canManage ? <span className="ccr-cardline-menu">{menu(c)}</span> : null}
    </div>
  );

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="ccr-cards-head">
        <h2>Company cards</h2>
        <span className="ccr-sub">{cards.filter((c) => c.active).length} active{cards.some((c) => c.active && !c.userId) ? ` · ${cards.filter((c) => c.active && !c.userId).length} not assigned yet` : ''}</span>
        {canManage ? <button type="button" className="ccr-btn gold" style={{ marginLeft: 'auto' }} onClick={() => setOpen('new')}><Plus size={16} aria-hidden="true" /> Add card</button> : null}
      </div>
      {canManage ? <AutoRemindersSwitch /> : null}
      {error ? <div className="ccr-note is-error" role="alert">{error}</div> : null}
      {unset?.cards.length ? (
        <UnknownCards cards={unset.cards} people={unset.people} onSetUp={async (digits, userId, replace, issuer) => {
          const r = await statementsApi.setUpCard(digits, userId, replace, issuer);
          onSaved(r.check.created ? `Card set up · ${r.check.created} Missing receipt ${r.check.created === 1 ? 'row' : 'rows'} made` : 'Card set up');
          await Promise.all([reload(), loadUnset()]);
        }} />
      ) : null}
      <div className={`ccr-box${loading ? ' is-loading' : ''}`}>
        {cards.length && isPhone ? (
          <div className="ccr-cards">
            {groups.map((g) => (
              <div key={g.key} className="ccr-card ccr-card-row" style={{ cursor: 'default', display: 'grid', gap: 8 }}>
                <span style={{ display: 'grid', gap: 3, minWidth: 0 }}>
                  <b>{g.userId ? nameOf(g.userId) : 'Not assigned yet'}</b>
                  {placeOf(g.cards[0]!) ? <span className="ccr-card-meta">{placeOf(g.cards[0]!)}</span> : null}
                </span>
                {g.cards.map(cardLine)}
              </div>
            ))}
          </div>
        ) : cards.length ? (
          <div className="ccr-table-wrap">
            <table className="ccr-table">
              <thead><tr><th>Cardholder</th><th className="ccr-col-wide">Location</th><th>Cards</th></tr></thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.key} style={{ cursor: 'default' }}>
                    <td style={{ verticalAlign: 'top' }}>{g.userId ? nameOf(g.userId) : <span className="ccr-muted">Not assigned yet</span>}</td>
                    <td className="ccr-col-wide" style={{ verticalAlign: 'top' }}>{placeOf(g.cards[0]!)}</td>
                    <td><div className="ccr-cardlines">{g.cards.map(cardLine)}</div></td>
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

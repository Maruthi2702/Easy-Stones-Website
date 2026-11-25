import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Ban, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import DashboardSearch from '../../../components/shared/DashboardSearch';
import LocationFilter from '../../../components/shared/LocationFilter';
import Pagination from '../../../components/shared/Pagination';
import { usePagination } from '../../../components/shared/paginationConfig';
import RowMenu from '../../../components/shared/RowMenu';
import type { RowMenuItem } from '../../../components/shared/RowMenu';
import useIsPhone from '../../../components/shared/form/useIsPhone';
import FormModal from '../../../components/shared/form/FormModal';
import { FormSection, FormRow, FormField, FormPicker, FormSearchPicker, SegmentedToggle } from '../../../components/shared/form/FormControls';
import LocationPicker from '../../../components/shared/form/LocationPicker';
import { ISSUERS, cleanCard, suggestCardLabel } from '../../../utils/cardReceipts';
import * as api from '../cardReceiptsApi';
import * as statementsApi from '../statements/statementsApi';
import UnknownCards from '../statements/UnknownCards';
import type { StatementsView, UnknownCard } from '../statements/statementsApi';
import { branchClass } from '../statements/statementsView';
import { BANK_CHOICES, CARD_STATUSES, NO_CARD_FILTERS, cardLocations, cardMatches, filtersOn, groupCards, initialOf, type CardBank, type CardFilters, type CardStatus } from '../cardsView';
import type { Card, Person, ReceiptsUser } from '../types';

type CardValues = { userId: string; issuer: 'amex' | 'encore' | 'other'; lastDigits: string; label: string; amexName: string; location: string };

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
export default function CardsPanel({ canManage, canSetUp = false, month = '', onSaved, user = null, headSlot = null, onSummary }: {
  canManage: boolean; canSetUp?: boolean; month?: string; onSaved: (text: string) => void;
  user?: ReceiptsUser | null;
  /** The page header's tools box (desktop): the chip, search, Filters and Add card go there. */
  headSlot?: HTMLElement | null;
  /** The numbers the page header shows beside its title. */
  onSummary?: (s: { total: number; active: number; unassigned: number }) => void;
}) {
  const [cards, setCards] = useState<Card[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<Card | 'new' | null>(null);
  /** Cards the bank statements name that nobody has set up, from the Statements check (needs its switch). */
  const [unset, setUnset] = useState<{ cards: UnknownCard[]; people: StatementsView['people'] } | null>(null);
  const [filters, setFilters] = useState<CardFilters>(NO_CARD_FILTERS);
  const pager = usePagination();

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
  /** Edit, Deactivate / Reactivate and Delete, in the row's ⋯ like the other screens. */
  const menu = (c: Card) => {
    if (!canManage) return null;
    const items: RowMenuItem[] = [
      { key: 'edit', label: c.userId ? 'Edit' : 'Assign to a person', icon: Pencil, onClick: () => setOpen(c) },
      c.active
        ? { key: 'off', label: 'Deactivate', icon: Ban, danger: true, onClick: () => toggle(c) }
        : { key: 'on', label: 'Reactivate', icon: RotateCcw, onClick: () => toggle(c) },
      { key: 'delete', label: 'Delete', icon: Trash2, danger: true, divider: true, onClick: () => remove(c) }
    ];
    return <RowMenu items={items} label={`Actions for card ${c.label}`} />;
  };
  const status = (c: Card) => (c.active ? <span className="ccr-chip is-ok">Active</span> : <span className="ccr-chip is-draft">Deactivated</span>);

  const toggle = async (card: Card) => {
    try { replace((await api.editCard(card._id, { active: !card.active })).card); onSaved(card.active ? `${card.label} deactivated` : `${card.label} active again`); } catch (e) { setError((e as Error).message); }
  };

  /** Only a card with no expenses can go; the server says so otherwise and the card stays. */
  const remove = async (card: Card) => {
    if (!window.confirm(`Delete card ${card.label}? This can’t be undone.`)) return;
    try { await api.deleteCard(card._id); setCards((list) => list.filter((c) => c._id !== card._id)); setError(''); onSaved(`${card.label} deleted`); } catch (e) { setError((e as Error).message); }
  };

  const bankName = (c: Card) => (c.issuer === 'amex' ? 'Amex' : c.issuer === 'encore' ? 'Encore' : 'Other card');
  const names = useMemo(() => ({ holderName: (c: Card) => (c.userId ? people.find((p) => p.id === c.userId)?.name || 'Someone who left' : ''), place: placeOf }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [people]);
  const patch = (p: Partial<CardFilters>) => setFilters((f) => ({ ...f, ...p }));
  useEffect(() => { pager.resetPage(); }, [filters, pager.resetPage]);
  const shown = useMemo(() => cards.filter((c) => cardMatches(c, filters, names)), [cards, filters, names]);
  // One entry per person, their Amex and Encore cards together, by location then name (cardsView.ts).
  const groups = useMemo(() => groupCards(shown, names), [shown, names]);
  const paged = groups.slice((pager.currentPage - 1) * pager.rowsPerPage, pager.currentPage * pager.rowsPerPage);
  const n = (p: Partial<CardFilters>) => cards.filter((c) => cardMatches(c, { ...filters, ...p }, names)).length;
  const locations = useMemo(() => cardLocations(cards, people, names), [cards, people, names]);
  const activeN = cards.filter((c) => c.active).length;
  const unassignedN = cards.filter((c) => c.active && !c.userId).length;
  useEffect(() => { onSummary?.({ total: cards.length, active: activeN, unassigned: unassignedN }); }, [cards.length, activeN, unassignedN, onSummary]);

  const cardLine = (c: Card) => (
    <div key={c._id} className="ccr-cardline" style={{ opacity: c.active ? 1 : 0.6 }}>
      <span className="ccr-cardline-main">
        <b>{c.label}</b>
        <span className="ccr-card-meta"><span className={`ccr-bank is-${c.issuer}`}>{bankName(c)}</span> ···{c.lastDigits}{c.amexName || c.statementName ? ` · ${c.amexName || c.statementName}` : ''}</span>
      </span>
      {status(c)}
      {canManage ? <span className="ccr-cardline-menu">{menu(c)}</span> : null}
    </div>
  );
  const holderCell = (g: (typeof groups)[number]) => (
    <span className="ccr-who">
      <span className={`ccr-av lg${g.userId ? '' : ' is-none'}`} aria-hidden="true">{g.userId ? initialOf(g.name) : '?'}</span>
      {g.userId ? <span className="ccr-who-name">{g.name}</span> : <span className="ccr-who-name is-none">Not assigned yet</span>}
    </span>
  );
  const place = (g: (typeof groups)[number]) => (g.place ? <span className={`ccr-branch ${branchClass(g.place)}`}>{g.place}</span> : <span className="ccr-muted">—</span>);

  // The page header's tools (Customers-tab look): the not-assigned shortcut, search, the round Filters button, Add card.
  const tools = (
    <>
      {unassignedN ? (
        <button type="button" className="ccr-chip is-wait ccr-chip-btn" onClick={() => patch({ status: 'unassigned' })}>{unassignedN} not assigned yet</button>
      ) : null}
      <DashboardSearch value={filters.search} onChange={(search) => patch({ search })} label="Search cards" placeholder="Search name, card ID, last digits"
        count={filters.search ? `${shown.length} of ${cards.length}` : null} />
      <LocationFilter
        options={[]} value="" onChange={() => {}} user={user} wide
        active={filtersOn(filters) > 0}
        activeCount={filtersOn(filters) - (filters.search.trim() ? 1 : 0)}
        onClear={() => setFilters((f) => ({ ...NO_CARD_FILTERS, search: f.search }))}
        doneLabel={shown.length ? `Show ${shown.length} card${shown.length === 1 ? '' : 's'}` : 'No cards match'}
      >
        <div className="fm-tokens ccr-fields">
          <div className="lf-group" role="group" aria-labelledby="ccr-cf-bank">
            <span className="lf-group-label" id="ccr-cf-bank">Bank</span>
            <SegmentedToggle<string>
              label="Bank" value={filters.bank} onChange={(bank) => patch({ bank: bank as CardBank })}
              options={[{ value: '', label: `All · ${n({ bank: '' })}` }, ...BANK_CHOICES.map((b) => ({ value: b.key, label: `${b.label} · ${n({ bank: b.key })}` }))]}
            />
          </div>
          <div className="lf-group">
            <label className="lf-group-label" htmlFor="ccr-cf-status">Status</label>
            <FormPicker id="ccr-cf-status" value={filters.status} onChange={(status) => patch({ status: status as CardStatus })}
              options={[...CARD_STATUSES.map((x) => ({ value: x.key, label: `${x.label} · ${n({ status: x.key })}` })), { value: 'all', label: `Every status · ${n({ status: 'all' })}` }]}
              sheetTitle="Status" keepInForm />
          </div>
          {locations.length > 1 ? (
            <div className="lf-group">
              <label className="lf-group-label" htmlFor="ccr-cf-location">Location</label>
              <LocationPicker id="ccr-cf-location" value={filters.location} onChange={(location) => patch({ location })} options={locations}
                noneLabel="All locations" sheetTitle="Location" />
            </div>
          ) : null}
        </div>
      </LocationFilter>
      {canManage ? <button type="button" className="ccr-btn gold" onClick={() => setOpen('new')}><Plus size={16} aria-hidden="true" /> Add card</button> : null}
    </>
  );

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {headSlot && !isPhone ? createPortal(tools, headSlot) : <div className="ccr-cards-bar">{tools}</div>}
      {error ? <div className="ccr-note is-error" role="alert">{error}</div> : null}
      {unset?.cards.length ? (
        <UnknownCards cards={unset.cards} people={unset.people} onSetUp={async (digits, userId, replace, issuer) => {
          const r = await statementsApi.setUpCard(digits, userId, replace, issuer);
          onSaved(r.check.created ? `Card set up · ${r.check.created} Missing receipt ${r.check.created === 1 ? 'row' : 'rows'} made` : 'Card set up');
          await Promise.all([reload(), loadUnset()]);
        }} />
      ) : null}
      <div className={`ccr-box${loading ? ' is-loading' : ''}`}>
        {groups.length && isPhone ? (
          <div className="ccr-cards">
            {paged.map((g) => (
              <div key={g.key} className={`ccr-card ccr-card-row ccr-hold${g.userId ? '' : ' is-none'}`} style={{ cursor: 'default', display: 'grid', gap: 8 }}>
                <span className="ccr-hold-head">
                  {holderCell(g)}
                  <span className="ccr-hold-tags">{g.cards.length > 1 ? <span className="ccr-two">{g.cards.length} cards</span> : null}{g.place ? place(g) : null}</span>
                </span>
                <span className="ccr-cardlines">{g.cards.map(cardLine)}</span>
              </div>
            ))}
          </div>
        ) : groups.length ? (
          <div className="ccr-table-wrap">
            <table className="ccr-table ccr-cards-table">
              <thead><tr><th>Cardholder</th><th className="ccr-col-wide">Location <span className="ccr-sorted" role="img" aria-label="Sorted A to Z">↑</span></th><th>Cards</th></tr></thead>
              <tbody>
                {paged.map((g) => (
                  <tr key={g.key} style={{ cursor: 'default' }} className={g.userId ? '' : 'is-none'}>
                    <td style={{ verticalAlign: 'top' }}><span className="ccr-first">{holderCell(g)}</span></td>
                    <td className="ccr-col-wide" style={{ verticalAlign: 'top' }}><span className="ccr-first">{place(g)}</span></td>
                    <td><div className="ccr-cardlines">{g.cards.map(cardLine)}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : cards.length ? (
          <div className="ccr-empty"><h3>Nothing matches</h3><span>Clear the search or the filters.</span></div>
        ) : (
          <div className="ccr-empty">{loading ? 'Loading…' : <><h3>No company cards yet</h3><span>Add each person’s card so they can upload receipts.</span></>}</div>
        )}
      </div>
      {groups.length ? (
        <Pagination currentPage={pager.currentPage} totalPages={Math.max(1, Math.ceil(groups.length / pager.rowsPerPage))}
          onPageChange={pager.setCurrentPage} rowsPerPage={pager.rowsPerPage} onRowsPerPageChange={pager.setRowsPerPage} totalCount={groups.length} />
      ) : null}
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

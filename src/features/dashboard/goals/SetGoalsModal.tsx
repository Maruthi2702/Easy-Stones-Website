import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import FormModal from '../../../components/shared/form/FormModal';
import { saveSalesGoals } from '../../../api/salesGoals';
import type { GoalPerson } from '../../../api/salesGoals';
import { MONTH_SHORT, annualGoal, moneyFull, readGoalMonths, spreadEvenly } from '../../../utils/salesGoals';

/**
 * Set goals (needs the Users & Roles → Visits → Set goals switch; the server checks it again, and
 * only people on your team). One block per person for the year on screen: an annual goal that
 * spreads evenly across the months, and an arrow that opens the twelve months to set each by hand
 * (the owner's design: months can differ; they always add up to the annual goal shown). A blank
 * month is no goal. Weekly visits is held for later. On FormModal (FORM_TEMPLATE.md), no Cancel.
 */
const dollars = (cents: number | null) => (cents == null ? '' : String(Math.round(cents) / 100));
const monthsOf = (p: GoalPerson) => p.goalCents.map(dollars);
const sameMonths = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => (readOne(v) ?? null) === (readOne(b[i]) ?? null));
const readOne = (s: string): number | null => {
    const t = s.replace(/[$,\s]/g, '');
    return t === '' || !Number.isFinite(Number(t)) ? null : Math.round(Number(t) * 100);
};

type Draft = { months: string[]; annual: string | null };

export default function SetGoalsModal({ year, people, onSaved, onClose }: {
    year: number; people: GoalPerson[]; onSaved: (person: GoalPerson) => void; onClose: () => void;
}) {
    const [base, setBase] = useState<Record<string, string[]>>(() => Object.fromEntries(people.map((p) => [p.id, monthsOf(p)])));
    const [drafts, setDrafts] = useState<Record<string, Draft>>(() => Object.fromEntries(people.map((p) => [p.id, { months: monthsOf(p), annual: null }])));
    const [openId, setOpenId] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [touched, setTouched] = useState(false);

    const changed = useMemo(() => people.filter((p) => !sameMonths(drafts[p.id].months, base[p.id])), [people, drafts, base]);
    const problems = useMemo(() => {
        const out: Record<string, string> = {};
        for (const p of people) {
            const r = readGoalMonths(drafts[p.id].months);
            if (!r.ok) out[`goal-${p.id}`] = `${p.name}: ${r.message}`;
        }
        return out;
    }, [people, drafts]);

    const setMonth = (id: string, i: number, value: string) =>
        setDrafts((d) => ({ ...d, [id]: { annual: null, months: d[id].months.map((m, k) => (k === i ? value : m)) } }));
    const setAnnual = (id: string, text: string) => {
        const cents = readOne(text);
        setDrafts((d) => ({ ...d, [id]: { annual: text, months: cents == null ? Array(12).fill('') : spreadEvenly(cents).map((c) => dollars(c)) } }));
    };
    const annualText = (id: string) => {
        const d = drafts[id];
        if (d.annual != null) return d.annual;
        const total = annualGoal(d.months.map(readOne));
        return total == null ? '' : dollars(total);
    };

    const submit = async () => {
        setTouched(true);
        setError('');
        if (Object.keys(problems).length) return;
        if (!changed.length) { onClose(); return; }
        setSaving(true);
        let failed = '';
        for (const p of changed) {
            try {
                const saved = await saveSalesGoals(p.id, year, drafts[p.id].months);
                onSaved(saved);
                setBase((b) => ({ ...b, [p.id]: monthsOf(saved) }));
            } catch (e) {
                failed = `${p.name}: ${e instanceof Error ? e.message : 'could not save.'}`;
                break;
            }
        }
        setSaving(false);
        if (failed) setError(failed); else onClose();
    };

    return (
        <FormModal
            title={`Sales goals · ${year}`}
            size="m"
            submitLabel="Save goals"
            savingLabel="Saving…"
            saving={saving}
            dirtyCount={changed.length}
            errors={problems}
            showErrors={touched}
            fieldLabels={Object.fromEntries(people.map((p) => [`goal-${p.id}`, `${p.name}'s goals`]))}
            onClose={onClose}
            onSubmit={() => { void submit(); }}
        >
            {error ? <p role="alert" className="gl-set-error">{error}</p> : null}
            <p className="gl-set-note">Open a person to set each month. The months add up to the annual goal. Leave a month blank for no goal.</p>
            <ul className="gl-set-list">
                {people.map((p) => {
                    const open = openId === p.id;
                    const d = drafts[p.id];
                    const total = annualGoal(d.months.map(readOne));
                    const bad = touched && problems[`goal-${p.id}`];
                    return (
                        <li key={p.id} className={`gl-set-item${open ? ' is-open' : ''}`}>
                            <div className="gl-set-head">
                                <button type="button" className="gl-chev" aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} ${p.name}’s months`} onClick={() => setOpenId(open ? null : p.id)}>
                                    <ChevronDown size={16} className={open ? 'is-up' : ''} aria-hidden="true" />
                                </button>
                                <span className="gl-who"><span className="gl-name">{p.name}</span>{p.branch && <small>{p.branch}</small>}</span>
                                <label className="gl-set-annual">
                                    <span className="gl-set-lbl">Annual goal</span>
                                    <span className="gl-set-money"><span aria-hidden="true">$</span>
                                        <input className="fm-input" inputMode="decimal" autoComplete="off" value={annualText(p.id)} disabled={saving}
                                            aria-invalid={bad ? true : undefined} onChange={(e) => setAnnual(p.id, e.target.value)} />
                                    </span>
                                </label>
                                <span className="gl-set-avg"><span className="gl-set-lbl">Average / month</span>{total == null ? '—' : moneyFull(total / 12)}</span>
                                <span className="gl-vph gl-set-weekly">Weekly visits · coming soon</span>
                            </div>
                            {bad ? <p role="alert" className="gl-set-error">{bad}</p> : null}
                            {open && (
                                <div className="gl-set-months">
                                    {MONTH_SHORT.map((m, i) => (
                                        <label key={m} className="gl-set-m">
                                            <span className="gl-set-lbl">{m}</span>
                                            <span className="gl-set-money"><span aria-hidden="true">$</span>
                                                <input className="fm-input" inputMode="decimal" autoComplete="off" value={d.months[i]} disabled={saving}
                                                    onChange={(e) => setMonth(p.id, i, e.target.value)} />
                                            </span>
                                        </label>
                                    ))}
                                    <p className="gl-set-sum">Months add up to <b>{total == null ? '—' : moneyFull(total)}</b></p>
                                </div>
                            )}
                        </li>
                    );
                })}
            </ul>
        </FormModal>
    );
}

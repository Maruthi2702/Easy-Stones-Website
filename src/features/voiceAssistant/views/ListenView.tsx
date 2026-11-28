import { useState } from 'react';
import { Search } from 'lucide-react';
import { questionText, typeChoices } from '../assistantMachine';
import { splitLastWord } from '../assistantFormat';
import type { Assistant } from '../useAssistant';
import LevelBars from './LevelBars';
import Logo from './Logo';

const SKIPPABLE = new Set(['notes', 'outcome', 'followUp']);

/** The live words, the newest one lit. */
export function LiveWords({ text }: { text: string }) {
  const { head, last } = splitLastWord(text);
  if (!text.trim()) return <span className="va-faint">Say it now…</span>;
  return <>“{head}<span className="va-last">{last}</span><span className="va-caret" aria-hidden="true" />”</>;
}

/** What has been understood so far, as small chips, above a question. */
function HeardSoFar({ a }: { a: Assistant }) {
  const d = a.state.draft;
  const chips = [
    d.visitType && `Type: ${a.types.find((t) => t.name === d.visitType)?.label || d.visitType}`,
    d.notes && `Notes: ${d.notes}`,
    d.outcome && `Outcome: ${d.outcome}`,
    d.followUp && `Follow-up: ${d.followUp}`
  ].filter(Boolean) as string[];
  if (!chips.length) return null;
  return <div className="va-chips" aria-label="Heard so far">{chips.map((c) => <span key={c} className="va-chip">{c}</span>)}</div>;
}

function TypeChoices({ a }: { a: Assistant }) {
  const [all, setAll] = useState(false);
  const shown = typeChoices(a.state, all);
  const more = typeChoices(a.state, true).length > shown.length;
  return (
    <div className="va-choices" role="group" aria-label="Visit type">
      {shown.map((t) => (
        <button key={t.name} type="button" className="va-choice" onClick={() => a.pickType(t.name as string)}>{t.label || t.name}</button>
      ))}
      {more && <button type="button" className="va-choice va-choice-more" onClick={() => setAll(true)}>More types</button>}
    </div>
  );
}

function CustomerMiss({ a }: { a: Assistant }) {
  const { customerMiss } = a.state;
  return (
    <div className="va-miss">
      <p className="va-note">
        {customerMiss ? <>I heard “{customerMiss}”. </> : null}
        Say the customer’s name, or pick from your recent ones.
      </p>
      {a.recent.length > 0 && (
        <div className="va-chips">
          {a.recent.map((c) => (
            <button key={c.id} type="button" className="va-chip va-chip-btn" onClick={() => a.pickCustomer(c)}>
              {c.label}{c.city ? ` · ${c.city}` : ''}
            </button>
          ))}
        </div>
      )}
      <button type="button" className="va-btn va-btn-ghost" onClick={a.openSearch}><Search size={16} aria-hidden="true" />Search by name</button>
    </div>
  );
}

/** The first sentence, and every question after it: the mic is open and the words appear as they are said. */
export function ListenView({ a }: { a: Assistant }) {
  const s = a.state;
  const asking = s.phase === 'ask' ? s.asking : null;
  return (
    <>
      {asking && <HeardSoFar a={a} />}
      {asking ? (
        <h2 className="va-q va-in" id="va-question">{questionText(s)}</h2>
      ) : (
        <p className="va-note va-in">Say what happened. For example: “Log a visit at Smith Granite, dropped samples, follow up Friday.”</p>
      )}
      {asking === 'type' && <TypeChoices a={a} />}
      {asking === 'customer' && <CustomerMiss a={a} />}
      {asking ? (
        <div className="va-status" role="status">
          <Logo spinning={s.mic === 'on'} size={22} />
          {s.partial.trim() ? <span className="va-quote"><LiveWords text={s.partial} /></span> : <span>Listening for your answer…</span>}
        </div>
      ) : (
        <div className="va-live" aria-live="polite"><LiveWords text={s.partial} /></div>
      )}
      <LevelBars />
      <div className="va-actions">
        <button type="button" className="va-btn va-btn-ghost" onClick={a.typeInstead}>Type instead</button>
        {asking && SKIPPABLE.has(asking) && <button type="button" className="va-btn va-btn-ghost" onClick={a.skip}>Skip</button>}
        <button type="button" className="va-btn va-btn-main va-grow" onClick={a.doneTalking} disabled={s.mic !== 'on'}>
          <span className="va-stop" aria-hidden="true" />Done talking
        </button>
      </div>
      <p className="va-fine">Your phone turns your voice into words. The assistant only gets the words, never a recording.</p>
    </>
  );
}

/** The words have gone: the card shows as a skeleton while the answer is worked out. */
export function ThinkingView({ a }: { a: Assistant }) {
  return (
    <>
      <p className="va-heard va-in" aria-label="What you said">“{a.state.heard}”</p>
      <div className="va-skel" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => <div key={i} className="va-skel-row"><i /><b /></div>)}
      </div>
      <p className="va-fine" role="status">Working it out…</p>
    </>
  );
}

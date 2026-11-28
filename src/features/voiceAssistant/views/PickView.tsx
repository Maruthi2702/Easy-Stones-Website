import type { Assistant } from '../useAssistant';

const WORDS = ['', 'one', 'two', 'three', 'four', 'five'];

/** "Which one?": customers that sound alike, each with its city; a tap picks (code ranked them, the person decides). */
export default function PickView({ a }: { a: Assistant }) {
  const list = a.state.candidates;
  const same = list.every((c) => c.label === list[0]?.label);
  return (
    <>
      <h2 className="va-q va-in" id="va-question">
        {same ? <>I found {WORDS[list.length] || list.length} <em>{list[0]?.label}</em>. Which one?</> : <>I found a few that sound like “{a.state.draft.customerQuery}”. Which one?</>}
      </h2>
      <div className="va-cards">
        {list.map((c, i) => (
          <button key={c.id} type="button" className="va-card va-in" style={{ ['--i' as string]: i }} onClick={() => a.pickCustomer(c)}>
            <span className="va-card-name">{c.label}</span>
            <span className="va-card-city">{c.city || 'No city on file'}</span>
            {c.note && <span className="va-card-note">{c.note}</span>}
          </button>
        ))}
      </div>
      <p className="va-fine">Tap the one you mean.</p>
      <button type="button" className="va-btn va-btn-ghost" onClick={a.openSearch}>Neither, search for a customer</button>
    </>
  );
}

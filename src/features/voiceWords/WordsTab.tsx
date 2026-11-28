import { useEffect, useMemo, useState } from 'react';
import { Eye, EyeOff, Mic, Pencil, Plus, ClipboardPaste, Trash2 } from 'lucide-react';
import DashboardSearch from '../../components/shared/DashboardSearch';
import Pagination from '../../components/shared/Pagination';
import { pageCount, usePagination } from '../../components/shared/paginationConfig';
import RowMenu from '../../components/shared/RowMenu';
import type { RowMenuItem } from '../../components/shared/RowMenu';
import FormModal from '../../components/shared/form/FormModal';
import type { VoiceWord, VoiceWordInput } from '../../utils/assistantContract';
import { addVoiceWord, deleteVoiceWord, loadVoiceWords, updateVoiceWord } from './voiceWordsApi';
import { EMPTY_LINE, KIND_LABELS, KIND_ORDER, NO_FILTERS, filterWords, heardLine, kindCounts, statusCounts } from './voiceWordsView';
import type { StatusFilter, WordFilters } from './voiceWordsView';
import PasteDialog from './PasteDialog';
import WordForm from './WordForm';

const STATUSES: { value: StatusFilter; label: string }[] = [{ value: 'active', label: 'Active' }, { value: 'hidden', label: 'Hidden' }, { value: 'all', label: 'All' }];

/** Words tab: the list the recognizer and Claude are taught from. Needs `manage_voice_words` (the server checks it on every call). */
export default function WordsTab() {
  const [words, setWords] = useState<VoiceWord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState<WordFilters>(NO_FILTERS);
  const [form, setForm] = useState<{ word: VoiceWord | null } | null>(null);
  const [pasting, setPasting] = useState(false);
  const [deleting, setDeleting] = useState<VoiceWord | null>(null);
  const [busy, setBusy] = useState(false);
  const pager = usePagination();

  const refresh = async () => {
    try { setWords(await loadVoiceWords()); setError(''); } catch (e) { setError((e as Error).message); } finally { setLoaded(true); }
  };
  useEffect(() => { void refresh(); }, []);

  const shown = useMemo(() => filterWords(words, filters), [words, filters]);
  const counts = useMemo(() => kindCounts(words, filters), [words, filters]);
  const totals = useMemo(() => statusCounts(words), [words]);
  const pages = pageCount(shown.length, pager.rowsPerPage);
  const page = Math.min(pager.currentPage, pages);
  const visible = shown.slice((page - 1) * pager.rowsPerPage, page * pager.rowsPerPage);
  const narrowed = Boolean(filters.query.trim()) || filters.kind !== 'all' || filters.status !== 'active';

  const change = (next: Partial<WordFilters>) => { setFilters((f) => ({ ...f, ...next })); pager.resetPage(); };
  const put = (word: VoiceWord) => setWords((list) => (list.some((w) => w.id === word.id) ? list.map((w) => (w.id === word.id ? word : w)) : [...list, word]));

  const toggleActive = async (w: VoiceWord) => {
    setBusy(true); setError('');
    try { put(await updateVoiceWord(w.id, { active: !w.active })); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const menuFor = (w: VoiceWord): RowMenuItem[] => [
    { key: 'edit', label: 'Edit', icon: Pencil, onClick: () => setForm({ word: w }) },
    { key: 'active', label: w.active ? 'Hide from the list' : 'Show in the list', icon: w.active ? EyeOff : Eye, onClick: () => void toggleActive(w) },
    { key: 'delete', label: 'Delete…', icon: Trash2, danger: true, divider: true, onClick: () => setDeleting(w) }
  ];

  return (
    <section className="vw-words" aria-label="Words">
      <div className="vw-toolbar">
        <DashboardSearch value={filters.query} onChange={(query) => change({ query })} label="Search words" placeholder="Search words"
          count={filters.query.trim() ? `${shown.length} of ${words.length}` : null} />
        <div className="vw-seg" role="radiogroup" aria-label="Show">
          {STATUSES.map((s) => (
            <button key={s.value} type="button" role="radio" aria-checked={filters.status === s.value} className="vw-seg-btn" onClick={() => change({ status: s.value })}>
              {s.label}{s.value !== 'all' ? <span className="vw-seg-n">{s.value === 'active' ? totals.active : totals.hidden}</span> : null}
            </button>
          ))}
        </div>
        <span className="vw-grow" />
        <button type="button" className="vw-btn" onClick={() => setPasting(true)}><ClipboardPaste size={16} aria-hidden="true" /> Paste a list</button>
        <button type="button" className="vw-btn vw-btn-primary vw-add" onClick={() => setForm({ word: null })}><Plus size={16} aria-hidden="true" /> Add word</button>
      </div>

      <div className="vw-chips" role="group" aria-label="Kind">
        <button type="button" className="vw-chip" aria-pressed={filters.kind === 'all'} onClick={() => change({ kind: 'all' })}>All <span>{counts.all}</span></button>
        {KIND_ORDER.map((k) => (
          <button key={k} type="button" className="vw-chip" data-kind={k} aria-pressed={filters.kind === k} onClick={() => change({ kind: k })}>{KIND_LABELS[k]} <span>{counts[k]}</span></button>
        ))}
      </div>

      {error ? <div className="vw-error" role="alert">{error}</div> : null}

      {!loaded ? (
        <div className="vw-empty">Loading…</div>
      ) : words.length === 0 && !error ? (
        <div className="vw-empty">
          <Mic size={28} aria-hidden="true" />
          <p>{EMPTY_LINE}</p>
          <button type="button" className="vw-btn vw-btn-primary" onClick={() => setForm({ word: null })}><Plus size={16} aria-hidden="true" /> Add the first word</button>
        </div>
      ) : shown.length === 0 ? (
        <div className="vw-empty"><p>Nothing matches{narrowed ? '.' : ' yet.'}</p>{narrowed ? <button type="button" className="vw-link" onClick={() => change(NO_FILTERS)}>Clear the search and filters</button> : null}</div>
      ) : (
        <>
          <ul className="vw-list" aria-label="Voice words">
            {visible.map((w) => (
              <li key={w.id} className={`vw-row${w.active ? '' : ' is-hidden'}`}>
                <span className="vw-kind" data-kind={w.kind}>{KIND_LABELS[w.kind] || w.kind}</span>
                <span className="vw-text">
                  <span className="vw-meant">{w.meant}{!w.active && <span className="vw-badge">Hidden</span>}</span>
                  <span className="vw-sub">{heardLine(w)}</span>
                  {w.note ? <span className="vw-note">{w.note}</span> : null}
                </span>
                <span className="vw-actions">
                  <button type="button" className="vw-icon" disabled={busy} onClick={() => void toggleActive(w)}
                    aria-label={w.active ? `Hide ${w.meant}` : `Show ${w.meant}`} title={w.active ? 'Hide from the list' : 'Show in the list'}>
                    {w.active ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                  <RowMenu label={`${w.meant} actions`} items={menuFor(w)} />
                </span>
              </li>
            ))}
          </ul>
          <Pagination currentPage={page} totalPages={pages} onPageChange={pager.setCurrentPage} rowsPerPage={pager.rowsPerPage} onRowsPerPageChange={pager.setRowsPerPage} totalCount={shown.length} />
        </>
      )}

      <button type="button" className="vw-fab" aria-label="Add word" onClick={() => setForm({ word: null })}><Plus size={24} aria-hidden="true" /></button>

      {form && (
        <WordForm
          word={form.word}
          onClose={() => setForm(null)}
          onSave={async (input) => {
            const saved = form.word ? await updateVoiceWord(form.word.id, input) : await addVoiceWord(input as VoiceWordInput);
            put(saved);
          }}
        />
      )}

      {pasting && (
        <PasteDialog
          existing={words}
          onClose={() => setPasting(false)}
          onAddOne={async (row) => {
            const saved = await addVoiceWord({ heard: row.heard, meant: row.meant, kind: row.kind });
            put(saved);
            return saved;
          }}
        />
      )}

      {deleting && (
        <DeleteWordDialog
          word={deleting}
          onClose={() => setDeleting(null)}
          onHide={async () => { put(await updateVoiceWord(deleting.id, { active: false })); }}
          onDelete={async () => { await deleteVoiceWord(deleting.id); setWords((list) => list.filter((w) => w.id !== deleting.id)); }}
        />
      )}
    </section>
  );
}

/** Delete with a check. Hiding is the gentler choice, so it is offered first: a hidden word stays in the list and can come back. */
function DeleteWordDialog({ word, onClose, onDelete, onHide }: { word: VoiceWord; onClose: () => void; onDelete: () => Promise<void>; onHide: () => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const run = async (work: () => Promise<void>) => {
    setSaving(true); setError('');
    try { await work(); onClose(); } catch (e) { setError((e as Error).message || 'Could not delete'); } finally { setSaving(false); }
  };
  return (
    <FormModal
      title="Delete word"
      size="s"
      onClose={onClose}
      onSubmit={(e) => { e.preventDefault(); void run(onDelete); }}
      submitLabel="Delete"
      savingLabel="Deleting…"
      submitTone="danger"
      saving={saving}
      footerStart={word.active ? <button type="button" className="vw-link" disabled={saving} onClick={() => void run(onHide)}>Hide it instead</button> : null}
    >
      <p className="vw-confirm">Delete <strong>{word.meant}</strong>{word.heard ? <> (heard as “{word.heard}”)</> : null}? The assistant stops using it right away and it can’t be brought back.</p>
      {error ? <div className="vw-error" role="alert">{error}</div> : null}
    </FormModal>
  );
}

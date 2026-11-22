import { useMemo, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import useAccessLog from './useAccessLog';
import { accessLine, filterAccess } from './teamLocationView';

/**
 * Who looked at whose location, and when (2026-11-22, owner: admins see this, the people looked at do not).
 * Written by the server on every map look (once per viewer and person per 12 h), every trail and every Locate
 * now; kept 1 year. Opened by the `view_location_audit` switch.
 */
export default function AccessLogPanel() {
  const log = useAccessLog(true);
  const [query, setQuery] = useState('');
  const rows = useMemo(() => filterAccess(log.entries, query), [log.entries, query]);
  const KIND = { live: 'Map', trail: 'Trail', locate: 'Locate now' } as const;

  return (
    <section className="tl-access" aria-label="Access log">
      <div className="tl-bar">
        <label className="tl-search">
          <Search size={15} aria-hidden="true" />
          <input type="search" className="no-capitalize" placeholder="Search a viewer or a person" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search the access log" />
        </label>
        <span className="tl-sum" role="status">{log.loading ? 'Loading…' : `${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}`}</span>
        <button type="button" className="tl-btn" onClick={() => void log.refresh()} aria-label="Refresh the access log" title="Refresh"><RefreshCw size={16} aria-hidden="true" /></button>
      </div>
      {log.error ? <div className="tl-note is-error" role="alert">{log.error}</div> : null}
      {!log.loading && !log.error && rows.length === 0 ? <div className="tl-empty"><h3>Nothing logged yet</h3><span>Every look at a map or trail, and every Locate now, appears here.</span></div> : null}
      <ul className="tl-access-list">
        {rows.map((e) => (
          <li key={e.id}>
            <span className={`tl-kind is-${e.kind}`}>{KIND[e.kind] ?? e.kind}</span>
            <span className="tl-access-line">{accessLine(e)}</span>
            <time dateTime={e.at}>{new Date(e.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time>
          </li>
        ))}
      </ul>
    </section>
  );
}

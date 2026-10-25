import type { ReactNode } from 'react';
import { Search, X } from 'lucide-react';
import LocationFilter, { LocationField } from '../../../components/shared/LocationFilter';
import { SCOPE_LABELS } from '../../../utils/holdView';
import type { CurrentUser } from '../../../types/records';

type HoldsToolbarProps = {
  user: CurrentUser | null;
  sidebarToggle?: ReactNode;
  scopes: string[];
  shownScope: string;
  onPickScope: (scope: string) => void;
  search: string;
  onSearch: (search: string) => void;
  branchOptions: string[];
  branch: string;
  onBranch: (branch: string) => void;
};

/** The Holds list's header: title, whose holds (when there's a choice), search and the branch filter. */
export default function HoldsToolbar({ user, sidebarToggle, scopes, shownScope, onPickScope, search, onSearch, branchOptions, branch, onBranch }: HoldsToolbarProps) {
  return (
    <div className="hl-head">
      {sidebarToggle}
      <h1 className="hl-title">Holds</h1>
      <span className="hl-grow" />
      {scopes.length > 1 ? (
        <div className="hl-seg" role="group" aria-label="Whose holds">
          {scopes.map((s) => (
            <button key={s} type="button" className={shownScope === s ? 'on' : ''} aria-pressed={shownScope === s} onClick={() => onPickScope(s)}>
              {SCOPE_LABELS[s]}
            </button>
          ))}
        </div>
      ) : null}
      <label className="hl-search">
        <Search size={16} aria-hidden="true" />
        <input type="search" value={search} onChange={(e) => onSearch(e.target.value)} placeholder="Hold #, customer, job, serial #" aria-label="Search holds" />
        {search ? <button type="button" className="hl-x" onClick={() => onSearch('')} aria-label="Clear search"><X size={14} /></button> : null}
      </label>
      {branchOptions.length > 1 ? (
        <LocationFilter options={[]} value="" onChange={() => {}} user={user} active={Boolean(branch)} onClear={() => onBranch('')}>
          <LocationField options={branchOptions} value={branch} onChange={(v) => onBranch(v || '')} user={user} />
        </LocationFilter>
      ) : null}
    </div>
  );
}

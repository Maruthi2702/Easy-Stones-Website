import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Search, X, Plus, MoreHorizontal, Truck, Download, Receipt } from 'lucide-react';
import LocationFilter, { LocationField } from '../../../components/shared/LocationFilter';
import { locationNames } from '../../../utils/locationFilter';
import { FREIGHT, CARRIERS } from '../../../accounting/permissions';
import { has } from '../freightView';
import type { Carrier, FreightUser } from '../types';

export type FreightHeaderProps = {
  sidebarToggle: ReactNode;
  user: FreightUser;
  search: string;
  onSearch: (search: string) => void;
  /** The branches this login may filter by (accessibleLocations). */
  branchOptions: string[];
  location: string;
  onLocation: (location: string) => void;
  carrierId: string;
  onCarrier: (carrierId: string) => void;
  carriers: Carrier[];
  filterActive: boolean;
  onClearFilters: () => void;
  canAdd: boolean;
  exporting: boolean;
  onCarriers: () => void;
  onNewInvoice: () => void;
  onExport: () => void;
  onAddCharge: () => void;
};

/**
 * The page's top row: the title, the search box, the Filters panel (branch,
 * carrier), the ⋯ menu (Carriers, Enter carrier invoice, Export to Excel —
 * each by permission) and Add charge.
 */
export default function FreightHeader({
  sidebarToggle, user, search, onSearch, branchOptions, location, onLocation, carrierId, onCarrier, carriers,
  filterActive, onClearFilters, canAdd, exporting, onCarriers, onNewInvoice, onExport, onAddCharge
}: FreightHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDown = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [menuOpen]);

  return (
    <div className="fr-head">
      {sidebarToggle}
      <h1 className="fr-title">3rd-Party Freight</h1>
      <span className="fr-grow" />
      <label className="fr-search">
        <Search size={16} aria-hidden="true" />
        <input type="search" value={search} onChange={(e) => onSearch(e.target.value)} placeholder="SO#, BOL, customer, payment ID" aria-label="Search charges" />
        {search ? <button type="button" className="fr-search-clear" onClick={() => onSearch('')} aria-label="Clear search"><X size={14} /></button> : null}
      </label>
      <LocationFilter
        options={[]}
        value=""
        onChange={() => {}}
        user={user}
        active={filterActive}
        onClear={onClearFilters}
        wide
      >
        {branchOptions.length > 1 ? (
          <LocationField options={locationNames(branchOptions)} value={location} onChange={(v) => onLocation(v || '')} user={user} />
        ) : null}
        <div className="lf-group">
          <label className="lf-group-label" htmlFor="fr-carrier-filter">Carrier</label>
          <select id="fr-carrier-filter" className="lf-select" value={carrierId} onChange={(e) => onCarrier(e.target.value)}>
            <option value="">All carriers</option>
            {carriers.map((c) => <option key={c._id} value={c._id}>{c.name}{c.active === false ? ' (deactivated)' : ''}</option>)}
          </select>
        </div>
      </LocationFilter>
      <div className="fr-more" ref={menuRef}>
        <button type="button" className="fr-icon-btn" aria-label="More" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
          <MoreHorizontal size={18} aria-hidden="true" />
        </button>
        {menuOpen ? (
          <div className="fr-menu" role="menu">
            {(has(user, CARRIERS.VIEW) || has(user, FREIGHT.VIEW)) ? (
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onCarriers(); }}><Truck size={16} aria-hidden="true" />Carriers</button>
            ) : null}
            {canAdd ? (
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onNewInvoice(); }}><Receipt size={16} aria-hidden="true" />Enter carrier invoice</button>
            ) : null}
            {has(user, FREIGHT.EXPORT) ? (
              <button type="button" role="menuitem" disabled={exporting} onClick={() => { setMenuOpen(false); onExport(); }}><Download size={16} aria-hidden="true" />{exporting ? 'Exporting…' : 'Export to Excel'}</button>
            ) : null}
          </div>
        ) : null}
      </div>
      {canAdd ? (
        <button type="button" className="fr-btn gold fr-add" onClick={onAddCharge} aria-label="Add charge" title="Add a charge by hand">
          <Plus size={16} aria-hidden="true" /><span className="fr-add-label">Add charge</span>
        </button>
      ) : null}
    </div>
  );
}

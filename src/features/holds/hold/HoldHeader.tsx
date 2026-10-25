import type { ReactNode } from 'react';
import { ArrowLeft, Printer, Pencil, MoreHorizontal, Unlock } from 'lucide-react';
import { stateLabel } from '../../../utils/holdView';
import type { Hold } from '../types';
import type { Menu } from './useMenu';

type HoldHeaderProps = {
  hold: Hold;
  state: string;
  act: { print: boolean; edit: boolean; release: boolean };
  sidebarToggle?: ReactNode;
  onBack: () => void;
  menuOpen: Menu['open'];
  setMenuOpen: Menu['setOpen'];
  menuRef: Menu['ref'];
  onPrint: () => void;
  onEdit: () => void;
  onRelease: () => void;
};

/** The hold's title bar: back to the list, its number and state, Print, Edit and the ⋯ menu (Release). */
export default function HoldHeader({ hold, state, act, sidebarToggle, onBack, menuOpen, setMenuOpen, menuRef, onPrint, onEdit, onRelease }: HoldHeaderProps) {
  const showMore = act.release;
  return (
    <div className="hl-head">
      {sidebarToggle}
      <button type="button" className="hl-back" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" /><span className="hl-back-label">Holds</span></button>
      <h1 className="hl-title">Hold #{hold.number}</h1>
      <span className={`hl-pill ${state}`}>{stateLabel(state)}</span>
      <span className="hl-grow" />
      <div className="hl-head-actions">
        {act.print ? (
          <button type="button" className="hl-btn" onClick={onPrint}><Printer size={16} aria-hidden="true" /><span className="hl-btn-label">Print</span></button>
        ) : null}
        {act.edit ? (
          <button type="button" className="hl-btn" onClick={onEdit}><Pencil size={16} aria-hidden="true" /><span className="hl-btn-label">Edit</span></button>
        ) : null}
        {showMore ? (
          <div className="hl-menu-wrap" ref={menuRef}>
            <button type="button" className="hl-icon-btn" aria-label="More" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
              <MoreHorizontal size={18} aria-hidden="true" />
            </button>
            {menuOpen ? (
              <div className="hl-menu" role="menu">
                <button type="button" role="menuitem" className="danger" onClick={() => { setMenuOpen(false); onRelease(); }}>
                  <Unlock size={16} aria-hidden="true" />Release hold
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

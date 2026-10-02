import React, { useRef, useState } from 'react';
import { ChevronUp, ChevronDown, Users } from 'lucide-react';
import { formatPhoneForDisplay } from '../../../utils/phoneUtils';
import { useDismiss, anchoredMenuStyle } from './uiHelpers';

/**
 * Call / Email as a split button: the main part goes to the primary contact
 * (named, so it's clear who), the chevron lists every contact — and, for email,
 * "Email all contacts".
 */
const SplitAction = ({ icon, verb, people, field, hrefOf }) => {
  const Icon = icon;
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(undefined);
  const ref = useRef(null);
  useDismiss(open, setOpen, ref, { closeOnScroll: true });
  const reachable = people.filter(p => p[field]);
  if (!reachable.length) return null;
  const first = reachable[0];
  const firstName = (first.name || '').split(' ')[0];
  const emailAll = field === 'email' && reachable.length > 1;
  return (
    <div className="cl-split" ref={ref}>
      <a href={hrefOf(first[field])} title={`${verb} ${first.name || first[field]}${first.role === 'Primary' ? ' (primary contact)' : ''}`}>
        <Icon size={16} aria-hidden="true" />{verb}{firstName ? ` ${firstName}` : ''}
      </a>
      {reachable.length > 1 && (
        <button type="button" aria-label={`Choose who to ${verb.toLowerCase()}`} aria-haspopup="menu" aria-expanded={open} onClick={(e) => { setPos(anchoredMenuStyle(ref.current || e.currentTarget, { estHeight: 280 })); setOpen(o => !o); }}>
          {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
      )}
      {open && (
        <div className="cl-pop" role="menu" style={{ width: 300, ...pos }}>
          <div className="cl-pop-grp">{verb} a contact</div>
          {reachable.map(p => (
            <a key={p.key} role="menuitem" className="cl-opt" href={hrefOf(p[field])} style={{ alignItems: 'flex-start', textDecoration: 'none' }} onClick={() => setOpen(false)}>
              <span style={{ minWidth: 0 }}>
                <b style={{ fontWeight: 650 }}>{p.name || p[field]}</b>
                {p.role && <span className="cl-lvl" style={{ marginLeft: 6, height: 18, fontSize: 10.5 }}>{p.role}</span>}
                {/* Without a name the bold line already is the address — don't repeat it. */}
                {p.name && <span className="cl-sub" style={{ display: 'block' }}>{field === 'phone' ? formatPhoneForDisplay(p.phone) : p.email}</span>}
              </span>
            </a>
          ))}
          {emailAll && (
            <>
              <div className="cl-pop-sep" />
              <a role="menuitem" className="cl-opt" href={`mailto:${reachable.map(p => p.email).join(',')}`} style={{ textDecoration: 'none' }} onClick={() => setOpen(false)}>
                <Users size={16} aria-hidden="true" />Email all contacts ({reachable.length})
              </a>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default SplitAction;

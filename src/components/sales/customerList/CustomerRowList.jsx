import React, { useRef, useState } from 'react';
import { Phone, Mail, MoreHorizontal, User } from 'lucide-react';
import { companyOf, contactOf, cityOf, initialsOf, primaryEmailOf } from '../../../utils/customerList';
import { StatusDot, LocationTag, IssueFlag } from './parts';

const SWIPE = 204; // three 68px actions

/**
 * One customer as a three-line row (phone and iPad portrait):
 * company (+⚠) / contact · city / location + rep, status on the right.
 * Swipe left for Call / Email / More; tap to open.
 */
const Row = ({ row, swiped, onSwipe, onOpen, onMore, onCall, isOpen }) => {
  const start = useRef(null);
  const [drag, setDrag] = useState(null);
  const phone = String(row.phone || '').replace(/[^\d+]/g, '');
  const email = primaryEmailOf(row);
  const person = contactOf(row);
  const city = cityOf(row);

  const onTouchStart = (e) => {
    const t = e.touches[0];
    start.current = { x: t.clientX, y: t.clientY, horizontal: null };
  };
  const onTouchMove = (e) => {
    if (!start.current) return;
    const t = e.touches[0];
    const dx = t.clientX - start.current.x;
    const dy = t.clientY - start.current.y;
    if (start.current.horizontal === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      start.current.horizontal = Math.abs(dx) > Math.abs(dy);
    }
    if (!start.current.horizontal) return;
    const base = swiped ? -SWIPE : 0;
    setDrag(Math.max(-SWIPE, Math.min(0, base + dx)));
  };
  const onTouchEnd = () => {
    if (drag !== null) onSwipe(drag < -SWIPE / 2 ? row._id : null);
    setDrag(null);
    start.current = null;
  };

  const offset = drag !== null ? drag : (swiped ? -SWIPE : 0);

  return (
    <div className={`cl-li${isOpen ? ' is-open' : ''}`}>
      {(swiped || drag !== null) && (
        <div className="cl-li-actions">
          {phone ? <a className="call" href={`tel:${phone}`} aria-label={`Call ${companyOf(row)}`} onClick={() => { onSwipe(null); onCall?.(row); }}><Phone size={20} aria-hidden="true" />Call</a> : null}
          {email ? <a className="mail" href={`mailto:${email}`} aria-label={`Email ${companyOf(row)}`}><Mail size={20} aria-hidden="true" />Email</a> : null}
          <button type="button" className="more" aria-label={`More for ${companyOf(row)}`} onClick={() => { onSwipe(null); onMore(row); }}><MoreHorizontal size={20} aria-hidden="true" />More</button>
        </div>
      )}
      <button
        type="button"
        className="cl-li-main"
        style={{ transform: offset ? `translateX(${offset}px)` : undefined, transition: drag !== null ? 'none' : undefined }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClick={() => (swiped ? onSwipe(null) : onOpen(row))}
      >
        <span className="cl-av lg" aria-hidden="true">{initialsOf(companyOf(row))}</span>
        <span className="cl-li-body">
          <span className="cl-co cl-li-name"><span>{companyOf(row)}</span><IssueFlag customer={row} /></span>
          <span className="cl-sub" style={{ display: 'block', fontSize: 13 }}>{[person, city].filter(Boolean).join(' · ') || '—'}</span>
          <span className="cl-li-meta">
            <LocationTag customer={row} />
            <span className={`who${row.salesRepName ? '' : ' none'}`}><User size={13} aria-hidden="true" />{row.salesRepName || 'Unassigned'}</span>
            {/* On a phone the status moves down here so the company name gets the full width. */}
            <span className="cl-li-status-meta"><StatusDot status={row.status} /></span>
          </span>
        </span>
        <span className="cl-li-status-side" style={{ paddingTop: 2 }}><StatusDot status={row.status} /></span>
      </button>
    </div>
  );
};

const SkeletonRow = ({ i }) => (
  <div className="cl-li" aria-hidden="true">
    <div className="cl-li-main" style={{ cursor: 'default' }}>
      <span className="cl-sk" style={{ width: 40, height: 40, borderRadius: '50%' }} />
      <span className="cl-li-body">
        <span className="cl-sk" style={{ width: 180 - (i % 3) * 30 }} />
        <span className="cl-sk" style={{ width: 130, marginTop: 8, height: 8 }} />
        <span className="cl-sk" style={{ width: 110, marginTop: 10, height: 8 }} />
      </span>
    </div>
  </div>
);

const CustomerRowList = ({ rows, loading, openId, onOpen, onMore, onCall }) => {
  const [swipedId, setSwipedId] = useState(null);
  if (loading && rows.length === 0) {
    return <div className="cl-list" aria-busy="true">{Array.from({ length: 8 }, (_, i) => <SkeletonRow key={i} i={i} />)}</div>;
  }
  return (
    <div className="cl-list">
      {rows.map(row => (
        <Row
          key={row._id}
          row={row}
          isOpen={openId === row._id}
          swiped={swipedId === row._id}
          onSwipe={setSwipedId}
          onOpen={onOpen}
          onMore={onMore}
          onCall={onCall}
        />
      ))}
    </div>
  );
};

export default CustomerRowList;

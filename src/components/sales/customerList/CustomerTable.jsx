import React, { useRef, useState } from 'react';
import { ArrowUp, ArrowDown, MoreHorizontal, Eye, ExternalLink, Pencil, Trash2 } from 'lucide-react';
import { formatPhoneForDisplay } from '../../../utils/phoneUtils';
import {
  companyOf, contactOf, streetOf, cityLineOf, primaryEmailOf, extraContactCount, statusMeta
} from '../../../utils/customerList';
import { StatusDot, LocationTag, RepBadge, ModaBadges, IssueFlag, CopyButton } from './parts';
import { useDismiss, anchoredMenuStyle } from './uiHelpers';

const SortHeader = ({ label, field, sort, onSort, className }) => {
  const active = sort.by === field;
  const ariaSort = active ? (sort.order === 'asc' ? 'ascending' : 'descending') : 'none';
  return (
    <th className={className} aria-sort={ariaSort}>
      <button type="button" onClick={() => onSort(field)}>
        {label}
        {active && (sort.order === 'asc' ? <ArrowUp size={13} strokeWidth={2.5} /> : <ArrowDown size={13} strokeWidth={2.5} />)}
      </button>
    </th>
  );
};

const RowMenu = ({ row, onOpen, onOpenProfile, onEdit, onDelete, canEdit, canDelete }) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(undefined);
  const ref = useRef(null);
  useDismiss(open, setOpen, ref, { closeOnScroll: true });
  const act = (fn) => (e) => { e.stopPropagation(); setOpen(false); fn(); };
  return (
    <div className="cl-rowmenu" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button type="button" className="cl-ib" aria-label={`Actions for ${companyOf(row)}`} aria-haspopup="menu" aria-expanded={open} onClick={(e) => { setPos(anchoredMenuStyle(e.currentTarget, { align: 'right', estHeight: 210 })); setOpen(o => !o); }}>
        <MoreHorizontal size={18} />
      </button>
      {open && (
        <div className="cl-pop right" role="menu" style={{ minWidth: 200, ...pos }}>
          <button type="button" role="menuitem" className="cl-opt" onClick={act(onOpen)}><Eye size={16} aria-hidden="true" />View details</button>
          <button type="button" role="menuitem" className="cl-opt" onClick={act(onOpenProfile)}><ExternalLink size={16} aria-hidden="true" />Open profile</button>
          {canEdit && <button type="button" role="menuitem" className="cl-opt" onClick={act(onEdit)}><Pencil size={16} aria-hidden="true" />Edit customer</button>}
          {canDelete && (
            <>
              <div className="cl-pop-sep" />
              <button type="button" role="menuitem" className="cl-opt danger" onClick={act(onDelete)}><Trash2 size={16} aria-hidden="true" />Delete…</button>
            </>
          )}
        </div>
      )}
    </div>
  );
};

const SkeletonRows = ({ count = 8 }) => Array.from({ length: count }, (_, i) => (
  <tr key={`sk${i}`} aria-hidden="true">
    <td><span className="cl-sk" style={{ width: 16, height: 16, borderRadius: 4 }} /></td>
    <td><span className="cl-sk" style={{ width: 150 - (i % 3) * 22 }} /><span className="cl-sk" style={{ width: 90, marginTop: 8, height: 8 }} /></td>
    <td><span className="cl-sk" style={{ width: 110 }} /><span className="cl-sk" style={{ width: 140, marginTop: 8, height: 8 }} /></td>
    <td className="c-addr"><span className="cl-sk" style={{ width: 130 - (i % 2) * 30 }} /><span className="cl-sk" style={{ width: 100, marginTop: 8, height: 8 }} /></td>
    <td><span className="cl-sk" style={{ width: 70 }} /><span className="cl-sk" style={{ width: 60, marginTop: 8, height: 8 }} /></td>
    <td className="c-level"><span className="cl-sk" style={{ width: 28 }} /></td>
    <td className="c-moda"><span className="cl-sk" style={{ width: 80 }} /></td>
    <td><span className="cl-sk" style={{ width: 90 - (i % 3) * 10 }} /></td>
    <td />
  </tr>
));

const CustomerTable = ({
  rows, loading, sort, onSort, selectedIds, onToggle, onToggleAll, openId, focusIndex,
  onOpen, onOpenProfile, onEdit, onDelete, canEdit, canDelete, showType, children
}) => {
  const allChecked = rows.length > 0 && rows.every(r => selectedIds.has(r._id));
  const someChecked = !allChecked && rows.some(r => selectedIds.has(r._id));

  return (
    <div className="cl-tablewrap">
      <table className="cl-table" aria-busy={loading ? 'true' : 'false'}>
        <colgroup>
          <col style={{ width: 44 }} />
          <col style={{ width: '22%' }} />
          <col style={{ width: '20%' }} />
          <col className="c-addr" style={{ width: '17%' }} />
          <col style={{ width: 140 }} />
          <col className="c-level" style={{ width: 84 }} />
          <col className="c-moda" style={{ width: 120 }} />
          <col style={{ width: 132 }} />
          <col style={{ width: 48 }} />
        </colgroup>
        <thead>
          <tr>
            <th style={{ width: 44 }}>
              <input
                type="checkbox"
                aria-label="Select all on this page"
                checked={allChecked}
                ref={(el) => { if (el) el.indeterminate = someChecked; }}
                onChange={() => onToggleAll(!allChecked)}
              />
            </th>
            <SortHeader label="Company" field="company" sort={sort} onSort={onSort} />
            <th>Phone &amp; email</th>
            <SortHeader label="Address" field="city" sort={sort} onSort={onSort} className="c-addr" />
            <SortHeader label="Rep & location" field="salesRep" sort={sort} onSort={onSort} />
            <SortHeader label="Level" field="level" sort={sort} onSort={onSort} className="c-level" />
            <th className="c-moda">Moda Resources</th>
            <th>Status</th>
            <th><span className="cl-sr">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {loading && rows.length === 0 ? <SkeletonRows /> : rows.map((row, i) => {
            const phone = formatPhoneForDisplay(row.phone) || row.phone || '';
            const email = primaryEmailOf(row);
            const extra = extraContactCount(row);
            const person = contactOf(row);
            const street = streetOf(row);
            const cityLine = cityLineOf(row);
            const cls = [
              selectedIds.has(row._id) ? 'is-sel' : '',
              openId === row._id ? 'is-open' : '',
              focusIndex === i ? 'is-focus' : '',
              statusMeta(row.status).closed ? 'is-low' : ''
            ].filter(Boolean).join(' ');
            return (
              <tr key={row._id} className={cls} onClick={() => onOpen(row, i)}>
                <td onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" aria-label={`Select ${companyOf(row)}`} checked={selectedIds.has(row._id)} onChange={() => onToggle(row._id)} />
                </td>
                <td>
                  <div className="cl-co">
                    <button type="button" className="cl-colink" title="Open profile" onClick={(e) => { e.stopPropagation(); onOpenProfile(row); }}>
                      {companyOf(row)}
                    </button>
                    <IssueFlag customer={row} />
                  </div>
                  <div className="cl-sub">
                    {showType && <>{row.customerType || 'Fabricator'}{person ? ' · ' : ''}</>}
                    {person}
                    {extra > 0 && <span className="cl-plus" title={`${extra} more contact${extra > 1 ? 's' : ''}`}>+{extra}</span>}
                  </div>
                </td>
                <td>
                  {phone ? (
                    <div className="cl-cp">
                      <a className="cl-tel" href={`tel:${String(row.phone).replace(/[^\d+]/g, '')}`} onClick={(e) => e.stopPropagation()}>{phone}</a>
                      <CopyButton value={phone} what="phone" />
                    </div>
                  ) : <span className="cl-miss">No phone</span>}
                  <div className="cl-cp cl-sub" style={{ marginTop: 2 }}>
                    {email ? <><span>{email}</span><CopyButton value={email} what="email" /></> : <span className="cl-miss">No email</span>}
                  </div>
                </td>
                <td className="c-addr">
                  {street || <span className="cl-miss">No street</span>}
                  <div className="cl-sub">{cityLine}</div>
                </td>
                <td>
                  <RepBadge name={row.salesRepName} />
                  <div style={{ marginTop: 4 }}><LocationTag customer={row} /></div>
                </td>
                <td className="c-level">{(row.level || row.segment) ? <span className="cl-lvl">{String(row.level || row.segment).replace('Level - ', 'L')}</span> : '—'}</td>
                <td className="c-moda"><ModaBadges customer={row} /></td>
                <td><StatusDot status={row.status} /></td>
                <td style={{ padding: '0 6px' }}>
                  <RowMenu
                    row={row}
                    canEdit={canEdit}
                    canDelete={canDelete}
                    onOpen={() => onOpen(row, i)}
                    onOpenProfile={() => onOpenProfile(row)}
                    onEdit={() => onEdit(row)}
                    onDelete={() => onDelete(row._id)}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {children}
    </div>
  );
};

export default CustomerTable;

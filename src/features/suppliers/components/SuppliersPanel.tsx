import { useEffect, useState } from 'react';
import { KeyRound, Lock, Mail, Pencil, Power, UserPlus, X } from 'lucide-react';
import { lockPage, unlockPage } from '../../../components/shared/pageLock';
import { hoursText } from '../../../utils/supplierBlocks';
import { languageEnglish } from '../../../utils/supplierI18n';
import * as api from '../suppliersApi';
import { loginState, theirTime, whenText } from '../supplierPosView';
import SupplierForm from './SupplierForm';
import LoginForm from './LoginForm';
import type { Meta, SupplierLoginInfo, SupplierRow } from '../types';

export type SuppliersPanelProps = {
  suppliers: SupplierRow[];
  meta: Meta;
  search: string;
  isPhone: boolean;
  canManage: boolean;
  adding: boolean;
  onAdded: () => void;
  onChanged: (s: SupplierRow) => void;
  say: (text: string) => void;
};

/**
 * Suppliers tab: every supplier with its login and its record — how often
 * its bundles are rejected, how long it takes to offer a first block on a new
 * PO, and how long we take to review. A row opens the supplier: details and
 * the login's Send invite / new link, Turn off, Unlock.
 */
export default function SuppliersPanel({ suppliers, meta, search, isPhone, canManage, adding, onAdded, onChanged, say }: SuppliersPanelProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<'supplier' | 'login' | null>(null);
  const q = search.trim().toLowerCase();
  const rows = suppliers.filter((s) => !q || [s.name, s.spsName, s.country, s.contactName, s.email, ...s.logins.map((l) => l.email)].join(' ').toLowerCase().includes(q));
  const opened = openId ? suppliers.find((s) => s.id === openId) || null : null;

  return (
    <>
      <div className="sp-box">
        {rows.length ? (
          isPhone ? (
            <div className="sp-cards">
              {rows.map((s) => {
                const st = loginState(s.logins[0]);
                return (
                  <button key={s.id} type="button" className={`sp-card${s.active ? '' : ' is-faded'}`} onClick={() => setOpenId(s.id)}>
                    <span className="sp-card-top"><b>{s.name}</b><span className={`sp-chip is-${st.colour}`}>{st.label}</span></span>
                    <span className="sp-card-meta">{[s.country, languageEnglish(s.language)].filter(Boolean).join(' · ')} · {s.openPos} open PO{s.openPos === 1 ? '' : 's'}</span>
                    <span className="sp-card-meta">Rejected {s.score.rejectionRate == null ? '—' : `${s.score.rejectionRate}%`} · answers in {hoursText(s.score.supplierHours)}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="sp-table-wrap">
              <table className="sp-table">
                <thead>
                  <tr><th>Supplier</th><th>Country · language</th><th>Login</th><th className="sp-num">Open POs</th><th className="sp-num">Rejected</th><th className="sp-num sp-col-wide">They offer in</th><th className="sp-num sp-col-wide">We review in</th></tr>
                </thead>
                <tbody>
                  {rows.map((s) => {
                    const st = loginState(s.logins[0]);
                    return (
                      <tr key={s.id} className={s.active ? '' : 'is-faded'} onClick={() => setOpenId(s.id)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setOpenId(s.id); }}>
                        <td><div className="sp-who"><b>{s.name}{s.active ? '' : ' (inactive)'}</b><span>{s.spsName ? `SPS: ${s.spsName}` : 'No SPS name'}</span></div></td>
                        <td><div className="sp-who"><span className="sp-txt">{s.country || '—'} · {languageEnglish(s.language)}</span><span>{theirTime(s.timeZone)}</span></div></td>
                        <td><div className="sp-who"><span className={`sp-chip is-${st.colour}`}>{st.label}</span><span>{s.logins[0]?.email || ''}</span></div></td>
                        <td className="sp-num">{s.openPos}</td>
                        <td className="sp-num">{s.score.rejectionRate == null ? '—' : `${s.score.rejectionRate}%`}<div className="sp-sub">of {s.score.bundlesDecided} bundles</div></td>
                        <td className="sp-num sp-col-wide">{hoursText(s.score.supplierHours)}</td>
                        <td className="sp-num sp-col-wide">{hoursText(s.score.reviewHours)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <div className="sp-empty">
            {suppliers.length ? <><h3>Nothing matches</h3><span>Clear the search.</span></> : <><h3>No suppliers yet</h3><span>Add a supplier, then give them a login to see their POs.</span></>}
          </div>
        )}
      </div>
      <p className="sp-sub">The record covers the last 180 days. “They offer in” is how long from a PO being assigned to their first block; “We review in”, from a bundle being sent to its step-1 decision.</p>

      {opened ? (
        <SupplierDrawer supplier={opened} canManage={canManage} onClose={() => setOpenId(null)}
          onEdit={() => setEditing('supplier')} onLogin={() => setEditing('login')} onChanged={onChanged} say={say} />
      ) : null}

      {adding || (editing === 'supplier' && opened) ? (
        <SupplierForm supplier={editing === 'supplier' ? opened : null} meta={meta}
          onClose={() => { setEditing(null); if (adding) onAdded(); }}
          onSave={async (body) => {
            if (editing === 'supplier' && opened) {
              const { supplier } = await api.editSupplier(opened.id, body);
              onChanged({ ...opened, ...supplier });
              say('Supplier saved');
            } else {
              const { supplier } = await api.addSupplier(body);
              onChanged({ ...supplier, logins: [], openPos: 0, score: { bundlesDecided: 0, rejectionRate: null, retakes: 0, supplierHours: null, reviewHours: null } });
              setOpenId(supplier.id);
              onAdded();
              say('Supplier added. Give them a login next.');
            }
            setEditing(null);
          }} />
      ) : null}

      {editing === 'login' && opened ? (
        <LoginForm supplier={opened} login={opened.logins[0] || null} meta={meta} onClose={() => setEditing(null)}
          onSave={async (body) => {
            const r = opened.logins[0] ? await api.editLogin(opened.id, opened.logins[0].id, body) : await api.addLogin(opened.id, body);
            onChanged({ ...opened, logins: [r.login, ...opened.logins.slice(1)] });
            setEditing(null);
            say(opened.logins[0] ? 'Login saved' : r.emailed ? `Invite emailed to ${r.login.email}` : 'Saved, but the invite email didn’t go out — send it again from the login');
          }} />
      ) : null}
    </>
  );
}

function SupplierDrawer({ supplier: s, canManage, onClose, onEdit, onLogin, onChanged, say }: {
  supplier: SupplierRow; canManage: boolean; onClose: () => void; onEdit: () => void; onLogin: () => void;
  onChanged: (s: SupplierRow) => void; say: (t: string) => void;
}) {
  const [busy, setBusy] = useState('');
  const [link, setLink] = useState('');
  useEffect(() => { lockPage(); return () => unlockPage(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const login = s.logins[0];
  const st = loginState(login);
  const act = async (key: string, run: () => Promise<{ login: SupplierLoginInfo; emailed?: boolean; link?: string }>, done: (r: { emailed?: boolean; link?: string }) => string) => {
    setBusy(key);
    try {
      const r = await run();
      onChanged({ ...s, logins: [r.login, ...s.logins.slice(1)] });
      setLink(r.link || '');
      say(done(r));
    } catch (e) {
      say((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  return (
    <>
      <div className="sp-scrim" onClick={onClose} aria-hidden="true" />
      <aside className="sp-drawer" role="dialog" aria-modal="true" aria-label={s.name}>
        <header className="sp-drawer-h">
          <div className="sp-drawer-ttl">
            <div className="sp-row"><h2>{s.name}</h2>{s.active ? null : <span className="sp-chip is-miss">Inactive</span>}</div>
            <span className="sp-sub is-13">{[s.country, languageEnglish(s.language), theirTime(s.timeZone)].filter(Boolean).join(' · ')}</span>
          </div>
          <div className="sp-drawer-nav">
            {canManage ? <button type="button" className="sp-btn is-small" onClick={onEdit}><Pencil size={14} /> Edit</button> : null}
            <button type="button" className="sp-x" aria-label="Close" onClick={onClose}><X size={16} strokeWidth={2.4} /></button>
          </div>
        </header>
        <div className="sp-drawer-b">
          <dl className="sp-dl">
            <div><dt>Name in SPS</dt><dd>{s.spsName || '—'}</dd></div>
            <div><dt>Open POs</dt><dd>{s.openPos}</dd></div>
            <div><dt>Contact</dt><dd>{s.contactName || '—'}</dd></div>
            <div><dt>Phone</dt><dd>{s.phone ? <a href={`tel:${s.phone}`}>{s.phone}</a> : '—'}</dd></div>
            <div className="is-wide"><dt>Email</dt><dd>{s.email ? <a href={`mailto:${s.email}`}>{s.email}</a> : '—'}</dd></div>
            {s.notes ? <div className="is-wide"><dt>Notes</dt><dd>{s.notes}</dd></div> : null}
          </dl>

          <section className="sp-section">
            <h3>Record · last 180 days</h3>
            <div className="sp-tiles is-3">
              <div className="sp-tile is-static"><span className="sp-tile-k">Bundles rejected</span><span className="sp-tile-v">{s.score.rejectionRate == null ? '—' : `${s.score.rejectionRate}%`}</span><span className="sp-tile-c">of {s.score.bundlesDecided} decided · {s.score.retakes} new photos asked</span></div>
              <div className="sp-tile is-static"><span className="sp-tile-k">They offer a first block in</span><span className="sp-tile-v">{hoursText(s.score.supplierHours)}</span><span className="sp-tile-c">median, after a PO is assigned</span></div>
              <div className="sp-tile is-static"><span className="sp-tile-k">We review in</span><span className="sp-tile-v">{hoursText(s.score.reviewHours)}</span><span className="sp-tile-c">median, sent → step 1</span></div>
            </div>
          </section>

          <section className="sp-section">
            <h3>Portal login</h3>
            {login ? (
              <div className="sp-login">
                <div className="sp-row"><b>{login.name}</b><span className={`sp-chip is-${st.colour}`}>{st.label}</span></div>
                <span className="sp-sub is-13">{login.email} · {languageEnglish(login.language)}</span>
                <span className="sp-sub">
                  {login.hasPassword ? `Last signed in ${login.lastLoginAt ? whenText(login.lastLoginAt) : '—'}` : `Invite sent ${whenText(login.invitedAt)}${login.invitedBy ? ` by ${login.invitedBy}` : ''}`}
                  {login.linkExpiresAt && new Date(login.linkExpiresAt).getTime() > Date.now() ? ` · link good until ${whenText(login.linkExpiresAt)}` : ''}
                </span>
                {canManage ? (
                  <div className="sp-btns">
                    <button type="button" className="sp-btn is-small" onClick={onLogin}><Pencil size={14} /> Edit</button>
                    {login.active ? (
                      <button type="button" className="sp-btn is-small" disabled={busy === 'link'} onClick={() => act('link', () => api.sendLoginLink(s.id, login.id), (r) => (r.emailed ? `Link emailed to ${login.email}` : 'The email didn’t go out — copy the link below'))}>
                        {login.hasPassword ? <><KeyRound size={14} /> Email a new password link</> : <><Mail size={14} /> Send the invite again</>}
                      </button>
                    ) : null}
                    {login.locked ? <button type="button" className="sp-btn is-small" disabled={busy === 'unlock'} onClick={() => act('unlock', () => api.unlockLogin(s.id, login.id), () => 'Unlocked')}><Lock size={14} /> Unlock</button> : null}
                    <button type="button" className={`sp-btn is-small${login.active ? ' is-warn' : ''}`} disabled={busy === 'active'}
                      onClick={() => act('active', () => api.setLoginActive(s.id, login.id, !login.active), () => (login.active ? 'Login turned off — they’re signed out' : 'Login turned on'))}>
                      <Power size={14} /> {login.active ? 'Turn login off' : 'Turn login on'}
                    </button>
                  </div>
                ) : null}
                {link ? <div className="sp-banner is-warn"><span>Send them this link yourself (it works once, for 7 days):</span><input className="fm-input" readOnly value={link} onFocus={(e) => e.target.select()} /></div> : null}
              </div>
            ) : (
              <div className="sp-login">
                <span className="sp-sub">No login yet. Without one they can’t see their POs or send photos.</span>
                {canManage ? <button type="button" className="sp-btn is-gold is-small" onClick={onLogin}><UserPlus size={14} /> Add login and email the invite</button> : null}
              </div>
            )}
          </section>
        </div>
      </aside>
    </>
  );
}

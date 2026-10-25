import { AlertTriangle, Plus, Pencil } from 'lucide-react';
import { Drawer } from '../parts/Drawer';
import { Loading } from '../parts/Loading';
import { CARRIERS } from '../../../accounting/permissions';
import { PAYMENT_TERMS } from '../../../accounting/freightRules';
import { has } from '../freightView';
import { listCarriers, listCharges } from '../freightApi';
import { useLoad } from './useLoad';
import type { PanelProps } from './panelParts';
import type { Loose } from '../../../types/records';

/** The carrier list (More › Carriers), with any typed carrier nobody recognises. */
export function CarriersPanel({ user, reloadKey, onClose, act }: Omit<PanelProps, 'id'>) {
  const { data, error } = useLoad(async () => {
    const [carriers, waiting] = await Promise.all([listCarriers(), listCharges({ status: 'to_approve', limit: 100 }).catch(() => ({ items: [] }))]);
    const unmatched: string[] = [...new Set<string>(waiting.items.filter((c: Loose) => !c.carrier && c.carrierNameRaw).map((c: Loose) => c.carrierNameRaw.trim()))];
    return { carriers, unmatched };
  }, [reloadKey]);
  const canAdd = has(user, CARRIERS.ADD);
  const canEdit = has(user, CARRIERS.EDIT);
  return (
    <Drawer label="Carriers" kicker="Carriers" onClose={onClose}
      footer={canAdd ? <button type="button" className="fr-btn gold" onClick={() => act.carrierForm(null)}><Plus size={16} aria-hidden="true" />Add carrier</button> : null}>
      {error ? <div className="fr-note error" role="alert"><AlertTriangle size={18} aria-hidden="true" /><span>{error}</span></div> : null}
      {!data && !error ? <Loading /> : null}
      {data ? (
        <>
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--fr-muted)' }}>A carrier typed on a delivery is matched by its name or any other spelling listed here.</p>
          {data.unmatched.length ? (
            <div className="fr-note warn" role="status">
              <AlertTriangle size={18} aria-hidden="true" />
              <div className="fr-grow">
                <b>{data.unmatched.length} carrier name{data.unmatched.length > 1 ? 's' : ''} nobody recognises:</b>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                  {data.unmatched.map((n) => (
                    canAdd
                      ? <button key={n} type="button" className="fr-btn sm" onClick={() => act.carrierForm(null, n)}><Plus size={14} aria-hidden="true" />{n}</button>
                      : <span key={n} className="fr-alias">{n}</span>
                  ))}
                </div>
                <div style={{ fontSize: 13, marginTop: 6 }}>Add it as a carrier, or add the spelling to an existing one.</div>
              </div>
            </div>
          ) : null}
          <div className="fr-carriers">
            {data.carriers.length === 0 ? <div className="fr-empty"><h3>No carriers yet</h3>Add the contract carriers your branches use.</div> : null}
            {data.carriers.map((c) => (
              <div key={c._id} className={`fr-carrier${c.active === false ? ' inactive' : ''}`}>
                <div className="fr-carrier-main">
                  <span className="fr-carrier-name">{c.name}
                    <span className={`fr-terms${c.paymentTerms === PAYMENT_TERMS.PER_INVOICE ? ' invoice' : ''}`}>{c.paymentTerms === PAYMENT_TERMS.PER_INVOICE ? 'Per invoice' : 'Per delivery'}</span>
                    {c.active === false ? <span className="fr-sub">Deactivated</span> : null}
                  </span>
                  {c.aliases?.length ? <div>{c.aliases.map((a: string) => <span key={a} className="fr-alias">{a}</span>)}</div> : null}
                </div>
                {canEdit ? (
                  <button type="button" className="fr-icon-btn" aria-label={`Edit ${c.name}`} title="Edit" onClick={() => act.carrierForm(c)}>
                    <Pencil size={15} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </>
      ) : null}
    </Drawer>
  );
}

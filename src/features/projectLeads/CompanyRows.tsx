import { Phone, Mail } from 'lucide-react';
import { STATUS_LABELS, contactName, formatPhone, formatDayShort, formatValue } from '../../utils/projectLeads';
import { rolesText, projectsText, type CompanyItem } from '../../utils/projectLeadCompanies';

/**
 * Multifamily Leads → Companies: one row per company across its projects. The row opens the company; Call and
 * Email are links beside it (never inside the row's button) so one tap reaches the person without opening anything.
 */
export default function CompanyRows({ items, openKey, onOpen }: { items: CompanyItem[]; openKey: string; onOpen: (key: string) => void }) {
  return (
    <ul className="prj-list prj-cos-list">
      {items.map((c) => {
        const person = contactName(c.contact);
        const place = [c.city, c.state].filter(Boolean).join(', ');
        return (
          <li key={c.key} className="prj-corow">
            <button type="button" className={`prj-row prj-row-co${openKey === c.key ? ' open' : ''}`} onClick={() => onOpen(c.key)}>
              <span className="prj-row-main">
                <span className="prj-name">{c.name}</span>
                <span className="prj-sub">{rolesText(c.roles)}{place ? ` · ${place}` : ''}</span>
                <span className="prj-sub">{projectsText(c.projects)}{c.latestProject ? ` · latest: ${c.latestProject}` : ''}</span>
              </span>
              <span className="prj-row-who">
                {c.contact.phone || c.contact.email || person ? (
                  <span className="prj-who">
                    <span className="prj-who-name">{person || 'No contact name'}</span>
                    <span className="prj-sub">{c.contact.phone ? formatPhone(c.contact.phone) : ''}</span>
                    <span className="prj-sub prj-sub-email">{c.contact.email}</span>
                  </span>
                ) : <span className="prj-muted">No phone or email listed</span>}
              </span>
              <span className="prj-row-end">
                <span className="prj-value">{formatValue(c.topValue)}</span>
                <span className={`prj-pill ${c.status}`}>{STATUS_LABELS[c.status]}</span>
                <span className="prj-sub">{c.assignedTo ? `With ${c.assignedTo}` : formatDayShort(c.lastUpdated)}</span>
              </span>
            </button>
            <span className="prj-co-quick">
              {c.contact.phone ? <a className="prj-quick" href={`tel:${c.contact.phone}`} aria-label={`Call ${c.name}`}><Phone size={17} aria-hidden="true" /></a> : <span className="prj-quick off" aria-hidden="true" />}
              {c.contact.email ? <a className="prj-quick" href={`mailto:${c.contact.email}`} aria-label={`Email ${c.name}`}><Mail size={17} aria-hidden="true" /></a> : <span className="prj-quick off" aria-hidden="true" />}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

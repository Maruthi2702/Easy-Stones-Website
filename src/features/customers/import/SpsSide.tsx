/**
 * One side of a "same customer?" comparison — SPS and Easy Stones laid out the
 * same way, field by field, so the two read straight across. Used by the SPS
 * import's "Need a decision" cards and by Connect customers to SPS.
 */
import './SpsImportModal.css';

const placeholder = (v: string | null | undefined): string | null => (v && v !== 'N/A' ? v : null);

export type SpsSideProps = {
    k: string;
    company?: string;
    contact?: string;
    phone?: string;
    email?: string;
    street?: string;
    place?: string;
    branch?: string;
    rep?: string;
};

export default function SpsSide({ k, company, contact, phone, email, street, place, branch, rep }: SpsSideProps) {
    const rows: [string, string | null | undefined][] = [
        ['Contact', placeholder(contact)],
        ['Phone', placeholder(phone)],
        ['Email', placeholder(email)],
        ['Address', placeholder(street)],
        ['City / State / ZIP', place],
        ['Branch', placeholder(branch)],
        ['Sales rep', placeholder(rep)]
    ];
    return (
        <div className="spsi-side">
            <span className="k">{k}</span>
            <b>{company}</b>
            {rows.map(([label, value]) => (
                <span key={label}><span className="spsc-muted">{label}: </span>{value || <span className="spsc-muted">—</span>}</span>
            ))}
        </div>
    );
}

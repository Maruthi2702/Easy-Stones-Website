import { Loader } from 'lucide-react';

/** A dashboard table with no rows yet while its data is still on the way says so. */
export const dashboardLoadingRow = (colSpan: number) => (
    <tr>
        <td colSpan={colSpan} style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
            <Loader size={16} className="animate-spin" style={{ verticalAlign: 'middle', marginRight: 8, color: '#d4af37' }} />
            Loading…
        </td>
    </tr>
);

// The Customers list's Excel export and its "Copy marketing emails".
import * as XLSX from 'xlsx';
import { formatPhoneForDisplay } from '../../../utils/phoneUtils';
import { primaryEmailOf, cityLineOf, streetOf, locationOf } from '../../../utils/customerList';
import { copyText } from './uiHelpers';
import type { Loose } from '../../../types/records';

export const exportRows = (rows: Loose[], sheetName: string) => {
    const worksheet = XLSX.utils.json_to_sheet(rows.map((l: Loose) => ({
        Company: l.company || '-',
        Name: l.contactName || l.name || '-',
        Email: l.email || '-',
        Phone: formatPhoneForDisplay(l.phone),
        Street: streetOf(l) || '-',
        City: cityLineOf(l) || l.city || '-',
        Status: l.status || '-',
        'Sales Rep': l.salesRepName || 'Unassigned',
        Location: locationOf(l),
        Level: l.level || '-',
        Type: l.customerType || 'Fabricator',
        'Moda Display': l.modaDisplay || 'No',
        'Moda Binders': l.modaBinder || '0',
        Notes: l.notes || l.quickNote || '-',
        Created: l.createdAt ? new Date(l.createdAt).toLocaleDateString() : '-'
    })));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    XLSX.writeFile(workbook, `${sheetName}_List_${new Date().toISOString().split('T')[0]}.xlsx`);
};

export type ListExportDeps = {
    fetchAllMatching: () => Promise<Loose[]>;
    activeTab: string;
    setMoreOpen: (open: boolean) => void;
    setNotice: (message: string) => void;
};

/** The ⋯ menu's Export to Excel and Copy marketing emails, over everything matching the filters. */
export const listExportActions = ({ fetchAllMatching, activeTab, setMoreOpen, setNotice }: ListExportDeps) => {
    const exportToExcel = async () => {
        try {
            exportRows(await fetchAllMatching(), activeTab === 'fabricators' ? 'Fabricators' : 'Partners');
        } catch (error) {
            console.error('Error exporting:', error);
            alert('Failed to export data');
        }
    };

    // Marketing list for everything matching the filters: skips accounts with
    // another rep and anyone who opted out, and prefers the marketing address.
    const emailAllContacts = async () => {
        setMoreOpen(false);
        try {
            const eligible = (await fetchAllMatching()).filter(p => p.status !== 'Different Sales Person' && p.receiveMarketing !== false);
            const emails = [...new Set(eligible
                .map(p => (p.marketingEmail && p.marketingEmail.trim() ? p.marketingEmail.trim() : primaryEmailOf(p)))
                .filter(Boolean))];
            if (emails.length === 0) { alert('No eligible marketing email addresses found for the current filters.'); return; }
            await copyText(emails.join('; '));
            setNotice(`Copied ${emails.length} marketing email addresses — paste them into Outlook's To or Bcc.`);
        } catch (error) {
            console.error('Error copying emails:', error);
            alert('Failed to copy emails');
        }
    };

    return { exportToExcel, emailAllContacts };
};

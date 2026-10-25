/**
 * Possible duplicates of a customer being added (new customers only; advice,
 * never blocks saving). Same rules as the import and the duplicate audit
 * (customerMatch.js, via POST /api/customers/possible-duplicates), asked
 * 600 ms after the company, phone or email stops changing.
 */
import { useEffect, useRef, useState } from 'react';
import { API_URL } from '../../../config/api';
import { authFetch } from '../../../api/authFetch';
import type { Loose } from '../../../types/records';

export type DuplicateMatch = { customer: Loose; signals: string[] };

export function useDuplicateCheck({ isEdit, company: companyValue, phone: phoneValue, email: emailValue }: { isEdit: boolean; company: string; phone: string; email: string }) {
    const [dupMatches, setDupMatches] = useState<DuplicateMatch[]>([]);
    const [dupDismissed, setDupDismissed] = useState(false);
    const dupSeq = useRef(0);
    useEffect(() => {
        if (isEdit) return undefined;
        const company = companyValue.trim();
        const phone = phoneValue.trim();
        const email = emailValue.trim();
        const seq = ++dupSeq.current;
        const timer = setTimeout(async () => {
            if (!company && !phone && !email) { setDupMatches([]); return; }
            try {
                const res = await authFetch(`${API_URL}/api/customers/possible-duplicates`, {
                    method: 'POST',
                    body: JSON.stringify({ company, phone, email })
                });
                if (seq !== dupSeq.current || !res.ok) return;
                const data = await res.json();
                if (seq === dupSeq.current) setDupMatches(data.matches || []);
            } catch {
                // Advice only; a failed check just shows nothing.
            }
        }, 600);
        return () => clearTimeout(timer);
    }, [isEdit, companyValue, phoneValue, emailValue]);
    return { dupMatches, dupDismissed, setDupDismissed };
}

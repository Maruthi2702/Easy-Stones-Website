/**
 * ZIP → city/state: looked up when the ZIP field is left, filled only into
 * blank fields, and the last ZIP typed wins (a newer ZIP cancels an older lookup).
 */
import { useEffect, useState } from 'react';
import type React from 'react';
import { API_URL } from '../../../config/api';
import { authFetch } from '../../../api/authFetch';
import type { CustomerFormValues } from '../../../utils/customerForm';

export function useZipLookup(setValues: React.Dispatch<React.SetStateAction<CustomerFormValues>>) {
    const [zipNote, setZipNote] = useState('');
    const [zipQuery, setZipQuery] = useState('');
    useEffect(() => {
        if (!/^\d{5}$/.test(zipQuery)) return undefined;
        let live = true;
        const zip = zipQuery;
        (async () => {
            try {
                const res = await authFetch(`${API_URL}/api/geocode/zip/${zip}`);
                if (!live) return;
                if (!res.ok) {
                    setZipNote(res.status === 404 ? `No city found for ${zip} — enter it yourself` : 'Couldn’t look up the ZIP — enter the city and state yourself');
                    return;
                }
                const { city, state } = await res.json();
                if (!live) return;
                setValues((v) => (v.address.zipCode.trim() !== zip ? v : {
                    ...v,
                    address: {
                        ...v.address,
                        city: v.address.city.trim() ? v.address.city : (city || v.address.city),
                        state: v.address.state.trim() ? v.address.state : (state || v.address.state)
                    }
                }));
            } catch {
                if (live) setZipNote('Couldn’t look up the ZIP — enter the city and state yourself');
            }
        })();
        return () => { live = false; };
    }, [zipQuery, setValues]);
    return { zipNote, setZipNote, setZipQuery };
}

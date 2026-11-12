/** Live read registrations for the small customer reads; the caller owns database selection. */
import * as customers from '../src/db/customers/index.ts';
import { indexCustomerContacts } from '../src/permits/router.ts';
import { companyOf, contactOf, realEmailsOf } from '../src/utils/customerList.ts';
import type { Loose } from '../src/types/records.ts';

export function lookupCompareReads(ids: string[], allIds: string[], batch: <T, R>(items: T[], read: (item: T) => Promise<R>) => Promise<R[]>) {
  return [
    { name: 'customer vCards: primary and every saved contact field', read: () => batch(ids, id => customers.customerVCard(id)) },
    { name: 'customer Moda: active totals, earlier counts and every item', read: () => batch(ids, async id => ({ _id: id, summary: await customers.customerModa(id) })) },
    { name: 'Holds: the customer snapshot fields', read: () => batch(ids, async id => {
      const c = await customers.customerById(id);
      if (!c) return null;
      const a = c.address || {};
      const cityLine = [a.city, [a.state, a.zipCode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
      return { _id: String(c._id), name: companyOf(c), contact: contactOf(c), phone: String(c.phone || ''),
        email: realEmailsOf(c)[0] || '', address: [a.street, cityLine].filter(Boolean).join('\n') };
    }) },
    { name: 'catalog: every customer price tier and active flag', read: () => batch(allIds, id => customers.customerPriceLevel(id)) },
    { name: 'Permits: every contact used for matching', read: () => customers.customerContactsForMatching(),
      prepare: (rows: unknown) => [...rows as Loose[]].sort((a, b) => String(a._id).localeCompare(String(b._id))) },
    { name: 'Permits: actual email/phone/name matches, including first-match precedence', read: async () => {
      const index = indexCustomerContacts(await customers.customerContactsForMatching());
      return Object.fromEntries(Object.entries(index).map(([key, values]) => [key,
        Object.fromEntries([...values].sort(([a], [b]) => a.localeCompare(b)))]));
    } }
  ];
}

/**
 * Office accounts: one internal customer per location ("Office – Kent"), where
 * the two visit types that have no customer — In-office admin day and Personal
 * time off — are logged. A rep picks the type and their home location's office
 * is filled in; they can change it. Pure, so it's tested in officeAccounts.test.ts;
 * the accounts are created by scripts/create-office-accounts.ts.
 */

/** The customer type every office account carries (also how lists and reports can leave them out). */
export const OFFICE_CUSTOMER_TYPE = 'Internal Office';

/** The stored names (VisitType.name) of the visit types that belong to an office, not a customer. */
export const OFFICE_VISIT_TYPES = ['In Office Administration Day', 'Personal Time Off'];

export const isOfficeVisitType = (name: unknown): boolean => OFFICE_VISIT_TYPES.includes(String(name ?? '').trim());

/** The office account's company name for a location. */
export const officeAccountName = (location: string): string => `Office – ${String(location).trim()}`;

type Option = { value: string; label: string; customerType?: string };

export const isOfficeOption = (option: Pick<Option, 'customerType'> | null | undefined): boolean =>
    option?.customerType === OFFICE_CUSTOMER_TYPE;

/** The dropdown option of a location's office account, or null when it hasn't been created. */
export const officeOptionFor = <T extends Option>(options: T[], location: string): T | null => {
    const label = officeAccountName(location).toLowerCase();
    return options.find((o) => isOfficeOption(o) && o.label.trim().toLowerCase() === label) ?? null;
};

/**
 * What the visit form should do to its customer when the type changes:
 * an office type with no customer (or another location's office, or a real
 * customer left from before the switch) → the home office; a non-office type
 * while an office account is picked → cleared, so a normal visit is never
 * logged against an office. Returns the customer id to set, or null to leave it.
 */
export const customerAfterTypeChange = (
    { typeName, customerId, options, home }: { typeName: string; customerId: string; options: Option[]; home: string }
): string | null => {
    const current = options.find((o) => o.value === customerId);
    if (isOfficeVisitType(typeName)) {
        // Already on an office account (the rep's own choice): leave it.
        if (isOfficeOption(current)) return null;
        const office = home ? officeOptionFor(options, home) : null;
        return office ? office.value : null;
    }
    return isOfficeOption(current) ? '' : null;
};

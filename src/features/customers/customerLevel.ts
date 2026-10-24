/** How a customer's price level reads on their profile ("Level 2 (20% Margin)"). */

const LEVEL_LABELS: Record<number, string> = {
    1: 'Level 1 (10% Margin)',
    2: 'Level 2 (20% Margin)',
    3: 'Level 3 (30% Margin)',
    4: 'Level 4 (40% Margin)'
};

/** A numeric price level (1–4); anything else reads as level 1. */
export const getPriceLevelLabel = (level: unknown): string => LEVEL_LABELS[level as number] || 'Level 1 (10% Margin)';

/**
 * The customer's level: their `level` text when it holds a number 1–4 (named
 * like the levels above), the text itself otherwise, else their `priceLevel`.
 */
export const getCustomerLevelLabel = (customer: { level?: string; priceLevel?: unknown } | null | undefined): string => {
    if (!customer) return 'Level 1 (10% Margin)';
    if (customer.level) {
        const match = customer.level.match(/\d+/);
        if (match) {
            const val = parseInt(match[0], 10);
            return LEVEL_LABELS[val] || customer.level;
        }
        return customer.level;
    }
    return getPriceLevelLabel(customer.priceLevel);
};

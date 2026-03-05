/**
 * Utility to parse information from OCR text of a business card.
 */
export const parseBusinessCard = (text) => {
    if (!text) return null;

    // Clean text: remove sequences of dots/dashes that are often noise
    const cleanedText = text.replace(/[·•▪\-_|=]{3,}/g, '\n');
    const lines = cleanedText.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 2); // Filter out very short noise

    const result = {
        company: '',
        customerName: '',
        phone: '',
        email: '',
        website: '',
        address: {
            street: '',
            city: '',
            state: '',
            zipCode: ''
        }
    };

    // Regex patterns (Very resilient to OCR noise)
    // Emails often have spaces around @ or dots in OCR
    const emailRegex = /([a-zA-Z0-9._%+-]+(?:\s*[@©®]\s*|[^\w\s][@©®])[a-zA-Z0-9.-]+\s*\.\s*[a-zA-Z]{2,})/;

    // Phone numbers often have | instead of 1, or spaces instead of dashes
    const phoneRegex = /(?:\+?[1|l][-.\s]?)?\(?([2-9][0-8][0-9])\)?(?:\s*|[-.\s])?([2-9][0-9]{2})(?:\s*|[-.\s])?([0-9]{4})/;

    // Website pattern
    const websiteRegex = /\b(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,})\b/i;

    // Zip Code
    const zipRegex = /\b(\d{5}(?:[- ]\d{4})?)\b/;

    lines.forEach((line) => {
        // 1. Email check (aggressive clean)
        if (!result.email && (line.includes('@') || line.includes('©') || line.includes('®'))) {
            const match = line.match(emailRegex);
            if (match) {
                result.email = match[1].replace(/\s+/g, '').replace(/[©®]/g, '@');
                return;
            }
        }

        // 2. Phone check
        if (!result.phone && (line.match(/\d/g)?.length || 0) >= 10) {
            const match = line.match(phoneRegex);
            if (match) {
                result.phone = `(${match[1]}) ${match[2]}-${match[3]}`;
                return;
            }
        }

        // 3. Website check
        if (!result.website && line.toLowerCase().includes('www.') || line.toLowerCase().includes('http')) {
            const match = line.match(websiteRegex);
            if (match) {
                result.website = match[0];
                return;
            }
        }

        // 4. Address heuristics
        if (zipRegex.test(line)) {
            const match = line.match(zipRegex);
            result.address.zipCode = match[1];

            // Try to extract City/State from the same line
            const parts = line.split(/[ ,]+/);
            const zipIndex = parts.findIndex(p => p.includes(match[1]));
            if (zipIndex > 0) {
                // Usually: City State Zip
                if (zipIndex >= 2) {
                    result.address.state = parts[zipIndex - 1];
                    result.address.city = parts.slice(0, zipIndex - 1).join(' ');
                } else {
                    result.address.state = parts[zipIndex - 1];
                }
            }
        }
    });

    // 5. Name and Company Heuristics (Aggressive)
    const companyKeywords = [
        'Inc', 'LLC', 'Corp', 'Ltd', 'Group', 'Solutions', 'Services', 'Systems',
        'Company', 'Construction', 'Stone', 'Marble', 'Granite', 'Tile', 'Design',
        'Stones', 'Kitchen', 'Bath'
    ];

    // Filter out lines already used
    const remainingLines = lines.filter(line =>
        !line.includes(result.email || '____') &&
        !line.includes(result.phone || '____') &&
        !line.includes(result.website || '____') &&
        !zipRegex.test(line)
    );

    if (remainingLines.length > 0) {
        // Look for company keywords first
        for (let i = 0; i < Math.min(5, remainingLines.length); i++) {
            const currentLine = remainingLines[i];
            if (companyKeywords.some(kw => currentLine.toLowerCase().includes(kw.toLowerCase()))) {
                result.company = currentLine;
                break;
            }
        }

        // Clean up remaining lines for name/company
        // Filter out lines that look like addresses (start with numbers)
        const textOnlyLines = remainingLines.filter(l => !/^\d+/.test(l) && l.length > 3);

        if (!result.company && textOnlyLines.length > 0) {
            // High probability first line is Company or Name
            result.company = textOnlyLines[0];
            if (textOnlyLines.length > 1) {
                result.customerName = textOnlyLines[1];
            }
        } else if (result.company) {
            // Find a line that isn't the company and has at least two words (likely a person's name)
            const nameLine = textOnlyLines.find(l =>
                l.toLowerCase() !== result.company.toLowerCase() &&
                l.split(/\s+/).length >= 2
            );
            if (nameLine) result.customerName = nameLine;
        }
    }

    // 6. Street Address heuristic
    const streetLine = remainingLines.find(l => /^\d+\s+[a-zA-Z]+/.test(l));
    if (streetLine) {
        result.address.street = streetLine;
    }

    return result;
};

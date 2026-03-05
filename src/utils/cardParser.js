/**
 * Utility to parse information from OCR text from various documents (DL, SSN, Business Cards).
 */
export const parseBusinessCard = (text) => {
    if (!text) return null;

    // Clean text: remove sequences of dots/dashes that are often noise
    const cleanedText = text.replace(/[·•▪\-_|=]{3,}/g, '\n');
    const lines = cleanedText.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 1);

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

    // Detection markers
    const isDL = text.toLowerCase().includes('driver license') || text.toLowerCase().includes('dl') || /\bLN\b|\bFN\b/.test(text) || /\b[128]\s[A-Z]/.test(text);
    const isSSN = text.toLowerCase().includes('social security') || /\b\d{3}-\d{2}-\d{4}\b/.test(text);

    // Regex patterns (Resilient)
    const emailRegex = /([a-zA-Z0-9._%+-]+(?:\s*[@©®]\s*|[^\w\s][@©®])[a-zA-Z0-9.-]+\s*\.\s*[a-zA-Z]{2,})/;
    const phoneRegex = /(?:\+?[1|l][-.\s]?)?\(?([2-9][0-8][0-9])\)?(?:\s*|[-.\s])?([2-9][0-9]{2})(?:\s*|[-.\s])?([0-9]{4})/;
    const zipRegex = /\b(\d{5}(?:[- ]\d{4})?)\b/;
    const ssnRegex = /\b(\d{3}-\d{2}-\d{4})\b/;

    // 1. Specific Document Logic: Driver License
    if (isDL) {
        let firstName = '';
        let lastName = '';

        lines.forEach(line => {
            // AAMVA Standard: 1=LN, 2=FN, 8=Address
            if (/^1\s|^LN\b/i.test(line)) {
                lastName = line.replace(/^1\s|^LN[:\s]*/i, '').trim();
            } else if (/^2\s|^FN\b/i.test(line)) {
                firstName = line.replace(/^2\s|^FN[:\s]*/i, '').trim();
            } else if (/^8\s/i.test(line)) {
                result.address.street = line.replace(/^8\s/i, '').trim();
            } else if (zipRegex.test(line) && !result.address.zipCode) {
                const match = line.match(zipRegex);
                result.address.zipCode = match[1];
                const parts = line.split(/[ ,]+/);
                const zipIndex = parts.findIndex(p => p.includes(match[1]));
                if (zipIndex > 0) {
                    result.address.state = parts[zipIndex - 1];
                    result.address.city = parts.slice(0, zipIndex - 1).join(' ');
                }
            }
        });

        if (firstName || lastName) {
            result.customerName = `${firstName} ${lastName}`.trim();
        }
        result.company = 'Personal (ID Scan)';
    }

    // 2. Specific Document Logic: SSN
    if (isSSN && !result.customerName) {
        // SSN cards usually have the name below "SOCIAL SECURITY"
        const ssnIndex = lines.findIndex(l => l.toLowerCase().includes('social security'));
        if (ssnIndex !== -1 && lines[ssnIndex + 1]) {
            result.customerName = lines[ssnIndex + 1];
        }
        result.company = 'Personal (SSN Scan)';
    }

    // 3. Fallback/Refinement for General Data (Email, Phone, Zip)
    lines.forEach((line) => {
        // Email
        if (!result.email && (line.includes('@') || line.includes('©') || line.includes('®'))) {
            const match = line.match(emailRegex);
            if (match) {
                result.email = match[1].replace(/\s+/g, '').replace(/[©®]/g, '@');
            }
        }
        // Phone
        if (!result.phone && (line.match(/\d/g)?.length || 0) >= 10) {
            const match = line.match(phoneRegex);
            if (match) {
                result.phone = `(${match[1]}) ${match[2]}-${match[3]}`;
            }
        }
        // Zip (if not found by DL logic)
        if (!result.address.zipCode && zipRegex.test(line)) {
            const match = line.match(zipRegex);
            result.address.zipCode = match[1];
        }
    });

    // 4. Heuristics for Company/Name (If not yet found)
    if (!result.customerName || !result.company) {
        const companyKeywords = [
            'Inc', 'LLC', 'Corp', 'Ltd', 'Group', 'Solutions', 'Services', 'Systems',
            'Company', 'Construction', 'Stone', 'Marble', 'Granite', 'Tile', 'Design',
            'Kitchen', 'Bath'
        ];

        const remainingLines = lines.filter(line =>
            !line.includes(result.email || '____') &&
            !line.includes(result.phone || '____') &&
            !zipRegex.test(line) &&
            !line.toLowerCase().includes('driver license') &&
            !line.toLowerCase().includes('social security') &&
            !/^[128]\s/.test(line)
        );

        if (remainingLines.length > 0) {
            // Find Company by keyword
            if (!result.company) {
                const companyLine = remainingLines.find(l => companyKeywords.some(kw => l.toLowerCase().includes(kw.toLowerCase())));
                if (companyLine) result.company = companyLine;
            }

            // Text-only lines (no starting numbers)
            const namingLines = remainingLines.filter(l => !/^\d+/.test(l) && l.length > 3);

            if (!result.company && namingLines.length > 0) {
                result.company = namingLines[0];
                if (!result.customerName && namingLines.length > 1) {
                    result.customerName = namingLines[1];
                }
            } else if (result.company && !result.customerName) {
                const nameLine = namingLines.find(l => l.toLowerCase() !== result.company.toLowerCase() && l.split(/\s+/).length >= 2);
                if (nameLine) result.customerName = nameLine;
            }
        }
    }

    // 5. Street Address fallback
    if (!result.address.street) {
        const streetLine = lines.find(l => /^\d+\s+[a-zA-Z]+/.test(l) && !l.includes(result.phone));
        if (streetLine) result.address.street = streetLine;
    }

    return result;
};

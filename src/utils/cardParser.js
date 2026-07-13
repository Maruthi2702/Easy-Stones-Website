/**
 * Utility to parse information from OCR text from various documents (DL, SSN, Business Cards, and Contact Card Screenshots).
 */
export const parseBusinessCard = (text) => {
    if (!text) return null;

    // Clean text: remove sequences of dots/dashes that are often noise
    const cleanedText = text.replace(/[·•▪\-_|=]{3,}/g, '\n');
    const lines = cleanedText.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);

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

    // Detection markers for specific IDs
    const isDL = text.toLowerCase().includes('driver license') || text.toLowerCase().includes('dl') || /\bLN\b|\bFN\b/.test(text) || /\b[128]\s[A-Z]/.test(text);
    const isSSN = text.toLowerCase().includes('social security') || /\b\d{3}-\d{2}-\d{4}\b/.test(text);

    // 1. Specific Document Logic: Driver License
    if (isDL) {
        let firstName = '';
        let lastName = '';
        const zipRegex = /\b(\d{5}(?:[- ]\d{4})?)\b/;

        lines.forEach(line => {
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
        return result;
    }

    // 2. Specific Document Logic: SSN
    if (isSSN) {
        const ssnIndex = lines.findIndex(l => l.toLowerCase().includes('social security'));
        if (ssnIndex !== -1 && lines[ssnIndex + 1]) {
            result.customerName = lines[ssnIndex + 1];
        }
        result.company = 'Personal (SSN Scan)';
        return result;
    }

    // 3. Structured Contact Card Parser (e.g., iPhone / Android Contact Screenshot)
    const filteredHeaderLines = [];
    let isHeaderSection = true;
    const contactLabels = ['mobile', 'home', 'work', 'main', 'notes', 'pager', 'fax', 'other'];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineLower = line.toLowerCase();

        if (contactLabels.includes(lineLower)) {
            isHeaderSection = false;
        }

        if (isHeaderSection) {
            const isTime = /^\d{1,2}:\d{2}$/.test(line);
            const isNoiseLabel = ['edit', 'back', 'done', 'cancel', 'save', 'contacts', 'keypad', 'calls'].includes(lineLower);
            const isSignalBattery = /^\d+%\s*$/.test(line) || lineLower.includes('lte') || lineLower.includes('5g') || lineLower.includes('wi-fi');
            
            if (!isTime && !isNoiseLabel && !isSignalBattery && line.length > 2) {
                filteredHeaderLines.push(line);
            }
        } else {
            if (i + 1 < lines.length) {
                const nextLine = lines[i + 1];
                const nextLineLower = nextLine.toLowerCase();
                
                if (contactLabels.includes(nextLineLower)) continue;

                if (lineLower === 'mobile' || lineLower === 'home' || lineLower === 'work' || lineLower === 'main' || lineLower === 'other') {
                    if (nextLine.includes('@') && !result.email) {
                        result.email = nextLine.replace(/\s+/g, '');
                    }
                    else if (/\d/.test(nextLine) && nextLine.replace(/\D/g, '').length >= 7 && !result.phone) {
                        result.phone = nextLine;
                    }
                    else if (/^\d+/.test(nextLine) && !result.address.street) {
                        result.address.street = nextLine;
                    }
                }
            }
        }
    }

    // Parse Name & Company from header lines
    if (filteredHeaderLines.length > 0) {
        const joinedHeader = filteredHeaderLines.join(' ');
        let cleanHeader = joinedHeader.replace(/^[A-Z\s-]{4,}\b/, '').trim();
        
        if (cleanHeader.includes('@')) {
            const parts = cleanHeader.split('@');
            if (parts.length === 2) {
                result.customerName = parts[0].trim();
                result.company = parts[1].trim();
            }
        } else {
            const nameCandidates = filteredHeaderLines.filter(l => !/^[A-Z\s-]{4,}$/.test(l));
            if (nameCandidates.length > 0) {
                result.customerName = nameCandidates[0];
                if (nameCandidates.length > 1) {
                    result.company = nameCandidates[1];
                }
            }
        }
    }

    // Strip out generic "Contact Photo & Poster" iOS system labels and single letter profile icons
    const cleanField = (val) => {
        if (!val) return '';
        return val
            .replace(/Contact Photo.*/i, '')
            .replace(/Poster.*/i, '')
            .replace(/\b[A-Za-z]\)?$/, '') // Remove trailing single letter icons like D) or D
            .replace(/\s*[-|@]\s*$/, '')    // Remove trailing delimiters
            .trim();
    };

    if (result.customerName) {
        result.customerName = cleanField(result.customerName);
    }
    if (result.company) {
        result.company = cleanField(result.company);
    }

    // General Regex fallbacks if structured parsing missed it
    const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/;
    const phoneRegex = /(?:\+?[1|l][-.\s]?)?\(?([2-9][0-8][0-9])\)?(?:\s*|[-.\s])?([2-9][0-9]{2})(?:\s*|[-.\s])?([0-9]{4})/;

    if (!result.email) {
        for (const line of lines) {
            const match = line.match(emailRegex);
            if (match) {
                result.email = match[1];
                break;
            }
        }
    }

    if (!result.phone) {
        for (const line of lines) {
            const match = line.match(phoneRegex);
            if (match) {
                result.phone = `(${match[1]}) ${match[2]}-${match[3]}`;
                break;
            }
        }
    }

    if (!result.address.street) {
        const streetLine = lines.find(l => /^\d+\s+[a-zA-Z]+/.test(l) && !l.includes(result.phone || '___'));
        if (streetLine) result.address.street = streetLine;
    }

    // Process address components (e.g. "22230 84th Ave S, Kent, WA 98032")
    if (result.address.street) {
        result.address.street = result.address.street.replace(/United States/i, '').trim();

        if (result.address.street.includes(',')) {
            const addressParts = result.address.street.split(',').map(p => p.trim());
            if (addressParts.length >= 2) {
                const streetVal = addressParts[0];
                const secondPart = addressParts[1];
                
                if (addressParts.length === 3) {
                    result.address.street = streetVal;
                    result.address.city = secondPart;
                    const stateZipPart = addressParts[2];
                    const stateZipMatch = stateZipPart.match(/^([A-Za-z]{2})\s+(\d{5})/);
                    if (stateZipMatch) {
                        result.address.state = stateZipMatch[1];
                        result.address.zipCode = stateZipMatch[2];
                    } else {
                        result.address.state = stateZipPart;
                    }
                } else if (addressParts.length === 2) {
                    result.address.street = streetVal;
                    const stateZipMatch = secondPart.match(/^(.*?)\s+([A-Za-z]{2})\s+(\d{5})/);
                    if (stateZipMatch) {
                        result.address.city = stateZipMatch[1].trim();
                        result.address.state = stateZipMatch[2];
                        result.address.zipCode = stateZipMatch[3];
                    } else {
                        const cityStateMatch = secondPart.match(/^(.*?)\s+([A-Za-z]{2})/);
                        if (cityStateMatch) {
                            result.address.city = cityStateMatch[1].trim();
                            result.address.state = cityStateMatch[2];
                        } else {
                            result.address.city = secondPart;
                        }
                    }
                }
            }
        } else {
            const zipMatch = result.address.street.match(/\b([A-Za-z]{2})\s+(\d{5})\b/);
            if (zipMatch) {
                result.address.state = zipMatch[1];
                result.address.zipCode = zipMatch[2];
                const withoutZip = result.address.street.substring(0, zipMatch.index).trim();
                const streetSuffixMatch = withoutZip.match(/\b(ave|avenue|st|street|rd|road|ln|lane|dr|drive|ct|court|way|blvd|boulevard)\s+([a-zA-Z\s]+)$/i);
                if (streetSuffixMatch) {
                    result.address.street = withoutZip.substring(0, streetSuffixMatch.index + streetSuffixMatch[1].length).trim();
                    result.address.city = streetSuffixMatch[2].trim();
                } else {
                    result.address.street = withoutZip;
                }
            }
        }
    }

    // Sanity check: ZIP Code must not be the street address number
    if (result.address.zipCode && result.address.street && result.address.street.startsWith(result.address.zipCode)) {
        result.address.zipCode = '';
    }

    return result;
};

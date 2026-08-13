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

    // Detection markers for specific IDs.
    // Deliberately conservative: `.includes('dl')` and `/\b[128]\s[A-Z]/` used to
    // fire on ordinary business cards (e.g. "Middle", "Handle", a suite number
    // like "Ste 2 A"), hijacking the whole scan into the ID-only branch below
    // and wiping out company/phone/email. Require an explicit license phrase,
    // or both the LN and FN field codes together, before treating this as an ID.
    const lowerText = text.toLowerCase();
    const isDL = lowerText.includes('driver license') || lowerText.includes("driver's license") || lowerText.includes('driver licence') || lowerText.includes('operator license')
        || (/\bLN\b/.test(text) && /\bFN\b/.test(text));
    const isSSN = lowerText.includes('social security') || /\b\d{3}-\d{2}-\d{4}\b/.test(text);

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

    // 3. Structured Contact Card Parser (e.g., iPhone / Android Contact Screenshot,
    // or a plain printed business card that never has "mobile/home/work" labels)
    const filteredHeaderLines = [];
    let isHeaderSection = true;
    const contactLabels = ['mobile', 'home', 'work', 'main', 'notes', 'pager', 'fax', 'other'];

    // A printed business card never trips the contactLabels check above, so
    // isHeaderSection stays true for the *entire* card and every line —
    // phone, email, address included — used to land in filteredHeaderLines.
    // That's what let a stray email hijack the whole name/company split
    // further down. Keep contact-info lines out of the header candidate pool.
    const quickEmailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
    const quickPhoneRegex = /\d{3}[-.\s)]\s?\d{3}[-.\s]\d{4}/;
    const quickUrlRegex = /(www\.|https?:\/\/|\.(com|net|org|io|co)\b)/i;
    const quickZipLineRegex = /\b[A-Za-z]{2}\s+\d{5}(-\d{4})?\b/;
    // Matches "1234 Industrial Way" as well as numbered street names like
    // "900 5th Ave" or "42nd St", where a plain \d+\s+[a-zA-Z] miss the digit
    // that starts the street-name token itself.
    const streetLineRegex = /^\d+\s+(\d+(st|nd|rd|th)\.?\s+)?[a-zA-Z]/i;
    const isContactInfoLine = (line) => (
        quickEmailRegex.test(line)
        || quickPhoneRegex.test(line)
        || quickUrlRegex.test(line)
        || quickZipLineRegex.test(line)
        || streetLineRegex.test(line)
    );

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

            if (!isTime && !isNoiseLabel && !isSignalBattery && line.length > 2 && !isContactInfoLine(line)) {
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

    // Parse Name & Company from header lines.
    // Job-title lines ("Sales Manager", "Owner") are neither the name nor the
    // company and must be dropped rather than landing in one of those fields
    // by position. The company is usually the ALL-CAPS logo line or a line
    // with a business suffix; whatever's left that reads like "First Last" is
    // the name.
    const companySuffixRegex = /\b(inc|llc|llp|corp|co|company|group|industries|enterprises|ltd|stone|granite|marble|quartz|tile|countertops?|supply|supplies)\b\.?/i;
    const titleKeywordRegex = /\b(manager|owner|president|ceo|cfo|coo|director|sales|representative|rep|founder|partner|vice president|vp|estimator|designer|consultant|specialist)\b/i;
    const isAllCapsLine = (l) => /^[A-Z0-9\s&.,'-]{4,}$/.test(l);
    const isNameShaped = (l) => /^[A-Za-z.'-]+(\s+[A-Za-z.'-]+){1,3}$/.test(l) && !isAllCapsLine(l);

    if (filteredHeaderLines.length > 0) {
        const nonTitleLines = filteredHeaderLines.filter(l => !titleKeywordRegex.test(l));

        const nameLine = nonTitleLines.find(isNameShaped);
        const companyLine = nonTitleLines.find(l => l !== nameLine && companySuffixRegex.test(l))
            || nonTitleLines.find(l => l !== nameLine && isAllCapsLine(l))
            || nonTitleLines.find(l => l !== nameLine);

        result.customerName = nameLine || '';
        result.company = companyLine || '';
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
        const streetLine = lines.find(l => streetLineRegex.test(l) && !l.includes(result.phone || '___'));
        if (streetLine) result.address.street = streetLine;
    }

    // Printed cards commonly put the street on one line and "City, ST ZIP" on
    // the next rather than joining them with commas — pull the following line
    // in before the comma-split logic below runs, so it's not left blank.
    if (result.address.street && !result.address.street.includes(',')) {
        const streetIdx = lines.indexOf(result.address.street);
        const nextLine = streetIdx !== -1 ? lines[streetIdx + 1] : undefined;
        if (nextLine && /^[A-Za-z .'-]+,?\s+[A-Za-z]{2}\s+\d{5}(-\d{4})?$/.test(nextLine)) {
            result.address.street = `${result.address.street}, ${nextLine}`;
        }
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

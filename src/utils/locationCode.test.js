import { describe, it, expect } from 'vitest';
import { normalizeLocationCode, formatLocationLabel, locationShortName } from './locationCode.js';

describe('normalizeLocationCode', () => {
    it('trims and uppercases a valid code', () => {
        expect(normalizeLocationCode('  sea ')).toEqual({ code: 'SEA', error: null });
    });

    it('treats blank / missing input as "no code"', () => {
        expect(normalizeLocationCode('')).toEqual({ code: '', error: null });
        expect(normalizeLocationCode('   ')).toEqual({ code: '', error: null });
        expect(normalizeLocationCode(undefined)).toEqual({ code: '', error: null });
        expect(normalizeLocationCode(null)).toEqual({ code: '', error: null });
    });

    it('accepts 2–5 letters or digits', () => {
        expect(normalizeLocationCode('SL').error).toBeNull();
        expect(normalizeLocationCode('SLC').error).toBeNull();
        expect(normalizeLocationCode('HOU2').error).toBeNull();
        expect(normalizeLocationCode('ABCDE').error).toBeNull();
    });

    it('rejects codes that are too short, too long, or contain other characters', () => {
        expect(normalizeLocationCode('S').error).toBeTruthy();
        expect(normalizeLocationCode('ABCDEF').error).toBeTruthy();
        expect(normalizeLocationCode('S-L').error).toBeTruthy();
        expect(normalizeLocationCode('S L').error).toBeTruthy();
    });
});

describe('formatLocationLabel', () => {
    it('appends the code in parentheses when present', () => {
        expect(formatLocationLabel({ name: 'Seattle', shortCode: 'SEA' })).toBe('Seattle (SEA)');
    });

    it('falls back to the name when there is no code', () => {
        expect(formatLocationLabel({ name: 'Dallas' })).toBe('Dallas');
        expect(formatLocationLabel({ name: 'Dallas', shortCode: '' })).toBe('Dallas');
    });

    it('handles a missing location', () => {
        expect(formatLocationLabel(null)).toBe('');
    });
});

describe('locationShortName', () => {
    const locations = [
        { name: 'Seattle', shortCode: 'SEA' },
        { name: 'Dallas' },
    ];

    it('returns the code for a known location', () => {
        expect(locationShortName(locations, 'Seattle')).toBe('SEA');
    });

    it('falls back to the name when no code is set or the location is unknown', () => {
        expect(locationShortName(locations, 'Dallas')).toBe('Dallas');
        expect(locationShortName(locations, 'Portland')).toBe('Portland');
        expect(locationShortName(undefined, 'Portland')).toBe('Portland');
    });
});

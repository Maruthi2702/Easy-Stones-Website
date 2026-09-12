import { describe, it, expect } from 'vitest';
import { formatPhoneInput, formatPhoneForDisplay, stripPhone } from './phoneUtils';

describe('formatPhoneInput', () => {
    it('formats ten digits', () => {
        expect(formatPhoneInput('2533802431')).toBe('(253) 380-2431');
    });

    it('formats partial entry as the user types', () => {
        expect(formatPhoneInput('25')).toBe('25');
        expect(formatPhoneInput('253')).toBe('253');
        expect(formatPhoneInput('25338')).toBe('(253) 38');
        expect(formatPhoneInput('2533802')).toBe('(253) 380-2');
    });

    it('drops the country code pasted from Google Maps', () => {
        expect(formatPhoneInput('+1 253-380-2431')).toBe('(253) 380-2431');
        expect(formatPhoneInput('12533802431')).toBe('(253) 380-2431');
        expect(formatPhoneInput('1 (253) 380-2431')).toBe('(253) 380-2431');
    });

    it('keeps a leading 1 that is still just the first digit typed', () => {
        expect(formatPhoneInput('1')).toBe('1');
        expect(formatPhoneInput('1253380243')).toBe('(125) 338-0243');
    });

    it('ignores anything past ten digits', () => {
        expect(formatPhoneInput('253380243199')).toBe('(253) 380-2431');
    });

    it('returns empty for empty input', () => {
        expect(formatPhoneInput('')).toBe('');
        expect(formatPhoneInput('abc')).toBe('');
    });
});

describe('formatPhoneForDisplay', () => {
    it('formats stored ten-digit numbers', () => {
        expect(formatPhoneForDisplay('2533802431')).toBe('(253) 380-2431');
    });

    it('formats stored numbers that kept their country code', () => {
        expect(formatPhoneForDisplay('+1 253 380 2431')).toBe('(253) 380-2431');
    });

    it('passes through anything it cannot format', () => {
        expect(formatPhoneForDisplay('ext. 4')).toBe('ext. 4');
        expect(formatPhoneForDisplay('')).toBe('');
    });
});

describe('stripPhone', () => {
    it('returns bare digits without the country code', () => {
        expect(stripPhone('(253) 380-2431')).toBe('2533802431');
        expect(stripPhone('+1 (253) 380-2431')).toBe('2533802431');
        expect(stripPhone('')).toBe('');
    });
});

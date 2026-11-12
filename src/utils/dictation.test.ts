import { describe, expect, it } from 'vitest';
import { appendSpoken, dictationErrorText, speechRecognitionCtor } from './dictation';

describe('appendSpoken', () => {
    it('starts an empty box with a capital', () => {
        expect(appendSpoken('', 'met with the owner')).toBe('Met with the owner');
    });
    it('adds to text already there with one space', () => {
        expect(appendSpoken('Met the owner', 'wants quartz')).toBe('Met the owner wants quartz');
        expect(appendSpoken('Met the owner  \n', 'wants quartz')).toBe('Met the owner wants quartz');
    });
    it('capitalizes after a finished sentence', () => {
        expect(appendSpoken('Met the owner.', 'wants quartz')).toBe('Met the owner. Wants quartz');
    });
    it('ignores blank speech', () => {
        expect(appendSpoken('Hello', '   ')).toBe('Hello');
    });
    it('squeezes inner spaces', () => {
        expect(appendSpoken('', 'two   spaces')).toBe('Two spaces');
    });
});

describe('dictationErrorText', () => {
    it('explains a blocked microphone', () => {
        expect(dictationErrorText('not-allowed')).toMatch(/blocked/i);
    });
    it('says nothing when it was stopped on purpose', () => {
        expect(dictationErrorText('aborted')).toBe('');
    });
    it('has a fallback', () => {
        expect(dictationErrorText('something-new')).not.toBe('');
    });
});

describe('speechRecognitionCtor', () => {
    it('is null when the browser has none', () => {
        expect(speechRecognitionCtor({})).toBeNull();
    });
    it('finds the prefixed one (Safari)', () => {
        class Fake {}
        expect(speechRecognitionCtor({ webkitSpeechRecognition: Fake })).toBe(Fake);
    });
});

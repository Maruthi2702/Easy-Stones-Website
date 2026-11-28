import { describe, expect, it, vi } from 'vitest';
import { onOpenSpeechTest, requestSpeechTest } from './openRequest';

describe('speech test open request', () => {
  it('tells every listener, and stops after it is removed', () => {
    const a = vi.fn(); const b = vi.fn();
    const stopA = onOpenSpeechTest(a); onOpenSpeechTest(b);
    requestSpeechTest();
    stopA();
    requestSpeechTest();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
  });
});

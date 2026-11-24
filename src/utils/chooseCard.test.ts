import { describe, it, expect } from 'vitest';
import { chooseCard } from './cardReceipts';

const amex = { _id: 'a1', label: 'MARU92069' };
const encore = { _id: 'e1', label: 'PATH3992' };

describe('chooseCard', () => {
  it('no choice means the first card (Amex first), as before', () => {
    expect(chooseCard([amex, encore], undefined)).toEqual({ card: amex, problem: '' });
    expect(chooseCard([amex, encore], '')).toEqual({ card: amex, problem: '' });
  });
  it('takes the chosen card when it is one of theirs', () => {
    expect(chooseCard([amex, encore], 'e1').card).toBe(encore);
  });
  it('refuses a card that is not theirs', () => {
    expect(chooseCard([amex, encore], 'x9')).toEqual({ card: null, problem: 'Choose one of your cards.' });
  });
  it('a person with no card gets none', () => {
    expect(chooseCard([], 'a1')).toEqual({ card: null, problem: '' });
  });
});

import { describe, it, expect } from 'vitest';
import { keepInFormPlacement } from './formFocus.ts';

// Boxes by their top and height, as the browser would measure them.
const body = (top: number, height: number) => ({ scrollTop: 0, getBoundingClientRect: () => ({ top, bottom: top + height, height }) });
const field = (top: number, height = 42) => ({ getBoundingClientRect: () => ({ top, bottom: top + height, height }) });
const list = (height: number) => ({ scrollHeight: height });
const place = (a: unknown, s: unknown, m: unknown) => keepInFormPlacement(a as Element, s as Element, m as Element);

describe('keepInForm: the list stays in the form and the form never moves', () => {
  it('opens below when the whole list fits there, as tall as the room (up to 440)', () => {
    expect(place(field(230), body(200, 600), list(220))).toEqual({ placement: 'down', maxHeight: 440 });
  });

  it('a list still loading opens with the room below, so it can grow when the customers arrive', () => {
    // The owner's screenshot: "Loading…" was ~86px tall and the list stayed that size.
    expect(place(field(271), body(186, 377), list(86))).toEqual({ placement: 'down', maxHeight: 186 + 377 - 313 - 12 });
  });

  it('opens above when it only fits there', () => {
    expect(place(field(600), body(200, 600), list(220))).toEqual({ placement: 'up', maxHeight: 600 - 200 - 12 });
  });

  it('a long list in a short body (the owner\'s screenshot) fills the room below and scrolls inside', () => {
    const s = body(186, 377); // header to footer
    const r = place(field(271), s, list(2000)); // Company, the first field
    expect(r).toEqual({ placement: 'down', maxHeight: 186 + 377 - 313 - 12 });
    expect(s.scrollTop).toBe(0);
  });

  it('picks the roomier side when it fits neither, without scrolling', () => {
    const s = body(100, 500);
    expect(place(field(400), s, list(400))).toEqual({ placement: 'up', maxHeight: 400 - 100 - 12 });
    expect(s.scrollTop).toBe(0);
  });
});

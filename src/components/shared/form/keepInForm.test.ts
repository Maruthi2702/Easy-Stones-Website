import { describe, it, expect } from 'vitest';
import { keepInFormPlacement } from './formFocus.ts';

// Boxes by their top and height, as the browser would measure them; the
// scroller moves its contents when scrollTop changes, like a form body.
const box = (top: number, height: number) => ({ getBoundingClientRect: () => ({ top, bottom: top + height, height }) });
const body = (top: number, height: number) => {
  const el = { scrollTop: 0, getBoundingClientRect: () => ({ top, bottom: top + height, height }) };
  return el;
};
const field = (scroller: { scrollTop: number }, top: number, height = 42) =>
  ({ getBoundingClientRect: () => ({ top: top - scroller.scrollTop, bottom: top - scroller.scrollTop + height, height }) });
const list = (height: number) => ({ scrollHeight: height, ...box(0, height) });
const place = (a: unknown, s: unknown, m: unknown) => keepInFormPlacement(a as Element, s as Element, m as Element);

describe('keepInForm: the list stays in the form, with its field in view', () => {
  it('opens below when the whole list fits there, without scrolling', () => {
    const s = body(200, 600);
    expect(place(field(s, 230), s, list(220))).toEqual({ placement: 'down', maxHeight: 220 });
    expect(s.scrollTop).toBe(0);
  });

  it('opens above when it only fits there', () => {
    const s = body(200, 600);
    expect(place(field(s, 600), s, list(220))).toEqual({ placement: 'up', maxHeight: 220 });
  });

  it('a short body (the screenshot: ~380px) caps the list and never scrolls the field away', () => {
    const s = body(200, 380);
    const f = field(s, 230); // Company, the first field
    const r = place(f, s, list(2000));
    expect(r.placement).toBe('down');
    expect(r.maxHeight).toBe(380 - 42 - 24);
    expect(s.scrollTop).toBeLessThanOrEqual(230 - 200 - 8);
    const t = f.getBoundingClientRect();
    expect(t.top).toBeGreaterThanOrEqual(200);
    expect(t.bottom + 12 + r.maxHeight).toBeLessThanOrEqual(200 + 380 + 12);
  });

  it('scrolls just enough for a list under a lower field', () => {
    const s = body(100, 500);
    const f = field(s, 330); // 216 below it, 218 above: a 300px list fits neither way
    const r = place(f, s, list(300));
    expect(r).toEqual({ placement: 'down', maxHeight: 300 });
    expect(s.scrollTop).toBe(300 - 216);
    expect(f.getBoundingClientRect().top).toBeGreaterThanOrEqual(100);
  });
});

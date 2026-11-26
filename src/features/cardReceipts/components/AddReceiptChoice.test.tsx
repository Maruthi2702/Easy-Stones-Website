// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import AddReceiptChoice from './AddReceiptChoice';

const phone = (on: boolean) => {
  window.matchMedia = ((q: string) => ({ matches: on, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
};
const props = () => ({ onCamera: vi.fn(), onLost: vi.fn(), onSeveral: vi.fn(), onFile: vi.fn(), onClose: vi.fn() });

afterEach(() => { cleanup(); });

describe('AddReceiptChoice on a phone (bottom drawer)', () => {
  it('shows the big camera card, the compact options and the two labelled groups', () => {
    phone(true);
    const p = props();
    render(<AddReceiptChoice {...p} />);
    for (const name of [/Take a photo/, /Upload/, /Lost receipt/, /Add several/]) expect(screen.getByRole('button', { name })).toBeTruthy();
    expect(screen.getByText('No receipt?')).toBeTruthy();
    expect(screen.getByText('For accounting')).toBeTruthy();
    expect(screen.queryByText(/drop or paste/i)).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Add receipt' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Take a photo/ }));
    fireEvent.click(screen.getByRole('button', { name: /Lost receipt/ }));
    fireEvent.click(screen.getByRole('button', { name: /Add several/ }));
    expect(p.onCamera).toHaveBeenCalled();
    expect(p.onLost).toHaveBeenCalled();
    expect(p.onSeveral).toHaveBeenCalled();
  });

  it('closes from the close button, the dimmed page and Esc', () => {
    phone(true);
    const p = props();
    render(<AddReceiptChoice {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(document.querySelector('.ccr-drawer-scrim')!);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(p.onClose).toHaveBeenCalledTimes(3);
  });

  it('leaves out "For accounting" without the Add several switch', () => {
    phone(true);
    render(<AddReceiptChoice {...props()} onSeveral={undefined} />);
    expect(screen.queryByText('For accounting')).toBeNull();
  });

  it('keeps the desktop words and the drop box off a phone', () => {
    phone(false);
    render(<AddReceiptChoice {...props()} />);
    expect(screen.getByRole('button', { name: /Open Camera/ })).toBeTruthy();
    expect(screen.queryByText('No receipt?')).toBeNull();
  });
});

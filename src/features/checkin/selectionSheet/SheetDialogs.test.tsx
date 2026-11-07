// @vitest-environment jsdom
// The Selection Sheet's Email pop-up: who it's for decides the address it
// starts with and which price button comes first (owner, 2026-11-07).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { EmailDialog } from './SheetDialogs';

afterEach(cleanup);

const priced = { materials: 3, any: true, missing: 1 };
const choices = () => within(document.querySelector('.ss-choices') as HTMLElement).getAllByRole('button');
const setup = (summary = priced) => {
    const onSend = vi.fn();
    render(<EmailDialog initialTo="pat@example.com" customer="Pat Visitor" fabricator="Intown" summary={summary} onSend={onSend} onClose={() => {}} />);
    return onSend;
};

describe('EmailDialog — who is it for?', () => {
    it('starts on the home owner: their email, without prices first', () => {
        const onSend = setup();
        expect(screen.getByRole('button', { name: /Home Owner/ }).getAttribute('aria-pressed')).toBe('true');
        expect((screen.getByLabelText(/Send to/) as HTMLInputElement).value).toBe('pat@example.com');
        expect(choices()[0].textContent).toContain('Send without prices');
        fireEvent.click(choices()[0]);
        expect(onSend).toHaveBeenCalledWith('pat@example.com', false);
    });

    it('for the fabricator: a blank address and with prices first', () => {
        const onSend = setup();
        fireEvent.click(screen.getByRole('button', { name: /Fabricator/ }));
        const to = screen.getByLabelText(/Send to/) as HTMLInputElement;
        expect(to.value).toBe('');
        expect(choices()[0].textContent).toContain('Send with prices');
        expect(choices()[1].textContent).toContain('Send without prices');
        fireEvent.change(to, { target: { value: 'orders@intown.example' } });
        fireEvent.keyDown(to, { key: 'Enter' });
        expect(onSend).toHaveBeenCalledWith('orders@intown.example', true);
    });

    it('keeps an address typed by hand when switching back', () => {
        setup();
        fireEvent.click(screen.getByRole('button', { name: /Fabricator/ }));
        fireEvent.change(screen.getByLabelText(/Send to/), { target: { value: 'typed@example.com' } });
        fireEvent.click(screen.getByRole('button', { name: /Home Owner/ }));
        expect((screen.getByLabelText(/Send to/) as HTMLInputElement).value).toBe('typed@example.com');
    });

    it('offers one Send button when no material has a price', () => {
        setup({ materials: 2, any: false, missing: 2 });
        fireEvent.click(screen.getByRole('button', { name: /Fabricator/ }));
        expect(choices()).toHaveLength(1);
        expect(choices()[0].textContent).toContain('Send email');
    });
});

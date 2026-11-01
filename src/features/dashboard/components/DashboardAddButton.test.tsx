// @vitest-environment jsdom
// The dashboard's round + opens as a speed dial (DashboardAddButton).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import DashboardAddButton from './DashboardAddButton';

afterEach(cleanup);

const plus = () => screen.getByRole('button', { name: /^Add: visit/ });
const menu = () => document.querySelector('.dab-menu') as HTMLElement;

describe('Dashboard + (speed dial)', () => {
    it('stays hidden until the + is pressed, then offers the actions nearest-first', () => {
        render(<DashboardAddButton onAddVisit={() => {}} onAddResource={() => {}} onScheduleActivity={() => {}} />);
        expect(plus().getAttribute('aria-expanded')).toBe('false');
        expect(menu().getAttribute('aria-hidden')).toBe('true');
        fireEvent.click(plus());
        expect(plus().getAttribute('aria-expanded')).toBe('true');
        expect(menu().getAttribute('aria-hidden')).toBe('false');
        const items = screen.getAllByRole('menuitem');
        expect(items.map((b) => b.textContent)).toEqual(['Add visit', 'Add resource', 'Schedule activity']);
        // --k is the distance from the +: the bottom one (Schedule activity) pops out first.
        expect(items.map((b) => b.style.getPropertyValue('--k'))).toEqual(['2', '1', '0']);
    });

    it('a pick runs it and closes; Esc and a tap on the dark page close without running anything', () => {
        const addVisit = vi.fn();
        render(<DashboardAddButton onAddVisit={addVisit} onAddResource={() => {}} />);
        fireEvent.click(plus());
        fireEvent.click(screen.getByRole('menuitem', { name: 'Add visit' }));
        expect(addVisit).toHaveBeenCalledTimes(1);
        expect(plus().getAttribute('aria-expanded')).toBe('false');

        fireEvent.click(plus());
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(plus().getAttribute('aria-expanded')).toBe('false');

        fireEvent.click(plus());
        fireEvent.click(document.querySelector('.dab-scrim') as HTMLElement);
        expect(plus().getAttribute('aria-expanded')).toBe('false');
        expect(addVisit).toHaveBeenCalledTimes(1);
    });

    it('leaves out what the login cannot do, and shows nothing with no actions', () => {
        const { container, rerender } = render(<DashboardAddButton onAddResource={() => {}} />);
        fireEvent.click(plus());
        expect(screen.getAllByRole('menuitem').map((b) => b.textContent)).toEqual(['Add resource']);
        rerender(<DashboardAddButton />);
        expect(container.innerHTML).toBe('');
    });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import WarrantyPage from './WarrantyPage';
afterEach(cleanup);

describe('Warranty resources', () => {
  it('opens the warranty and lets visitors switch to care information', () => {
    render(<MemoryRouter><WarrantyPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: /Residential 15\/Commercial 10 Year/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Care & Maintenance' }));
    expect(screen.getByRole('heading', { name: 'Moda Quartz Care & Maintenance Guidelines' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Download Warranty PDF' })).toBeNull();
  });
  it.each([
    ['care', 'Care & Maintenance'], ['policies', 'Customer Policies'], ['qc', 'Quality Control Standards']
  ])('opens the section linked by ?section=%s', (section, button) => {
    render(<MemoryRouter initialEntries={[`/warranty?section=${section}`]}><WarrantyPage /></MemoryRouter>);
    expect(screen.getByRole('button', { name: button }).classList.contains('active')).toBe(true);
    const link = screen.getByRole('link', { name: /Download/ });
    expect(link.hasAttribute('download')).toBe(true);
    expect(link.getAttribute('href')).toMatch(/\.pdf$/);
  });
  it('falls back to warranty for an unknown section', () => {
    render(<MemoryRouter initialEntries={['/warranty?section=unknown']}><WarrantyPage /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Download Warranty PDF' })).toBeTruthy();
  });
});

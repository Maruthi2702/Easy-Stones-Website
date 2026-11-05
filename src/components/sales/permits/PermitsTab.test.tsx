// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PermitsTab from './PermitsTab';

const api = vi.hoisted(() => ({ permitsMeta: vi.fn(), listPermits: vi.fn(), exportPermits: vi.fn(), refreshPermits: vi.fn() }));
vi.mock('../../../api/permits', () => api);
const meta = { sources: [], checks: [], cities: [], cityCounties: {}, canExport: false, canRefresh: false, running: false };
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  api.permitsMeta.mockResolvedValue(meta);
  api.listPermits.mockReset(); api.listPermits.mockResolvedValue({ items: [], counts: {}, total: 0 });
  api.refreshPermits.mockResolvedValue({ started: true });
});
afterEach(cleanup);

describe('Permits page', () => {
  it('loads metadata and the first list page', async () => {
    render(<PermitsTab />);
    await waitFor(() => expect(api.listPermits).toHaveBeenCalledWith(expect.objectContaining({ page: 1 })));
    expect(await screen.findByRole('heading', { name: /No permits/ })).toBeTruthy();
    expect(api.permitsMeta).toHaveBeenCalledTimes(1);
  });
  it('shows a fetch error and retries it', async () => {
    api.listPermits.mockRejectedValueOnce(new Error('Permits unavailable'));
    render(<PermitsTab />);
    expect((await screen.findByRole('alert')).textContent).toContain('Permits unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(api.listPermits).toHaveBeenCalledTimes(2);
  });
  it('restricts export and refresh to metadata grants', async () => {
    render(<PermitsTab />); await waitFor(() => expect(api.permitsMeta).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.queryByRole('menuitem', { name: 'Download as PDF' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Refresh now' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: /Detailed Checks/ })).toBeTruthy();
  });
  it('opens an export link carrying the current filters', async () => {
    api.permitsMeta.mockResolvedValue({ ...meta, canExport: true });
    render(<PermitsTab />); await screen.findByRole('heading', { name: /No permits/ });
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const pdf = screen.getByRole('menuitem', { name: 'Download as PDF' });
    expect(pdf.getAttribute('href')).toContain('/api/permits/');
    expect(pdf.getAttribute('href')).toContain('download');
    expect((screen.getByRole('menuitem', { name: 'Download as Excel' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('starts an authorized refresh and explains the background pull', async () => {
    api.permitsMeta.mockResolvedValue({ ...meta, canRefresh: true });
    render(<PermitsTab />); await screen.findByRole('heading', { name: /No permits/ });
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Refresh now' }));
    expect((await screen.findByRole('status')).textContent).toContain('Pulling now');
    expect(api.refreshPermits).toHaveBeenCalledTimes(1);
  });
  it('dismisses the menu with Escape', async () => {
    render(<PermitsTab />); await screen.findByRole('heading', { name: /No permits/ });
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('menu', { name: 'More' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: 'More' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'More' }));
  });
});

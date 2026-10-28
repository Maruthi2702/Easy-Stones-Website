// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useFuelQuery } from './useFuelQuery';
afterEach(cleanup);
it('clears a previous month while loading and after a failed new request', async () => {
  const read = vi.fn<(signal: AbortSignal) => Promise<number>>().mockResolvedValueOnce(5250).mockRejectedValueOnce(new Error('Connection unavailable'));
  const { result, rerender } = renderHook(({ month }) => useFuelQuery(month, read), { initialProps: { month: '2026-07' } });
  await waitFor(() => expect(result.current.data).toBe(5250));
  rerender({ month: '2026-08' }); expect(result.current.data).toBeNull(); expect(result.current.loading).toBe(true);
  await waitFor(() => expect(result.current.error).toBe('Connection unavailable')); expect(result.current.data).toBeNull();
});
it('ignores a late response from a superseded filter request', async () => {
  let finishOld!: (value: number) => void;
  const read = vi.fn<(signal: AbortSignal) => Promise<number>>().mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; })).mockResolvedValueOnce(8309105);
  const { result, rerender } = renderHook(({ month }) => useFuelQuery(month, read), { initialProps: { month: '2026-07' } });
  rerender({ month: '2026-08' }); await waitFor(() => expect(result.current.data).toBe(8309105));
  await act(async () => finishOld(8295379)); expect(result.current.data).toBe(8309105); expect(read.mock.calls[0]![0].aborted).toBe(true);
});

import { describe, expect, it, vi } from 'vitest';
import { answerOpenRequests } from './answerRequests';

const at = { lat: 47.6, lng: -122.3, accuracy: 12 };

describe('answering Locate now asks', () => {
  it('sends one position for every open ask and says who asked', async () => {
    const send = vi.fn().mockResolvedValue(true);
    const position = vi.fn().mockResolvedValue(at);
    const names = await answerOpenRequests({ load: async () => [{ id: 'a', requestedByName: 'Krish' }, { id: 'b', requestedByName: 'Ada' }], position, send, done: new Set() });
    expect(names).toEqual(['Krish', 'Ada']);
    expect(position).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('a', at);
    expect(send).toHaveBeenCalledWith('b', at);
  });
  it('never answers the same ask twice from this phone', async () => {
    const send = vi.fn().mockResolvedValue(true);
    const done = new Set<string>();
    const load = async () => [{ id: 'a', requestedByName: 'Krish' }];
    await answerOpenRequests({ load, position: async () => at, send, done });
    expect(await answerOpenRequests({ load, position: async () => at, send, done })).toEqual([]);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('does nothing — and takes no position — when there is nothing to answer', async () => {
    const position = vi.fn();
    expect(await answerOpenRequests({ load: async () => [], position, send: vi.fn(), done: new Set() })).toEqual([]);
    expect(position).not.toHaveBeenCalled();
  });
  it('leaves the ask open when there is no position or the send fails', async () => {
    const done = new Set<string>();
    const load = async () => [{ id: 'a', requestedByName: 'Krish' }];
    expect(await answerOpenRequests({ load, position: async () => null, send: vi.fn(), done })).toEqual([]);
    expect(await answerOpenRequests({ load, position: async () => at, send: async () => false, done })).toEqual([]);
    expect(await answerOpenRequests({ load, position: async () => { throw new Error('x'); }, send: vi.fn(), done })).toEqual([]);
    expect(done.size).toBe(0);
  });
  it('survives a failed load', async () => {
    expect(await answerOpenRequests({ load: async () => { throw new Error('offline'); }, position: async () => at, send: vi.fn(), done: new Set() })).toEqual([]);
  });
});

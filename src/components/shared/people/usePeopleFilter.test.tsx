// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import usePeopleFilter from './usePeopleFilter';
import type { PersonOption } from '../../../api/myTeam';

const options: PersonOption[] = [
    { value: 'me1', id: 'me1', label: 'Krish', location: 'Seattle', inactive: false },
    { value: 'j', id: 'j', label: 'Jesus', location: 'Seattle', inactive: false },
    { value: 'b', id: 'b', label: 'Bart', location: 'Kent', inactive: false }
];
afterEach(() => { cleanup(); sessionStorage.clear(); });

describe('usePeopleFilter', () => {
    it('opens on Me or My team and is only "active" away from that', () => {
        const me = renderHook(() => usePeopleFilter({ options, me: 'me1' })).result;
        expect(me.current.value).toEqual(['me1']);
        expect(me.current.active).toBe(false);
        const team = renderHook(() => usePeopleFilter({ options, me: 'me1', start: 'team' })).result;
        expect(team.current.value).toEqual([]);
        act(() => team.current.field.onToggle('b'));
        expect(team.current.value).toEqual(['me1', 'j']);
        expect(team.current.active).toBe(true);
        act(() => team.current.reset());
        expect(team.current.value).toEqual([]);
    });

    it('ticks and unticks a whole branch, and never ends empty', () => {
        const { result } = renderHook(() => usePeopleFilter({ options, me: 'me1' }));
        act(() => result.current.field.onBranch(['b'], true));
        expect(result.current.value).toEqual(['me1', 'b']);
        act(() => result.current.field.onBranch(['b', 'me1'], false));
        expect(result.current.value).toEqual(['me1']);
    });

    it('remembers a pick for the session and drops people the viewer can no longer see', () => {
        const first = renderHook(() => usePeopleFilter({ options, me: 'me1', storageKey: 'k.me1' }));
        act(() => first.result.current.setValue(['j', 'gone']));
        first.unmount();
        const again = renderHook(() => usePeopleFilter({ options, me: 'me1', storageKey: 'k.me1' }));
        expect(again.result.current.value).toEqual(['j']);
    });
});

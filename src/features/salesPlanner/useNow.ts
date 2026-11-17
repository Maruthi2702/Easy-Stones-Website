import { useSyncExternalStore } from 'react';

// One clock for every card: it ticks each minute, so a stop fades and the NOW line moves
// without a screen of timers.
let current = new Date();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
const tick = () => { current = new Date(); listeners.forEach((l) => l()); };
const subscribe = (listener: () => void) => {
    listeners.add(listener);
    if (!timer) timer = setInterval(tick, 60_000);
    return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && timer) { clearInterval(timer); timer = null; }
    };
};

// With nobody listening the clock isn't ticking, so a stale reading is replaced before it is used.
const snapshot = () => {
    if (listeners.size === 0 && Math.abs(Date.now() - current.getTime()) > 30_000) current = new Date();
    return current;
};

/** The current time, refreshed every minute. */
export default function useNow(): Date {
    return useSyncExternalStore(subscribe, snapshot, snapshot);
}

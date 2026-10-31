import { useEffect, useState } from 'react';
import { API_URL } from '../config/api';
import { authFetch } from './authFetch';
import { activeTypes } from '../utils/typeLists';

/*
 * The two admin-managed lists, Visit Types and Resource Types — the one source
 * behind every visit-type and resource-type dropdown, filter and rule. Both
 * live in the database (src/routes/typeLists.js); nothing in the app names a
 * type. Each is loaded once per page load and shared, and the admin screens'
 * saves replace it at once so the forms show a change without a reload.
 */

export type VisitFields = { notes: boolean; outcome: boolean; followUp: 'none' | 'optional' | 'always' };
export type ResourceFamily = 'tower' | 'tabletop' | 'binder' | 'samples' | 'other';

export type TypeRecord = {
    _id: string;
    /** What records store; never changes. */
    name: string;
    /** What staff read; can be renamed. */
    label: string;
    order: number;
    /** false = hidden from the Add dropdown. */
    active: boolean;
    system: boolean;
    fields?: VisitFields;
    family?: ResourceFamily;
};

export type TypeInput = { label?: string; active?: boolean; fields?: VisitFields; family?: ResourceFamily };

export type TypeListKind = 'visit' | 'resource';

const PATHS: Record<TypeListKind, string> = { visit: '/api/visit-types', resource: '/api/resource-types' };

type Store = {
    types: TypeRecord[];
    loaded: boolean;
    inflight: Promise<void> | null;
    listeners: Set<() => void>;
};

const stores: Record<TypeListKind, Store> = {
    visit: { types: [], loaded: false, inflight: null, listeners: new Set() },
    resource: { types: [], loaded: false, inflight: null, listeners: new Set() }
};

const publish = (kind: TypeListKind, types: TypeRecord[]) => {
    const s = stores[kind];
    s.types = [...types].sort((a, b) => a.order - b.order);
    s.loaded = true;
    s.listeners.forEach((fn) => fn());
};

const messageOf = async (res: Response, fallback: string) => {
    try {
        const data = await res.json();
        return data?.message || data?.error || fallback;
    } catch {
        return fallback;
    }
};

/** Fetch a list (once, unless force). */
export function loadTypes(kind: TypeListKind, { force = false }: { force?: boolean } = {}): Promise<void> {
    const s = stores[kind];
    if (s.inflight && !force) return s.inflight;
    if (s.loaded && !force) return Promise.resolve();
    // Named, then called: `run` is read inside, after it has been assigned.
    const load = async (): Promise<void> => {
        try {
            const res = await authFetch(`${API_URL}${PATHS[kind]}`);
            if (res.ok) {
                const data = await res.json();
                if (s.inflight === run) publish(kind, Array.isArray(data?.types) ? data.types : []);
            }
        } catch (err) {
            console.warn(`[${kind} types] could not load the list:`, err);
        } finally {
            if (s.inflight === run) s.inflight = null;
        }
    };
    const run: Promise<void> = load();
    s.inflight = run;
    return run;
}

/** Forget both lists (a logout): the next login loads its own. */
export function clearTypeLists(): void {
    (['visit', 'resource'] as TypeListKind[]).forEach((kind) => {
        const s = stores[kind];
        s.types = [];
        s.loaded = false;
        s.inflight = null;
        s.listeners.forEach((fn) => fn());
    });
}

async function send(kind: TypeListKind, path: string, method: string, body: unknown, fallback: string) {
    const res = await authFetch(`${API_URL}${PATHS[kind]}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (!res.ok) throw new Error(await messageOf(res, fallback));
    return res.json();
}

/** The admin screens' writes. Each throws with the reason to show; each updates the shared list. */
export const typeListApi = {
    async add(kind: TypeListKind, input: TypeInput): Promise<TypeRecord> {
        const { type } = await send(kind, '', 'POST', input, 'Could not add the type');
        publish(kind, [...stores[kind].types, type]);
        return type;
    },
    async update(kind: TypeListKind, id: string, input: TypeInput): Promise<TypeRecord> {
        const { type } = await send(kind, `/${id}`, 'PUT', input, 'Could not save the type');
        publish(kind, stores[kind].types.map((t) => (t._id === id ? type : t)));
        return type;
    },
    /** Saves the whole list in the order of `ids`; shows it at once and puts it back if the save fails. */
    async reorder(kind: TypeListKind, ids: string[]): Promise<void> {
        const before = stores[kind].types;
        const byId = new Map(before.map((t) => [t._id, t]));
        publish(kind, ids.map((id, order) => ({ ...(byId.get(id) as TypeRecord), order })));
        try {
            const { types } = await send(kind, '/reorder', 'PATCH', { ids }, 'Could not save the order');
            publish(kind, types);
        } catch (error) {
            publish(kind, before);
            throw error;
        }
    },
    async remove(kind: TypeListKind, id: string): Promise<void> {
        await send(kind, `/${id}`, 'DELETE', undefined, 'Could not delete the type');
        publish(kind, stores[kind].types.filter((t) => t._id !== id));
    }
};

export function useTypeList(kind: TypeListKind) {
    const [, setTick] = useState(0);
    useEffect(() => {
        const s = stores[kind];
        const fn = () => setTick((t) => t + 1);
        s.listeners.add(fn);
        if (!s.loaded && !s.inflight) loadTypes(kind);
        return () => { s.listeners.delete(fn); };
    }, [kind]);
    const s = stores[kind];
    return {
        /** Every type, hidden ones too, in the managers' order. */
        types: s.types,
        /** What the Add dropdown offers: active types in order. */
        active: activeTypes(s.types) as TypeRecord[],
        loaded: s.loaded,
        /** The record for a stored name, if it's in the list. */
        byName: (name: unknown) => s.types.find((t) => t.name === String(name ?? '')),
        refresh: () => loadTypes(kind, { force: true })
    };
}

export const useVisitTypes = () => useTypeList('visit');
export const useResourceTypes = () => useTypeList('resource');

/**
 * Dropdown options from a list: the active types in order, plus the value a
 * record already holds when it isn't among them (hidden, or from before the
 * list moved to the database), shown as stored.
 */
export function typeOptions(active: TypeRecord[], all: TypeRecord[], current: unknown) {
    const options = active.map((t) => ({ value: t.name, label: t.label }));
    const value = String(current ?? '');
    if (!value || options.some((o) => o.value === value)) return options;
    const known = all.find((t) => t.name === value);
    return [{ value, label: known?.label || value }, ...options];
}

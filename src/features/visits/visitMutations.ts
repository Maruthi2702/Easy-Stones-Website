import { newVisitId } from '../../utils/visitForm';

// Socket echoes can arrive before or after the response. This browser's save
// handler owns their refresh. Other browsers fetch under their own permissions.
const localMutations = new Set<string>();
const MAX_REMEMBERED = 200;

export function newVisitMutation(): string {
    const id = newVisitId();
    localMutations.add(id);
    if (localMutations.size > MAX_REMEMBERED) localMutations.delete(localMutations.values().next().value!);
    return id;
}

export const isLocalVisitMutation = (id: unknown): boolean => typeof id === 'string' && localMutations.has(id);

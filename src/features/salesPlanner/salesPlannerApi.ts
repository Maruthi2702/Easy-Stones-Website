import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import type { ActivitySave } from './salesPlanner';

/**
 * The planner's writes to /api/schedule (src/routes/schedule.ts). Reads go
 * through ./plannerSchedule, which caches them. Each call hands back the
 * response as it came; the callers read `ok` and the error body themselves.
 */

/** Add a stop (no id) or save the edit form over one. */
export const saveActivity = (id: string | null, form: ActivitySave) => authFetch(
    id !== null ? `${API_URL}/api/schedule/${id}` : `${API_URL}/api/schedule`,
    { method: id !== null ? 'PUT' : 'POST', body: JSON.stringify(form) }
);

/** A dragged stop's new start (and end, when it has one). */
export const moveActivity = (id: string, patch: { startTime: string; endTime?: string }) =>
    authFetch(`${API_URL}/api/schedule/${id}`, { method: 'PUT', body: JSON.stringify(patch) });

export const deleteActivity = (id: string) =>
    authFetch(`${API_URL}/api/schedule/${id}`, { method: 'DELETE' });

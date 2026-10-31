import { useEffect } from 'react';
import { io } from 'socket.io-client';
import { API_URL } from '../../config/api';
import { followCheckIns } from '../../api/checkInLive';
import { expireCacheKeys } from '../../utils/dataCache';
import { refreshCustomers } from '../../api/customerOptions';
import { cartActions } from '../holds';
import { clearInventoryCache } from '../../api/inventoryAnalysisCache';

/**
 * What the page does when the server says something changed. The handlers are
 * registered once, on mount, with the first render's functions — anything
 * that must read current state goes through a ref (`refreshCheckIns`,
 * `currentUserId`), as it always did.
 */
export type LiveUpdateHandlers = {
    /** The current filters' check-in fetch (a ref: the filters change). */
    refreshCheckInsRef: { current: () => void };
    /** After updates may have been missed: reload the log if it's on screen (a ref, like the above). */
    resyncCheckInsRef: { current: () => void };
    /** The signed-in user's id (a ref: it loads after the first render). */
    currentUserIdRef: { current: string | null };
    onCustomersChanged: () => void;
    onResourcesChanged: () => void;
    onLocationsChanged: () => void;
    onInventoryChanged: () => void;
    onMySchedulesChanged: () => void;
    /** Run once the socket is set up (the first loads). */
    onStart: () => void;
};

/**
 * The Sales page's one socket (MIGRATION_NOTES.md §4, step A7): check-ins
 * (scoped to the viewer's locations — the token is sent on every connect),
 * customers, resources, locations, slab locks, inventory imports and the
 * viewer's own calendar. Moved out of SalesPage unchanged (2026-10-24).
 */
export function useSalesLiveUpdates(handlers: LiveUpdateHandlers) {
    useEffect(() => {
        const { refreshCheckInsRef, resyncCheckInsRef, currentUserIdRef, onCustomersChanged, onResourcesChanged, onLocationsChanged, onInventoryChanged, onMySchedulesChanged, onStart } = handlers;
        const socket = io(API_URL || window.location.origin, {
            transports: ['websocket', 'polling'],
            withCredentials: true
        });

        // checkin_update is scoped to the viewer's own assigned location(s)
        // (mirrors join_delivery_rooms for delivery_update) rather than
        // broadcast to every connected socket. followCheckIns joins those
        // rooms on every connect (with a fresh token if the old one expired)
        // and reloads the log after a reconnect or the phone waking up.
        const stopFollowing = followCheckIns(socket, () => {
            expireCacheKeys('checkins_');
            resyncCheckInsRef.current();
        });

        // Through a ref: this handler is registered once, and calling
        // fetchCheckIns directly ran the first render's copy — its page,
        // search, month and branch — so a live update swapped the filtered
        // list for an unfiltered one while the filters still showed. Same
        // fix as the /checkin-log page.
        socket.on('checkin_update', () => {
            expireCacheKeys('checkins_');
            refreshCheckInsRef.current();
        });

        socket.on('customer_update', () => {
            onCustomersChanged();
            // Every customer dropdown, for a change made by anyone, anywhere.
            refreshCustomers();
        });

        socket.on('resource_update', () => {
            onResourcesChanged();
        });

        socket.on('location_update', () => {
            onLocationsChanged();
        });

        // Slabs held, released or carted by anyone (src/holds/router.ts):
        // the cart and any screen showing slab locks refresh.
        socket.on('slab_reservations_changed', (payload) => {
            cartActions.reservationsChanged(payload?.slabKeys || []);
        });

        // Fired by src/routes/inventoryAnalysis.js after a stock/sales import.
        // Without this, only the importer's own browser (via the modal's
        // onComplete callback) ever saw the new data — everyone else's open
        // Inventory Analysis tab stayed on the pre-import snapshot.
        socket.on('inventory_analysis_update', () => {
            // Forget remembered Inventory Analysis answers even while that tab
            // isn't open, so the next visit shows the new import, not the old.
            clearInventoryCache();
            onInventoryChanged();
        });

        // Keeps the Calendar tile honest when a stop is added from another
        // device or pulled in by the Google sync. The planner grid updates
        // itself through the schedule cache; this is only the count above it.
        socket.on('schedule_update', (payload) => {
            const mine = !payload?.userId
                || !currentUserIdRef.current
                || String(payload.userId) === String(currentUserIdRef.current);
            if (mine) onMySchedulesChanged();
        });

        onStart();

        return () => {
            stopFollowing();
            socket.disconnect();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- registered once; see LiveUpdateHandlers
    }, []);
}

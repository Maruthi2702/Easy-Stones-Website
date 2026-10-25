import { DELIVERY_PERMISSIONS } from '../utils/deliveryAccess.js';
import { CHECKIN_PERMISSIONS } from '../utils/checkInAccess.js';

// Room membership must enforce the same feature switch as its HTTP reads.
// Clear old rooms even on logout or a refused join; sequence async lookups so
// an older account's slow response cannot restore its rooms after a new join.
export function registerBranchRoomJoins(socket, { resolveStaff }) {
  for (const [event, prefix, permission] of [
    ['join_delivery_rooms', 'delivery-location:', DELIVERY_PERMISSIONS.VIEW],
    ['join_checkin_rooms', 'checkin-location:', CHECKIN_PERMISSIONS.VIEW_LOG]
  ]) {
    let generation = 0;
    socket.on(event, async (payload, ack) => {
      const current = ++generation;
      const reply = typeof ack === 'function' ? ack : () => {};
      for (const room of socket.rooms) if (room.startsWith(prefix)) socket.leave(room);
      try {
        const staff = await resolveStaff(payload?.token);
        if (current !== generation || !socket.connected || !staff?.permissions.includes(permission)) {
          return reply({ ok: false });
        }
        const locations = staff.assignedLocations || [];
        for (const location of locations.includes('*') ? ['*'] : locations) socket.join(`${prefix}${location}`);
        reply({ ok: true });
      } catch {
        reply({ ok: false });
      }
    });
  }
}

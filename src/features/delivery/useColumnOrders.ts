import { useEffect, useState } from 'react';
import { getDeliveryColumnOrders, subscribeDeliveryColumns } from '../../api/deliverySchedule';
import { canArrangeDeliveryColumns } from '../../utils/deliveryAccess';
import type { CurrentUser } from '../../types/records';
import type { ScheduleRole } from './types';

/** Each branch's saved driver-column order, kept current, and the Arrange Driver Columns form's open state. */
export function useColumnOrders({ role, currentUser, locationFilter }: { role: ScheduleRole; currentUser: CurrentUser | null; locationFilter: string }) {
  // Each branch's column order ({ Seattle: [ids] }; src/utils/deliveryColumns.ts).
  // Read once, and again whenever someone changes one anywhere. Arrange
  // Drivers View (Users & Roles → Delivery Schedule) sets the branch on screen
  // from Search & filters, below Location; the All Locations board always uses
  // the default order.
  const [columnOrders, setColumnOrders] = useState<Record<string, string[]>>({});
  const [arrangeOpen, setArrangeOpen] = useState(false);
  const canArrangeColumns = role !== 'driver' && canArrangeDeliveryColumns(currentUser);
  useEffect(() => {
    if (role === 'driver') return undefined;
    let alive = true;
    const load = () => getDeliveryColumnOrders().then((orders) => { if (alive) setColumnOrders(orders); });
    load();
    const unsubscribe = subscribeDeliveryColumns(load);
    return () => { alive = false; unsubscribe(); };
  }, [role]);
  const columnOrder = locationFilter ? (columnOrders[locationFilter] || null) : null;

  return { columnOrders, setColumnOrders, arrangeOpen, setArrangeOpen, canArrangeColumns, columnOrder };
}

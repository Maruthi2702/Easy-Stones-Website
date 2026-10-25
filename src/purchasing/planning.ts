import type { Policy, Receipt, Projection, DraftLine, Load } from './types.ts';
export const variantKey = (name: string) => name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
export function validDay(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export const shiftDay = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
export const inclusiveDays = (from: string, through: string) =>
  validDay(from) && validDay(through) && through >= from
    ? Math.round((Date.parse(through) - Date.parse(from)) / 86400000) + 1
    : 0;
export const todayPacific = (now: Date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
export const roundBuy = (need: number, multiple: number, minimum: number) =>
  need > 1e-8 ? Math.ceil((Math.max(need, minimum) - 1e-8) / multiple) * multiple : 0;

// A shipment fulfills its PO line; it is not another order. Parent totals must
// agree across shipment rows, and no quantity can be allocated twice.
export function normalizeInbound(rows: import('./types.ts').InboundRow[]): Receipt[] {
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = JSON.stringify([row.po, row.line]);
    groups.set(key, [...(groups.get(key) || []), row]);
  }
  const receipts: Receipt[] = [];
  for (const [key, group] of groups) {
    const parent = group[0];
    if (!parent) continue;
    const fields = [
      'product',
      'branch',
      'supplier',
      'ordered',
      'received',
      'cancelled',
      'eta',
      'confirmed',
    ] as const;
    if (group.some((row) => fields.some((field) => row[field] !== parent[field])))
      throw new Error(`PO ${parent.po}, line ${parent.line}: conflicting parent totals or identity`);
    if (parent.received + parent.cancelled > parent.ordered)
      throw new Error(`PO ${parent.po}, line ${parent.line}: received/cancelled exceeds ordered`);
    const shipments = new Set<string>();
    let pendingShipped = 0;
    let receivedShipped = 0;
    for (const row of group) {
      if (!row.shipment) {
        if (group.length > 1 || row.shipped || row.shipmentReceived)
          throw new Error(`PO ${parent.po}: a shipment ID is required for shipment rows`);
        continue;
      }
      if (shipments.has(row.shipment)) throw new Error(`PO ${parent.po}: duplicate shipment ${row.shipment}`);
      shipments.add(row.shipment);
      if (row.shipmentReceived > row.shipped)
        throw new Error(`Shipment ${row.shipment}: received exceeds shipped`);
      pendingShipped += row.shipped - row.shipmentReceived;
      receivedShipped += row.shipmentReceived;
      if (row.shipped > row.shipmentReceived)
        receipts.push({
          key: `${key}:${row.shipment}`,
          product: row.product,
          branch: row.branch,
          supplier: row.supplier,
          slabs: row.shipped - row.shipmentReceived,
          eta: row.shipmentEta,
          confirmed: row.confirmed,
        });
    }
    if (
      receivedShipped > parent.received ||
      pendingShipped > parent.ordered - parent.received - parent.cancelled
    )
      throw new Error(`PO ${parent.po}: shipment totals do not reconcile to remaining PO quantity`);
    const unshipped = parent.ordered - parent.received - parent.cancelled - pendingShipped;
    if (unshipped > 0)
      receipts.push({
        key: `${key}:unshipped`,
        product: parent.product,
        branch: parent.branch,
        supplier: parent.supplier,
        slabs: unshipped,
        eta: parent.eta,
        confirmed: parent.confirmed,
      });
  }
  return receipts;
}

export function project({
  daily,
  ready,
  receipts,
  policy,
  today,
  leadDays,
  reviewDays,
  bufferDays,
}: {
  daily: number;
  ready: number;
  receipts: Receipt[];
  policy: Policy;
  today: string;
  leadDays: number;
  reviewDays: number;
  bufferDays: number;
}): Projection {
  const horizon = leadDays + reviewDays;
  const through = shiftDay(today, horizon);
  const eligible = receipts.filter((r) => r.confirmed && validDay(r.eta) && r.eta >= today);
  const warnings = receipts
    .filter((r) => !r.confirmed || !validDay(r.eta) || r.eta < today)
    .map((r) => `${r.key}: unconfirmed, overdue or missing receipt ETA`);
  const inbound = eligible.filter((r) => r.eta <= through).reduce((n, r) => n + r.slabs, 0);
  const safety = daily * bufferDays,
    target = daily * horizon + safety;
  const rawNeed = Math.max(0, target - ready - inbound);
  const proposedSlabs =
    policy.active && daily > 0 ? roundBuy(rawNeed, policy.bundleSlabs, policy.minimumSlabs) : 0;
  let available = ready,
    stockoutOn: string | null = ready <= 0 && daily > 0 ? today : null;
  let bufferBreachOn: string | null = ready < safety && daily > 0 ? today : null;
  let maxGap = 0;
  const points = [{ day: today, available }];
  // Conservative end-of-day receipts: a receipt cannot cover that day's earlier
  // consumption without a receiving-time schedule.
  for (let day = 1; day <= horizon; day++) {
    const date = shiftDay(today, day);
    available -= daily;
    if (available < -1e-8 && !stockoutOn) stockoutOn = date;
    if (available < safety - 1e-8 && !bufferBreachOn) bufferBreachOn = date;
    if (day <= leadDays) maxGap = Math.max(maxGap, -available);
    available += eligible
      .filter((r) => r.eta === date || (day === 1 && r.eta === today))
      .reduce((n, r) => n + r.slabs, 0);
    points.push({ day: date, available: Math.round(available * 10000) / 10000 });
  }
  return {
    leadDays,
    daily,
    ready,
    inbound,
    target,
    safety,
    rawNeed,
    proposedSlabs,
    stockoutOn,
    bufferBreachOn,
    orderBy: bufferBreachOn ? shiftDay(bufferBreachOn, -leadDays) : null,
    regularArrival: shiftDay(today, leadDays),
    urgentSlabs: Math.min(proposedSlabs, Math.max(0, Math.ceil(Math.max(0, maxGap) - 1e-8))),
    bridgeShortfall: Math.max(0, Math.ceil(Math.max(0, maxGap) - 1e-8)),
    warnings,
    points,
  };
}

// Deterministic whole-bundle packing, not an optimal-packing claim. Each group
// has one supplier, destination and approved mix group. A blank mix group is
// deliberately single-color. Payload includes tare, with a separate layout cap.
export function packContainers(
  lines: DraftLine[],
  container: {
    payloadKg: number;
    tareKg: number;
    maxSlabs: number;
    layoutConfirmed: boolean;
    mixingConfirmed: boolean;
  },
): Load[] {
  if (!container.layoutConfirmed || container.payloadKg <= container.tareKg || container.maxSlabs < 1)
    throw new Error('Confirm container payload, tare and loading layout before drafting loads');
  if (lines.reduce((n, line) => n + line.quantity / line.bundleSlabs, 0) > 10000)
    throw new Error('Draft exceeds 10,000 bundles; split the order');
  const loads: Load[] = [];
  for (const line of [...lines].sort(
    (a, b) => (a.requiredOn || '9999').localeCompare(b.requiredOn || '9999') || a.key.localeCompare(b.key),
  )) {
    if (
      !line.supplier ||
      line.weightKg <= 0 ||
      line.bundleSlabs < 1 ||
      line.quantity % line.bundleSlabs !== 0
    )
      throw new Error(`${line.product}: supplier, weight and whole-bundle quantity are required`);
    if (
      line.bundleSlabs > container.maxSlabs ||
      line.weightKg * line.bundleSlabs + container.tareKg > container.payloadKg
    )
      throw new Error(`${line.product}: one bundle exceeds container capacity`);
    if (loads.length > 500) throw new Error('Too many container loads; narrow the draft');
    const mix = container.mixingConfirmed && line.mixGroup ? line.mixGroup : line.key;
    for (let remaining = line.quantity; remaining > 0; remaining -= line.bundleSlabs) {
      let load = loads.find(
        (l) =>
          l.supplier === line.supplier &&
          l.branch === line.branch &&
          l.mixGroup === mix &&
          l.slabs + line.bundleSlabs <= container.maxSlabs &&
          l.grossKg + line.weightKg * line.bundleSlabs <= container.payloadKg,
      );
      if (!load) {
        if (loads.length >= 500) throw new Error('Draft exceeds 500 loads');
        load = {
          supplier: line.supplier,
          branch: line.branch,
          mixGroup: mix,
          slabs: 0,
          cargoKg: 0,
          grossKg: container.tareKg,
          requiredOn: line.requiredOn,
          lines: [],
        };
        loads.push(load);
      }
      load.slabs += line.bundleSlabs;
      load.cargoKg += line.weightKg * line.bundleSlabs;
      load.grossKg = load.cargoKg + container.tareKg;
      const old = load.lines.find((l) => l.key === line.key);
      if (old) old.quantity += line.bundleSlabs;
      else load.lines.push({ ...line, quantity: line.bundleSlabs });
    }
  }
  return loads;
}

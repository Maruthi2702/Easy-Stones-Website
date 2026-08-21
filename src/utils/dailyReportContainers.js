/**
 * A container line with a blank PO# continues the container above it — one
 * PO can land with two or three different materials/colors on it, entered as
 * consecutive rows. Anything that counts containers, or checks a slab count
 * against what's typical for one, needs to group lines back into the
 * physical containers they represent first — counting or thresholding raw
 * lines double-counts a single container once per color, and makes an
 * ordinary split shipment's per-color line look like an anomaly on its own.
 */
export const groupContainers = (containers) => {
  const groups = [];
  for (const line of containers || []) {
    const startsNew = Boolean(line.poNumber && String(line.poNumber).trim());
    if (startsNew || groups.length === 0) {
      groups.push({ poNumber: line.poNumber || '', lines: [line] });
    } else {
      groups[groups.length - 1].lines.push(line);
    }
  }
  return groups;
};

export const groupSlabs = (group) =>
  group.lines.reduce((s, l) => s + (Number(l.slabs) || 0), 0);

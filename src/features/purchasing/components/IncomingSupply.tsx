import type { ImportedTransitLine } from '../../../purchasing/types';

export default function IncomingSupply({ lines = [] }: { lines?: ImportedTransitLine[] }) {
  if (!lines.length) return <span>—</span>;
  const known = lines.filter(line => line.slabs !== null);
  const slabs = known.reduce((sum, line) => sum + (line.slabs ?? 0), 0);
  const unknown = lines.length - known.length;
  const containers = new Set(lines.map(line => line.containerNumber).filter(Boolean));
  const etas = lines.map(line => line.eta).filter((date): date is string => !!date).sort();
  return <>
    <strong>{known.length ? `${slabs.toLocaleString()} slabs` : 'Slabs unknown'}</strong>
    {unknown > 0 && <small>{unknown} line{unknown === 1 ? '' : 's'} with unknown slab count</small>}
    <small>{containers.size} container{containers.size === 1 ? '' : 's'}{etas[0] ? ` · Next ETA ${etas[0]}` : ' · ETA unknown'}</small>
    <details>
      <summary>PO &amp; container details</summary>
      {lines.map(line => <p key={line.key}>
        <strong>PO #{line.poNumber || 'Unknown'} · {line.containerNumber || 'Container unknown'}</strong><br />
        {line.slabs === null ? 'Slabs unknown' : `${line.slabs} slabs`} · {line.quantity.toLocaleString()} {line.units} · {line.branch}<br />
        ETA {line.eta || 'unknown'} · {line.supplier || 'Supplier unknown'}
      </p>)}
    </details>
  </>;
}

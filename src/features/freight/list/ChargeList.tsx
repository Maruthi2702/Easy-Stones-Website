import { Loading } from '../parts/Loading';
import type { CarrierGroup } from '../freightView';
import type { Loose } from '../../../types/records';
import type { FreightCharge } from '../types';
import type { ChargeCells } from './chargeCells';
import ChargeTable from './ChargeTable';
import ChargeCards from './ChargeCards';

const EMPTY: Record<string, [string, string]> = {
  to_approve: ['Nothing waiting', 'Every charge is approved or paid. New ones appear here when a 3rd-party delivery is completed.'],
  approved: ['Nothing approved and unpaid', 'Approved charges wait here until they’re marked paid.'],
  paid: ['No payments yet', 'Paid charges show here, each with its payment ID.'],
  all: ['No charges', 'Charges appear when a 3rd-party delivery is completed, or when one is added by hand.']
};

/**
 * The list's card: a spinner on the first load, the empty state (the tab's
 * own words, or "No charges match" when a search or filter is on), or the
 * charges as a table and as phone cards.
 */
export default function ChargeList({ data, items, groups, loading, tab, filtered, showBranch, cells, onOpen }: {
  data: Loose | null; items: FreightCharge[]; groups: CarrierGroup[]; loading: boolean; tab: string;
  /** A search or a branch / carrier filter is on. */
  filtered: boolean;
  showBranch: boolean; cells: ChargeCells; onOpen: (id: string) => void;
}) {
  return (
    <div className={`fr-card${items.length ? ' has-cards' : ''}`}>
      {loading && !data ? <Loading /> : null}
      {data && !items.length ? (
        <div className="fr-empty"><h3>{filtered ? 'No charges match' : EMPTY[tab][0]}</h3>{filtered ? 'Try another search, branch or carrier.' : EMPTY[tab][1]}</div>
      ) : null}
      {items.length ? (
        <>
          <ChargeTable groups={groups} showBranch={showBranch} cells={cells} onOpen={onOpen} />
          <ChargeCards groups={groups} showBranch={showBranch} cells={cells} onOpen={onOpen} />
        </>
      ) : null}
    </div>
  );
}

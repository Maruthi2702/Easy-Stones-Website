import { formatMoney, usDate, type RepeatInfo } from '../../../utils/cardReceipts';

/**
 * What a "looks already saved" answer says (Add receipt, Add several): which receipt it is, and what "Update the saved one"
 * would do or why it isn't offered (owner, 2026-11-25: an approved receipt can't be updated). The buttons are the screen's.
 */
export default function RepeatLine({ repeat }: { repeat: RepeatInfo }) {
  return (
    <span>
      You already saved {repeat.merchant}, {formatMoney(repeat.cents)} on {usDate(repeat.date)}. Is this a second purchase?
      {repeat.canMerge
        ? <> If it’s the same one, update it: it takes this photo, total and category and keeps “{repeat.merchant}”.{repeat.clearsApprovals ? ' Its approvals start again.' : ''}</>
        : repeat.status === 'approved' ? ' It’s already approved, so it can’t be updated.' : null}
      {' '}
    </span>
  );
}

/**
 * Who approves a card receipt (owner, 2026-11-23; replaces the "approves receipts of" role lists and
 * the step-1-then-step-2 order). Shared by the server (src/routes/cardReceipts.ts, the reminder job
 * and routes) and the screens (src/features/cardReceipts/).
 *
 * Every receipt needs the **Accounting approval**; from $150.00 up it also needs a **second
 * approval**, given in parallel, by a different person:
 *
 *   Cardholder           Accounting approval           Second approval ($150+)
 *   staff (anyone else)  Accounting or an Admin        their branch's manager / director, or an Admin
 *   manager / director   Accounting or an Admin        an Admin
 *   accounting           another Accounting or Admin   an Admin
 *   admin                Accounting or another Admin   none
 *
 *   - An Admin may always stand in for Accounting (two Admins cover a $150+ receipt when Accounting is away).
 *     An Admin's approval fills the second approval when that is open and theirs to give, else the Accounting one.
 *   - Nobody approves their own receipt; the two approvals are always two different people.
 *   - **Ask** (Accounting or an Admin): a question to the cardholder's branch manager / director or an Admin
 *     (an Admin only, for a manager's, director's or accounting member's receipt). The person asked answers with
 *     a comment, which approves: it fills the second approval when that's open and theirs to give. Asking takes
 *     back an Accounting approval already given, so Accounting gives the final approval after the answer.
 *     While a question is open nobody else approves; Accounting or an Admin can withdraw it.
 *   - **Send back** (Accounting or an Admin, with a comment) clears both approvals and any question.
 *   - **Reopen** (Accounting or an Admin, with a reason) turns an approved receipt back to waiting, approvals cleared.
 *   - **An Admin's own charge** with no upload waits for Accounting (never "Missing receipt"): Accounting
 *     (or another Admin) fills in the category and approves it without a receipt.
 *
 * Roles are read by name here on purpose (owner: approval is the Accounting, Admin and branch-manager roles,
 * not anyone ticked); the Approve switch is still needed on top.
 */
import { can, CARD_RECEIPTS } from './cardReceipts.ts';

/** From $150.00 up (owner: "$150 or above") a receipt needs the second approval. */
export const SECOND_APPROVAL_CENTS = 15_000;
export const needsSecondApproval = (cents: number | null | undefined) => (cents ?? 0) >= SECOND_APPROVAL_CENTS;

const roleKey = (r: unknown) => String(r ?? '').trim().toLowerCase();
export const ACCOUNTING_ROLE = 'accounting';
export const ADMIN_ROLE = 'admin';
export const MANAGER_ROLES: readonly string[] = ['manager', 'director'];
export const isAccountingRole = (role: unknown) => roleKey(role) === ACCOUNTING_ROLE;
export const isAdminRole = (role: unknown) => roleKey(role) === ADMIN_ROLE;
export const isManagerRole = (role: unknown) => MANAGER_ROLES.includes(roleKey(role));
/** Accounting and Admins: the Accounting approval, Ask, Send back, Reopen. */
export const isAccountingSide = (role: unknown) => isAccountingRole(role) || isAdminRole(role);

export type HolderKind = 'staff' | 'manager' | 'accounting' | 'admin';
export const holderKindOf = (role: unknown): HolderKind =>
  isAdminRole(role) ? 'admin' : isAccountingRole(role) ? 'accounting' : isManagerRole(role) ? 'manager' : 'staff';

/** Which approval a decision gave. `accounting` / `admin` on the Accounting approval; `manager` / `admin` on the second. */
export type ApproverAs = 'accounting' | 'admin' | 'manager';
export type Decision = { by: string; byName: string; at: string | Date; comment: string; as?: ApproverAs | null };
/** A question Accounting sent (the clarification ask). Open while `answeredAt` is empty. */
export type Ask = {
  to: string; toName: string; by: string; byName: string; at: string | Date; question: string;
  answer: string; answeredAt: string | Date | null;
};

/** What the rules read off an expense (the stored record or the screen's view alike). */
export type ApprovalState = {
  userId: string;
  /** The cardholder's role now (the server reads it; the view sends it as `holderRole`). */
  holderRole: string | null | undefined;
  /** The cardholder's home branch saved on the expense. */
  location: string | null | undefined;
  cents: number;
  status: string;
  voided?: unknown;
  /** The Accounting approval (stored in the expense's `approval`). */
  approval: Decision | null | undefined;
  secondApproval: Decision | null | undefined;
  ask: Ask | null | undefined;
  /** Who typed it when it was added on the cardholder's behalf (2026-11-23): never one of its approvers either. */
  addedById?: string | null;
};

export type ApprovalViewer = {
  id: string;
  role?: string | null;
  permissions?: readonly string[] | null;
  location?: string | null;
  assignedLocations?: readonly string[] | null;
};

/**
 * A manager / director of the cardholder's branch: their home or assigned locations include it. An "all
 * locations" ('*') login is on no branch's team (src/utils/teamScope.ts), so '*' alone doesn't count.
 */
export function isBranchManagerOf(viewer: ApprovalViewer | null | undefined, branch: string | null | undefined) {
  if (!viewer || !isManagerRole(viewer.role)) return false;
  const want = String(branch ?? '').trim().toLowerCase();
  if (!want) return false;
  const mine = [viewer.location, ...(viewer.assignedLocations || [])]
    .map((l) => String(l ?? '').trim().toLowerCase()).filter((l) => l && l !== '*');
  return mine.includes(want);
}

/** The branch's managers / directors from a staff list (active ones, never the cardholder). */
export function branchManagersOf<T extends ApprovalViewer & { _id?: unknown; isActive?: boolean | null }>(
  staff: readonly T[], branch: string | null | undefined, holderId = ''
): T[] {
  return staff.filter((p) => p.isActive !== false && String(p._id ?? p.id) !== String(holderId) && isBranchManagerOf(p, branch));
}

export const askOpen = (s: Pick<ApprovalState, 'ask'>) => Boolean(s.ask && !s.ask.answeredAt);
const live = (s: ApprovalState) => s.status === 'waiting' && !s.voided;
/** The cardholder, or whoever added the receipt for them: neither approves, asks about, sends back or reopens it. */
const isHolder = (viewer: ApprovalViewer, s: ApprovalState) =>
  String(viewer.id) === String(s.userId) || (Boolean(s.addedById) && String(viewer.id) === String(s.addedById));
const approver = (viewer: ApprovalViewer | null | undefined) => Boolean(viewer && can(viewer, CARD_RECEIPTS.APPROVE));

export const secondNeeded = (s: Pick<ApprovalState, 'cents' | 'holderRole'>) =>
  needsSecondApproval(s.cents) && holderKindOf(s.holderRole) !== 'admin';

/** Who may give the second approval, ignoring whether it's open (also used to pick who an Ask may go to). */
function mayGiveSecond(viewer: ApprovalViewer, s: ApprovalState) {
  if (isAdminRole(viewer.role)) return true;
  return holderKindOf(s.holderRole) === 'staff' && isBranchManagerOf(viewer, s.location);
}

export type Slot = 'accounting' | 'second';

/** Whether `viewer` may fill this approval now (an open question blocks everyone but the person asked, who answers). */
export function canFill(slot: Slot, viewer: ApprovalViewer | null | undefined, s: ApprovalState): boolean {
  if (!viewer || !approver(viewer) || !live(s) || isHolder(viewer, s) || askOpen(s)) return false;
  const other = slot === 'accounting' ? s.secondApproval : s.approval;
  if (other && String(other.by) === String(viewer.id)) return false; // two different people
  if (slot === 'accounting') return !s.approval && isAccountingSide(viewer.role);
  return secondNeeded(s) && !s.secondApproval && mayGiveSecond(viewer, s);
}

/** Which approval an Approve from `viewer` fills: an Admin's goes to the second one first; null = can't approve. */
export function slotFor(viewer: ApprovalViewer | null | undefined, s: ApprovalState): Slot | null {
  if (!viewer) return null;
  if (isAdminRole(viewer.role)) {
    if (canFill('second', viewer, s)) return 'second';
    return canFill('accounting', viewer, s) ? 'accounting' : null;
  }
  if (canFill('accounting', viewer, s)) return 'accounting';
  return canFill('second', viewer, s) ? 'second' : null;
}

/** What `as` a decision in this slot records. */
export const approverAs = (slot: Slot, viewer: ApprovalViewer): ApproverAs =>
  isAdminRole(viewer.role) ? 'admin' : slot === 'accounting' ? 'accounting' : 'manager';

/** Every approval it needs is in and no question is open → Approved. */
export const fullyApproved = (s: ApprovalState) =>
  Boolean(s.approval) && (!secondNeeded(s) || Boolean(s.secondApproval)) && !askOpen(s);

/** Ask, Send back, Reopen and filling in an Admin's receipt: Accounting or an Admin, with Approve, never their own. */
const accountingActor = (viewer: ApprovalViewer | null | undefined, s: ApprovalState) =>
  Boolean(viewer && approver(viewer) && isAccountingSide(viewer.role) && !isHolder(viewer, s));

export const canSendBack = (viewer: ApprovalViewer | null | undefined, s: ApprovalState) => accountingActor(viewer, s) && live(s);
export const canAsk = (viewer: ApprovalViewer | null | undefined, s: ApprovalState) => accountingActor(viewer, s) && live(s) && !askOpen(s);
export const canWithdrawAsk = (viewer: ApprovalViewer | null | undefined, s: ApprovalState) => accountingActor(viewer, s) && live(s) && askOpen(s);
/** The person asked answers, and an answer approves, so they need the Approve switch like any approver. */
export const canAnswer = (viewer: ApprovalViewer | null | undefined, s: ApprovalState) =>
  Boolean(viewer && approver(viewer) && live(s) && askOpen(s) && String(s.ask!.to) === String(viewer.id) && !isHolder(viewer, s));
export const canReopen = (viewer: ApprovalViewer | null | undefined, s: ApprovalState) =>
  accountingActor(viewer, s) && s.status === 'approved' && !s.voided;
/** An Admin's own receipt: Accounting (or another Admin) picks its category, type, customer and note. */
export const canFillDetails = (viewer: ApprovalViewer | null | undefined, s: ApprovalState) =>
  accountingActor(viewer, s) && live(s) && holderKindOf(s.holderRole) === 'admin';

/**
 * Who a question may go to: for a staff member's receipt their branch's manager / director or an Admin; for
 * anyone else's an Admin. Never the cardholder or the person asking.
 */
export function mayBeAsked(person: ApprovalViewer, s: ApprovalState, askerId: string) {
  if (String(person.id) === String(s.userId) || (s.addedById && String(person.id) === String(s.addedById)) || String(person.id) === String(askerId)) return false;
  if (isAdminRole(person.role)) return true;
  return holderKindOf(s.holderRole) === 'staff' && isBranchManagerOf(person, s.location);
}

/** The slot an answer fills: the second approval when it's open and the person asked may give it, else none. */
export function slotForAnswer(viewer: ApprovalViewer, s: ApprovalState): Slot | null {
  if (!approver(viewer) || !secondNeeded(s) || s.secondApproval || !mayGiveSecond(viewer, s)) return null;
  if (s.approval && String(s.approval.by) === String(viewer.id)) return null;
  return 'second';
}

/** Why `viewer` has this receipt in Waiting for me, or null. */
export type WaitingReason = 'asked' | 'accounting' | 'second';
export function waitingReason(viewer: ApprovalViewer | null | undefined, s: ApprovalState): WaitingReason | null {
  if (!viewer || !live(s) || isHolder(viewer, s)) return null;
  if (canAnswer(viewer, s)) return 'asked';
  if (askOpen(s)) return null;
  if (canFill('accounting', viewer, s) && (isAccountingRole(viewer.role) || !canFill('second', viewer, s))) return 'accounting';
  if (canFill('second', viewer, s)) return 'second';
  return canFill('accounting', viewer, s) ? 'accounting' : null;
}

/** Who still has to act on a waiting receipt (for reminders and the chips). */
export function stillNeeded(s: ApprovalState): { accounting: boolean; second: boolean; askedId: string } {
  if (!live(s)) return { accounting: false, second: false, askedId: '' };
  if (askOpen(s)) return { accounting: false, second: false, askedId: String(s.ask!.to) };
  return { accounting: !s.approval, second: secondNeeded(s) && !s.secondApproval, askedId: '' };
}

/** The approvals a receipt shows as chips: "Accounting ✓ Maria" · "Manager or Admin — waiting". */
export function approvalChips(s: ApprovalState): { key: Slot; label: string; by: string; done: boolean }[] {
  const chips: { key: Slot; label: string; by: string; done: boolean }[] = [
    { key: 'accounting', label: 'Accounting', by: s.approval?.byName || '', done: Boolean(s.approval) }
  ];
  if (secondNeeded(s)) {
    chips.push({
      key: 'second', label: holderKindOf(s.holderRole) === 'staff' ? 'Manager or Admin' : 'Admin',
      by: s.secondApproval?.byName || '', done: Boolean(s.secondApproval)
    });
  }
  return chips;
}

/** Approving needs a comment for a lost receipt; an Admin's own receipt needs its category instead of a receipt. */
export function approveProblem(s: ApprovalState & { lostReason?: string; receiptUrl?: string; category?: string }, comment: string) {
  if (s.voided) return 'This expense was voided.';
  if (s.status !== 'waiting') return s.status === 'approved' ? 'It’s already approved.' : 'It isn’t waiting for approval.';
  if (askOpen(s)) return 'A question about this receipt is still open.';
  if (holderKindOf(s.holderRole) === 'admin') return s.category ? '' : 'Pick a category before approving.';
  if (s.lostReason && !s.receiptUrl && !comment.trim()) return 'A lost receipt needs your comment to approve it.';
  return '';
}

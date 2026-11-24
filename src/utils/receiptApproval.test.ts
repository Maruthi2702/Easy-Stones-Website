import { describe, it, expect } from 'vitest';
import { CARD_RECEIPTS } from './cardReceipts.ts';
import {
  needsSecondApproval, holderKindOf, isBranchManagerOf, branchManagersOf, canFill, slotFor, fullyApproved, canSendBack, canAsk,
  canWithdrawAsk, canAnswer, canReopen, canFillDetails, mayBeAsked, slotForAnswer, waitingReason, stillNeeded, approvalChips,
  approveProblem, approverAs, type ApprovalState, type ApprovalViewer
} from './receiptApproval.ts';

const A = [CARD_RECEIPTS.APPROVE];
const acct: ApprovalViewer = { id: 'acct', role: 'accounting', permissions: A };
const acct2: ApprovalViewer = { id: 'acct2', role: 'accounting', permissions: A };
const admin: ApprovalViewer = { id: 'adm', role: 'admin', permissions: A, assignedLocations: ['*'] };
const admin2: ApprovalViewer = { id: 'adm2', role: 'admin', permissions: A };
const seaMgr: ApprovalViewer = { id: 'mgr', role: 'manager', permissions: A, location: 'Seattle' };
const kentMgr: ApprovalViewer = { id: 'kmgr', role: 'manager', permissions: A, location: 'Kent' };
const seaDir: ApprovalViewer = { id: 'dir', role: 'director', permissions: A, assignedLocations: ['Kent', 'Seattle'] };
const allDir: ApprovalViewer = { id: 'alldir', role: 'director', permissions: A, assignedLocations: ['*'] };
const noSwitch: ApprovalViewer = { id: 'acct3', role: 'accounting', permissions: [] };

const at = '2026-11-23T10:00:00Z';
const exp = (over: Partial<ApprovalState> = {}): ApprovalState => ({
  userId: 'rep', holderRole: 'sales_rep', location: 'Seattle', cents: 4_000, status: 'waiting',
  approval: null, secondApproval: null, ask: null, ...over
});
const by = (v: ApprovalViewer, as: 'accounting' | 'admin' | 'manager' = 'accounting') => ({ by: v.id, byName: v.id, at, comment: '', as });

describe('the $150 line', () => {
  it('is $150.00 and above', () => {
    expect(needsSecondApproval(14_999)).toBe(false);
    expect(needsSecondApproval(15_000)).toBe(true);
    expect(needsSecondApproval(null)).toBe(false);
  });
});

describe('holders and branch managers', () => {
  it('sorts roles into the four kinds', () => {
    expect(holderKindOf('Admin')).toBe('admin');
    expect(holderKindOf('accounting')).toBe('accounting');
    expect(holderKindOf('director')).toBe('manager');
    expect(holderKindOf('sales_rep')).toBe('staff');
    expect(holderKindOf('')).toBe('staff');
  });
  it('a branch manager works at the cardholder’s branch; "all locations" alone does not count', () => {
    expect(isBranchManagerOf(seaMgr, 'Seattle')).toBe(true);
    expect(isBranchManagerOf(seaMgr, 'seattle ')).toBe(true);
    expect(isBranchManagerOf(kentMgr, 'Seattle')).toBe(false);
    expect(isBranchManagerOf(seaDir, 'Seattle')).toBe(true);
    expect(isBranchManagerOf(allDir, 'Seattle')).toBe(false);
    expect(isBranchManagerOf(acct, 'Seattle')).toBe(false);
    expect(isBranchManagerOf(seaMgr, '')).toBe(false);
  });
  it('lists the active managers of a branch, never the cardholder', () => {
    const staff = [{ _id: 'mgr', ...seaMgr }, { _id: 'old', ...seaMgr, id: 'old', isActive: false }, { _id: 'kmgr', ...kentMgr }, { _id: 'dir', ...seaDir }];
    expect(branchManagersOf(staff, 'Seattle').map((p) => p._id)).toEqual(['mgr', 'dir']);
    expect(branchManagersOf(staff, 'Seattle', 'dir').map((p) => p._id)).toEqual(['mgr']);
  });
});

describe('under $150', () => {
  it('Accounting alone approves a staff receipt', () => {
    const s = exp();
    expect(slotFor(acct, s)).toBe('accounting');
    expect(slotFor(seaMgr, s)).toBe(null);
    expect(fullyApproved({ ...s, approval: by(acct) })).toBe(true);
  });
  it('an Admin stands in for Accounting', () => {
    expect(slotFor(admin, exp())).toBe('accounting');
    expect(approverAs('accounting', admin)).toBe('admin');
  });
  it('needs the Approve switch and never your own', () => {
    expect(slotFor(noSwitch, exp())).toBe(null);
    expect(slotFor(acct, exp({ userId: 'acct', holderRole: 'accounting' }))).toBe(null);
    expect(slotFor(acct2, exp({ userId: 'acct', holderRole: 'accounting' }))).toBe('accounting');
  });
  it('nothing once it is not waiting', () => {
    expect(slotFor(acct, exp({ status: 'draft' }))).toBe(null);
    expect(slotFor(acct, exp({ voided: true }))).toBe(null);
  });
});

describe('$150 and above', () => {
  const big = exp({ cents: 20_000 });
  it('a staff receipt needs Accounting and the branch manager or an Admin, in either order', () => {
    expect(slotFor(acct, big)).toBe('accounting');
    expect(slotFor(seaMgr, big)).toBe('second');
    expect(slotFor(seaDir, big)).toBe('second');
    expect(slotFor(kentMgr, big)).toBe(null);
    expect(slotFor(admin, big)).toBe('second');
    expect(fullyApproved({ ...big, approval: by(acct) })).toBe(false);
    expect(fullyApproved({ ...big, approval: by(acct), secondApproval: by(seaMgr, 'manager') })).toBe(true);
    expect(fullyApproved({ ...big, secondApproval: by(seaMgr, 'manager') })).toBe(false);
  });
  it('two Admins cover it when Accounting is away, and never one person twice', () => {
    const after = { ...big, secondApproval: by(admin, 'admin') };
    expect(slotFor(admin, after)).toBe(null);
    expect(slotFor(admin2, after)).toBe('accounting');
    expect(canFill('accounting', admin, after)).toBe(false);
  });
  it('a manager’s or director’s receipt needs an Admin, not a branch manager', () => {
    const s = exp({ cents: 20_000, userId: 'kmgr', holderRole: 'manager' });
    expect(slotFor(seaDir, { ...s, location: 'Kent' })).toBe(null);
    expect(slotFor(admin, s)).toBe('second');
    expect(slotFor(acct, s)).toBe('accounting');
  });
  it('an accounting member’s receipt: another Accounting member or an Admin, plus an Admin', () => {
    const s = exp({ cents: 20_000, userId: 'acct', holderRole: 'accounting' });
    expect(slotFor(acct, s)).toBe(null);
    expect(slotFor(acct2, s)).toBe('accounting');
    expect(slotFor(admin, s)).toBe('second');
  });
  it('an Admin’s receipt needs Accounting only, at any amount', () => {
    const s = exp({ cents: 90_000, userId: 'adm', holderRole: 'admin' });
    expect(slotFor(acct, s)).toBe('accounting');
    expect(slotFor(admin2, s)).toBe('accounting');
    expect(slotFor(admin, s)).toBe(null);
    expect(fullyApproved({ ...s, approval: by(acct) })).toBe(true);
    expect(approvalChips(s)).toHaveLength(1);
  });
});

describe('asking for clarification', () => {
  const big = exp({ cents: 20_000 });
  const asked = { ...big, ask: { to: 'mgr', toName: 'Jo', by: 'acct', byName: 'Maria', at, question: 'What was this?', answer: '', answeredAt: null } };
  it('Accounting and Admins ask; managers do not', () => {
    expect(canAsk(acct, big)).toBe(true);
    expect(canAsk(admin, big)).toBe(true);
    expect(canAsk(seaMgr, big)).toBe(false);
    expect(canAsk(acct, asked)).toBe(false);
  });
  it('a staff receipt goes to its branch’s manager or an Admin; others to an Admin', () => {
    expect(mayBeAsked(seaMgr, big, 'acct')).toBe(true);
    expect(mayBeAsked(kentMgr, big, 'acct')).toBe(false);
    expect(mayBeAsked(admin, big, 'acct')).toBe(true);
    expect(mayBeAsked(acct2, big, 'acct')).toBe(false);
    const mgrs = exp({ userId: 'kmgr', holderRole: 'manager', location: 'Kent' });
    expect(mayBeAsked(seaDir, mgrs, 'acct')).toBe(false);
    expect(mayBeAsked(admin, mgrs, 'acct')).toBe(true);
    expect(mayBeAsked(admin, mgrs, 'adm')).toBe(false);
  });
  it('an open question stops every approval; only the person asked answers', () => {
    expect(slotFor(acct, asked)).toBe(null);
    expect(slotFor(admin, asked)).toBe(null);
    expect(canAnswer(seaMgr, asked)).toBe(true);
    expect(canAnswer(seaDir, asked)).toBe(false);
    expect(waitingReason(seaMgr, asked)).toBe('asked');
    expect(waitingReason(acct, asked)).toBe(null);
    expect(canWithdrawAsk(acct2, asked)).toBe(true);
    expect(stillNeeded(asked)).toEqual({ accounting: false, second: false, askedId: 'mgr' });
  });
  it('the answer fills the second approval when it is theirs to give', () => {
    expect(slotForAnswer(seaMgr, asked)).toBe('second');
    expect(slotForAnswer(seaMgr, { ...asked, cents: 4_000 })).toBe(null);
    expect(slotForAnswer(seaMgr, { ...asked, secondApproval: by(admin, 'admin') })).toBe(null);
  });
  it('blocks approving until it is answered', () => {
    expect(approveProblem(asked, '')).toMatch(/question/);
  });
});

describe('send back, reopen, an Admin’s receipt', () => {
  it('only Accounting and Admins send back or reopen', () => {
    expect(canSendBack(acct, exp())).toBe(true);
    expect(canSendBack(seaMgr, exp({ cents: 20_000 }))).toBe(false);
    const done = exp({ status: 'approved', approval: by(acct) });
    expect(canReopen(acct2, done)).toBe(true);
    expect(canReopen(seaMgr, done)).toBe(false);
    expect(canReopen(acct, exp())).toBe(false);
    expect(canReopen(acct, { ...done, voided: true })).toBe(false);
  });
  it('Accounting fills in an Admin’s receipt and approves it with no receipt, once it has a category', () => {
    const s = { ...exp({ userId: 'adm', holderRole: 'admin' }), receiptUrl: '', lostReason: '', category: '' };
    expect(canFillDetails(acct, s)).toBe(true);
    expect(canFillDetails(acct, exp())).toBe(false);
    expect(canFillDetails(admin, s)).toBe(false);
    expect(approveProblem(s, '')).toMatch(/category/);
    expect(approveProblem({ ...s, category: 'fuel' }, '')).toBe('');
  });
  it('a lost receipt still needs the approver’s comment', () => {
    const s = { ...exp(), lostReason: 'Lost it', receiptUrl: '' };
    expect(approveProblem(s, '')).toMatch(/comment/);
    expect(approveProblem(s, 'ok')).toBe('');
  });
});

describe('Waiting for me and the chips', () => {
  const big = exp({ cents: 20_000 });
  it('says why each person has it', () => {
    expect(waitingReason(acct, big)).toBe('accounting');
    expect(waitingReason(seaMgr, big)).toBe('second');
    expect(waitingReason(admin, big)).toBe('second');
    expect(waitingReason(admin, exp())).toBe('accounting');
    expect(waitingReason(kentMgr, big)).toBe(null);
    expect(waitingReason(acct, { ...big, approval: by(acct) })).toBe(null);
  });
  it('lists the approvals with who gave them', () => {
    expect(approvalChips({ ...big, approval: by(acct) })).toEqual([
      { key: 'accounting', label: 'Accounting', by: 'acct', done: true },
      { key: 'second', label: 'Manager or Admin', by: '', done: false }
    ]);
    expect(stillNeeded({ ...big, approval: by(acct) })).toEqual({ accounting: false, second: true, askedId: '' });
  });
});

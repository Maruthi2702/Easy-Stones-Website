import { useState } from 'react';
import type { ReactNode } from 'react';
import { Lock, Plus } from 'lucide-react';
import useIsPhone from '../../components/shared/form/useIsPhone';
import { FormSheet } from '../../components/shared/form/FormControls';
import { PAYMENTS, formatMoney, methodOf, paymentTotals } from '../../utils/paymentsReceived';
import { usePaymentsData } from './usePaymentsData';
import { NO_FILTERS, dayLabel, visiblePayments, type PaymentFilters } from './paymentsView';
import PaymentsHeader from './components/PaymentsHeader';
import PaymentTiles from './components/PaymentTiles';
import PaymentList from './components/PaymentList';
import PaymentForm from './components/PaymentForm';
import VoidPaymentForm from './components/VoidPaymentForm';
import type { Payment, PaymentsUser } from './types';
import './Payments.css';

export type PaymentsPageProps = { currentUser: PaymentsUser | null; sidebarToggle?: ReactNode };

type Open = { kind: 'add' } | { kind: 'edit'; payment: Payment } | { kind: 'void'; payment: Payment } | null;

/**
 * Operations → Payments (2026-11-02): every payment a branch takes, one entry
 * each, by day. Design and the owner's calls: the claude.ai artifact
 * **Payments page prototype** (https://claude.ai/artifact/4zkVgFWTfDFdtLdfVJjjQh).
 * A submitted Daily Report day is locked here too. The report keeps its own
 * typed grid until the owner confirms the switch-over; it shows this page's
 * total beside it meanwhile.
 */
export default function PaymentsPage({ currentUser, sidebarToggle = null }: PaymentsPageProps) {
  const isPhone = useIsPhone();
  const data = usePaymentsData(currentUser);
  const [filters, setFilters] = useState<PaymentFilters>(NO_FILTERS);
  const [open, setOpen] = useState<Open>(null);
  const [statsOpen, setStatsOpen] = useState(false);
  const [toast, setToast] = useState('');

  const perms = currentUser?.permissions || [];
  const locked = data.day.submitted;
  const canAdd = perms.includes(PAYMENTS.ADD) && !locked;
  const canEdit = perms.includes(PAYMENTS.EDIT) && !locked;
  const canVoid = perms.includes(PAYMENTS.VOID) && !locked;

  const totals = paymentTotals(data.payments);
  const { base, rows, shown } = visiblePayments(data.payments, filters);
  const voidedCount = data.payments.filter((p) => p.voided).length;
  const shownLabel = filters.method === 'all' ? 'All methods' : methodOf(filters.method)?.short || filters.method;

  const say = (text: string) => { setToast(text); window.setTimeout(() => setToast(''), 2600); };
  const patchFilters = (patch: Partial<PaymentFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const pickMethod = (method: string) => { patchFilters({ method }); setStatsOpen(false); };

  const lockedBy = data.day.autoSubmitted ? 'the 11:59 PM auto-submit' : data.day.submittedBy || 'someone';
  const lockedAt = data.day.submittedAt ? new Date(data.day.submittedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';

  return (
    <div className="pay">
      <div className="pay-page">
        <PaymentsHeader
          sidebarToggle={sidebarToggle}
          user={currentUser}
          locations={data.locations}
          location={data.location}
          onLocation={data.setLocation}
          date={data.date}
          today={data.today}
          onDate={data.setDate}
          locked={locked}
          filters={filters}
          onFilters={patchFilters}
          voidedCount={voidedCount}
          searchCount={filters.search ? `${rows.length} of ${base.length}` : null}
          isPhone={isPhone}
          onStats={() => setStatsOpen(true)}
        />

        {locked ? (
          <div className="pay-note is-lock" role="status">
            <Lock size={15} aria-hidden="true" />
            <span>
              <strong>{data.location}’s Daily Report for {dayLabel(data.date)} was submitted by {lockedBy}{lockedAt ? ` at ${lockedAt}` : ''}.</strong>
              {' '}Payments for this day are locked. Reopen the report to change them.
            </span>
          </div>
        ) : null}
        {data.error ? <div className="pay-note is-error" role="alert">{data.error}</div> : null}

        {!isPhone ? <PaymentTiles totals={totals} method={filters.method} onMethod={pickMethod} /> : null}

        <div className={`pay-card-box${data.loading ? ' is-loading' : ''}`} aria-busy={data.loading}>
          {rows.length ? (
            <PaymentList
              rows={rows}
              isPhone={isPhone}
              shownLabel={filters.search ? `${shownLabel} matching “${filters.search.trim()}”` : shownLabel}
              shownCents={shown.net}
              shownCount={shown.count}
              canEdit={canEdit}
              canVoid={canVoid}
              onEdit={(payment) => setOpen({ kind: 'edit', payment })}
              onVoid={(payment) => setOpen({ kind: 'void', payment })}
            />
          ) : (
            <div className="pay-empty">
              {data.loading ? <span>Loading…</span> : base.length || data.payments.length ? (
                <><h3>No payments match</h3><span>Clear the search or the filters.</span></>
              ) : (
                <>
                  <h3>No payments recorded for {dayLabel(data.date)}</h3>
                  {canAdd ? <button type="button" className="pay-btn gold" onClick={() => setOpen({ kind: 'add' })}><Plus size={16} aria-hidden="true" /> Add payment</button> : null}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {perms.includes(PAYMENTS.ADD) ? (
        <button type="button" className="pay-fab" onClick={() => setOpen({ kind: 'add' })} disabled={!canAdd || !data.location}
          aria-label="Add payment" title={locked ? 'This day is submitted. Reopen it to add a payment' : 'Add payment'}>
          <Plus size={24} strokeWidth={2.4} aria-hidden="true" />
        </button>
      ) : null}

      {isPhone ? (
        <FormSheet open={statsOpen} title={`Totals · ${dayLabel(data.date)}`} onClose={() => setStatsOpen(false)}>
          <PaymentTiles totals={totals} method={filters.method} onMethod={pickMethod} />
        </FormSheet>
      ) : null}

      {open?.kind === 'add' || open?.kind === 'edit' ? (
        <PaymentForm
          location={data.location}
          date={data.date}
          today={data.today}
          payment={open.kind === 'edit' ? open.payment : null}
          onClose={() => setOpen(null)}
          onVoid={open.kind === 'edit' && canVoid ? () => setOpen({ kind: 'void', payment: open.payment }) : undefined}
          onSave={async (values) => {
            const saved = open.kind === 'edit' ? await data.edit(open.payment.id, values) : await data.add(values);
            setOpen(null);
            const where = saved.date !== data.date ? ` to ${dayLabel(saved.date)}` : '';
            say(open.kind === 'edit' ? `Payment updated${where}` : saved.cents < 0 ? `Return saved as ${formatMoney(saved.cents)}${where}` : `Payment saved${where}`);
          }}
        />
      ) : null}

      {open?.kind === 'void' ? (
        <VoidPaymentForm
          payment={open.payment}
          onClose={() => setOpen(null)}
          onVoid={async (reason) => { await data.voidOne(open.payment.id, reason); setOpen(null); say('Payment voided'); }}
        />
      ) : null}

      {toast ? <div className="pay-toast" role="status">{toast}</div> : null}
    </div>
  );
}

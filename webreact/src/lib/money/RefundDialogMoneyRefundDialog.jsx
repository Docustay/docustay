// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R6.023.M1 — RefundDialog › RefundDialogMoneyRefundDialog
// The modal form for refunding a payment, with reason selection and session credit return option.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import DecisionModal from "@/lib/forms/DecisionModal.jsx";
import { SheetSection } from "@/lib/components/kit/SheetRow.jsx";

export default function RefundDialogMoneyRefundDialog({
  open,
  onOpenChange,
  REFUND_REASONS,
  paymentData,
  busySending,
  error,
  approvalSent,
  chargesOff,
  refundAmount,
  selectedReason,
  returnCredit,
  costSentence,
  isFullRefund,
  handleRefund,
  handleCancel,
  onIsFullRefundChange,
  onSelectedReasonChange,
  onReturnCreditChange,
}) {
  const displayAmount = (refundAmount / 100).toFixed(2);

  return (
    <DecisionModal
      open={open}
      onOpenChange={onOpenChange}
      title={`Refund ${paymentData?.payerDisplayName || 'Customer'} $${displayAmount}`}
      subtitle={`Paid on ${paymentData?.createdAtDate} by ${paymentData?.paymentMethod}, for a session on the ${paymentData?.sessionDate}.`}
      cancelLabel="Cancel"
      confirmLabel={`Refund $${displayAmount}`}
      danger={true}
      busy={busySending}
      error={error || (approvalSent ? "Sent to the maintainer to approve — refunds are an Owner's decision." : "") || (chargesOff ? "Refunds can't go out while charges are switched off. Nothing changed." : "")}
      onCancel={handleCancel}
      onConfirm={handleRefund}
      testId="money-refund-dialog"
    >
      <SheetSection>
        <div className="flex items-start gap-5 py-2.5">
          <label className="w-32 shrink-0 pt-2.5 text-sm text-ink-2">How much</label>
          <div className="min-w-0 flex-1">
            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => onIsFullRefundChange?.(true)}
                className={`flex flex-1 items-center justify-between gap-2 rounded-button border px-3 py-2.5 text-sm font-medium transition-all ${
                  isFullRefund
                    ? "border-brand bg-brand-soft text-brand"
                    : "border-line bg-white text-ink-2 hover:border-brand-soft"
                }`}
              >
                <span className="flex-1 text-left">${displayAmount}</span>
                <span className="text-xs text-mute">▼</span>
              </button>
              <button
                type="button"
                onClick={() => onIsFullRefundChange?.(false)}
                className={`flex flex-1 items-center justify-between gap-2 rounded-button border px-3 py-2.5 text-sm font-medium transition-all ${
                  !isFullRefund
                    ? "border-brand bg-brand-soft text-brand"
                    : "border-line bg-white text-ink-2 hover:border-brand-soft"
                }`}
              >
                <span className="flex-1 text-left">All of it</span>
                <span className="text-xs text-mute">▼</span>
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-start gap-5 py-2.5">
          <label className="w-32 shrink-0 pt-2.5 text-sm text-ink-2">Why</label>
          <div className="min-w-0 flex-1">
            <select
              value={selectedReason}
              onChange={(e) => onSelectedReasonChange?.(e.target.value)}
              disabled={busySending}
              className="w-full min-h-10 rounded-button border border-line bg-white px-3 py-2.5 text-sm font-medium text-ink-2 focus:border-brand focus:outline-none"
            >
              {REFUND_REASONS?.map((reason) => (
                <option key={reason} value={reason}>
                  {reason}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-mute">She sees this on the receipt.</p>
          </div>
        </div>

        {paymentData?.entitlementCreditId && (
          <div className="flex items-start gap-3 py-2.5">
            <input
              type="checkbox"
              checked={returnCredit}
              onChange={(e) => onReturnCreditChange?.(e.target.checked)}
              disabled={busySending}
              className="mt-1 h-5 w-5 shrink-0 cursor-pointer rounded border-line accent-accent"
              id="return-credit"
            />
            <label htmlFor="return-credit" className="flex-1 text-sm text-ink-2">
              Give the session back to her block
              <span className="mt-1 block text-xs text-mute">
                Otherwise she's had the money back and lost the session, which is almost certainly not what you meant.
              </span>
            </label>
          </div>
        )}

        {costSentence && (
          <div className="mt-3 rounded-button bg-warn-soft px-4 py-3 text-xs text-warn leading-relaxed">
            <strong>This can't be undone.</strong> {costSentence}
          </div>
        )}
      </SheetSection>
    </DecisionModal>
  );
}

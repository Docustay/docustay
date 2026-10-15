// ═══════════════════════════════════════════════════════════════════════════════════════════════
// StopSubscriptionModalMoneyStopSubscriptionModal — the DecisionModal element rendered by
// StopSubscriptionModal, extracted to its own component per R6.027.M1.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import DecisionModal from "@/lib/forms/DecisionModal.jsx";

export default function StopSubscriptionModalMoneyStopSubscriptionModal({
  open,
  onOpenChange,
  subscription,
  onConfirm,
  busy,
  error,
  selectedMode,
  handleConfirm,
  handleCancel,
  options,
  confirmButtonLabel,
  formatDate,
  formatMoney,
  onSelect,
}) {
  return (
    <DecisionModal
      open={open}
      onOpenChange={onOpenChange}
      title={`Stop ${subscription?.payerName}'s ${subscription?.planName}?`}
      subtitle={`${formatMoney(subscription?.currentAmountMinor)} a month, running since ${formatDate(subscription?.createdAt)}. He's paid up to ${formatDate(subscription?.currentPeriodEnd)}.`}
      options={options}
      selected={selectedMode}
      onSelect={onSelect}
      cancelLabel="Leave it running"
      confirmLabel={confirmButtonLabel}
      onCancel={handleCancel}
      onConfirm={handleConfirm}
      busy={busy}
      error={error}
      testId="money-stop-subscription-modal"
    >
      <div className="rounded-sm bg-brand-soft px-3.75 py-3 text-meta text-ink-2">
        <b className="font-medium">Either way.</b> His booked sessions stay booked. Cancel those separately if that's what you mean.
      </div>
    </DecisionModal>
  );
}

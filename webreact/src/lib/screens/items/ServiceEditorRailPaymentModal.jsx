import DecisionModal from "@/lib/forms/DecisionModal.jsx";
import DisabledWithReason from "@/lib/forms/DisabledWithReason.jsx";

export default function ServiceEditorRailPaymentModal({
  open,
  onOpenChange,
  testId,
  item,
  stripeLive,
  PAYMENT_OPTIONS,
  selectedMode,
  paymentBusy,
  paymentError,
  handleConfirmPaymentPolicy,
}) {

  return (
    <DecisionModal
      open={open}
      onOpenChange={onOpenChange}
      title={`What has to happen before someone books ${item.name || "this service"}?`}
      subtitle="This is real for this service only — it doesn't change your practice default."
      cancelLabel="Cancel"
      confirmLabel="Save"
      onCancel={() => onOpenChange(false)}
      onConfirm={handleConfirmPaymentPolicy}
      busy={paymentBusy}
      error={paymentError}
      testId={testId}
    >
      <div className="flex flex-col gap-3">
        <DisabledWithReason
          disabled={!stripeLive}
          reason="Connect Stripe to require payment"
          testId={`${testId}-mode-deposit`}
        >
          {({ describedBy }) => (
            <div className="flex flex-col gap-1 rounded-control border border-line bg-surface p-3" aria-describedby={describedBy}>
              <b className="text-ui text-ink">A deposit</b>
              <span className="text-meta text-mute">Part of the price taken at booking, the rest on the day.</span>
            </div>
          )}
        </DisabledWithReason>
        <DisabledWithReason
          disabled={!stripeLive}
          reason="Connect Stripe to require payment"
          testId={`${testId}-mode-payinfull`}
        >
          {({ describedBy }) => (
            <div className="flex flex-col gap-1 rounded-control border border-line bg-surface p-3" aria-describedby={describedBy}>
              <b className="text-ui text-ink">Paid in full</b>
              <span className="text-meta text-mute">The whole thing up front. Common for packages, rare for single sessions.</span>
            </div>
          )}
        </DisabledWithReason>
      </div>
    </DecisionModal>
  );
}

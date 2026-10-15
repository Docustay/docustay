// ═══════════════════════════════════════════════════════════════════════════════════════════════
// DisputeDetailAcceptTheDisputeModal — the modal for accepting a dispute.
// Ported from webui/src/lib/screens/money/DisputeDetail.svelte:312-326 (the DecisionModal element);
// shown when bind:open=showAcceptModal.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import DecisionModal from "@/lib/forms/DecisionModal.jsx";

export default function DisputeDetailAcceptTheDisputeModal({
  open = false,
  onOpenChange,
  dispute,
  showAcceptModal,
  busySending = false,
  handleAccept,
}) {
  if (!dispute) return null;

  return (
    <DecisionModal
      open={open}
      onOpenChange={onOpenChange}
      title="Accept the dispute"
      subtitle={`You'll lose $${(dispute.amountMinor / 100).toFixed(2)} and this settles it immediately.`}
      confirmLabel="Accept, we're done"
      cancelLabel="Wait, no"
      danger={true}
      busy={busySending}
      onConfirm={handleAccept}
      onCancel={() => onOpenChange(false)}
    >
      <div className="py-3">
        <p className="m-0 text-sm leading-relaxed">You lose $${(dispute.amountMinor / 100).toFixed(2)}.</p>
      </div>
    </DecisionModal>
  );
}

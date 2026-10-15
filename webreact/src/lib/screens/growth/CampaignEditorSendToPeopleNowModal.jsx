// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R7.021.M1 — CampaignEditorSendToPeopleNowModal.jsx
// The modal at webui/src/lib/screens/growth/CampaignEditor.svelte:607-616 becomes a separate component
// Props: { open, onOpenChange, showDecisionModal, handleSend, audienceCount }
// Uses: DecisionModal
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import DecisionModal from "@/lib/forms/DecisionModal.jsx";

export default function CampaignEditorSendToPeopleNowModal({
  open = false,
  onOpenChange = null,
  showDecisionModal = false,
  handleSend = null,
  audienceCount = 0,
}) {
  return (
    <DecisionModal
      open={open}
      onOpenChange={onOpenChange}
      title={`Send to ${audienceCount} people now?`}
      subtitle="This cannot be taken back."
      rows={[]}
      confirmLabel="Send it"
      cancelLabel="Hold on"
      onConfirm={handleSend}
      onCancel={() => onOpenChange?.(false)}
    />
  );
}

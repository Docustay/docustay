// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R7.021.M2 — CampaignEditorModal2Modal.jsx
// The DiscardGuard at webui/src/lib/screens/growth/CampaignEditor.svelte:618-620 becomes a separate component
// Props: { open, onOpenChange, onNavigate, showDiscardGuard }
// Uses: DiscardGuard
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import DiscardGuard from "@/lib/components/editor/DiscardGuard.jsx";

export default function CampaignEditorModal2Modal({
  open = false,
  onOpenChange = null,
  onNavigate = null,
  showDiscardGuard = false,
}) {
  return (
    <DiscardGuard
      open={open}
      onOpenChange={onOpenChange}
      objectNoun="campaign"
      onDiscard={() => onNavigate?.("/run/campaigns")}
    />
  );
}

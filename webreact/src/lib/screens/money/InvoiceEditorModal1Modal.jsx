// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R6.035.M1 — InvoiceEditorModal1Modal.jsx
// Renders the discard confirmation modal from InvoiceEditor.svelte:741-745
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import DiscardGuard from "@/lib/components/editor/DiscardGuard.jsx";

export default function InvoiceEditorModal1Modal({
  open = false,
  onOpenChange = null,
  invoice = null,
  showDiscardGuard = false,
  handleClose = null,
}) {
  return (
    <DiscardGuard
      open={showDiscardGuard}
      onOpenChange={onOpenChange}
      objectNoun="invoice"
      onKeepEditing={() => onOpenChange?.(false)}
      onDiscard={handleClose}
      testId="invoice-editor-discard-guard"
    />
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ModalAttachAgreementModal3Modal — the modal shown when template loading fails
// Ported from webui/src/lib/screens/items/ModalAttachAgreement.svelte:165-176 (the error state)
// Built on Dialog; uses ErrorPanel
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import {
  Dialog, DialogContent,
} from "@/lib/components/ui/dialog.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";
import { useBindableOpen } from "@/lib/hooks/useBindableOpen.js";

export default function ModalAttachAgreementModal3Modal({
  open = false,
  onOpenChange,
  testId = "modal-attach-agreement",
  loadError = null,
  loadAll = null,
}) {
  const [isOpen, setOpen] = useBindableOpen(open, onOpenChange);

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      <DialogContent data-testid={`${testId}-load-error`} className="w-(--size-modal) max-w-[calc(100vw-2rem)] sm:max-w-none gap-0 rounded-modal p-0 shadow-modal">
        <ErrorPanel
          subject="Contract templates"
          error={loadError}
          variant="band"
          onRetry={loadAll}
          testId={`${testId}-load-error-panel`}
        />
      </DialogContent>
    </Dialog>
  );
}

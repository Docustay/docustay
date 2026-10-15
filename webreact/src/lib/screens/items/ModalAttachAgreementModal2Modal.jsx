// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ModalAttachAgreementModal2Modal — the modal shown when user lacks permission
// Ported from webui/src/lib/screens/items/ModalAttachAgreement.svelte:154-164 (the denied state)
// Built on Dialog; uses ErrorPanel
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import {
  Dialog, DialogContent,
} from "@/lib/components/ui/dialog.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";
import { useBindableOpen } from "@/lib/hooks/useBindableOpen.js";

export default function ModalAttachAgreementModal2Modal({
  open = false,
  onOpenChange,
  testId = "modal-attach-agreement",
}) {
  const [isOpen, setOpen] = useBindableOpen(open, onOpenChange);

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      <DialogContent data-testid={`${testId}-denied`} className="w-(--size-modal) max-w-[calc(100vw-2rem)] sm:max-w-none gap-0 rounded-modal p-0 shadow-modal">
        <ErrorPanel
          subject="Documents"
          error={{ message: "You don't have permission to attach an agreement." }}
          variant="band"
          testId={`${testId}-denied-panel`}
        />
      </DialogContent>
    </Dialog>
  );
}

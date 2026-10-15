// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ModalAttachAgreementModal1Modal — the modal shown while loading templates
// Ported from webui/src/lib/screens/items/ModalAttachAgreement.svelte:145-153 (the loading state)
// Built on Dialog; uses Spinner
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import {
  Dialog, DialogContent,
} from "@/lib/components/ui/dialog.jsx";
import { Spinner } from "@/lib/components/ui/spinner.jsx";
import { useBindableOpen } from "@/lib/hooks/useBindableOpen.js";

export default function ModalAttachAgreementModal1Modal({
  open = false,
  onOpenChange,
  testId = "modal-attach-agreement",
}) {
  const [isOpen, setOpen] = useBindableOpen(open, onOpenChange);

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      <DialogContent data-testid={`${testId}-loading`} showCloseButton={false} className="w-(--size-modal) max-w-[calc(100vw-2rem)] sm:max-w-none gap-0 rounded-modal p-0 shadow-modal">
        <div className="flex items-center justify-center gap-2.5 py-3.5 px-4 text-mute text-sm" role="status">
          <Spinner />
          <span>Loading templates…</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ModalAttachAgreementModal4Modal — the modal shown when no active templates exist
// Ported from webui/src/lib/screens/items/ModalAttachAgreement.svelte:177-185 (the no templates state)
// Built on Dialog
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import {
  Dialog, DialogContent,
} from "@/lib/components/ui/dialog.jsx";
import { useBindableOpen } from "@/lib/hooks/useBindableOpen.js";

export default function ModalAttachAgreementModal4Modal({
  open = false,
  onOpenChange,
  testId = "modal-attach-agreement",
  templates = [],
}) {
  const [isOpen, setOpen] = useBindableOpen(open, onOpenChange);

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      <DialogContent data-testid={`${testId}-no-templates`} className="w-(--size-modal) max-w-[calc(100vw-2rem)] sm:max-w-none gap-0 rounded-modal p-0 shadow-modal">
        <p className="text-sm text-mute leading-relaxed p-5">
          You have no active contract templates yet, and an agreement is a copy of one.
          <a href="/documents" className="text-brand hover:underline ml-1">Create a template</a> first.
        </p>
      </DialogContent>
    </Dialog>
  );
}

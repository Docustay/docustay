// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ModalArchiveServiceModal1Modal — the loading dialog, ported from
// `webui/src/lib/screens/items/ModalArchiveService.svelte:194-201`
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { Dialog, DialogContent } from "@/lib/components/ui/dialog.jsx";
import { Spinner } from "@/lib/components/ui/spinner.jsx";

export default function ModalArchiveServiceModal1Modal({ open = false, onOpenChange, testId = "modal-archive-service" }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid={`${testId}-loading`} showCloseButton={false}>
        <div className="flex items-center justify-center gap-3 px-6 py-4 text-mute text-meta" role="status">
          <Spinner />
          <span>Loading what this affects…</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

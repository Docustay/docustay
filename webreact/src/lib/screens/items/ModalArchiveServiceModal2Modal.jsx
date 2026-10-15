// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ModalArchiveServiceModal2Modal — the error dialog, ported from
// `webui/src/lib/screens/items/ModalArchiveService.svelte:203-213`
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { Dialog, DialogContent } from "@/lib/components/ui/dialog.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";

export default function ModalArchiveServiceModal2Modal({ open = false, onOpenChange, testId = "modal-archive-service", loadError = null, loadCounts = null }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid={`${testId}-load-error`}>
        <ErrorPanel
          subject="What this touches"
          error={loadError}
          variant="band"
          onRetry={loadCounts}
          testId={`${testId}-load-error-panel`}
        />
      </DialogContent>
    </Dialog>
  );
}

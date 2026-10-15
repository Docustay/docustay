// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ModalChangePriceModal3Modal — the load error state dialog for ModalChangePrice.
// Extracted from webui/src/lib/screens/items/ModalChangePrice.svelte:361-371.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { Dialog, DialogContent } from "@/lib/components/ui/dialog.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";

export default function ModalChangePriceModal3Modal({ open, onOpenChange, testId, prefillError, loadPrefill }) {
  return (
    <>
      {open && (
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogContent data-testid={`${testId}-load-error`}>
            <ErrorPanel
              subject="The current price"
              error={prefillError}
              variant="band"
              onRetry={loadPrefill}
              testId={`${testId}-load-error-panel`}
            />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

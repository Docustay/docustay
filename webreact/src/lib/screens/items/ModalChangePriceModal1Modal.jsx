// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ModalChangePriceModal1Modal — the loading state dialog for ModalChangePrice.
// Extracted from webui/src/lib/screens/items/ModalChangePrice.svelte:341-348.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { Dialog, DialogContent } from "@/lib/components/ui/dialog.jsx";
import { Spinner } from "@/lib/components/ui/spinner.jsx";

export default function ModalChangePriceModal1Modal({ open, onOpenChange, testId }) {
  return (
    <>
      {open && (
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogContent data-testid={`${testId}-loading`} showCloseButton={false}>
            <div className="flex items-center justify-center gap-3 p-6 text-mute text-sm">
              <Spinner />
              <span>Loading the current price…</span>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

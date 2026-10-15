// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ModalChangePriceModal2Modal — the permission denied state dialog for ModalChangePrice.
// Extracted from webui/src/lib/screens/items/ModalChangePrice.svelte:350-359.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { Dialog, DialogContent } from "@/lib/components/ui/dialog.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";

export default function ModalChangePriceModal2Modal({ open, onOpenChange, testId }) {
  return (
    <>
      {open && (
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogContent data-testid={`${testId}-denied`}>
            <ErrorPanel
              subject="This price"
              error={{ message: "You don't have permission to see or change prices." }}
              variant="band"
              testId={`${testId}-denied-panel`}
            />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

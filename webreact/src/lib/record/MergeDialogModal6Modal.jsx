// ═══════════════════════════════════════════════════════════════════════════════════════════════
// MergeDialogModal6Modal — result modal after merge succeeds, built on Dialog. Shows the
// successful merge confirmation and allows the user to undo or close.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/lib/components/ui/dialog.jsx";
import MergeResult from "./MergeResult.jsx";

export default function MergeDialogModal6Modal({
  open,
  onOpenChange,
  busy,
  merged,
  survivorName,
  handleUndo,
  closeResult,
  error = null,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="merge-result-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Merged</DialogTitle>
        </DialogHeader>
        {error && (
          <div
            className="rounded-sm border border-bad-border bg-bad-bg px-3 py-2.5 text-meta text-bad"
            data-testid="merge-result-dialog-error"
            role="alert"
          >
            {error}
          </div>
        )}
        <MergeResult
          survivorName={survivorName}
          cameAcross={merged?.cameAcross ?? []}
          dropped={merged?.dropped ?? []}
          undoUntil={merged?.undoUntil}
          busy={busy}
          onUndo={handleUndo}
          onClose={closeResult}
        />
      </DialogContent>
    </Dialog>
  );
}

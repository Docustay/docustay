// ConfirmAction — "{Verb} {object}?" with its consequence. Ported from webui/src/lib/forms/ConfirmAction.svelte:
// same props (bind:open → open + onOpenChange), testids (TESTID-CONTRACT §3) and copy ("Keep it", "Working…").
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription,
  AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/lib/components/ui/alert-dialog.jsx";
import { useBindableOpen } from "@/lib/hooks/useBindableOpen.js";

export default function ConfirmAction({
  open = false, onOpenChange, object, verb, consequence, detail = null, confirmLabel = null, cancelLabel = "Keep it",
  busy = false, error = null, destructive = true, testId = "confirm", onConfirm = null, onCancel = null, children = null,
}) {
  const [isOpen, setOpen] = useBindableOpen(open, onOpenChange);
  const question = `${verb} ${object}?`;
  return (
    <AlertDialog open={isOpen} onOpenChange={setOpen}>
      <AlertDialogContent className="w-(--size-modal) max-w-[calc(100vw-2rem)] sm:max-w-none gap-3 rounded-modal p-6 shadow-modal"
                          data-testid={testId} data-destructive={destructive ? "true" : undefined}>
        <AlertDialogHeader className="text-left">
          <AlertDialogTitle className="text-modal-title font-medium text-ink" data-testid={`${testId}-question`}>{question}</AlertDialogTitle>
          <AlertDialogDescription className="text-control leading-relaxed text-mute" data-testid={`${testId}-consequence`}>{consequence}</AlertDialogDescription>
        </AlertDialogHeader>
        {detail && <p className="m-0 text-meta text-ink-2" data-testid={`${testId}-detail`}>{detail}</p>}
        {children}
        {error && <p className="m-0 rounded-sm border border-bad-border bg-bad-bg px-3 py-2.5 text-meta text-bad" data-testid={`${testId}-error`} role="alert">{error}</p>}
        <AlertDialogFooter className="flex-row justify-end gap-2.5">
          <AlertDialogCancel data-testid={`${testId}-cancel`} disabled={busy} onClick={() => onCancel?.()}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction data-testid={`${testId}-confirm`} disabled={busy} onClick={(e) => { e.preventDefault(); onConfirm?.(); }}>{busy ? "Working…" : (confirmLabel ?? verb)}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

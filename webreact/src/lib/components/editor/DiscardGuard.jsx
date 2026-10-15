// DiscardGuard — "Discard this {objectNoun}? Your changes will be lost." Ported from
// webui/src/lib/components/editor/DiscardGuard.svelte (bind:open → open + onOpenChange).
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/lib/components/ui/alert-dialog.jsx";
import { useBindableOpen } from "@/lib/hooks/useBindableOpen.js";

export default function DiscardGuard({ open = false, onOpenChange, objectNoun, onKeepEditing = null, onDiscard = null, testId = "discard-guard" }) {
  const [isOpen, setOpen] = useBindableOpen(open, onOpenChange);
  return (
    <AlertDialog open={isOpen} onOpenChange={setOpen}>
      <AlertDialogContent className="w-(--size-modal) max-w-[calc(100vw-2rem)] sm:max-w-none rounded-modal p-6 shadow-modal" data-testid={testId}>
        <AlertDialogHeader className="text-left">
          <AlertDialogTitle className="text-modal-title font-medium text-ink" data-testid={`${testId}-question`}>Discard this {objectNoun}?</AlertDialogTitle>
          <AlertDialogDescription className="text-control text-mute" data-testid={`${testId}-consequence`}>Your changes will be lost.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-row justify-end gap-2.5">
          <AlertDialogCancel data-testid={`${testId}-keep`} onClick={() => { setOpen(false); onKeepEditing?.(); }}>Keep editing</AlertDialogCancel>
          <AlertDialogAction variant="destructive" data-testid={`${testId}-discard`} onClick={(e) => { e.preventDefault(); setOpen(false); onDiscard?.(); }}>Discard</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

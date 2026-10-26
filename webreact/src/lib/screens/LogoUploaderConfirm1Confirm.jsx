// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R8.010.M1 — LogoUploaderConfirm1Confirm.
//
// The confirm dialog for uploading a logo, built on alert-dialog archetype.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/lib/components/ui/alert-dialog.jsx";
import { useBindableOpen } from "@/lib/hooks/useBindableOpen.js";

export default function LogoUploaderConfirm1Confirm({
  open = false,
  onOpenChange = null,
  logo = null,
  src = null,
  pending = null,
  busy = false,
  confirmUpload = null,
}) {
  const [isOpen, setOpen] = useBindableOpen(open, onOpenChange);

  return (
    <AlertDialog open={isOpen} onOpenChange={setOpen}>
      <AlertDialogContent className="w-(--size-modal) max-w-[calc(100vw-2rem)] sm:max-w-none rounded-modal p-6 shadow-modal">
        <AlertDialogHeader className="text-left">
          <AlertDialogTitle className="text-modal-title font-medium text-structure-900">
            {src ? `Replace your ${logo?.label.toLowerCase()}?` : `Use this as your ${logo?.label.toLowerCase()}?`}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-sm text-structure-600">
            It changes for everyone straight away. Resized to {pending?.w} × {pending?.h} px.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {pending && (
          <div className="flex justify-center p-3 border border-structure-200 rounded-xl">
            <img src={pending.previewUrl} alt="New logo preview" className="max-w-full max-h-[140px] object-contain" />
          </div>
        )}

        <AlertDialogFooter className="flex-row justify-end gap-2.5">
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={(e) => {
              e.preventDefault();
              confirmUpload?.();
            }}
          >
            {busy ? "Saving…" : "Yes, use this logo"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

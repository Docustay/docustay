import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/lib/components/ui/alert-dialog.jsx";

export default function SettingsMineConfirm1Confirm({ open, onOpenChange, photoSrc, busy, photoConfirm, confirmPhotoUpload }) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {photoSrc ? "Replace your photo?" : "Use this as your photo?"}
          </AlertDialogTitle>
          <AlertDialogDescription>It changes for everyone straight away.</AlertDialogDescription>
        </AlertDialogHeader>
        {photoConfirm && (
          <div className="flex justify-center my-4">
            <img src={photoConfirm.previewUrl} alt="" aria-hidden="true" className="max-w-full max-h-[200px] rounded-md" />
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={busy} onClick={confirmPhotoUpload}>
            {busy ? "Saving…" : "Yes, use this photo"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

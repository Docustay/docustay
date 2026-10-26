// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R8.003.M1 — CalendarSettingsScreenCalendarDisconnectConfirm.
//
// The confirm dialog for disconnecting a calendar connection, built on alert-dialog archetype.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/lib/components/ui/alert-dialog.jsx";
import { useBindableOpen } from "@/lib/hooks/useBindableOpen.js";

export default function CalendarSettingsScreenCalendarDisconnectConfirm({
  open = false,
  onOpenChange = null,
  busy = false,
  problem = null,
  disconnectTarget = null,
  confirmDisconnect = null,
}) {
  const [isOpen, setOpen] = useBindableOpen(open, onOpenChange);

  return (
    <AlertDialog open={isOpen} onOpenChange={setOpen}>
      <AlertDialogContent className="w-(--size-modal) max-w-[calc(100vw-2rem)] sm:max-w-none rounded-modal p-6 shadow-modal" data-testid="calendar-disconnect-confirm">
        <AlertDialogHeader className="text-left">
          <AlertDialogTitle className="text-modal-title font-medium text-ink">
            Disconnect {disconnectTarget?.externalAccount ?? "this calendar"}?
          </AlertDialogTitle>
          <AlertDialogDescription className="text-control text-mute">
            Workbench stops reading busy times from it and stops putting new sessions on it. Sessions already on it stay there.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {problem && (
          <p role="alert" style={{ fontSize: "var(--fs-sm)", color: "var(--chip-bad-ink)" }}>
            {problem}
          </p>
        )}

        <AlertDialogFooter className="flex-row justify-end gap-2.5">
          <AlertDialogCancel disabled={busy}>Keep it connected</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={busy} onClick={(e) => { e.preventDefault(); confirmDisconnect?.(); }}>
            Disconnect it
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

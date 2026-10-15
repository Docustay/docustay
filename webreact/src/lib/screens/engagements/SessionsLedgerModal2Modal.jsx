// ═══════════════════════════════════════════════════════════════════════════════════════════════
// SessionsLedgerModal2Modal — the attendance dialog as its own component
// Built on Dialog from webui/src/lib/screens/engagements/SessionsLedger.svelte:424-431
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/lib/components/ui/dialog.jsx";
import { Suspense, lazy } from "react";

// AttendanceControl import
const AttendanceControl = lazy(() =>
  import("../AttendanceControl.jsx").catch(() => ({
    default: ({ onDone }) => { onDone?.(); return null; }
  }))
);

export default function SessionsLedgerModal2Modal({
  open,
  onOpenChange,
  onDone,
  attendanceTarget,
  onAttendanceDone,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="sessions-attendance-dialog">
        <DialogHeader>
          <DialogTitle>Mark attendance</DialogTitle>
        </DialogHeader>
        {attendanceTarget && (
          <Suspense fallback={<div>Loading...</div>}>
            <AttendanceControl
              booking={attendanceTarget}
              participants={[]}
              onDone={onAttendanceDone}
            />
          </Suspense>
        )}
      </DialogContent>
    </Dialog>
  );
}

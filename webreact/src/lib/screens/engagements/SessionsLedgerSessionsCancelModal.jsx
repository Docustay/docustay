// ═══════════════════════════════════════════════════════════════════════════════════════════════
// SessionsLedgerSessionsCancelModal — the cancel modal as its own component
// Built on DecisionModal from webui/src/lib/screens/engagements/SessionsLedger.svelte:407-420
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import DecisionModal from "@/lib/forms/DecisionModal.jsx";

export default function SessionsLedgerSessionsCancelModal({
  open,
  onOpenChange,
  rows,
  whenLabel,
  cancelTarget,
  cancelBusy,
  cancelError,
  confirmCancel,
}) {
  return (
    <DecisionModal
      open={open}
      onOpenChange={onOpenChange}
      title={`Cancel ${cancelTarget?.who || "this"} session?`}
      subtitle={whenLabel(cancelTarget?.starts_at)}
      rows={rows}
      cancelLabel="Keep it"
      confirmLabel="Cancel session"
      danger={true}
      busy={cancelBusy}
      error={cancelError}
      onCancel={() => {
        onOpenChange?.(false);
      }}
      onConfirm={confirmCancel}
      testId="sessions-cancel-modal"
    />
  );
}

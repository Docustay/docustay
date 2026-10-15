// ═══════════════════════════════════════════════════════════════════════════════════════════════
// BookingOffConfirmModal — the modal as its own component.
// TASK R5.009.M1 — BookingOffConfirm › BookingOffConfirmModal: the modal as its own component.
// Ported from webui/src/lib/screens/engagements/BookingOffConfirm.svelte:110-128
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import DecisionModal from "@/lib/forms/DecisionModal.jsx";

export default function BookingOffConfirmModal({
  open,
  onOpenChange,
  onCancel,
  testId,
  busy,
  error,
  rows,
  judgment,
  handleCancel,
  handleConfirm,
}) {
  return (
    <DecisionModal
      open={open}
      onOpenChange={onOpenChange}
      title="Turn off online booking?"
      subtitle="Your booking page stops working within a minute. Anyone with the link sees a note saying you're not taking bookings online."
      rows={rows}
      cancelLabel="Leave it on"
      confirmLabel="Turn it off"
      danger={true}
      wide={true}
      busy={busy}
      error={error}
      onCancel={handleCancel}
      onConfirm={handleConfirm}
      testId={testId}
    >
      <p className="m-0 rounded-control border-0 bg-warn-soft px-3.75 py-3.25 text-xs text-warn leading-relaxed" data-testid={`${testId}-judgment`}>{judgment}</p>
    </DecisionModal>
  );
}

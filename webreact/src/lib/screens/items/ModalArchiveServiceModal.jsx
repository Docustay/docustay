// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ModalArchiveServiceModal — the main decision modal, ported from
// `webui/src/lib/screens/items/ModalArchiveService.svelte:215-235`
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import DecisionModal from "@/lib/forms/DecisionModal.jsx";

export default function ModalArchiveServiceModal({
  open = false,
  onOpenChange,
  testId = "modal-archive-service",
  title = "",
  subtitle = "",
  rows = [],
  busy = false,
  submitError = null,
  cancel = null,
  submit = null,
}) {
  return (
    <DecisionModal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      subtitle={subtitle}
      rows={rows}
      cancelLabel="Cancel"
      confirmLabel="Archive it"
      danger
      busy={busy}
      error={submitError}
      onCancel={cancel}
      onConfirm={submit}
      wide
      testId={testId}
    >
      <p className="m-0 text-meta text-mute" data-testid={`${testId}-footer`}>
        You can put it back any time, and it keeps its history when you do.
      </p>
    </DecisionModal>
  );
}

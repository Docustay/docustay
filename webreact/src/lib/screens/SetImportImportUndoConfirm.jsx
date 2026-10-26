// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R8.020.M1 — SetImport › SetImportImportUndoConfirm: the modal as its own component
//
// Ported from webui/src/lib/screens/SetImport.svelte:535-553 — the `<DecisionModal>` element and
// everything inside it. Built on DecisionModal.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import DecisionModal from "@/lib/forms/DecisionModal.jsx";

export default function SetImportImportUndoConfirm({
  open,
  onOpenChange,
  runResult,
  busy,
  error,
  undoThisImport,
}) {
  return (
    <DecisionModal
      open={open}
      onOpenChange={onOpenChange}
      title="Undo this import?"
      subtitle="Nothing else about this practice changes."
      rows={[
        {
          headline: `${runResult?.created ?? 0} people created`,
          detail:
            "Archived, not deleted — recoverable the same way any archived person is. " +
            "People this import only filled blank fields on keep those values; there is no before-" +
            "snapshot to undo those.",
        },
      ]}
      cancelLabel="Leave it"
      confirmLabel="Undo the import"
      danger={true}
      busy={busy}
      error={error}
      onCancel={() => onOpenChange(false)}
      onConfirm={undoThisImport}
      testId="import-undo-confirm"
    />
  );
}

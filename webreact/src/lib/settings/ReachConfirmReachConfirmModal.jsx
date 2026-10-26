// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R8.039.M1 — ReachConfirm › ReachConfirmReachConfirmModal: the modal as its own component
//
// Ported from webui/src/lib/settings/ReachConfirm.svelte:63-91 — the `<DecisionModal>` element and
// everything inside it. Built on DecisionModal.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import DecisionModal from "@/lib/forms/DecisionModal.jsx";

export default function ReachConfirmReachConfirmModal({
  open,
  onOpenChange,
  reach,
  label,
  onConfirm,
  busy,
  error,
  tellText,
  onTellTextChange,
  title,
  subtitle,
  cancelLabel,
  confirmLabel,
  rows,
  handleKeep,
  handleConfirm,
}) {
  return (
    <DecisionModal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      subtitle={subtitle}
      rows={rows}
      cancelLabel={cancelLabel}
      confirmLabel={confirmLabel}
      onCancel={handleKeep}
      onConfirm={handleConfirm}
      busy={busy}
      error={error}
      testId="reach-confirm-modal"
    >
      {/* Tell everyone: "A line from you explaining the change." Always visible, sent only if non-empty. */}
      <div className="flex flex-col gap-1">
        <label htmlFor="reach-tell-textarea" className="font-medium text-sm text-[var(--color-structure-900)]">
          Tell everyone
        </label>
        <span className="text-xs text-[var(--color-structure-600)] leading-relaxed">
          A line from you explaining the change. Most people never notice a policy change until it costs them something.
        </span>
        <textarea
          id="reach-tell-textarea"
          className="min-h-20 px-2.5 py-2.5 border border-[var(--color-structure-200)] rounded-lg text-sm font-inherit resize-vertical disabled:opacity-50"
          placeholder="A line from you explaining the change."
          value={tellText}
          onChange={(e) => onTellTextChange?.(e.target.value)}
          disabled={busy}
          data-testid="reach-confirm-tell-textarea"
        />
      </div>
    </DecisionModal>
  );
}

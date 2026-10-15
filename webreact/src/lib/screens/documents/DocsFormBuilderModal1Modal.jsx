// DocsFormBuilder › DocsFormBuilderModal1Modal: the modal as its own component
// Ported from webui/src/lib/screens/documents/DocsFormBuilder.svelte:663-667 (the DiscardGuard)
// Built on DiscardGuard archetype.
import DiscardGuard from "@/lib/components/editor/DiscardGuard.jsx";

export default function DocsFormBuilderModal1Modal({
  open = false,
  onOpenChange,
  showDiscardGuard,
  handleClose,
  testId = "docs-form-builder-modal1modal",
}) {
  // The modal is shown when showDiscardGuard is true (from parent's state)
  if (!showDiscardGuard) return null;

  return (
    <DiscardGuard
      objectNoun="form"
      onKeepEditing={() => {
        if (onOpenChange) onOpenChange(false);
      }}
      onDiscard={() => {
        handleClose?.();
        if (onOpenChange) onOpenChange(false);
      }}
      testId={testId}
    />
  );
}

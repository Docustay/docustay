// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R6.014.M1 — DocTemplateEditorModal1Modal.jsx
// Renders the discard confirmation modal from DocTemplateEditor.svelte:782-788
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import DiscardGuard from "@/lib/components/editor/DiscardGuard.jsx";

export default function DocTemplateEditorModal1Modal({
  open = false,
  onOpenChange = null,
  onKeepEditing = null,
  onDiscard = null,
  objectNoun = "template",
}) {
  return (
    <DiscardGuard
      open={open}
      onOpenChange={onOpenChange}
      objectNoun={objectNoun}
      onKeepEditing={onKeepEditing}
      onDiscard={onDiscard}
      testId="doc-template-editor-discard-guard"
    />
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R6.013.M1 — DocsSendSendDocumentSheet1Sheet. Confirmation sheet shown after send completes.
// Ported from webui/src/lib/screens/documents/DocsSend.svelte:143-162 (the {#if phase === "sent"} block)
// Props: { open, onOpenChange, onDone, onCancel, sentName, template, send }
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import SideSheet from "@/lib/forms/SideSheet.jsx";

export default function DocsSendSendDocumentSheet1Sheet({
  open = false,
  onOpenChange = null,
  onDone = null,
  onCancel = null,
  sentName = "",
  template = null,
}) {
  if (!open) return null;

  return (
    <SideSheet
      title={`Send ${template?.name ?? "a document"}`}
      onCancel={() => onDone?.()}
      testId="send-document-sheet"
      footer={
        <footer className="sticky bottom-0 flex shrink-0 justify-end gap-2.5 border-t border-line bg-surface px-5.5 py-4">
          <button
            type="button"
            className="inline-flex h-(--size-control) items-center justify-center gap-2 rounded-control border border-line bg-surface px-4 text-control font-medium text-ink hover:bg-surface-hover disabled:opacity-60"
            onClick={() => onDone?.()}
            data-testid="send-done"
          >
            Done
          </button>
        </footer>
      }
    >
      <div className="px-0">
        <p className="m-0 text-field text-ink" data-testid="send-sent">
          Sent to {sentName} — they'll get an email with a link.
        </p>
      </div>
    </SideSheet>
  );
}

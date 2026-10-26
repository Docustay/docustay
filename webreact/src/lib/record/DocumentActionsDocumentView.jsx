// ═══════════════════════════════════════════════════════════════════════════════════════════════
// F130 (23 Oct 2026) — THE DOCUMENT ITSELF, FROM ITS RECORD PAGE. The staff record (/record/document/<id>) used to show event names and
// a field list but never the document. "View document" opens the SAME one document view the signer and the PDF read
// (GET /api/documents/:id/view → buildDocumentView), with every signature recorded so far; once it is final, "Download signed copy"
// is the sealed PDF with its Certificate of Completion (GET /api/documents/:id/pdf).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import { request, ApiError } from "@/lib/api.js";
import { Button } from "@/lib/components/ui/button.jsx";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/lib/components/ui/dialog.jsx";
import DocumentViewRenderer from "@/lib/screens/documents/DocumentViewRenderer.jsx";

export default function DocumentActionsDocumentView({ document = null }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState({ phase: "idle", view: null, error: null });
  if (!document?.id) return null;
  const executed = document.state === "executed";

  async function show() {
    setOpen(true);
    if (state.phase === "ready") return;
    setState({ phase: "loading", view: null, error: null });
    try {
      const res = await request(`/api/documents/${document.id}/view`);
      setState({ phase: "ready", view: res?.data?.view ?? null, error: null });
    } catch (err) {
      setState({ phase: "error", view: null, error: err instanceof ApiError ? err.message : String(err?.message ?? err) });
    }
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={show} data-testid="doc-view-trigger">View document</Button>
      {executed && (
        <Button asChild variant="outline" size="sm">
          <a href={`/api/documents/${document.id}/pdf`} download data-testid="doc-download-signed">Download signed copy</a>
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto" data-testid="doc-view-dialog">
          <DialogTitle>{document.title ?? "Document"}</DialogTitle>
          <DialogDescription>
            {executed ? "The signed copy, as everyone signed it." : "As it reads now. Signatures appear as each person signs."}
          </DialogDescription>
          {state.phase === "loading" && <p className="m-0 text-meta text-mute" data-testid="doc-view-loading">Loading…</p>}
          {state.phase === "error" && <p className="m-0 text-meta text-bad" role="alert" data-testid="doc-view-error">{state.error}</p>}
          {state.phase === "ready" && (state.view
            ? <DocumentViewRenderer view={state.view} />
            : <p className="m-0 text-meta text-mute" data-testid="doc-view-none">This document has no written wording to show here (an uploaded file is opened from Documents).</p>)}
          {state.phase === "ready" && executed && (
            <p className="m-0 mt-2 text-meta text-mute">
              The downloadable copy also carries its Certificate of Completion.{" "}
              <a className="text-brand underline" href={`/api/documents/${document.id}/pdf`} download>Download signed copy</a>
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

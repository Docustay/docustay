// ═══════════════════════════════════════════════════════════════════════════════════════════════
// SignedCopyPreview — "Preview a signed copy" (QUEUE §23.2.8). A dialog that draws the REAL signed-copy view (mode `signed`) from GET /api/documents/settings/signed-copy-preview — made-up signatures and a
// made-up certificate, this practice's CURRENT settings — and offers the same view as a PDF. Nothing is stored or sent. Change a setting, reopen the preview, see the change.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { request, ApiError } from "@/lib/api.js";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/lib/components/ui/dialog.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import DocumentViewRenderer from "./DocumentViewRenderer.jsx";

export default function SignedCopyPreview({ open, onOpenChange }) {
  const [phase, setPhase] = useState("loading");
  const [view, setView] = useState(null);
  const [error, setError] = useState(null);

  async function load() {
    try {
      setPhase("loading");
      const res = await request("/api/documents/settings/signed-copy-preview");
      setView(res.view);
      setPhase("ready");
    } catch (err) {
      setError(err instanceof ApiError ? err : new Error(String(err?.message ?? err)));
      setPhase("error");
    }
  }
  useEffect(() => { if (open) load(); }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-24px)] max-w-3xl overflow-y-auto" data-testid="signed-copy-preview">
        <DialogHeader>
          <DialogTitle>Preview a signed copy</DialogTitle>
          <DialogDescription>A made-up agreement, signed by made-up people, drawn with your current settings. Nothing here is saved or sent.</DialogDescription>
        </DialogHeader>
        {phase !== "ready" ? <ScreenState phase={phase} error={error} subject="the signed-copy preview" onRetry={load} /> : (
          <>
            <div className="flex justify-end">
              <Button asChild variant="outline" size="sm"><a href="/api/documents/settings/signed-copy-preview.pdf" target="_blank" rel="noreferrer" data-testid="preview-download-pdf">Open as PDF</a></Button>
            </div>
            <div className="rounded-card border border-line p-5"><DocumentViewRenderer view={view} /></div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

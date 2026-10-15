// ═══════════════════════════════════════════════════════════════════════════════════════════════
// DocumentPreviewTabs — "As the client sees it" / "As the signed copy" (QUEUE §23.3.1). Both tabs draw the ONE document view (GET /api/documents/templates/:id/view), the same tree the real signing
// page and the real signed PDF are drawn from, with the practice's current settings and the template's own override — so a preview cannot drift from what is sent and signed.
// Used by the preview screen (DocPreview) and the send wizard's Review step.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api.js";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";
import DocumentViewRenderer from "./DocumentViewRenderer.jsx";
import { cn } from "@/lib/utils";

const TABS = [["signing", "As the client sees it"], ["signed", "As the signed copy"]];

export default function DocumentPreviewTabs({ templateId, personId = null, initialMode = "signing", className }) {
  const [mode, setMode] = useState(initialMode);
  const [state, setState] = useState({ phase: "loading", view: null, error: null });

  useEffect(() => {
    if (!templateId) return undefined;
    let live = true;
    setState((s) => ({ ...s, phase: "loading" }));
    api.templateView({ templateId, mode, personId })
      .then((r) => { if (live) setState({ phase: "ready", view: r.view, error: null }); })
      .catch((e) => { if (live) setState({ phase: "error", view: null, error: e instanceof ApiError ? e : new Error(String(e?.message ?? e)) }); });
    return () => { live = false; };
  }, [templateId, personId, mode]);

  return (
    <div className={className} data-testid="doc-preview-tabs">
      <div role="tablist" aria-label="Preview as" className="mb-3 inline-flex rounded-lg border border-line bg-surface-2 p-0.5">
        {TABS.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={mode === key} onClick={() => setMode(key)} data-testid={`preview-tab-${key}`}
            className={cn("rounded-md px-3 py-1.5 text-control", mode === key ? "bg-surface text-ink shadow-sm" : "text-mute hover:text-ink")}>
            {label}
          </button>
        ))}
      </div>
      {state.phase === "loading" ? <p className="m-0 text-sm text-mute" data-testid="preview-tab-loading">Loading…</p>
        : state.phase === "error" ? <ErrorPanel error={state.error} subject="This preview" testId="preview-tab-error" />
        : <DocumentViewRenderer view={state.view} />}
      {state.phase === "ready" && mode === "signed" ? <p className="m-0 mt-2 text-meta text-mute" data-testid="preview-tab-signed-note">Signed by made-up people, with made-up times. It shows how the real signed copy will look with your current settings.</p> : null}
    </div>
  );
}

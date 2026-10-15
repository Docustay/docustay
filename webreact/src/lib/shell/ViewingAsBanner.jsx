// The see-as preview strip, fixed above everything (R3.017, ViewingAsBanner.svelte). A session fact, so it lives in
// the shell: "Exit preview" must be reachable on any screen the preview reached.
import { useState } from "react";
import { Button } from "@/lib/components/ui/button";
import { rankLabel } from "@/lib/permissions/vocab.js";

export default function ViewingAsBanner({ viewingAs = null, onExit = null }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  if (!viewingAs) return null;
  const exit = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await onExit?.(); } catch (err) { setError(err?.message ?? String(err)); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-x-0 top-0 z-60 flex h-11 items-center justify-center gap-3 bg-warn-soft px-4 text-control text-warn" data-testid="viewing-as-banner" role="status">
      <span>
        You're previewing Workbench as <strong className="font-semibold">{viewingAs.displayName ?? "someone"}{viewingAs.staffRole ? ` (${rankLabel(viewingAs.staffRole)})` : ""}</strong>. Nothing you do here is saved.
      </span>
      <Button variant="outline" size="sm" data-testid="viewing-as-exit" disabled={busy} onClick={exit}>{busy ? "Exiting…" : "Exit preview"}</Button>
      {error ? <span className="text-bad" role="alert" data-testid="viewing-as-error">{error}</span> : null}
    </div>
  );
}

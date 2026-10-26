// ═══════════════════════════════════════════════════════════════════════════════════════════════
// DocsPublish — built from specs/mockups/DocsPublish.frame.html: a centred modal ("Make this the
// default?"), not a full screen (SLIDEUP-AUDIT.md's ruling: a frame drawn as a centred box stays
// one). POSTs /api/documents/templates/publish (src/documents/publish.mjs's `publishTemplate`,
// already built — this screen is the missing half; see DocTemplateEditor.jsx's own "onPublish is
// deliberately left unset" note, which this closes).
// ★ SIMPLIFIED FROM THE FRAME: the frame shows a computed per-template diff ("One thing: 48 hours
//   became 24") and an exact prior-signer count. Neither is available from data this screen has —
//   computing a real body diff against the predecessor template is real, separate work this pass
//   didn't reach. The facts shown here are the ones genuinely known (this template's own sent
//   count, and the mechanics publishTemplate() actually performs), not invented numbers.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import { request, ApiError } from "@/lib/api.js";
import SideSheet from "@/lib/forms/SideSheet.jsx";
import { Switch } from "@/lib/components/ui/switch.jsx";

export default function DocsPublish({
  open = false,
  onOpenChange = null,
  templateId = null,
  templateName = "",
  sentInstances = 0,
  onPublished = null,
  testId = "docs-publish",
}) {
  const [askEveryoneToResign, setAskEveryoneToResign] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function handleCancel() {
    if (busy) return;
    setError(null);
    setAskEveryoneToResign(false);
    onOpenChange?.(false);
  }

  async function handlePublish() {
    if (busy || !templateId) return;
    setBusy(true);
    setError(null);
    try {
      await request("/api/documents/templates/publish", {
        method: "POST",
        body: { templateId, askEveryoneToResign },
      });
      setAskEveryoneToResign(false);
      onOpenChange?.(false);
      onPublished?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  const FACTS = [
    sentInstances > 0
      ? { title: `${sentInstances} sent already`, detail: "Nothing changes for them. What they signed — or were sent — is what they signed." }
      : null,
    { title: "New bookings get this one", detail: "From the moment you publish." },
    { title: "The old one is kept", detail: "Retired, not deleted. You'll always be able to read it." },
  ].filter(Boolean);

  return (
    <SideSheet
      variant="modal"
      title="Make this the default?"
      subtitle={templateName ? `Replaces whichever version of ${templateName} is the default now.` : undefined}
      saveLabel={busy ? "Publishing…" : "Make it the default"}
      cancelLabel="Not yet"
      busy={busy}
      error={error}
      onCancel={handleCancel}
      onSave={handlePublish}
      testId={testId}
    >
      <div className="overflow-hidden rounded-lg border border-line">
        {FACTS.map((f, idx) => (
          <div key={idx} className={`px-3.75 py-3 text-sm ${idx < FACTS.length - 1 ? "border-b border-hair" : ""}`}>
            <b className="block font-medium text-ink">{f.title}</b>
            <span className="mt-0.5 block text-mute">{f.detail}</span>
          </div>
        ))}
      </div>

      <label className="mt-3 flex items-start gap-3 text-sm">
        <Switch checked={askEveryoneToResign} onCheckedChange={setAskEveryoneToResign} disabled={busy} data-testid={`${testId}-resign-toggle`} />
        <span className="flex-1">
          <span className="block text-ink">Ask everyone to sign the new one</span>
          {sentInstances > 0 && (
            <span className="mt-0.5 block text-meta text-mute">
              {sentInstances} people get an email. Only do this if what changed actually matters.
            </span>
          )}
        </span>
      </label>
    </SideSheet>
  );
}

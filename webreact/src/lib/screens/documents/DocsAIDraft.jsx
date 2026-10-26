// ═══════════════════════════════════════════════════════════════════════════════════════════════
// DocsAIDraft — R6.004. Built from specs/mockups/DocsAIDraft.frame.html: a centred modal ("Write a
// document"), not a full screen — the frame's own `.md` box, matching SLIDEUP-AUDIT.md's ruling
// that a frame drawn as a centred box stays one. Opened from DocTemplateEditor's "Write with AI"
// verb; POSTs /api/documents/ai/draft (src/documents/ai.mjs, already built and wired — this screen
// was the missing half) and hands the returned structured body back to the editor via onDraftReady.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import { request, ApiError } from "@/lib/api.js";
import SideSheet from "@/lib/forms/SideSheet.jsx";
import { Field, FieldLabel, FieldContent } from "@/lib/components/ui/field.jsx";
import { Textarea } from "@/lib/components/ui/textarea.jsx";

export default function DocsAIDraft({
  open = false,
  onOpenChange = null,
  templateId = null,
  onDraftReady = null,
  testId = "docs-ai-draft",
}) {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [requestError, setRequestError] = useState(null);

  function handleCancel() {
    if (busy) return;
    setPrompt("");
    setRequestError(null);
    onOpenChange?.(false);
  }

  async function handleSubmit() {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setRequestError(null);
    try {
      const res = await request("/api/documents/ai/draft", {
        method: "POST",
        body: { prompt: prompt.trim(), templateId },
      });
      onDraftReady?.(res.body);
      setPrompt("");
      onOpenChange?.(false);
    } catch (err) {
      setRequestError(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <SideSheet
      variant="modal"
      title="Write a document"
      subtitle="Tell it what you need in plain words. It writes a first draft using your own clauses where they fit."
      saveLabel={busy ? "Writing…" : "Write a draft"}
      cancelLabel="Cancel"
      busy={busy}
      error={requestError}
      onCancel={handleCancel}
      onSave={handleSubmit}
      testId={testId}
    >
      <Field>
        <FieldLabel htmlFor={`${testId}-prompt`}>What for</FieldLabel>
        <FieldContent>
          <Textarea
            id={`${testId}-prompt`}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g., a short agreement for the Saturday group — six people, 90 minutes, $45 each…"
            rows={4}
            disabled={busy}
            data-testid={`${testId}-prompt-input`}
          />
        </FieldContent>
      </Field>
      {/* ★ DESIGN SYSTEM PASS, 29 Sep 2026 — a hardcoded hex pair replaced with the app's own "warn"
          tone tokens (StatusBadge.jsx's own TONE map: bg-warn-soft/text-warn), so this warning
          follows the theme (including dark mode) instead of carrying its own frozen colour.
          ★ CAUGHT LIVE: my first pass here used `bg-chip-warn-bg`/`text-chip-warn-ink`, which do not
          exist anywhere in theme.css — a plausible-sounding guess, not a real token, and it would
          have rendered this warning with no background or text colour at all. */}
      <div
        className="mt-2.5 rounded-lg bg-warn-soft px-3.75 py-3.25 text-sm leading-relaxed text-warn"
        data-testid={`${testId}-warning`}
      >
        <b>Read it properly before you send it.</b> This is a first draft, not legal advice. It will
        be wrong about something, and it is your name on it.
      </div>
    </SideSheet>
  );
}

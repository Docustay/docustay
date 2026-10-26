// ═══════════════════════════════════════════════════════════════════════════════════════════════
// DocsAICheck — R6.003. Built from specs/mockups/DocsAICheck.frame.html: a full page, two columns —
// "What we noticed" (findings) on the left, "What's fine" + a standing disclaimer on the right.
// POSTs /api/documents/ai/check (src/documents/ai.mjs, already built — this screen was the missing
// half). ★ `finding.action.patch` is EXPLICITLY, by the backend's own system prompt
// (src/documents/ai.mjs's CHECK_SYSTEM), "never applied automatically — a person reviews and
// applies it through the ordinary template-editing routes." So the per-finding button does not
// invent an auto-patch this backend deliberately refuses to support — it takes the person into the
// template editor to make the change by hand, carrying the suggestion's own words as context; only
// dismissing a finding (the frame's own ✕) is a purely local, no-server action.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { request, ApiError } from "@/lib/api.js";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";
import PromptCard from "@/lib/prompts/PromptCard.jsx";
import { Button } from "@/lib/components/ui/button.jsx";

export default function DocsAICheck({ path = null, params = null, app = null, onNavigate = null, onRefetch = null }) {
  const templateId = params?.id ?? null;
  const [phase, setPhase] = useState("loading");
  const [error, setError] = useState(null);
  const [findings, setFindings] = useState([]);
  const [fine, setFine] = useState([]);
  const [dismissed, setDismissed] = useState(() => new Set());
  const [templateName, setTemplateName] = useState("");

  async function run() {
    if (!templateId) return;
    setPhase("loading");
    setError(null);
    try {
      const res = await request("/api/documents/ai/check", { method: "POST", body: { templateId } });
      setFindings(res.findings ?? []);
      setFine(res.fine ?? []);
      setPhase("ready");
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setPhase("denied");
      else setPhase("error");
      setError(err);
    }
  }

  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId]);

  function goToEditor() {
    onNavigate?.(`/documents/templates/${templateId}`);
  }

  const visibleFindings = findings.filter((_, idx) => !dismissed.has(idx));

  if (phase === "loading") return <ScreenState phase="loading" />;
  if (phase === "denied") return <ScreenState phase="denied" />;
  if (phase === "error") return <ErrorPanel error={error} onBack={goToEditor} subject="Checking this template" />;

  return (
    <div className="px-7.5 py-6.5" data-testid="docs-ai-check">
      <div className="mb-4.5 flex items-end gap-4">
        <div className="flex-1">
          {/* ★ DESIGN SYSTEM PASS, 29 Sep 2026 — the maintainer: "one plain font everywhere, drop the serif
              titles." `font-figure` (Fraunces) removed; Inter (the app's own default) applies. */}
          <h1 className="m-0 text-page-title font-medium tracking-[-0.01em] text-ink">
            {templateName || "Checking this template"}
          </h1>
          <p className="m-0 mt-1.5 text-control text-mute">
            {visibleFindings.length === 0
              ? "Nothing worth a look — you're clear to publish."
              : `${visibleFindings.length} thing${visibleFindings.length === 1 ? "" : "s"} worth a look before you make this the default.`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={goToEditor} data-testid="docs-ai-check-ignore">
            Ignore and publish
          </Button>
          <Button onClick={goToEditor} data-testid="docs-ai-check-fix">
            Fix them
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-5.5 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          <div className="mb-4.5 rounded-card border border-line bg-surface">
            <div className="border-b border-hair px-4.25 py-3.5">
              <b className="text-heading font-medium">What we noticed</b>
            </div>
            <div className="flex flex-col gap-2.5 p-4.25">
              {visibleFindings.length === 0 ? (
                <p className="m-0 text-meta text-mute">Nothing flagged.</p>
              ) : (
                findings.map((f, idx) =>
                  dismissed.has(idx) ? null : (
                    <PromptCard
                      key={idx}
                      icon="▣"
                      tone="warn"
                      headline={f.title}
                      why={f.why}
                      action={{ label: f.action?.label ?? "Fix in editor", onClick: goToEditor }}
                      onDismiss={() => setDismissed((prev) => new Set(prev).add(idx))}
                      testId={`docs-ai-check-finding-${idx}`}
                    />
                  )
                )
              )}
            </div>
          </div>
        </div>

        <div className="w-full lg:w-80 lg:shrink-0">
          <div className="mb-4.5 rounded-card border border-line bg-surface">
            <div className="border-b border-hair px-4.25 py-3.5">
              <b className="text-heading font-medium">What's fine</b>
            </div>
            <div className="flex flex-col px-4.25 py-1.5">
              {fine.length === 0 ? (
                <p className="m-0 py-2.75 text-meta text-mute">Nothing confirmed yet.</p>
              ) : (
                fine.map((label, idx) => (
                  <div key={idx} className="flex items-center gap-3 border-b border-hair py-2.75 text-ui last:border-b-0" data-testid={`docs-ai-check-fine-${idx}`}>
                    <span className="flex-1">{label}</span>
                    <span className="inline-flex h-5.25 items-center rounded-control bg-ok-soft px-2.25 text-caption font-medium text-ok">Good</span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-card border border-line bg-surface">
            <div className="border-b border-hair px-4.25 py-3.5">
              <b className="text-heading font-medium">Worth knowing</b>
            </div>
            <div className="px-4.25 py-2.75">
              <p className="m-0 text-meta leading-relaxed text-mute">
                <span className="font-medium text-ink">This isn't legal advice.</span> It's a second
                pair of eyes for the obvious things, not a ruling.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

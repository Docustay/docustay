// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 17.35 — HOMEFIRSTRUN — THE FIRST-RUN HOME FOR A PRACTICE WITH NOBODY IN IT YET.
//
// ★★★ THE FRAME IS THE REFERENCE, NOT THIS COMMENT. Structure:
//   Hero band: "{n} things are costing you clients" with evidence sentence
//   Prompt cards band: up to N audit prompts (PromptCard component)
//   Setup band: "Get going — {done} of 5 done" with the five ruled setup steps
//   Audit band: "What we checked" with inline audit result cards
//
// ★★★ ONE TRUTH, TWO SURFACES: the setup steps are rendered through the existing SetupPanel
//   and SetupSheet, not a new parallel structure. Same checklist data, different surface.
//
// ★ When zero audit prompts exist, the hero band is absent and the setup band stands alone
//   with "We'll check your web address as soon as you give us one" placeholder.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useCallback } from "react";
import { request } from "@/lib/api.js";

export default function HomeFirstRun({ data = null, onOpen = null, onDismiss = null }) {
  // Dismiss a prompt card. MEASURED 27 Sep (F804/F-BUILD-2/F-BUILD-3): the ported Svelte source
  // called a per-instance `/api/prompts/{kind}/{subjectId}/dismiss` route with a `dismissKey` body
  // that does not exist — the real, only route is the flat `POST /api/prompts/dismiss`, body
  // `{kind, subjectId}` (src/routes/prompts.mjs:67-83). Same fix as Home.jsx (R4.001).
  const dismissPrompt = useCallback(
    async (prompt) => {
      if (!prompt.kind) return;
      try {
        await request("/api/prompts/dismiss", {
          method: "POST",
          body: { kind: prompt.kind, subjectId: prompt.subjectId ?? null },
        });
        onDismiss?.();
      } catch (err) {
        console.error("Failed to dismiss prompt:", err);
      }
    },
    [onDismiss]
  );

  // Navigate to a URL
  const navigate = useCallback(
    (url) => {
      onOpen?.(url);
    },
    [onOpen]
  );

  // Get button text based on endowed flag
  const getActionLabel = (row) => {
    if (row.endowed) return "See them";
    if (row.fixUrl) return "Go";
    return null;
  };

  const prompts = data?.audit?.prompts ?? [];
  const hasPrompts = prompts.length > 0;
  const visiblePrompts = prompts.slice(0, 3);

  return (
    <section
      data-testid="home-first-run"
      className="flex flex-col gap-6"
    >
      {/* ═══ HERO BAND (if audit prompts exist) ─────────────────────────────────────────────── */}
      {hasPrompts && (
        <>
          <div
            data-testid="home-first-run-hero"
            className="flex items-end gap-5"
          >
            <div className="flex items-end">
              <span className="text-figure-lg font-normal text-ink">
                {prompts.length}
              </span>
            </div>
            <div className="flex-1">
              <p className="m-0 text-sm text-ink-muted">
                <strong className="text-ink">{prompts.length}</strong> things are costing you clients
              </p>
              <p className="text-base text-ink-2 m-0 mt-3.5 leading-relaxed max-w-4xl">
                You haven't added anyone yet, so here's what we found from your web address alone.
                <strong className="font-medium"> None of this needed a password.</strong>
              </p>
            </div>
          </div>

          {/* PROMPT CARDS BAND */}
          <div data-testid="home-first-run-prompts" className="flex flex-col gap-2.5">
            {visiblePrompts.map((prompt, idx) => (
              <div
                  key={prompt.id || prompt.headline}
                  className="flex gap-3.5 rounded-2xl border border-line bg-surface p-4"
                >
                  <div
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl text-lg"
                    style={{
                      backgroundColor: "var(--color-brand-soft)",
                      color: "var(--color-brand)",
                    }}
                  >
                    {prompt.icon || "◈"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-base font-medium text-ink-2">
                      {prompt.headline}
                    </div>
                    {prompt.why && (
                      <div className="text-sm text-ink-muted mt-1 leading-1.55">
                        <strong className="text-ink-2 font-medium">Why:</strong> {prompt.why}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0 self-center">
                    {prompt.action && (
                      <button
                        onClick={prompt.action.onClick || (() => prompt.action.href && navigate(prompt.action.href))}
                        className="rounded-sm bg-surface border border-line px-3.5 h-8 text-sm font-medium text-ink-2 hover:bg-paper hover:text-ink"
                      >
                        {prompt.action.label || "Fix it"}
                      </button>
                    )}
                    <button
                      onClick={() => dismissPrompt(prompt)}
                      className="text-line hover:text-ink-muted p-1 text-base"
                      aria-label="Dismiss"
                    >
                      ×
                    </button>
                  </div>
                </div>
            ))}
          </div>
        </>
      )}

      {/* ═══ SETUP AND AUDIT COLUMNS ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-5.5 lg:flex-row lg:items-start">
        {/* LEFT COLUMN: SETUP STEPS */}
        <div className="flex-1 min-w-0">
          {data?.checklist?.firstRunFive && (
            <div
              data-testid="home-first-run-setup"
              className="rounded-2xl border border-line bg-surface overflow-hidden"
            >
              <div className="flex items-center justify-between px-4.5 py-3.5 border-b border-hair">
                <h2 className="text-base font-medium text-ink">Get going</h2>
                <span
                  data-testid="home-first-run-progress"
                  className="text-sm text-ink-muted"
                >
                  {data.checklist.summary?.done || 0} of 5 done
                </span>
              </div>

              <ul className="list-none m-0 p-0 flex flex-col gap-0">
                {data.checklist.firstRunFive.map((row, i) => (
                  <li
                    key={row.title + i}
                    data-status={row.status}
                    className="flex items-center gap-3 px-0 py-2.75 border-b border-hair text-sm text-ink last:border-b-0 data-[status=done]:text-color-success-600"
                  >
                    <span
                      data-testid={`home-first-run-step-${i + 1}`}
                      className="flex h-6 w-6 shrink-0 items-center justify-center font-mono text-sm text-ink-muted data-[status=done]:bg-color-success-50 data-[status=done]:text-color-success-700 data-[status=done]:rounded data-[status=done]:font-medium"
                    >
                      {row.status === "done" ? "✓" : i + 1}
                    </span>
                    <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                      <span className="font-medium text-ink">{row.title}</span>
                      {(row.endowedMessage || row.whatToDo) && (
                        <span className="text-xs text-ink-muted">{row.endowedMessage || row.whatToDo}</span>
                      )}
                    </span>
                    {getActionLabel(row) && (
                      <button
                        type="button"
                        data-testid={`home-first-run-step-action-${i + 1}`}
                        onClick={() => {
                          if (row.endowed) {
                            navigate("/items/services");
                          } else if (row.fixUrl) {
                            navigate(row.fixUrl);
                          }
                        }}
                        className="h-8 px-3.5 rounded-sm text-xs font-medium text-ink-2 border border-line bg-surface hover:bg-paper hover:text-ink shrink-0"
                      >
                        {getActionLabel(row)}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* RIGHT COLUMN: WHAT WE CHECKED */}
        <div className="w-full lg:w-80 lg:shrink-0">
          {hasPrompts ? (
            <div
              data-testid="home-first-run-audit"
              className="rounded-2xl border border-line bg-surface overflow-hidden"
            >
              <div className="flex items-center justify-between px-4.5 py-3.5 border-b border-hair">
                <h2 className="text-base font-medium text-ink">What we checked</h2>
                <button
                  type="button"
                  onClick={() => navigate("/run")}
                  data-testid="home-first-run-audit-link"
                  className="text-sm text-brand hover:underline bg-none border-none p-0 cursor-pointer"
                >
                  Open Run
                </button>
              </div>

              <div className="flex flex-col gap-0 px-4.5 py-3">
                {prompts.map((prompt) => (
                  <div
                    key={prompt.id || prompt.headline}
                    data-tone={prompt.tone}
                    className="flex gap-3 py-3 px-0 border-b border-hair text-sm last:border-b-0"
                  >
                    <span
                      className="h-2 w-2 rounded-full shrink-0 mt-1.5"
                      style={{
                        backgroundColor: `var(--color-${prompt.tone}-600)`,
                      }}
                    />
                    <span className="flex-1 min-w-0 leading-relaxed">
                      <span className="block text-ink font-medium">{prompt.headline}</span>
                      {prompt.why && (
                        <span className="block text-ink-muted text-xs mt-0.75">{prompt.why}</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div
              data-testid="home-first-run-audit-empty"
              className="rounded-2xl border border-line bg-surface overflow-hidden flex flex-col"
            >
              <div className="px-4.5 py-3.5 border-b border-hair">
                <h2 className="text-base font-medium text-ink">What we checked</h2>
              </div>
              <p className="m-0 px-4.5 py-10 text-center text-sm text-ink-muted">
                We'll check your web address as soon as you give us one.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

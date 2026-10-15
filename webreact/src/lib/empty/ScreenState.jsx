// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ScreenState — ported from webui/src/lib/empty/ScreenState.svelte: one of the six phases, or it throws.
// ★ R-41: the loading phase is the ONE large centred spinner (AppSpinner), shown after the same 300ms delay
//   the Svelte skeleton used (no flash on fast loads), same testid `screen-loading`, same "Loading…" copy.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { PHASES } from "./phase.js";
import { emptyBlockOf } from "./descriptor.js";
import EmptyState from "./EmptyState.jsx";
import ErrorPanel from "./ErrorPanel.jsx";
import AppSpinner from "@/lib/components/kit/AppSpinner.jsx";

export default function ScreenState({
  phase, empty = null, error = null, reason = null, testIds = {}, onClearFilters = null,
  onNavigate = null, children = null, subject = null, onRetry = null,
}) {
  if (!PHASES.includes(phase)) {
    throw new Error(
      `ScreenState: "${phase}" is not a screen state. The six are ${PHASES.join(", ")}. ` +
      `A screen that cannot say which state it is in will render its happy path during a failure.`);
  }
  const [showLoading, setShowLoading] = useState(false);
  useEffect(() => {
    setShowLoading(false);
    if (phase !== "loading") return undefined;
    const t = setTimeout(() => setShowLoading(true), 300);
    return () => clearTimeout(t);
  }, [phase]);

  if (phase === "loading") {
    return showLoading ? <div data-state="loading" aria-busy="true" className="flex flex-1"><AppSpinner testId={testIds.loading ?? "screen-loading"} label="Loading…" /></div> : null;
  }
  if (phase === "error") {
    return <ErrorPanel error={error} subject={subject} onRetry={onRetry} variant="page" testId={testIds.error ?? "screen-error"} retryTestId="screen-error-retry" />;
  }
  if (phase === "denied") {
    return (
      <div className="flex flex-col gap-1.5 rounded-card border border-line bg-surface p-6" data-state="denied" data-testid={testIds.denied ?? "screen-denied"} role="status">
        <p className="m-0 text-heading font-medium text-ink">You do not have access to this.</p>
        <p className="m-0 text-ui text-mute">{reason ?? "Your role does not include this view. An administrator of this practice can change that."}</p>
      </div>
    );
  }
  if (phase === "not-built") {
    return <EmptyState kind="not-built" headline="This is not built yet." line="This part of Workbench is still being built." reason={reason} testId="screen-not-built" onNavigate={onNavigate} />;
  }
  if (phase === "empty") {
    const block = emptyBlockOf({ emptyState: empty && typeof empty === "object" ? empty : null, empty: typeof empty === "string" ? empty : "" });
    return <EmptyState kind={block.kind} icon={block.icon ?? null} headline={block.headline ?? ""} line={block.line ?? ""} action={block.action ?? null} testId={testIds.empty ?? "screen-empty"} onClearFilters={onClearFilters} onNavigate={onNavigate} />;
  }
  return <div data-state="ready" data-testid="screen-ready">{children}</div>;
}

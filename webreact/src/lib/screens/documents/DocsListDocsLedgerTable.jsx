// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R6.010.T1 — DocsListDocsLedgerTable. Table component displaying documents within a ledger page.
// Props: { onNavigate, go, fetchError, load, rows, phase, VIEWS, activeView, filtered, displayPhase,
//          showControls, isRichEmpty, clearFilters, emptyPropFor, summaryText, stateFor, starterBusy,
//          starterError, startFromCoachingAgreement }
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import LedgerPage from "@/lib/lists/LedgerPage.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";
import { Button } from "@/lib/components/ui/button.jsx";

export default function DocsListDocsLedgerTable({
  onNavigate = null,
  go = null,
  fetchError = null,
  load = null,
  rows = [],
  phase = "loading",
  VIEWS = [],
  activeView = "all",
  filtered = [],
  displayPhase = "loading",
  showControls = false,
  isRichEmpty = false,
  clearFilters = null,
  emptyPropFor = null,
  summaryText = null,
  stateFor = null,
  starterBusy = false,
  starterError = null,
  startFromCoachingAgreement = null,
  controls = null,
  onView = null,
}) {
  return (
    <LedgerPage
      title="Templates"
      summary={summaryText}
      primary={{ label: "New template", onClick: () => go("/documents/templates/new") }}
      headerAction={isRichEmpty ? null : { label: "Building blocks", onClick: () => go("/documents/clauses") }}
      views={rows.length > 0 ? VIEWS : null}
      activeView={activeView}
      onView={onView}
      controls={showControls ? controls : null}
      testId="docs-ledger"
    >
      {isRichEmpty ? (
        <div className="rounded-card border border-line bg-surface px-6 py-14 text-center" data-state="empty" data-kind="first-run" data-testid="docs-empty-rich" role="status">
          <p className="m-0 mb-1.75 text-empty-title font-medium text-ink" data-testid="docs-empty-headline">No agreements or forms yet</p>
          <p className="m-0 mb-4.5 text-ui text-mute" data-testid="docs-empty-line" style={{ maxWidth: "46ch", marginLeft: "auto", marginRight: "auto" }}>
            A document is anything someone signs — an agreement, a consent form, an intake questionnaire. Attach one to a service and it goes out the moment someone books, and signing it can start the subscription on its own.
          </p>
          <div className="mb-0 flex justify-center gap-2 flex-wrap">
            <Button
              data-testid="docs-empty-starter"
              disabled={starterBusy}
              onClick={startFromCoachingAgreement}
            >Start from a coaching agreement</Button>
            <Button variant="outline" data-testid="docs-empty-scratch" onClick={() => go("/documents/templates/new")}>
              Write one from scratch
            </Button>
          </div>
          {starterError && (
            <p className="m-0 mt-2.5 text-ui text-destructive" role="alert" data-testid="docs-starter-error">{starterError}</p>
          )}
        </div>
      ) : (
        <ScreenState
          phase={displayPhase}
          error={phase === "error" ? fetchError : null}
          reason={phase === "denied" ? (fetchError?.message ?? null) : null}
          empty={emptyPropFor?.()}
          onClearFilters={clearFilters}
          onNavigate={onNavigate}
          subject="Documents"
          onRetry={load}
        >
          {displayPhase === "ready" && (
            <div className="overflow-auto rounded-card border border-line bg-surface" data-testid="docs-tbl">
              <table className="w-full border-collapse" data-testid="docs-table">
                <thead>
                  <tr>
                    <th className="h-9 border-b border-line bg-surface-sunken px-4 py-0 text-left text-caption font-medium text-mute" data-testid="docs-th-document">Document</th>
                    <th className="h-9 border-b border-line bg-surface-sunken px-4 py-0 text-left text-caption font-medium text-mute" data-testid="docs-th-type">Type</th>
                    <th className="h-9 border-b border-line bg-surface-sunken px-4 py-0 text-left text-caption font-medium text-mute" data-testid="docs-th-sent">Sent</th>
                    <th className="h-9 border-b border-line bg-surface-sunken px-4 py-0 text-left text-caption font-medium text-mute" data-testid="docs-th-signed">Signed</th>
                    <th className="h-9 border-b border-line bg-surface-sunken px-4 py-0 text-left text-caption font-medium text-mute" data-testid="docs-th-used">Where it's used</th>
                    <th className="h-9 border-b border-line bg-surface-sunken px-4 py-0 text-left text-caption font-medium text-mute" data-testid="docs-th-state">State</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => {
                    const state = stateFor?.(row) ?? {};
                    return (
                      <tr
                        key={row.id}
                        className="cursor-pointer hover:bg-paper"
                        data-testid="docs-row"
                        data-id={row.id}
                        onClick={() => go(`/documents/templates/${row.id}`)}
                      >
                        <td className="h-10 border-b border-line-soft px-4 py-0 text-ui" data-testid={`docs-cell-name-${row.id}`}>{row.name}</td>
                        <td className="h-10 border-b border-line-soft px-4 py-0 text-ui" data-testid={`docs-cell-type-${row.id}`}>{row.type}</td>
                        <td className="h-10 border-b border-line-soft px-4 py-0 text-ui font-variant-numeric tabular-nums" data-testid={`docs-cell-sent-${row.id}`}>
                          {row.sent_instances != null ? `${row.sent_instances} sent` : "—"}
                        </td>
                        <td className="h-10 border-b border-line-soft px-4 py-0 text-ui font-variant-numeric tabular-nums text-mute" title="Not tracked by this list." data-testid={`docs-cell-signed-${row.id}`}>—</td>
                        <td className="h-10 border-b border-line-soft px-4 py-0 text-ui text-mute" title="Not tracked by this list." data-testid={`docs-cell-used-${row.id}`}>—</td>
                        <td className="h-10 border-b border-line-soft px-4 py-0 text-ui" data-testid={`docs-cell-state-${row.id}`}>
                          <StatusBadge label={state.label ?? "—"} tone={state.tone ?? "neutral"} testId={`docs-state-${row.id}`} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </ScreenState>
      )}
    </LedgerPage>
  );
}

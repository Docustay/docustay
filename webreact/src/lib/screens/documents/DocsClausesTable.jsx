// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R6.007.T1 — DocsClausesTable. Table component displaying clauses with a sidebar rail.
// Props: { onNavigate, testId, basePath, phase, error, rows, summary, openCreate, actionsFor }
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import LedgerPage from "@/lib/lists/LedgerPage.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";
import RowActions from "@/lib/lists/RowActions.jsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/lib/components/ui/card.jsx";
import { Checkbox } from "@/lib/components/ui/checkbox.jsx";

// ★ Island wall (ISLAND-PROGRAMS §2 FE): a local uuid check, not `isUuid` from record/deleteTypes (that file is outside the island).
const isUuid = (v) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export default function DocsClausesTable({
  onNavigate = null,
  testId = "docs-clauses",
  basePath = "/documents/clauses",
  phase = "loading",
  error = null,
  rows = [],
  summary = "",
  openCreate = null,
  actionsFor = null,
  bulk = null,
}) {
  // selection for a card list: the same checkbox the shared table cells use, rendered in a card instead of a <td>
  const ids = rows.filter((r) => isUuid(r.id)).map((r) => r.id);
  const allSelected = ids.length > 0 && ids.every((id) => bulk?.selected.has(id));
  const someSelected = !allSelected && ids.some((id) => bulk?.selected.has(id));
  const toggleAll = () => {
    const next = new Set(bulk.selected);
    if (allSelected) ids.forEach((id) => next.delete(id)); else ids.forEach((id) => next.add(id));
    bulk.setSelected(next);
  };
  const toggleOne = (id) => {
    const next = new Set(bulk.selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    bulk.setSelected(next);
  };
  return (
    <LedgerPage
      title="Clauses"
      summary={summary}
      primary={{ label: "New clause", onClick: openCreate }}
      testId={testId}
    >
      <ScreenState
        phase={phase}
        error={phase === "error" ? error : null}
        reason={phase === "denied" ? error?.message ?? null : null}
        empty={{
          kind: "first-run",
          headline: "Write your first clause",
          line: "A clause is a reusable section of a contract — write it once and drop it into any agreement.",
          action: { label: "New clause", href: `${basePath}?new=1` },
        }}
        onNavigate={onNavigate}
      >
        <div className="flex items-start gap-5.5" data-testid={`${testId}-layout`}>
          <div className="flex min-w-0 flex-1 flex-col gap-2.25" data-testid={`${testId}-list`}>
            {bulk?.bulkBar}
            {bulk?.selectable && (
              <div className="flex items-center gap-3 px-3.75">
                <Checkbox
                  checked={allSelected ? true : someSelected ? "indeterminate" : false}
                  onCheckedChange={toggleAll}
                  aria-label="Select all shown rows"
                  data-testid="list-select-all"
                />
                <span className="text-caption text-mute">Select all</span>
              </div>
            )}
            {rows.map((row) => (
              <Card
                key={row.id}
                className="flex-row items-center gap-3 rounded-control border border-line px-3.75 py-3.25 ring-0"
                data-testid={`${testId}-row-${row.id}`}
              >
                {bulk?.selectable && (
                  <Checkbox
                    checked={bulk.selected.has(row.id)}
                    onCheckedChange={() => toggleOne(row.id)}
                    aria-label="Select row"
                    data-testid={`list-select-row-${row.id}`}
                  />
                )}
                <span className="w-4 text-[13px] text-chevron" aria-hidden="true">
                  ⋮⋮
                </span>
                <div className="min-w-0 flex-1">
                  <b className="block text-ui font-medium text-ink" data-testid={`${testId}-name-${row.id}`}>
                    {row.name}
                  </b>
                  <span className="mt-0.5 block text-caption text-mute" data-testid={`${testId}-gist-${row.id}`}>
                    {row.gist}
                  </span>
                </div>
                {(() => {
                  const n = Number(row.usageCount) || 0;
                  return (
                    <StatusBadge
                      label={n > 0 ? `${n} doc${n === 1 ? "" : "s"}` : "Not used"}
                      tone={n > 0 ? "ok" : "neutral"}
                      testId={`${testId}-usage-${row.id}`}
                    />
                  );
                })()}
                <RowActions
                  actions={actionsFor?.(row) ?? []}
                  row={row}
                />
              </Card>
            ))}
          </div>

          <div className="w-80 flex-shrink-0" data-testid={`${testId}-rail`}>
            <Card>
              <CardHeader>
                <CardTitle>Why these exist</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div data-testid={`${testId}-why-once`}>
                  <b className="block text-ui font-medium text-ink">Change it once</b>
                  <span className="mt-1 block text-caption leading-relaxed text-mute">
                    Edit the cancellation clause and every agreement that uses it is updated.
                    Already-signed ones never change.
                  </span>
                </div>
                <div data-testid={`${testId}-why-legal`}>
                  <b className="block text-ui font-medium text-ink">Nothing here is legal advice</b>
                  <span className="mt-1 block text-caption leading-relaxed text-mute">
                    These are a starting point written in plain words. Have a lawyer read them
                    if the stakes warrant it.
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </ScreenState>
    </LedgerPage>
  );
}

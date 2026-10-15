// Mirrors CategoriesPageItemsCategoriesTable.jsx exactly — same list shape one level up (Programs
// follow-up brief, 30 Sep 2026, Parts 1/3/5). The one real difference: a Program's name links to
// its detail page (Part 3), and "what's in it" counts across all three catalogue subjects, not
// services only (a category only ever counted services).
import { LedgerPage } from "@/lib/components/kit/archetypes/index.js";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import RowActions from "@/lib/lists/RowActions.jsx";
import { BulkHeadCell, BulkRowCell } from "@/lib/lists/BulkCells.jsx";

export default function ProgramsPageItemsProgramsTable({
  onNavigate,
  isCoach,
  VISIBILITY_LABEL,
  phase,
  error,
  rows,
  openCreate,
  deleteErrors,
  actionsFor,
  contentsText,
  bulk = null,
}) {
  function go(href) {
    if (onNavigate) onNavigate(href);
    else window.location.assign(href);
  }

  return (
    <LedgerPage
      title="Programs"
      summary="Which line of business a service, package or plan belongs to — Life Coaching, Recovery Coaching, and any others you add."
      primary={isCoach ? null : { label: "New program", onClick: openCreate }}
      testId="items-programs"
    >
      <ScreenState
        phase={phase}
        error={phase === "error" ? error : null}
        reason={phase === "denied" ? (error?.message ?? null) : null}
        empty={{
          kind: "first-run",
          headline: "No programs yet",
          line: "Every service, package or plan belongs to a program. Life Coaching and Recovery Coaching are seeded for you; add more if you run others.",
          action: isCoach ? null : { label: "New program", href: "/items/programs?new=1" },
        }}
        onNavigate={onNavigate}
      >
        <div className="overflow-auto rounded-card border border-line bg-surface" data-testid="items-programs-table-scroll">
          <table className="w-full border-collapse" data-testid="items-programs-table">
            <thead>
              <tr>
                <BulkHeadCell bulk={bulk} rows={rows} />
                <th scope="col" className="h-9 border-b border-line bg-surface-2 px-4 text-left text-xs font-medium text-mute">Program</th>
                <th scope="col" className="h-9 border-b border-line bg-surface-2 px-4 text-left text-xs font-medium text-mute">What&rsquo;s in it</th>
                <th scope="col" className="h-9 border-b border-line bg-surface-2 px-4 text-left text-xs font-medium text-mute">On the booking page</th>
                <th scope="col" className="h-9 border-b border-line bg-surface-2 px-4 text-left text-xs font-medium text-mute"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} data-testid={`items-programs-row-${row.id}`}>
                  <BulkRowCell bulk={bulk} id={row.id} />
                  <td className="h-11.5 border-b border-hair px-4 text-sm text-ink" data-testid={`items-programs-name-${row.id}`}>
                    <a
                      href={`/items/programs/${row.id}`}
                      onClick={(e) => { e.preventDefault(); go(`/items/programs/${row.id}`); }}
                      className="font-medium text-brand hover:text-brand no-underline"
                    >
                      {row.name}
                    </a>
                  </td>
                  <td className="h-11.5 border-b border-hair px-4 text-sm text-ink" data-testid={`items-programs-contents-${row.id}`}>{contentsText(row)}</td>
                  <td className="h-11.5 border-b border-hair px-4 text-sm text-ink" data-testid={`items-programs-visibility-${row.id}`}>
                    {VISIBILITY_LABEL[row.visibility] ?? row.visibility}
                  </td>
                  <td className="h-11.5 border-b border-hair px-4 text-sm text-ink text-right">
                    <RowActions actions={actionsFor(row)} row={row} />
                  </td>
                </tr>
              ))}
              {rows.map((row) =>
                deleteErrors[row.id] ? (
                  <tr key={`${row.id}-error`}>
                    <td colSpan={bulk?.selectable ? 5 : 4} className="p-0 border-b border-line">
                      <div className="flex gap-2.5 items-start bg-bad-soft text-bad-ink border border-bad-border rounded-lg p-3 m-2.5 text-xs leading-relaxed" data-testid={`items-programs-delete-error-${row.id}`} role="alert">
                        <span aria-hidden="true">!</span>
                        <span>
                          {deleteErrors[row.id].message}{deleteErrors[row.id].requestId
                            ? ` (ref ${deleteErrors[row.id].requestId})` : ""}
                        </span>
                      </div>
                    </td>
                  </tr>
                ) : null
              )}
            </tbody>
          </table>
        </div>
      </ScreenState>
    </LedgerPage>
  );
}

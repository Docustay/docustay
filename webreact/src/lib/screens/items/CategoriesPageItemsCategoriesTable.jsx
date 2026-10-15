import { LedgerPage } from "@/lib/components/kit/archetypes/index.js";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import RowActions from "@/lib/lists/RowActions.jsx";
import { BulkHeadCell, BulkRowCell } from "@/lib/lists/BulkCells.jsx";

export default function CategoriesPageItemsCategoriesTable({
  onNavigate,
  isCoach,
  VISIBILITY_LABEL,
  phase,
  error,
  rows,
  openCreate,
  deleteErrors,
  actionsFor,
  servicesText,
  bulk = null,
}) {
  return (
    <LedgerPage
      title="Categories"
      summary="How your services group together, on your booking page and in reports."
      primary={isCoach ? null : { label: "New category", onClick: openCreate }}
      testId="items-categories"
    >
      <ScreenState
        phase={phase}
        error={phase === "error" ? error : null}
        reason={phase === "denied" ? (error?.message ?? null) : null}
        empty={{
          kind: "first-run",
          headline: "No groups yet",
          line: "Categories become the headings on your booking page. One is plenty to start.",
          action: isCoach ? null : { label: "New category", href: "/items/categories?new=1" },
        }}
        onNavigate={onNavigate}
      >
        <div className="overflow-auto rounded-card border border-line bg-surface" data-testid="items-categories-table-scroll">
          <table className="w-full border-collapse" data-testid="items-categories-table">
            <thead>
              <tr>
                <BulkHeadCell bulk={bulk} rows={rows} />
                <th scope="col" className="h-9 border-b border-line bg-surface-2 px-4 text-left text-xs font-medium text-mute">Category</th>
                <th scope="col" className="h-9 border-b border-line bg-surface-2 px-4 text-left text-xs font-medium text-mute">What&rsquo;s in it</th>
                <th scope="col" className="h-9 border-b border-line bg-surface-2 px-4 text-left text-xs font-medium text-mute">On the booking page</th>
                <th scope="col" className="h-9 border-b border-line bg-surface-2 px-4 text-left text-xs font-medium text-mute">Booked this year</th>
                <th scope="col" className="h-9 border-b border-line bg-surface-2 px-4 text-left text-xs font-medium text-mute"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} data-testid={`items-categories-row-${row.id}`}>
                  <BulkRowCell bulk={bulk} id={row.id} />
                  <td className="h-11.5 border-b border-hair px-4 text-sm text-ink" data-testid={`items-categories-name-${row.id}`}>
                    <b className="font-medium">{row.name}</b>
                  </td>
                  <td className="h-11.5 border-b border-hair px-4 text-sm text-ink" data-testid={`items-categories-services-${row.id}`}>{servicesText(row.services_count)}</td>
                  <td className="h-11.5 border-b border-hair px-4 text-sm text-ink" data-testid={`items-categories-visibility-${row.id}`}>
                    {VISIBILITY_LABEL[row.visibility] ?? row.visibility}
                  </td>
                  <td className="h-11.5 border-b border-hair px-4 text-sm text-ink font-variant-numeric-tabular-nums" data-testid={`items-categories-booked-${row.id}`}>
                    {row.booked_this_year ?? 0}
                  </td>
                  <td className="h-11.5 border-b border-hair px-4 text-sm text-ink text-right">
                    <RowActions actions={actionsFor(row)} row={row} />
                  </td>
                </tr>
              ))}
              {rows.map((row) =>
                deleteErrors[row.id] ? (
                  <tr key={`${row.id}-error`}>
                    <td colSpan={bulk?.selectable ? 6 : 5} className="p-0 border-b border-line">
                      <div className="flex gap-2.5 items-start bg-bad-soft text-bad-ink border border-bad-border rounded-lg p-3 m-2.5 text-xs leading-relaxed" data-testid={`items-categories-delete-error-${row.id}`} role="alert">
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

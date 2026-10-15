// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ServicesListServicesLedgerTable — the table component for ServicesList (R5.042.T1).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import LedgerPage from "@/lib/lists/LedgerPage.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import RowActions from "@/lib/lists/RowActions.jsx";
import BulkBar from "@/lib/lists/BulkBar.jsx";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";
import QuickCreateRow from "@/lib/components/kit/QuickCreateRow.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import { Checkbox } from "@/lib/components/ui/checkbox.jsx";
import { ProgramChips } from "@/lib/programs/ProgramChip.jsx";

export default function ServicesListServicesLedgerTable({
  path,
  onNavigate,
  go,
  viewData,
  fetchError,
  load,
  phase,
  rows,
  hasPriceColumn,
  canWrite,
  VIEWS,
  activeView,
  filtered,
  displayPhase,
  showControls,
  bulkAllowed,
  isRichEmpty,
  clearFilters,
  emptyPropFor,
  summaryText,
  lengthText,
  priceText,
  thisYearText,
  statusTone,
  initials,
  rowActions,
  selected,
  toggleRow,
  toggleAll,
  quickError,
  quickSave,
  controls,
  bulkBar,
  onViewChange,
  onRefetch,
  bulkActions,
  onBulkClear,
  duplicateOne,
  setActive,
  archiveOne,
  restoreOne,
}) {
  if (isRichEmpty) {
    return (
      <LedgerPage
        title={viewData?.title ?? "Services"}
        summary={summaryText}
        primary={canWrite === true ? { label: "New service", onClick: () => go(`${path}/new`) } : null}
        views={(canWrite === false && rows.length === 0) ? null : VIEWS}
        activeView={activeView}
        onView={onViewChange}
        controls={showControls ? controls : null}
        testId="services-ledger"
      >
        {bulkAllowed && !isRichEmpty && bulkBar && bulkBar}

        <div className="rounded-card border border-line bg-surface p-14 text-center" data-state="empty" data-testid="services-empty-rich" role="status">
          <p className="m-0 mb-1.75 text-lg font-medium text-ink" data-testid="services-empty-headline">Nothing to sell yet</p>
          <p className="m-0 mb-4.5 mx-auto max-w-prose text-sm text-mute leading-relaxed" data-testid="services-empty-line">
            A service is a thing someone books and pays for — a session, a class, a consultation. Nothing
            can be booked, packaged or invoiced until one exists.
          </p>
          <div className="flex gap-2 justify-center flex-wrap">
            <Button data-testid="services-empty-create" onClick={() => go(`${path}/new`)}>
              Create your first service
            </Button>
            <Button variant="outline" data-testid="services-empty-import" onClick={() => go("/settings/import")}>
              Bring them from another system
            </Button>
          </div>
          <QuickCreateRow
            placeholderName="Name it"
            placeholderPrice="$0"
            onSave={quickSave}
            testId="services-quick-create"
          />
          {quickError && (
            <p className="mt-2.5 text-control text-danger" role="alert" data-testid="services-quick-error">{quickError}</p>
          )}
        </div>
      </LedgerPage>
    );
  }

  return (
    <LedgerPage
      title={viewData?.title ?? "Services"}
      summary={summaryText}
      primary={canWrite === true ? { label: "New service", onClick: () => go(`${path}/new`) } : null}
      views={(canWrite === false && rows.length === 0) ? null : VIEWS}
      activeView={activeView}
      onView={onViewChange}
      controls={showControls ? controls : null}
      testId="services-ledger"
    >
      {bulkAllowed && !isRichEmpty && bulkBar && bulkBar}

      <ScreenState
        phase={displayPhase}
        error={phase === "error" ? fetchError : null}
        reason={phase === "denied" ? (fetchError?.message ?? null) : null}
        empty={emptyPropFor()}
        onClearFilters={clearFilters}
        onNavigate={go}
        subject="Services"
        onRetry={load}
      >
        {displayPhase === "ready" && (
          <div className="w-full">
            <table className="w-full border-collapse bg-surface border border-line rounded-lg overflow-hidden" data-testid="services-table">
              <thead>
                <tr>
                  {canWrite === true && (
                    <th className="w-8 h-9 px-4 py-0 text-left text-sm font-medium text-mute border-b border-line bg-surface-sunken">
                      <Checkbox
                        checked={filtered.length > 0 && selected.size === filtered.length}
                        onCheckedChange={toggleAll}
                        aria-label="Select all"
                        data-testid="services-select-all"
                      />
                    </th>
                  )}
                  <th className="h-9 px-4 py-0 text-left text-sm font-medium text-mute border-b border-line bg-surface-sunken" data-testid="services-th-service">Service</th>
                  <th className="h-9 px-4 py-0 text-left text-sm font-medium text-mute border-b border-line bg-surface-sunken" data-testid="services-th-category">Category</th>
                  <th className="h-9 px-4 py-0 text-left text-sm font-medium text-mute border-b border-line bg-surface-sunken" data-testid="services-th-program">Program</th>
                  <th className="h-9 px-4 py-0 text-left text-sm font-medium text-mute border-b border-line bg-surface-sunken" data-testid="services-th-length">Length</th>
                  {hasPriceColumn && <th className="h-9 px-4 py-0 text-left text-sm font-medium text-mute border-b border-line bg-surface-sunken" data-testid="services-th-price">Price</th>}
                  <th className="h-9 px-4 py-0 text-left text-sm font-medium text-mute border-b border-line bg-surface-sunken" data-testid="services-th-status">Status</th>
                  <th className="h-9 px-4 py-0 text-left text-sm font-medium text-mute border-b border-line bg-surface-sunken" data-testid="services-th-this-year">This year</th>
                  {canWrite === true && <th className="h-9 px-4 py-0 text-right text-sm font-medium text-mute border-b border-line bg-surface-sunken" aria-hidden="true"></th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.id} data-testid="services-row" data-id={row.id}>
                    {canWrite === true && (
                      <td className="h-10 px-4 py-0 border-b border-line-soft">
                        <Checkbox
                          checked={selected.has(row.id)}
                          onCheckedChange={() => toggleRow(row.id)}
                          aria-label={`Select ${row.name}`}
                          data-testid={`services-select-${row.id}`}
                        />
                      </td>
                    )}
                    <td className="h-10 px-4 py-0 border-b border-line-soft" data-testid={`services-cell-service-${row.id}`}>
                      <span className="flex items-center gap-2">
                        <span className="w-7 h-7 rounded-full bg-primary-wash text-primary flex items-center justify-center text-xs font-medium flex-shrink-0" aria-hidden="true">{initials(row.name)}</span>
                        <a
                          href={`/items/services/${row.id}`}
                          onClick={(e) => {
                            if (onNavigate) {
                              e.preventDefault();
                              go(`/items/services/${row.id}`);
                            }
                          }}
                          className="text-brand hover:text-brand no-underline"
                        >
                          {row.name}
                        </a>
                      </span>
                    </td>
                    <td className="h-10 px-4 py-0 border-b border-line-soft" data-testid={`services-cell-category-${row.id}`}>{row.category_name ?? "—"}</td>
                    <td className="h-10 px-4 py-0 border-b border-line-soft" data-testid={`services-cell-program-${row.id}`}><ProgramChips ids={[row.program_id]} /></td>
                    <td className="h-10 px-4 py-0 border-b border-line-soft font-variant-numeric tabular-nums" data-testid={`services-cell-length-${row.id}`}>{lengthText(row)}</td>
                    {hasPriceColumn && <td className="h-10 px-4 py-0 border-b border-line-soft font-variant-numeric tabular-nums" data-testid={`services-cell-price-${row.id}`}>{priceText(row)}</td>}
                    <td className="h-10 px-4 py-0 border-b border-line-soft" data-testid={`services-cell-status-${row.id}`}>
                      <StatusBadge
                        label={row.status ?? "—"}
                        tone={statusTone(row.status)}
                        testId={`services-status-${row.id}`}
                      />
                    </td>
                    <td className="h-10 px-4 py-0 border-b border-line-soft font-variant-numeric tabular-nums" data-testid={`services-cell-this-year-${row.id}`}>{thisYearText(row)}</td>
                    {canWrite === true && (
                      <td className="h-10 px-4 py-0 border-b border-line-soft text-right">
                        <RowActions actions={rowActions(row)} row={row} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ScreenState>
    </LedgerPage>
  );
}

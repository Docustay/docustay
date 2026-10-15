// ═══════════════════════════════════════════════════════════════════════════════════════════════
// SessionsLedgerSessionsLedgerTable — the table as its own component
// Built on DataTable (kit component) from webui/src/lib/screens/engagements/SessionsLedger.svelte:350-404
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { ProgramChips } from "@/lib/programs/ProgramChip.jsx";
import RowActions from "@/lib/lists/RowActions.jsx";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";
import { BulkHeadCell, BulkRowCell } from "@/lib/lists/BulkCells.jsx";

export default function SessionsLedgerSessionsLedgerTable({
  view,
  onNavigate,
  go,
  phase,
  columns,
  whenLabel,
  stateTone,
  summaryText,
  VIEWS,
  activeView,
  clearFilters,
  filtered,
  displayPhase,
  emptyPropFor,
  rowActions,
  bulk = null,
}) {
  return (
    <table className="w-full border-collapse bg-surface border border-line rounded-lg overflow-hidden" data-testid="sessions-table">
      <thead>
        <tr>
          <BulkHeadCell bulk={bulk} rows={filtered} />
          {columns.map((c) => (
            <th
              key={c.field}
              className="h-9 px-4 text-left text-xs font-medium text-mute border-b border-line bg-surface-sunken"
              data-testid={`sessions-th-${c.field}`}
            >
              {c.label}
            </th>
          ))}
          <th className="h-9 px-4 text-left text-xs font-medium text-mute border-b border-line bg-surface-sunken" aria-hidden="true"></th>
        </tr>
      </thead>
      <tbody>
        {filtered.map((row) => (
          <tr key={row.id} className="border-b border-line-soft last:border-b-0" data-testid="sessions-row" data-id={row.id}>
            <BulkRowCell bulk={bulk} id={row.id} />
            {columns.map((c) => (
              <td
                key={`${row.id}-${c.field}`}
                className="h-10 px-4 border-b border-line-soft last:border-b-0 overflow-wrap break-word"
                data-testid={`sessions-cell-${c.field}-${row.id}`}
              >
                {c.field === "starts_at"
                  ? whenLabel(row.starts_at)
                  : c.field === "state_label"
                  ? <StatusBadge label={row.state_label} tone={stateTone(row.state_label)} testId={`sessions-state-chip-${row.id}`} />
                  : c.format === "program" ? <ProgramChips ids={[row[c.field]].filter(Boolean)} /> : (row[c.field] ?? "—")}
              </td>
            ))}
            <td className="h-10 px-4 text-right">
              <RowActions actions={rowActions(row)} row={row} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

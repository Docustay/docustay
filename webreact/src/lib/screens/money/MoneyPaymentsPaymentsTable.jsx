// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R6.045.T1 — MoneyPayments › MoneyPaymentsPaymentsTable
// Ported from webui/src/lib/screens/money/MoneyPayments.svelte:39-66
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import LedgerPage from "@/lib/lists/LedgerPage.jsx";
import LedgerRow from "@/lib/shared/LedgerRow.jsx";
import { Checkbox } from "@/lib/components/ui/checkbox.jsx";
import RowActions from "@/lib/lists/RowActions.jsx";
import { isUuid } from "@/lib/record/deleteTypes.js";
import ProgramFilter from "@/lib/programs/ProgramFilter.jsx";
import { ProgramChips } from "@/lib/programs/ProgramChip.jsx";
import { usePrograms } from "@/lib/programs/programs.js";

export default function MoneyPaymentsPaymentsTable({ onNavigate = null, rows = [], summary = "", bulk = null, programFilter = "all", onProgramFilter = () => {}, hasAnyRows = rows.length > 0 }) {
  const { programs } = usePrograms();
  const shown = rows.slice(0, 10);
  const ids = shown.filter((r) => isUuid(r.id)).map((r) => r.id);
  const all = Boolean(bulk?.selectable) && ids.length > 0 && ids.every((id) => bulk.selected.has(id));
  const some = !all && Boolean(bulk?.selectable) && ids.some((id) => bulk.selected.has(id));
  const toggleAll = () => { const next = new Set(bulk.selected); if (all) ids.forEach((id) => next.delete(id)); else ids.forEach((id) => next.add(id)); bulk.setSelected(next); };
  const toggleRow = (id) => { const next = new Set(bulk.selected); if (next.has(id)) next.delete(id); else next.add(id); bulk.setSelected(next); };
  return (
    <LedgerPage
      title="Payments"
      summary={summary}
      primary={{
        label: "Take a payment",
        onClick: () => onNavigate?.("/money/virtual-terminal"),
      }}
      onNavigate={onNavigate}
      controls={hasAnyRows && programs.length >= 2
        ? <ProgramFilter value={programFilter} onChange={onProgramFilter} testId="payments-filter-program" />
        : null}
    >
      {rows.length > 0 && (
        <div className="bg-surface border border-line rounded-card mb-4.5 overflow-hidden">
          <div className="px-4.5 py-3.5 border-b border-hair font-medium text-ui text-ink">Your recent payments</div>
          {bulk?.selectable && (
            <div className="flex items-center gap-2 border-b border-hair px-4.5 py-2">
              <Checkbox checked={all ? true : some ? "indeterminate" : false} onCheckedChange={toggleAll} aria-label="Select all shown rows" data-testid="list-select-all" />
              <span className="text-meta text-mute">Select all</span>
            </div>
          )}
          {bulk?.bulkBar}
          <div className="px-4.5 pt-1.5 pb-3.5">
            {shown.map((row) => (
              <LedgerRow
                key={row.id}
                amount={row.amountMinor}
                who={row.payerName}
                label={<>{row.method} <ProgramChips ids={row.program_ids} /></>}
                date={row.createdAt}
                onClick={() => onNavigate?.(`/money/payments/${row.id}`)}
                leading={bulk?.selectable ? <Checkbox checked={bulk.selected.has(row.id)} onCheckedChange={() => toggleRow(row.id)} aria-label="Select row" data-testid={`list-select-row-${row.id}`} /> : null}
                trailing={bulk?.selectable ? <RowActions row={row} actions={[]} /> : null}
              />
            ))}
          </div>
        </div>
      )}
    </LedgerPage>
  );
}

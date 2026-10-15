// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R6.041.T1 — MoneyEstimates › MoneyEstimatesTable1Table
// Ported from webui/src/lib/screens/money/MoneyEstimates.svelte:199-245
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";
import { BulkHeadCell, BulkRowCell, RowMenuHeadCell, RowMenuCell } from "@/lib/lists/BulkCells.jsx";

export default function MoneyEstimatesTable1Table({
  filteredEstimates = [],
  formatAmount = (minor) => `$${(minor / 100).toFixed(2)}`,
  getStatusTag = () => "mute",
  handleRowClick = () => {},
  bulk = null,
}) {
  return (
    <div className="overflow-hidden rounded-card border border-line bg-surface">
      <table className="w-full border-collapse">
        <thead>
          <tr className="h-9 border-b border-line bg-surface-2">
            <BulkHeadCell bulk={bulk} rows={filteredEstimates} />
            <th className="px-4 text-left text-xs font-medium text-mute">Number</th>
            <th className="px-4 text-left text-xs font-medium text-mute">Who</th>
            <th className="px-4 text-left text-xs font-medium text-mute">Title</th>
            <th className="px-4 text-left text-xs font-medium text-mute">Amount</th>
            <th className="px-4 text-left text-xs font-medium text-mute">Good until</th>
            <th className="px-4 text-left text-xs font-medium text-mute">State</th>
            <RowMenuHeadCell bulk={bulk} />
          </tr>
        </thead>
        <tbody>
          {filteredEstimates.map((estimate) => (
            <tr
              key={estimate.id}
              onClick={() => handleRowClick(estimate)}
              className="h-11.5 border-b border-hair last:[&>td]:border-b-0 cursor-pointer transition-colors hover:bg-surface-soft"
            >
              <BulkRowCell bulk={bulk} id={estimate.id} />
              <td className="px-4 text-sm text-ink tabular-nums">{estimate.estimate_number}</td>
              <td className="px-4 text-sm text-ink">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-medium text-brand">
                    {estimate.recipient_initials || "?"}
                  </span>
                  <span>{estimate.recipient_display_name || estimate.recipient_email || estimate.id}</span>
                </div>
              </td>
              <td className="px-4 text-sm text-ink">{estimate.title || "—"}</td>
              <td className="px-4 text-sm text-ink tabular-nums">{formatAmount(estimate.amount_minor || 0)}</td>
              <td className="px-4 text-sm text-ink-2 tabular-nums text-xs">
                {estimate.expires_at
                  ? new Date(estimate.expires_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })
                  : "—"}
              </td>
              <td className="px-4 text-sm text-ink">
                <StatusBadge
                  label={estimate.status}
                  tone={getStatusTag(estimate.status)}
                  testId={`estimate-status-${estimate.id}`}
                />
                {estimate.status === "declined" && estimate.decline_reason && (
                  <span className="text-xs opacity-70" title={estimate.decline_reason}>
                    {estimate.decline_reason}
                  </span>
                )}
              </td>
              <RowMenuCell bulk={bulk} row={estimate} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

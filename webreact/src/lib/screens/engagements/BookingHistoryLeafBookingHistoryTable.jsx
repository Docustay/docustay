// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R5.006.T1 — BookingHistoryLeaf › BookingHistoryLeafBookingHistoryTable: the table as its own
// component, built on DataTable inside LedgerPage. Ported from
// webui/src/lib/screens/engagements/BookingHistoryLeaf.svelte:252-311 — same structure, behavior.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";

export default function BookingHistoryLeafBookingHistoryTable({
  phase,
  error,
  filtered,
  displayPhase,
  clearFilters,
  emptyPropFor,
  whenLabel,
  whatTone,
  initials,
}) {
  if (displayPhase !== "ready") {
    return null;
  }

  return (
    <div className="overflow-auto rounded-card border border-line bg-surface" data-testid="booking-history">
      <table className="w-full border-collapse" data-testid="history-table">
        <thead>
          <tr>
            <th className="h-9 border-b border-line bg-surface-sunken px-4 text-left text-caption font-medium text-mute" data-testid="history-th-when">
              When
            </th>
            <th className="h-9 border-b border-line bg-surface-sunken px-4 text-left text-caption font-medium text-mute" data-testid="history-th-what">
              What
            </th>
            <th className="h-9 border-b border-line bg-surface-sunken px-4 text-left text-caption font-medium text-mute" data-testid="history-th-who">
              Who
            </th>
            <th className="h-9 border-b border-line bg-surface-sunken px-4 text-left text-caption font-medium text-mute" data-testid="history-th-session">
              Which session
            </th>
            <th className="h-9 border-b border-line bg-surface-sunken px-4 text-left text-caption font-medium text-mute" data-testid="history-th-wherefrom">
              Where from
            </th>
            <th className="h-9 border-b border-line bg-surface-sunken px-4 text-left text-caption font-medium text-mute" data-testid="history-th-note">
              Note
            </th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((row, i) => (
            <tr key={row.at + "-" + i} data-testid="history-row">
              <td
                className="h-10 border-b border-hair px-4 py-0 text-ui text-ink tabular-nums last:[&>td]:border-b-0"
                data-testid="history-cell-when"
              >
                {whenLabel(row.at)}
              </td>
              <td className="h-10 border-b border-hair px-4 py-0 text-ui text-ink last:[&>td]:border-b-0" data-testid="history-cell-what">
                <StatusBadge
                  testId="history-what-chip"
                  label={row.what}
                  tone={whatTone(row.what) === "bad" ? "bad" : "neutral"}
                />
              </td>
              <td className="h-10 border-b border-hair px-4 py-0 text-ui text-ink last:[&>td]:border-b-0" data-testid="history-cell-who">
                {row.who ? (
                  <div className="flex items-center gap-[var(--gap)]">
                    <span className="h-7 w-7 flex-shrink-0 rounded-full bg-[var(--primary-wash)] flex items-center justify-center text-xs font-medium text-[var(--primary)]">
                      {initials(row.who)}
                    </span>
                    {row.who}
                  </div>
                ) : (
                  "—"
                )}
              </td>
              <td className="h-10 border-b border-hair px-4 py-0 text-ui text-ink last:[&>td]:border-b-0" data-testid="history-cell-session">
                {row.session ?? "—"}
              </td>
              <td className="h-10 border-b border-hair px-4 py-0 text-ui text-ink last:[&>td]:border-b-0" data-testid="history-cell-wherefrom">
                {row.whereFrom ?? "—"}
              </td>
              <td
                className="h-10 border-b border-hair px-4 py-0 text-ui text-ink max-w-[260px] whitespace-nowrap overflow-hidden text-ellipsis last:[&>td]:border-b-0"
                data-testid="history-cell-note"
                title={row.note ?? undefined}
              >
                {row.note ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

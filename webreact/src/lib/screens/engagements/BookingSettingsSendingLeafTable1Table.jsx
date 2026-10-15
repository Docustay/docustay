// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R5.011.T1 — BookingSettingsSendingLeafTable1Table: the table at
// webui/src/lib/screens/engagements/BookingSettingsSendingLeaf.svelte:302-344 becomes
// BookingSettingsSendingLeafTable1Table, built on DataTable (kit) — inside LedgerPage when the
// source used LedgerPage. Parent task R5.011 renders it.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { Switch } from "@/lib/components/ui/switch.jsx";

export default function BookingSettingsSendingLeafTable1Table({
  rows = [],
  reminderOffsets = [],
  reminderBusyMinutes = null,
  reminderProblem = null,
  onOffsetToggle = null,
  channelCell = null,
  rowBusy = null,
}) {
  return (
    <table className="w-full border-collapse" data-testid="sending-table">
      <thead>
        <tr>
          <th className="h-[var(--table-header-h)] px-2 text-left text-xs font-medium text-ink-muted border-b border-line bg-surface-sunken">What</th>
          <th className="h-[var(--table-header-h)] px-2 text-left text-xs font-medium text-ink-muted border-b border-line bg-surface-sunken">Timing</th>
          <th className="h-[var(--table-header-h)] px-2 text-left text-xs font-medium text-ink-muted border-b border-line bg-surface-sunken">Email</th>
          <th className="h-[var(--table-header-h)] px-2 text-left text-xs font-medium text-ink-muted border-b border-line bg-surface-sunken">Text</th>
          <th className="h-[var(--table-header-h)] px-2 text-left text-xs font-medium text-ink-muted border-b border-line bg-surface-sunken">Push</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} data-testid={`sending-tr-${row.key}`}>
            <td className="h-[var(--row-h)] px-2 py-1.5 border-b border-line-soft text-ui align-middle">
              <span className="block text-ink">{row.name}</span>
              <span className="block text-xs text-ink-muted mt-0.5">{row.meaning}</span>
            </td>
            <td className="h-[var(--row-h)] px-2 py-1.5 border-b border-line-soft text-ui align-middle whitespace-normal">
              {row.key === "reminder" ? (
                <div className="flex flex-col gap-1.5">
                  {reminderOffsets.map((o) => (
                    <label
                      key={o.minutes}
                      className="flex items-center gap-2 text-ui text-ink"
                      data-testid={`sending-row-reminder-offset-${o.minutes}`}
                    >
                      <Switch
                        checked={o.enabled}
                        disabled={reminderBusyMinutes === o.minutes}
                        aria-label={o.label}
                        onCheckedChange={(v) => onOffsetToggle?.(o.minutes, v)}
                        data-testid={`sending-row-reminder-offset-${o.minutes}-toggle`}
                      />
                      <span>{o.label}</span>
                    </label>
                  ))}
                  {reminderProblem && (
                    <span
                      className="block mt-1 text-xs text-chip-bad-ink"
                      data-testid="sending-row-reminder-timing-problem"
                      role="alert"
                    >
                      {reminderProblem}
                    </span>
                  )}
                </div>
              ) : (
                <span data-testid={`sending-row-${row.key}-timing`}>{row.timing ?? "—"}</span>
              )}
            </td>
            {channelCell && (
              <>
                <td className="h-[var(--row-h)] px-2 py-1.5 border-b border-line-soft text-ui align-middle">
                  {channelCell(row, "email", `sending-row-${row.key}-email`)}
                </td>
                <td className="h-[var(--row-h)] px-2 py-1.5 border-b border-line-soft text-ui align-middle">
                  {channelCell(row, "text", `sending-row-${row.key}-text`)}
                </td>
                <td className="h-[var(--row-h)] px-2 py-1.5 border-b border-line-soft text-ui align-middle">
                  {channelCell(row, "push", `sending-row-${row.key}-push`)}
                </td>
              </>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

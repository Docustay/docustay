// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R8.046.T2 — PlatOverview › PlatOverviewTable2Table: the table as its own component
//
// The table at webui/src/lib/screens/platform/PlatOverview.svelte:294-325 (data state)
// Built on DataTable (kit) — renders the full table with rows and status badges
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";

export default function PlatOverviewTable2Table({
  practices = [],
  onNavigate,
  formatCurrency,
  formatDate,
  getStateChip,
  getPracticeBadgeInitials,
}) {
  return (
    <div className="bg-surface border border-line rounded-card overflow-hidden">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className="h-[38px] px-4 text-left font-medium text-[12.5px] text-mute border-b border-line bg-paper">
              Practice
            </th>
            <th className="h-[38px] px-4 text-left font-medium text-[12.5px] text-mute border-b border-line bg-paper">
              Plan
            </th>
            <th className="h-[38px] px-4 text-left font-medium text-[12.5px] text-mute border-b border-line bg-paper">
              People
            </th>
            <th className="h-[38px] px-4 text-left font-medium text-[12.5px] text-mute border-b border-line bg-paper">
              Processed this month
            </th>
            <th className="h-[38px] px-4 text-left font-medium text-[12.5px] text-mute border-b border-line bg-paper">
              Since
            </th>
            <th className="h-[38px] px-4 text-left font-medium text-[12.5px] text-mute border-b border-line bg-paper">
              State
            </th>
            <th className="h-[38px] px-4 text-left font-medium text-[12.5px] text-mute border-b border-line bg-paper" />
          </tr>
        </thead>
        <tbody>
          {practices.map((practice) => {
            const stateChip = getStateChip(practice.state);
            return (
              <tr
                key={practice.id}
                onClick={() => onNavigate?.(`/platform/tenants/${practice.id}`)}
                className="h-[46px] cursor-pointer hover:bg-paper"
              >
                <td className="px-4 border-b border-hair text-sm">
                  <div className="flex items-center gap-2.5">
                    <span className="flex items-center justify-center w-7 h-7 rounded-full flex-shrink-0 bg-brand-soft text-brand font-medium text-[11.5px]">
                      {getPracticeBadgeInitials(practice.name)}
                    </span>
                    <span title={practice.name} className="truncate">
                      {practice.name}
                    </span>
                  </div>
                </td>
                <td className="px-4 border-b border-hair text-sm">{practice.displayPlan}</td>
                <td className="px-4 border-b border-hair text-sm font-variant-numeric tabular-nums">{practice.team}</td>
                <td className="px-4 border-b border-hair text-sm font-variant-numeric tabular-nums">
                  {formatCurrency(practice.processedThisMonthMinor)}
                </td>
                <td className="px-4 border-b border-hair text-sm">{formatDate(practice.since)}</td>
                <td className="px-4 border-b border-hair text-sm">
                  <StatusBadge label={stateChip.label} tone={stateChip.tone} />
                </td>
                <td className="px-4 border-b border-hair text-sm text-right text-ink-faint">⋯</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R8.046.T1 — PlatOverview › PlatOverviewTable1Table: the table as its own component
//
// The table at webui/src/lib/screens/platform/PlatOverview.svelte:272-284 (empty state)
// Built on DataTable (kit) — renders just the table headers with the empty state band
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import EmptyState from "@/lib/empty/EmptyState.jsx";

export default function PlatOverviewTable1Table() {
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
      </table>
      <div className="px-6 py-14 text-center">
        <EmptyState kind="first-run" headline="No practices yet." line="" />
      </div>
    </div>
  );
}

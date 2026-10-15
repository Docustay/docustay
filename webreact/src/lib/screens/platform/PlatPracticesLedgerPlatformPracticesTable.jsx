// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R8.048.T1 — PlatPractices › PlatPracticesLedgerPlatformPracticesTable: the table as its own component
// Renders the LedgerPage with controls (search, filters, export) and the practices table.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import LedgerPage from "@/lib/lists/LedgerPage.jsx";
import RowActions from "@/lib/lists/RowActions.jsx";
import ExportMenu from "@/lib/lists/ExportMenu.jsx";
import EmptyState from "@/lib/empty/EmptyState.jsx";

export default function PlatPracticesLedgerPlatformPracticesTable({
  practices = [],
  counts = { all: 0, live: 0, trialling: 0, needs: 0, gone: 0 },
  activeView = "all",
  searchQuery = "",
  filters = { plan: null, since: null, processed: null, state: null },
  exportBusy = false,
  handleViewChange = null,
  handleSearchChange = null,
  filteredPractices = [],
  hasFiltersActive = false,
  uniquePlans = [],
  uniqueSince = [],
  uniqueStates = [],
  getRowActions = null,
  formatCurrency = null,
  exportAsCSV = null,
  summary = null,
  onFilterChange = null,
  onClearFilters = null,
}) {
  const handlePlanChange = (e) => {
    onFilterChange?.({ ...filters, plan: e.target.value || null });
  };
  const handleSinceChange = (e) => {
    onFilterChange?.({ ...filters, since: e.target.value || null });
  };
  const handleProcessedChange = (e) => {
    onFilterChange?.({ ...filters, processed: e.target.value || null });
  };
  const handleStateChange = (e) => {
    onFilterChange?.({ ...filters, state: e.target.value || null });
  };

  return (
    <LedgerPage
      title="Practices"
      summary={summary}
      primary={{
        label: "New practice",
        disabled: true,
        disabledReason: "New practices are set up through provisioning.",
      }}
      testId="ledger-platform-practices"
      views={[
        { key: "all", label: `All (${counts.all})` },
        { key: "live", label: `Live (${counts.live})` },
        { key: "trialling", label: `Trialling (${counts.trialling})` },
        { key: "needs", label: `Needs looking at (${counts.needs})` },
        { key: "gone", label: `Gone (${counts.gone})` },
      ]}
      activeView={activeView}
      onView={handleViewChange}
      controls={
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            className="flex-1 basis-[200px] min-w-[150px] h-[34px] rounded-[8px] border border-line bg-white px-[11px] text-control placeholder-mute focus:outline-none"
            placeholder="Search"
            value={searchQuery}
            onChange={handleSearchChange}
            onInput={handleSearchChange}
            data-testid="practices-search"
          />

          <select
            className="h-[34px] rounded-[8px] border border-line bg-white px-[11px] text-control cursor-pointer focus:outline-none"
            value={filters.plan || ""}
            onChange={handlePlanChange}
            data-testid="practices-filter-plan"
          >
            <option value="">Plan</option>
            <option value="All">All</option>
            {uniquePlans.map((plan) => (
              <option key={plan} value={plan}>{plan}</option>
            ))}
          </select>

          <select
            className="h-[34px] rounded-[8px] border border-line bg-white px-[11px] text-control cursor-pointer focus:outline-none"
            value={filters.since || ""}
            onChange={handleSinceChange}
            data-testid="practices-filter-since"
          >
            <option value="">Since</option>
            {uniqueSince.map((since) => (
              <option key={since} value={since}>{since}</option>
            ))}
          </select>

          <select
            className="h-[34px] rounded-[8px] border border-line bg-white px-[11px] text-control cursor-pointer focus:outline-none"
            value={filters.processed || ""}
            onChange={handleProcessedChange}
            data-testid="practices-filter-processed"
          >
            <option value="">Processed</option>
            <option value="none">None</option>
            <option value="small">Small</option>
            <option value="large">Large</option>
          </select>

          <select
            className="h-[34px] rounded-[8px] border border-line bg-white px-[11px] text-control cursor-pointer focus:outline-none"
            value={filters.state || ""}
            onChange={handleStateChange}
            data-testid="practices-filter-state"
          >
            <option value="">State</option>
            {uniqueStates.map((state) => (
              <option key={state} value={state}>{state}</option>
            ))}
          </select>

          <div className="flex-1" />

          <ExportMenu
            formats={[
              {
                key: "csv",
                label: "CSV",
                includes: "practice-level fields only",
              },
            ]}
            onExport={exportAsCSV}
            busy={exportBusy}
            testId="practices-export"
          />
        </div>
      }
    >
      {filteredPractices.length === 0 ? (
        hasFiltersActive ? (
          <EmptyState
            kind="filtered"
            headline="No practices match your filters."
            line="Try changing your filters or search."
            icon="IconFilter"
            onClearFilters={onClearFilters}
          />
        ) : practices.length === 0 ? (
          <EmptyState
            kind="first-run"
            headline="No practices yet."
            line="New practices are set up through provisioning."
            icon="IconBuildings"
          />
        ) : null
      ) : (
        <div className="overflow-auto rounded-card border border-line bg-surface">
          <table className="w-full border-collapse" data-testid="practices-table">
            <thead>
              <tr>
                <th scope="col" className="h-9 border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute"></th>
                <th scope="col" className="h-9 border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">Practice</th>
                <th scope="col" className="h-9 border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">Plan</th>
                <th scope="col" className="h-9 border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">Team</th>
                <th scope="col" className="h-9 border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">Clients</th>
                <th scope="col" className="h-9 border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">Processed this month</th>
                <th scope="col" className="h-9 border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">Since</th>
                <th scope="col" className="h-9 border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">State</th>
                <th scope="col" className="h-9 border-b border-line bg-surface-2 px-4 text-right text-caption font-medium text-mute"></th>
              </tr>
            </thead>
            <tbody>
              {filteredPractices.map((practice) => (
                <tr key={practice.id} data-testid={`practice-row-${practice.id}`} data-practice-id={practice.id} data-state={practice.state} className="border-b border-hair last:[&>td]:border-b-0">
                  <td className="h-11 border-b border-hair px-4 text-center">
                    <div className="mx-auto flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-[var(--color-avatar-bg)] text-[var(--color-avatar-ink)] text-caption font-medium">
                      {practice.name.slice(0, 2).toUpperCase()}
                    </div>
                  </td>
                  <td className="h-11 border-b border-hair px-4 text-ui text-ink" data-testid={`practice-name-${practice.id}`}>
                    {practice.name}
                  </td>
                  <td className="h-11 border-b border-hair px-4 text-ui text-ink" data-testid={`practice-plan-${practice.id}`}>
                    {practice.displayPlan}
                  </td>
                  <td className="h-11 border-b border-hair px-4 text-ui text-ink font-variant-numeric" data-testid={`practice-team-${practice.id}`}>
                    {practice.team}
                  </td>
                  <td className="h-11 border-b border-hair px-4 text-ui text-ink font-variant-numeric" data-testid={`practice-clients-${practice.id}`}>
                    {practice.clients}
                  </td>
                  <td className="h-11 border-b border-hair px-4 text-ui text-ink font-variant-numeric" data-testid={`practice-processed-${practice.id}`}>
                    {formatCurrency?.(practice.processedThisMonthMinor)}
                  </td>
                  <td className="h-11 border-b border-hair px-4 text-ui text-ink" data-testid={`practice-since-${practice.id}`}>
                    {new Date(practice.since).toLocaleString(undefined, { month: "short", year: "numeric" })}
                  </td>
                  <td className="h-11 border-b border-hair px-4 text-ui text-ink" data-testid={`practice-state-${practice.id}`}>
                    <span className={`inline-flex items-center h-5.25 px-2.25 rounded-[5px] text-caption font-medium ${
                      practice.state === "Fine"
                        ? "bg-[var(--ok-soft)] text-[var(--ok)]"
                        : practice.state.includes("Payment") || practice.state.includes("Gone")
                        ? "bg-[var(--bad-soft)] text-[var(--bad)]"
                        : practice.state.includes("days left")
                        ? "bg-[var(--color-brand-soft)] text-[var(--color-brand)]"
                        : "bg-[var(--color-mute-bg)] text-[var(--mute)]"
                    }`}>
                      {practice.state}
                    </span>
                  </td>
                  <td className="h-11 border-b border-hair px-4 text-right">
                    <RowActions actions={getRowActions?.(practice) || []} row={practice} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </LedgerPage>
  );
}

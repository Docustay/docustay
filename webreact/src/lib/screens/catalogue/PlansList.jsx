// ═══════════════════════════════════════════════════════════════════════════════════════════════
// PlansList — the Plans catalogue: same shape as PackagesList, rows, empty state.
// Props: { path, params, app, onNavigate, onRefetch }
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useEffect } from "react";
import { request, ApiError } from "@/lib/api.js";
import LedgerPage from "@/lib/lists/LedgerPage.jsx";
import EmptyState from "@/lib/empty/EmptyState.jsx";
import { formatValue } from "@/lib/format.js";
import ArchiveControl from "@/lib/record/ArchiveControl.jsx";
import useListBulk from "@/lib/lists/useListBulk.jsx";
import RowActions from "@/lib/lists/RowActions.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import { Badge } from "@/lib/components/ui/badge.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import ProgramFilter, { matchesProgram } from "@/lib/programs/ProgramFilter.jsx";
import { ProgramChips } from "@/lib/programs/ProgramChip.jsx";
import CatalogueDataTable from "@/lib/screens/catalogue/CatalogueDataTable.jsx";

const INTERVAL_LABEL = {
  week: "Weekly",
  month: "Monthly",
  quarter: "Quarterly",
  year: "Yearly",
};

export default function PlansList({ path = "/items/plans", params = null, app = null, onNavigate = null, onRefetch = null }) {
  function go(href) {
    if (onNavigate) onNavigate(href);
    else window.location.assign(href);
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // FETCH
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const [viewData, setViewData] = useState(null);
  const [fetchError, setFetchError] = useState(null);
  const [fetchDenied, setFetchDenied] = useState(false);

  async function load() {
    setFetchError(null);
    setFetchDenied(false);
    try {
      const data = await request(`/api/list${path}`);
      setViewData(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setFetchDenied(true);
      setFetchError(err);
    }
  }

  useEffect(() => {
    load();
  }, [path, app?.refetchSignal]);

  const phase = (() => {
    if (fetchDenied) return "denied";
    if (fetchError) return "error";
    if (!viewData) return "loading";
    return "ready";
  })();

  const rows = viewData?.rows ?? [];
  const apiColumns = viewData?.columns ?? [];
  const canWrite = viewData?.canWrite ?? null;
  const emptyState = viewData?.emptyState ?? null;

  // Helper to map field names to testid names — unchanged from before this rebuild, so any test
  // keyed to plans-th-plan / plans-cell-price-<id> / plans-cell-subscribers-<id> keeps working.
  function fieldTestIdName(field) {
    if (field === "name") return "plan";
    if (field === "price_amount_minor") return "price";
    if (field === "live_subscriptions") return "subscribers";
    return field;
  }

  // ─── ITEM 16 — search (client-side, same substring-on-name idea Packages already used) ────────
  const [search, setSearch] = useState("");
  const [programFilter, setProgramFilter] = useState("all");
  const filtered = (() => {
    const q = search.trim().toLowerCase();
    let r = rows;
    if (q) r = r.filter((x) => String(x.name ?? "").toLowerCase().includes(q));
    if (programFilter !== "all") r = r.filter((x) => matchesProgram(programFilter, x.program_id));
    return r;
  })();

  // ─── ITEM 16 — bulk-select state; CatalogueDataTable owns the checkbox UI ──────────────────────
  // §13.3 — selection + bulk Delete/Archive/Restore come from the shared hook (it clears the selection when the list reloads)
  const bulk = useListBulk({ app, path: "/items/plans", rank: app?.nav?.rank ?? null, rows: filtered });

  const tableColumns = apiColumns.map((c) => ({
    field: fieldTestIdName(c.field),
    label: c.label,
    format: c.format,
    sortable: c.field !== "name", // the name column already links out; TanStack would sort by label text either way, so nothing is lost keeping it a plain click-through
    cell: (row) => (
      c.field === "name" ? (
        <button type="button" className="font-medium text-ink hover:underline" onClick={() => go(`/items/plans/${row.id}`)}>
          {row.name}
        </button>
      ) : c.field === "price_amount_minor" ? (
        formatValue(row.price_amount_minor, "money", { currency: row.price_currency })
      ) : c.field === "interval" ? (
        <Badge variant="secondary" data-value={row.interval}>{INTERVAL_LABEL[row.interval] ?? row.interval}</Badge>
      ) : c.field === "live_subscriptions" ? (
        row.live_subscriptions
      ) : c.field === "program_name" ? (
        <ProgramChips ids={[row.program_id]} />
      ) : (
        formatValue(row[c.field], c.format, { empty: "—" })
      )
    ),
  }));

  // ─── Render table ───────────────────────────────────────────────────────────────────────────
  function renderTable() {
    if (phase !== "ready" || rows.length === 0) {
      return renderEmpty();
    }

    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Input className="min-w-52 max-w-72" placeholder="Search" data-testid="plans-search" value={search} onChange={(e) => setSearch(e.target.value)} />
          <ProgramFilter value={programFilter} onChange={setProgramFilter} testId="plans-filter-program" />
        </div>
        {bulk.bulkBar}
        <CatalogueDataTable
          testIdPrefix="plans"
          rows={filtered}
          columns={tableColumns}
          selectable={bulk.selectable}
          selected={bulk.selected}
          onSelectedChange={bulk.setSelected}
          extraColumn={canWrite ? {
            label: "Actions",
            cell: (row) => (
              <span className="flex items-center gap-2">
              <ArchiveControl
                type="plan"
                id={row.id}
                // ★★★ FOUND LIVE, Programs follow-up brief Part 9 — `active === false` means
                //   "turned off" (setItemActive), a completely different, orthogonal state from
                //   "archived" (archived_at). This made a merely-turned-off plan show a "Restore"
                //   button that 404'd every time ("it was never archived"), and an actually-archived
                //   plan with active still true show "Archive" again. Fixed to read the list's own
                //   `archived` column (now added to the SQL — records/lists/items.mjs), the same
                //   real signal ServicesList.jsx's row actions already use correctly.
                archived={row.archived === true}
                rank={app?.nav?.rank}
                onDone={async () => { await load(); onRefetch?.(); }}
              />
              <RowActions row={row} actions={[]} />
              </span>
            ),
          } : null}
        />
      </div>
    );
  }

  function renderEmpty() {
    if (phase === "loading") {
      return <div className="text-mute">Loading…</div>;
    }

    if (phase === "denied") {
      return (
        <EmptyState
          kind="denied"
          headline="No access"
          line="You don't have permission to see plans."
          testId="plans-empty"
        />
      );
    }

    if (phase === "error") {
      return (
        <EmptyState
          kind="error"
          headline="Something went wrong"
          line={fetchError?.message || "Could not load plans"}
          testId="plans-empty"
        />
      );
    }

    // Empty with rows available
    if (rows.length === 0 && emptyState) {
      const props = {
        kind: emptyState.kind,
        icon: emptyState.icon,
        headline: emptyState.headline,
        line: emptyState.line,
        testId: "plans-empty-rich",
        onNavigate: go,
      };

      // Handle action and blockedAction
      if (emptyState.blockedAction && emptyState.kind === "blocked") {
        // Show custom empty state with both action and blockedAction
        return (
          <div className="rounded-card border border-line bg-surface px-6 py-14" data-testid="plans-empty-rich" data-kind="blocked">
            <div className="flex flex-col items-center gap-4 text-center">
              <h2 className="text-empty-title font-medium text-ink" data-testid="plans-empty-headline">{emptyState.headline}</h2>
              <p className="mx-auto max-w-[46ch] text-ui text-mute" data-testid="plans-empty-line">{emptyState.line}</p>
              <div className="flex flex-col gap-2 items-center">
                <Button onClick={() => go(emptyState.action?.href)} data-testid="plans-empty-create">
                  {emptyState.action?.label}
                </Button>
                <p className="mx-auto max-w-[46ch] text-ui text-mute" data-testid="plans-empty-blocked-line">{emptyState.blockedLine}</p>
                <Button
                  variant="outline"
                  onClick={() => go(emptyState.blockedAction?.href)}
                  data-testid="plans-empty-blocked-action"
                >
                  {emptyState.blockedAction?.label}
                </Button>
              </div>
            </div>
          </div>
        );
      }

      // Standard empty state
      return (
        <EmptyState
          {...props}
          action={emptyState.action || null}
        />
      );
    }

    return <div className="text-mute">No plans to display</div>;
  }

  // ─── Primary button (create) ────────────────────────────────────────────────────────────────
  const primaryButton = canWrite
    ? {
        label: "Add plan",
        onClick: () => go(`${path}/new`),
      }
    : null;

  return (
    <LedgerPage
      title="Plans"
      summary={rows.length > 0 ? `${rows.length} plan${rows.length === 1 ? "" : "s"}.` : null}
      primary={primaryButton}
      archetype="ledger"
      testId="plans-page"
      loading={phase === "loading"}
    >
      {renderTable()}
    </LedgerPage>
  );
}

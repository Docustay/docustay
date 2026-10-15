// ═══════════════════════════════════════════════════════════════════════════════════════════════
// PackagesList — the Packages catalogue (W9.2): list, filters, columns, empty state.
// Props: { path, params, app, onNavigate, onRefetch }
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useEffect } from "react";
import { request, ApiError } from "@/lib/api.js";
import { Input } from "@/lib/components/ui/input.jsx";
import { formatValue } from "@/lib/format.js";
import LedgerPage from "@/lib/lists/LedgerPage.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import ArchiveControl from "@/lib/record/ArchiveControl.jsx";
import useListBulk from "@/lib/lists/useListBulk.jsx";
import RowActions from "@/lib/lists/RowActions.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import ProgramFilter, { matchesProgram } from "@/lib/programs/ProgramFilter.jsx";
import { ProgramChips } from "@/lib/programs/ProgramChip.jsx";
import CatalogueDataTable from "@/lib/screens/catalogue/CatalogueDataTable.jsx";

export default function PackagesList({ path = "/items/packages", params = null, app = null, onNavigate = null, onRefetch = null }) {
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
  const canWrite = viewData?.canWrite ?? null;

  // ─── Search ────────────────────────────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");

  const [programFilter, setProgramFilter] = useState("all");

  const filtered = (() => {
    let r = rows;
    const q = search.trim().toLowerCase();
    if (q) r = r.filter((x) => String(x.name ?? "").toLowerCase().includes(q));
    if (programFilter !== "all") r = r.filter((x) => matchesProgram(programFilter, x.program_id));
    return r;
  })();

  const isFiltered = search.trim() !== "" || programFilter !== "all";
  const displayPhase = phase === "ready" && filtered.length === 0 ? "empty" : phase;
  const showControls = phase === "ready" && rows.length > 0;
  const isRichEmpty = displayPhase === "empty" && !isFiltered && rows.length === 0 && canWrite === true;

  function clearFilters() {
    setSearch("");
    setProgramFilter("all");
  }

  function emptyPropFor() {
    if (isFiltered) {
      return { kind: "filtered", headline: "Nothing matches those filters", line: "Try different filters or clear them.", action: null };
    }
    return viewData?.emptyState ?? { kind: "blocked", headline: "No packages yet", line: "Several sessions sold together at a better rate.", action: null };
  }

  // ─── Summary sentence ───────────────────────────────────────────────────────────────────────
  const NUMBER_WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
  function numberText(n) {
    if (typeof n !== "number" || !Number.isFinite(n)) return String(n ?? "0");
    if (Number.isInteger(n) && n >= 0 && n <= 10) return NUMBER_WORDS[n];
    return String(n);
  }
  const summaryText = (() => {
    if (phase !== "ready") return null;
    if (rows.length === 0) {
      return canWrite === false ? "Nothing here yet." : "Combine sessions and sell them together at a better rate.";
    }
    const base = `${numberText(rows.length)} package${rows.length === 1 ? "" : "s"}.`;
    if (isFiltered && filtered.length === 0) return `${base} None match what you're filtering by.`;
    return base;
  })();

  // ─── Cell formatting ───────────────────────────────────────────────────────────────────────
  function priceText(row) {
    const amt = row.price_amount_minor;
    if (amt == null) return "—";
    if (Number(amt) === 0) return "Free";
    return formatValue(amt, "money", { currency: row.price_currency });
  }

  function contentsText(row) {
    return row.contents ?? "—";
  }

  function sellableText(row) {
    return row.sellable ?? "—";
  }

  // ─── Row actions ───────────────────────────────────────────────────────────────────────────
  // Note: Packages don't have edit or duplicate actions shown at the list level.
  // Editing happens by navigating to the detail view.
  // ★★★ FOUND LIVE, Programs follow-up brief Part 9 — this used to be a stub returning `[]`, with a
  //   comment claiming archive was "handled through the detail view's ArchiveControl" when no
  //   package screen anywhere embedded it; a package could not be archived at all, and until
  //   migration 0544/this session's OWNERSHIP fix (F826), the underlying route would have thrown
  //   even if it had been wired. Replaced with a real `extraColumn` below, mirroring PlansList.jsx.

  // ─── Selection (bulk-select state; CatalogueDataTable owns the checkbox UI) ───────────────────
  // §13.3 — selection + bulk Delete/Archive/Restore come from the shared hook (it also clears the selection when the list reloads)
  const bulk = useListBulk({ app, path: "/items/packages", rank: app?.nav?.rank ?? null, rows: filtered });

  // ─── Controls ───────────────────────────────────────────────────────────────────────────────
  const controls = showControls ? (
    <>
      <Input
        className="min-w-52 max-w-72"
        placeholder="Search"
        data-testid="packages-search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <ProgramFilter value={programFilter} onChange={setProgramFilter} testId="packages-filter-program" />
      <div className="flex-1" />
    </>
  ) : null;

  // Handle custom empty state rendering for blocked state
  const renderEmpty = () => {
    const emptyState = viewData?.emptyState;

    if (displayPhase === "empty" && emptyState?.blockedAction && emptyState?.kind === "blocked") {
      // Custom blocked empty state with both action and blockedAction
      return (
        <div className="rounded-card border border-line bg-surface px-6 py-14" data-testid="packages-empty-rich" data-kind="blocked">
          <div className="flex flex-col items-center gap-4 text-center">
            <h2 className="text-empty-title font-medium text-ink" data-testid="packages-empty-headline">{emptyState.headline}</h2>
            <p className="mx-auto max-w-[46ch] text-ui text-mute" data-testid="packages-empty-line">{emptyState.line}</p>
            <div className="flex flex-col gap-2 items-center">
              <Button onClick={() => go(emptyState.action?.href)} data-testid="packages-empty-create">
                {emptyState.action?.label}
              </Button>
              <p className="mx-auto max-w-[46ch] text-ui text-mute" data-testid="packages-empty-blocked-line">{emptyState.blockedLine}</p>
              <Button
                variant="outline"
                onClick={() => go(emptyState.blockedAction?.href)}
                data-testid="packages-empty-blocked-action"
              >
                {emptyState.blockedAction?.label}
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <ScreenState
        phase={displayPhase}
        error={phase === "error" ? fetchError : null}
        reason={phase === "denied" ? (fetchError?.message ?? null) : null}
        empty={emptyPropFor()}
        onClearFilters={clearFilters}
        onNavigate={go}
        subject="Packages"
        onRetry={load}
      />
    );
  };

  return (
    <LedgerPage
      title={viewData?.title ?? "Packages"}
      summary={summaryText}
      primary={canWrite === true ? { label: "New package", onClick: () => go(`${path}/new`) } : null}
      controls={showControls ? controls : null}
      testId="packages-ledger"
    >
      {displayPhase === "empty" ? (
        renderEmpty()
      ) : (
        <ScreenState
          phase={displayPhase}
          error={phase === "error" ? fetchError : null}
          reason={phase === "denied" ? (fetchError?.message ?? null) : null}
          empty={emptyPropFor()}
          onClearFilters={clearFilters}
          onNavigate={go}
          subject="Packages"
          onRetry={load}
        >
          {displayPhase === "ready" && (
            <div className="w-full">
              {bulk.bulkBar}
              <CatalogueDataTable
                testIdPrefix="packages"
                rows={filtered}
                search=""
                selectable={bulk.selectable}
                selected={bulk.selected}
                onSelectedChange={bulk.setSelected}
                columns={[
                  {
                    field: "package", label: "Package", sortable: false,
                    cell: (row) => (
                      <a
                        href={`/items/packages/${row.id}`}
                        onClick={(e) => { if (onNavigate) { e.preventDefault(); go(`/items/packages/${row.id}`); } }}
                        className="text-brand hover:text-brand no-underline"
                      >
                        {row.name}
                      </a>
                    ),
                  },
                  { field: "price", label: "Price", format: "money", cell: (row) => priceText(row) },
                  { field: "contents", label: "Contents", cell: (row) => contentsText(row) },
                  { field: "program_name", label: "Program", cell: (row) => <ProgramChips ids={[row.program_id]} /> },
                  { field: "sellable", label: "Sellable", cell: (row) => sellableText(row) },
                ]}
                extraColumn={canWrite === true ? {
                  label: "",
                  cell: (row) => (
                    <span className="flex items-center gap-2">
                    <ArchiveControl
                      type="package"
                      id={row.id}
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
          )}
        </ScreenState>
      )}
    </LedgerPage>
  );
}

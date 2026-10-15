// ═══════════════════════════════════════════════════════════════════════════════════════════════
// CouponsPage — build from specs/mockups/ItemsDiscounts.frame.html (vocabulary: Coupons, codes)
// on LedgerPage. Props: { path, params, app, onNavigate, onRefetch }
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useEffect, lazy, Suspense } from "react";
import { request, api, ApiError } from "@/lib/api.js";
import LedgerPage from "@/lib/lists/LedgerPage.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import useListBulk from "@/lib/lists/useListBulk.jsx";

// R5.026.T1 — lazy-loaded since it's built separately
const CouponsPageCouponsLedgerTable = lazy(() =>
  import("./CouponsPageCouponsLedgerTable.jsx").catch(() => ({
    default: () => <div data-testid="coupons-ledger-table-mock" className="text-mute">Table will render once the subtask is built</div>
  }))
);

export default function CouponsPage({ path = "/items/coupons", params = null, app = null, onNavigate = null, onRefetch = null }) {
  function go(href) {
    if (onNavigate) onNavigate(href);
    else window.location.assign(href);
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // THE FETCH PHASE
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

  // ─── filters — Search (name), Active (all/active/inactive) ─────────────────────────────────────
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState("all");

  const filtered = (() => {
    let r = rows;
    const q = search.trim().toLowerCase();
    if (q) r = r.filter((x) => String(x.name ?? "").toLowerCase().includes(q));
    if (activeFilter !== "all") {
      r = r.filter((x) => (activeFilter === "active" ? x.active === true : x.active === false));
    }
    return r;
  })();

  const isFiltered = search.trim() !== "" || activeFilter !== "all";
  const displayPhase = phase === "ready" && filtered.length === 0 ? "empty" : phase;
  const showControls = phase === "ready" && rows.length > 0;
  const bulk = useListBulk({ app, path, rank: app?.nav?.rank ?? null, rows: filtered, onChanged: load, resetKey: `${search}|${activeFilter}` });

  function clearFilters() {
    setSearch("");
    setActiveFilter("all");
  }

  function emptyPropFor() {
    if (isFiltered) {
      return { kind: "filtered", headline: "Nothing matches those filters", line: "Try different filters or clear them.", action: null };
    }
    return viewData?.emptyState ?? { kind: "first-run", headline: "Nothing here yet", line: "", action: null };
  }

  // ─── the verbatim vocabulary sentence — F16 §2.3, shown every ready render ─────────────────────
  const summaryText = "A coupon is the rule. A code is what someone types.";

  // ─── expand/collapse ────────────────────────────────────────────────────────────────────────────
  const [expandedIds, setExpandedIds] = useState(new Set());
  function toggleExpanded(id) {
    const s = new Set(expandedIds);
    if (s.has(id)) s.delete(id); else s.add(id);
    setExpandedIds(s);
  }

  // ─── Active toggle — the one real write this screen makes ─────────────────────────────────────
  const [togglingId, setTogglingId] = useState(null);
  async function setActive(row, active) {
    setTogglingId(row.id);
    try {
      await api.setCouponActive(row.id, active);
      await load();
      onRefetch?.();
    } finally {
      setTogglingId(null);
    }
  }

  // ─── row actions — "Open" is the only real, wired action
  function rowActions(row) {
    return [{ id: "open", label: "Open", onRun: () => go(`${path}/${row.id}`) }];
  }

  function codesOf(row) {
    return row.codes ?? [];
  }

  // ─── Render controls snippet ─────────────────────────────────────────────────────────────────
  const controls = showControls ? (
    <>
      <Input
        className="min-w-52 max-w-72"
        placeholder="Search"
        data-testid="coupons-search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <select
        className="h-8 rounded-lg border border-input bg-surface px-2.5 py-1 text-base text-ink outline-none"
        data-testid="coupons-filter-active"
        value={activeFilter}
        onChange={(e) => setActiveFilter(e.target.value)}
      >
        <option value="all">Active: All</option>
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
      </select>
    </>
  ) : null;

  return (
    <LedgerPage
      title={viewData?.title ?? "Coupons"}
      summary={summaryText}
      primary={canWrite === true ? { label: "New coupon", onClick: () => go(`${path}/new`) } : null}
      controls={controls}
      testId="coupons-ledger"
    >
      <ScreenState
        phase={displayPhase}
        error={phase === "error" ? fetchError : null}
        reason={phase === "denied" ? (fetchError?.message ?? null) : null}
        empty={emptyPropFor()}
        onClearFilters={clearFilters}
        onNavigate={go}
        subject="Coupons"
        onRetry={load}
      >
        {displayPhase === "ready" && (
          <Suspense fallback={<div className="text-mute">Loading…</div>}>
            {bulk.bulkBar}
            <CouponsPageCouponsLedgerTable
              bulk={bulk}
              path={path}
              onNavigate={onNavigate}
              go={go}
              viewData={viewData}
              fetchError={fetchError}
              load={load}
              phase={phase}
              canWrite={canWrite}
              codesOf={codesOf}
              filtered={filtered}
              displayPhase={displayPhase}
              showControls={showControls}
              clearFilters={clearFilters}
              emptyPropFor={emptyPropFor}
              summaryText={summaryText}
              expandedIds={expandedIds}
              toggleExpanded={toggleExpanded}
              togglingId={togglingId}
              setActive={setActive}
              rowActions={rowActions}
            />
          </Suspense>
        )}
      </ScreenState>
    </LedgerPage>
  );
}

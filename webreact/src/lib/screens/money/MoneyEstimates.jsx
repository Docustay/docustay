// ═══════════════════════════════════════════════════════════════════════════════════════════════
// MONEY › ESTIMATES — ESTIMATES LIST WITH FILTERING AND MANAGEMENT
// Built from webui/src/lib/screens/money/MoneyEstimates.svelte via MoneyInvoices.frame.html
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { request, ApiError } from "@/lib/api.js";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import MoneyEstimatesTable1Table from "./MoneyEstimatesTable1Table.jsx";
import EstimateSheet from "@/lib/money/EstimateSheet.jsx";
import useListBulk from "@/lib/lists/useListBulk.jsx";

export default function MoneyEstimates({ path = null, params = null, app = null, onNavigate = null, onRefetch = null }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [screenPhase, setScreenPhase] = useState("loading"); // loading, ready, denied, error

  const [estimates, setEstimates] = useState([]);
  const [filteredEstimates, setFilteredEstimates] = useState([]);

  // Filters
  const [statusFilters, setStatusFilters] = useState([]); // draft, sent, opened, accepted, declined, expired, converted
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("created"); // created, amount, expires_at
  // ★ FOUND LIVE, 28 Sep 2026 — "New estimate" navigated to "/money/estimates/new", a path never
  //   registered anywhere (routes.js/sectionPages.js) — the backend's generic fallback answered
  //   "section refused: unknown_path", which the shell renders as "You do not have access to
  //   this", reading like a real permission refusal when it was a routing gap. EstimateSheet.jsx
  //   already exists, self-contained (own recipients fetch, own open/onOpenChange/onCreated
  //   contract matching BookSessionDialog's pattern) and was imported by zero files — never wired.
  const [showEstimateSheet, setShowEstimateSheet] = useState(false);

  // Fetch estimates on mount
  useEffect(() => {
    fetchEstimates();
  }, []);

  // Apply filters whenever estimates, statusFilters, searchQuery, or sortBy changes
  useEffect(() => {
    applyFilters();
  }, [estimates, statusFilters, searchQuery, sortBy]);

  async function fetchEstimates() {
    try {
      setLoading(true);
      setScreenPhase("loading");
      setError(null);

      const res = await request("/api/money/estimates");

      // ★ the route answers { estimates: { rows, … } }; this read `res.rows` off the wrapper — always undefined — so the list said "No estimates yet" with
      //   estimates on file (found in the §13 sandbox test)
      const rows = res?.estimates?.rows ?? res?.rows ?? null;
      setEstimates(Array.isArray(rows) ? rows : []);

      setScreenPhase("ready");
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setScreenPhase("denied");
      } else {
        setScreenPhase("error");
        setError(err);
      }
    } finally {
      setLoading(false);
    }
  }

  function applyFilters() {
    let filtered = [...estimates];

    // Apply status filters
    if (statusFilters.length > 0) {
      filtered = filtered.filter((e) => statusFilters.includes(e.status));
    }

    // Apply search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((e) =>
        (e.recipient_display_name?.toLowerCase().includes(query)) ||
        (e.title?.toLowerCase().includes(query)) ||
        (e.estimate_number?.toLowerCase().includes(query))
      );
    }

    // Sort
    filtered.sort((a, b) => {
      switch (sortBy) {
        case "amount":
          return (b.amount_minor || 0) - (a.amount_minor || 0);
        case "expires_at":
          if (!a.expires_at) return 1;
          if (!b.expires_at) return -1;
          return new Date(a.expires_at) - new Date(b.expires_at);
        case "created":
        default:
          return new Date(b.created_at || 0) - new Date(a.created_at || 0);
      }
    });

    setFilteredEstimates(filtered);
  }

  // §13.3 — selection + bulk Delete come from the shared hook; this screen writes no delete code of its own
  const bulk = useListBulk({ app, path: "/money/estimates", rank: app?.nav?.rank ?? null, rows: filteredEstimates, onChanged: fetchEstimates });

  function toggleStatusFilter(status) {
    setStatusFilters((prev) =>
      prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status]
    );
  }

  function formatAmount(minor) {
    if (!minor && minor !== 0) return "$0";
    return `$${(minor / 100).toFixed(2)}`;
  }

  function getStatusTag(status, declineReason) {
    const classMap = {
      draft: "mute",
      sent: "warn",
      opened: "warn",
      accepted: "ok",
      declined: "bad",
      expired: "bad",
      converted: "ok",
    };
    return classMap[status] || "mute";
  }

  function handleCreateNew() {
    setShowEstimateSheet(true);
  }

  function handleRowClick(estimate) {
    onNavigate?.(`/money/estimates/${estimate.id}`);
  }

  function handleExport() {
    // Export functionality
  }

  if (screenPhase === "loading") {
    return <ScreenState phase="loading" />;
  }

  if (screenPhase === "denied") {
    return <ScreenState phase="denied" />;
  }

  if (screenPhase === "error") {
    return <ErrorPanel error={error} onBack={() => onNavigate?.("/money")} />;
  }

  // Ready phase
  return (
    <div className="flex w-full flex-col" data-testid="money-estimates">
      <div className="flex-1 overflow-auto px-7.5 py-6.5 pb-17.5">
        {/* Page header */}
        <div className="mb-4.5 flex items-end gap-4">
          <div className="flex-1">
            <h1 className="m-0 font-fraunces text-2xl font-medium tracking-tight">Estimates</h1>
            <p className="m-0 mt-1 text-sm text-mute">Manage estimate lifecycle from draft to accepted</p>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <Button variant="ghost" onClick={handleExport}>Export</Button>
            <Button variant="primary" onClick={handleCreateNew}>New estimate</Button>
          </div>
        </div>

        {/* Filters */}
        <div className="mb-3.5 flex flex-wrap items-center gap-2">
          <input
            type="text"
            className="flex-1 min-w-50 max-w-70 h-8.5 rounded-lg border border-line bg-white px-2.75 text-sm text-label placeholder-label"
            placeholder="⌕ Search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {statusFilters.length > 0 && (
            <span className="inline-flex h-8.5 items-center rounded-lg border border-line bg-white px-3 text-sm text-ink-2">
              {statusFilters.length} filter{statusFilters.length !== 1 ? "s" : ""} active
            </span>
          )}
        </div>

        {/* Empty state or table */}
        {filteredEstimates.length === 0 ? (
          <div className="rounded-card border border-line bg-surface p-14 text-center">
            <div className="text-lg font-medium text-ink">No estimates yet</div>
            <p className="mx-auto mt-1.75 max-w-xl text-sm text-mute leading-1.6">
              {estimates.length === 0
                ? "Create your first estimate to get started."
                : "No estimates match your filters."}
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2 border-t border-line-soft pt-5">
              {estimates.length === 0 ? (
                <Button variant="primary" onClick={handleCreateNew}>
                  Create first estimate
                </Button>
              ) : (
                <Button variant="ghost" onClick={() => setStatusFilters([])}>
                  Clear filters
                </Button>
              )}
            </div>
          </div>
        ) : (
          <>
          {bulk.bulkBar}
          <MoneyEstimatesTable1Table
            bulk={bulk}
            filteredEstimates={filteredEstimates}
            formatAmount={formatAmount}
            getStatusTag={getStatusTag}
            handleRowClick={handleRowClick}
          />
          </>
        )}
      </div>
      <EstimateSheet
        open={showEstimateSheet}
        onOpenChange={setShowEstimateSheet}
        onCreated={() => { setShowEstimateSheet(false); fetchEstimates(); }}
      />
    </div>
  );
}

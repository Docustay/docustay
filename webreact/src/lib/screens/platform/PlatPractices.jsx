// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R8.048 — PlatPractices: rebuild from the frame on the archetype
// The Practices ledger: views All · Live · Trialling · Needs looking at · Gone, search, filters, Export.
// Ported from webui/src/lib/screens/platform/PlatPractices.svelte
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState, useCallback, useMemo } from "react";
import { api, ApiError } from "@/lib/api.js";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";
import PlatPracticesLedgerPlatformPracticesTable from "./PlatPracticesLedgerPlatformPracticesTable.jsx";

export default function PlatPractices({ app, onNavigate, testData = null }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [practices, setPractices] = useState([]);
  const [counts, setCounts] = useState({ all: 0, live: 0, trialling: 0, needs: 0, gone: 0 });
  const [activeView, setActiveView] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState({ plan: null, since: null, processed: null, state: null });
  const [exportBusy, setExportBusy] = useState(false);

  let searchDebounceTimer = null;

  const debouncedFetch = useCallback((view, q) => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      fetchPractices(view, q);
    }, 300);
  }, []);

  const fetchPractices = async (view, q) => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.platformPractices({ view, q });
      if (result) {
        setPractices(result.practices || []);
        setCounts(result.counts || { all: 0, live: 0, trialling: 0, needs: 0, gone: 0 });
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError({ status: 403 });
      } else {
        setError(err instanceof ApiError ? err.message : String(err?.message ?? err));
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (testData !== null) {
      setPractices(testData.practices || []);
      setCounts(testData.counts || { all: 0, live: 0, trialling: 0, needs: 0, gone: 0 });
      setLoading(false);
    } else {
      fetchPractices(activeView, searchQuery);
    }
  }, [testData]);

  const handleViewChange = useCallback((view) => {
    setActiveView(view);
    setSearchQuery("");
    setFilters({ plan: null, since: null, processed: null, state: null });
    debouncedFetch(view, "");
  }, [debouncedFetch]);

  const handleSearchChange = useCallback((e) => {
    setSearchQuery(e.target.value);
    debouncedFetch(activeView, e.target.value);
  }, [activeView, debouncedFetch]);

  const handleFilterChange = useCallback((newFilters) => {
    setFilters(newFilters);
  }, []);

  const handleClearFilters = useCallback(() => {
    setFilters({ plan: null, since: null, processed: null, state: null });
    setSearchQuery("");
  }, []);

  // Compute filtered practices
  const filteredPractices = useMemo(() => {
    let result = practices;

    // Plan filter
    if (filters.plan && filters.plan !== "All") {
      result = result.filter((p) => p.displayPlan === filters.plan);
    }

    // Since filter (month)
    if (filters.since) {
      result = result.filter((p) => {
        const since = new Date(p.since);
        const month = since.toLocaleString(undefined, { month: "long", year: "numeric" });
        return month === filters.since;
      });
    }

    // Processed filter (by amount range)
    if (filters.processed) {
      result = result.filter((p) => {
        const amount = p.processedThisMonthMinor;
        if (filters.processed === "none") return amount === 0;
        if (filters.processed === "small") return amount > 0 && amount < 50000;
        if (filters.processed === "large") return amount >= 50000;
        return true;
      });
    }

    // State filter
    if (filters.state && filters.state !== "All") {
      result = result.filter((p) => p.state === filters.state);
    }

    return result;
  }, [practices, filters]);

  const hasFiltersActive = useMemo(() => {
    return filters.plan !== null || filters.since !== null || filters.processed !== null || filters.state !== null;
  }, [filters]);

  // Get unique filter options
  const uniquePlans = useMemo(() => {
    return [...new Set(practices.map((p) => p.displayPlan).filter(Boolean))];
  }, [practices]);

  const uniqueSince = useMemo(() => {
    return [
      ...new Set(
        practices
          .map((p) => new Date(p.since).toLocaleString(undefined, { month: "long", year: "numeric" }))
          .filter(Boolean)
      ),
    ];
  }, [practices]);

  const uniqueStates = useMemo(() => {
    return [...new Set(practices.map((p) => p.state).filter(Boolean))];
  }, [practices]);

  // Row actions
  const getRowActions = useCallback((practice) => {
    const actions = [
      {
        id: "open",
        label: "Open",
        onRun: () => onNavigate?.(`/platform/tenants/${practice.id}`),
      },
    ];

    // "Ask to look" only for non-gone practices
    if (practice.state !== "Gone") {
      actions.push({
        id: "ask-to-look",
        label: "Ask to look",
        onRun: () => onNavigate?.(`/platform/tenants/${practice.id}/look`),
      });
    }

    return actions;
  }, [onNavigate]);

  // Format currency
  const formatCurrency = useCallback((minor) => {
    return `$${(minor / 100).toFixed(0)}`;
  }, []);

  // Export CSV
  const exportAsCSV = useCallback(async (format) => {
    if (format !== "csv") return;
    setExportBusy(true);
    try {
      const rows = filteredPractices.map((p) => [
        p.name,
        p.displayPlan,
        String(p.team),
        String(p.clients),
        formatCurrency(p.processedThisMonthMinor),
        new Date(p.since).toLocaleString(undefined, { month: "short", year: "numeric" }),
        p.state,
      ]);

      const csv = [
        ["Practice", "Plan", "Team", "Clients", "Processed this month", "Since", "State"],
        ...rows,
      ]
        .map((row) => row.map((v) => `"${v}"`).join(","))
        .join("\n");

      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `practices-${new Date().toISOString().split("T")[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExportBusy(false);
    }
  }, [filteredPractices, formatCurrency]);

  // Summary text
  const summary = useMemo(() => {
    const total = counts.all;
    if (total === 0) return null;

    const parts = [];
    if (counts.live > 0) parts.push(`${counts.live} live`);
    if (counts.trialling > 0) parts.push(`${counts.trialling} trialling`);
    if (counts.needs > 0) parts.push(`${counts.needs} needing looking at`);

    if (parts.length === 0) return null;
    return parts.join(", ") + ".";
  }, [counts]);

  if (loading) {
    return <ScreenState phase="loading" />;
  }

  if (error && typeof error === "object" && error.status === 403) {
    return <ScreenState phase="denied" />;
  }

  if (error && typeof error === "string") {
    return <ErrorPanel error={new Error(error)} />;
  }

  return (
    <PlatPracticesLedgerPlatformPracticesTable
      practices={practices}
      counts={counts}
      activeView={activeView}
      searchQuery={searchQuery}
      filters={filters}
      exportBusy={exportBusy}
      handleViewChange={handleViewChange}
      handleSearchChange={handleSearchChange}
      filteredPractices={filteredPractices}
      hasFiltersActive={hasFiltersActive}
      uniquePlans={uniquePlans}
      uniqueSince={uniqueSince}
      uniqueStates={uniqueStates}
      getRowActions={getRowActions}
      formatCurrency={formatCurrency}
      exportAsCSV={exportAsCSV}
      summary={summary}
      onFilterChange={handleFilterChange}
      onClearFilters={handleClearFilters}
    />
  );
}

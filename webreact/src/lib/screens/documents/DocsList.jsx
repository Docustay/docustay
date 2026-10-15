// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R6.010 — DocsList. Screen for managing document templates: agreements and forms.
// Props: { path, params, app, onNavigate, onRefetch }
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { request, ApiError } from "@/lib/api.js";
import DocsListDocsLedgerTable from "./DocsListDocsLedgerTable.jsx";
import { Input } from "@/lib/components/ui/input.jsx";

// ★ the maintainer, 29 Sep 2026 (documents island ruling) — this screen is now mounted at /documents/templates
//   (and its four sub-tab paths), not just /documents/contracts/all. The URL's last segment names
//   which tab opens; unrecognised or absent (bare /documents/templates) means "all".
const TAB_FROM_SEGMENT = Object.freeze({ all: "all", agreements: "agreements", forms: "forms", retired: "retired" });

export default function DocsList({
  path = "/documents/templates/all",
  params = null,
  app = null,
  onNavigate = null,
  onRefetch = null,
}) {
  // Navigation helper
  function go(href) {
    if (onNavigate) onNavigate(href);
    else window.location.assign(href);
  }

  // Data fetching
  const [contractRows, setContractRows] = useState(null);
  const [formRows, setFormRows] = useState(null);
  const [fetchError, setFetchError] = useState(null);
  const [fetchDenied, setFetchDenied] = useState(false);

  async function load() {
    setFetchError(null);
    setFetchDenied(false);
    setContractRows(null);
    setFormRows(null);
    try {
      const [c, f] = await Promise.all([
        request("/api/list/documents/contracts/templates"),
        request("/api/list/documents/forms/templates"),
      ]);
      setContractRows((c.rows ?? []).map((r) => ({ ...r, type: "Agreement" })));
      setFormRows((f.rows ?? []).map((r) => ({ ...r, type: "Form" })));
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setFetchDenied(true);
      setFetchError(err);
    }
  }

  // Load on mount and when app.refetchSignal changes
  useEffect(() => {
    load();
  }, [app?.refetchSignal]);

  // Derived values
  const loaded = contractRows !== null && formRows !== null;
  const rows = [...(contractRows ?? []), ...(formRows ?? [])];

  const phase = fetchDenied ? "denied" : fetchError ? "error" : !loaded ? "loading" : "ready";

  // Views configuration
  const VIEWS = [
    { key: "all", label: "All" },
    { key: "agreements", label: "Agreements" },
    { key: "forms", label: "Forms" },
    { key: "retired", label: "Retired" },
  ];
  const initialSegment = path.split("/").pop();
  const [activeView, setActiveView] = useState(TAB_FROM_SEGMENT[initialSegment] ?? "all");
  const [search, setSearch] = useState("");

  // ★ Keep the tab in sync when the URL changes underneath this mounted instance (sidebar click
  //   between two Templates sub-tabs re-uses the same component rather than remounting it).
  useEffect(() => {
    const seg = path.split("/").pop();
    setActiveView(TAB_FROM_SEGMENT[seg] ?? "all");
  }, [path]);

  // ★ Changing tabs updates the URL too, so the sidebar highlights the matching row and the tab
  //   is bookmarkable — same click, now a real navigation instead of local-only state.
  function selectView(key) {
    setActiveView(key);
    go(`/documents/templates/${key}`);
  }

  // Filter rows based on view and search
  const filtered = (() => {
    let r = rows;
    if (activeView === "agreements") r = r.filter((x) => x.type === "Agreement");
    else if (activeView === "forms") r = r.filter((x) => x.type === "Form");
    else if (activeView === "retired") r = r.filter((x) => x.active === false);
    const q = search.trim().toLowerCase();
    if (q) r = r.filter((x) => String(x.name ?? "").toLowerCase().includes(q));
    return r;
  })();

  const isFiltered = activeView !== "all" || search.trim() !== "";
  const displayPhase = phase === "ready" && filtered.length === 0 ? "empty" : phase;
  const showControls = phase === "ready" && rows.length > 0;
  const isRichEmpty = displayPhase === "empty" && !isFiltered && rows.length === 0;

  function clearFilters() {
    setSearch("");
    setActiveView("all");
  }

  function emptyPropFor() {
    if (isFiltered) {
      return {
        kind: "filtered",
        headline: "Nothing matches those filters",
        line: "Try a different view or clear the search.",
        action: null,
      };
    }
    return { kind: "first-run", headline: "No agreements or forms yet", line: "", action: null };
  }

  // Number to word conversion
  const NUMBER_WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
  function numberText(n) {
    if (Number.isInteger(n) && n >= 0 && n <= 10) return NUMBER_WORDS[n];
    return String(n);
  }

  const summaryText = (() => {
    if (phase !== "ready") return null;
    if (rows.length === 0) return "Nothing written yet.";
    return `${numberText(rows.length)} template${rows.length === 1 ? "" : "s"}.`;
  })();

  function stateFor(row) {
    return row.active === false
      ? { label: "Retired", tone: "neutral" }
      : { label: "In use", tone: "ok" };
  }

  // Starter template action
  const [starterBusy, setStarterBusy] = useState(false);
  const [starterError, setStarterError] = useState(null);
  async function startFromCoachingAgreement() {
    setStarterBusy(true);
    setStarterError(null);
    try {
      const result = await request("/api/documents/starters", {
        method: "POST",
        body: { key: "coaching-agreement" },
      });
      go(`/documents/templates/${result.templateId}`);
    } catch (err) {
      setStarterError(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setStarterBusy(false);
    }
  }

  // Render controls snippet
  const controls = (
    <Input
      className="min-w-[200px] max-w-[280px]"
      placeholder="Search"
      data-testid="docs-search"
      value={search}
      onChange={(e) => setSearch(e.target.value)}
    />
  );

  return (
    <DocsListDocsLedgerTable
      onNavigate={onNavigate}
      go={go}
      fetchError={fetchError}
      load={load}
      rows={rows}
      phase={phase}
      VIEWS={VIEWS}
      activeView={activeView}
      filtered={filtered}
      displayPhase={displayPhase}
      showControls={showControls}
      isRichEmpty={isRichEmpty}
      clearFilters={clearFilters}
      emptyPropFor={emptyPropFor}
      summaryText={summaryText}
      stateFor={stateFor}
      starterBusy={starterBusy}
      starterError={starterError}
      startFromCoachingAgreement={startFromCoachingAgreement}
      controls={showControls ? controls : null}
      onView={selectView}
    />
  );
}

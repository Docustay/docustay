// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ServicesList — the Services catalogue: summary sentence, views, pills, columns, bulk, empties.
// Ported from webui/src/lib/screens/items/ServicesList.svelte (617 lines)
// Props: { path, params, app, onNavigate, onRefetch }
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useEffect, Suspense, lazy } from "react";
import { request, api, ApiError } from "@/lib/api.js";
import { Input } from "@/lib/components/ui/input.jsx";
import { NativeSelect, NativeSelectOption } from "@/lib/components/ui/native-select.jsx";
import ExportMenu from "@/lib/lists/ExportMenu.jsx";
import useListBulk from "@/lib/lists/useListBulk.jsx";
import ProgramFilter, { matchesProgram } from "@/lib/programs/ProgramFilter.jsx";
import { toast } from "sonner";
import { formatValue } from "@/lib/format.js";

// R5.042.T1 — lazy-loaded since it's built separately
const ServicesListServicesLedgerTable = lazy(() =>
  import("./ServicesListServicesLedgerTable.jsx").catch(() => ({
    default: () => <div data-testid="services-ledger-mock" className="text-mute">Table will render once the subtask is built</div>
  }))
);

export default function ServicesList({ path = "/items/services", params = null, app = null, onNavigate = null, onRefetch = null }) {
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
  const columns = viewData?.columns ?? [];
  const hasPriceColumn = columns.some((c) => c.field === "price_amount_minor");
  const canWrite = viewData?.canWrite ?? null;

  // ─── Views (client-side) ────────────────────────────────────────────────────────────────────
  const VIEWS = [
    { key: "all", label: "All" },
    { key: "available", label: "Available" },
    { key: "hidden", label: "Hidden" },
    { key: "archived", label: "Archived" },
  ];
  const [activeView, setActiveView] = useState("all");

  // ─── Filters ────────────────────────────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [bookableFilter, setBookableFilter] = useState("all");
  const [priceFilter, setPriceFilter] = useState("all");
  // ★ Programs follow-up brief (30 Sep 2026, Part 5) — same shape as categoryFilter above.
  const [programFilter, setProgramFilter] = useState("all");

  const categoryOptions = (() => {
    const set = new Set();
    let hasUncategorised = false;
    for (const r of rows) {
      if (r.category_name) set.add(r.category_name);
      else hasUncategorised = true;
    }
    const opts = Array.from(set).sort();
    if (hasUncategorised) opts.push("Uncategorised");
    return opts;
  })();

  const filtered = (() => {
    let r = rows;
    if (activeView === "available") r = r.filter((x) => x.status === "Available");
    else if (activeView === "hidden") r = r.filter((x) => x.status === "Hidden");
    else if (activeView === "archived") r = r.filter((x) => x.status === "Archived");
    const q = search.trim().toLowerCase();
    if (q) r = r.filter((x) => String(x.name ?? "").toLowerCase().includes(q));
    if (categoryFilter !== "all") {
      r = r.filter((x) => (categoryFilter === "Uncategorised" ? !x.category_name : x.category_name === categoryFilter));
    }
    if (programFilter !== "all") {
      r = r.filter((x) => matchesProgram(programFilter, x.program_id));
    }
    if (bookableFilter !== "all") {
      r = r.filter((x) => (bookableFilter === "yes" ? x.bookable === true : x.bookable === false));
    }
    if (hasPriceColumn && priceFilter !== "all") {
      r = r.filter((x) => (priceFilter === "free" ? Number(x.price_amount_minor) === 0 : Number(x.price_amount_minor) > 0));
    }
    return r;
  })();

  const isFiltered = activeView !== "all" || search.trim() !== "" || categoryFilter !== "all" || programFilter !== "all" || bookableFilter !== "all" || priceFilter !== "all";
  const displayPhase = phase === "ready" && filtered.length === 0 ? "empty" : phase;
  const showControls = phase === "ready" && rows.length > 0;
  const bulkAllowed = canWrite === true;
  const isRichEmpty = displayPhase === "empty" && !isFiltered && rows.length === 0 && canWrite === true;

  function clearFilters() {
    setSearch("");
    setCategoryFilter("all");
    setProgramFilter("all");
    setBookableFilter("all");
    setPriceFilter("all");
    setActiveView("all");
  }

  function emptyPropFor() {
    if (isFiltered) {
      return { kind: "filtered", headline: "Nothing matches those filters", line: "Try different filters or clear them.", action: null };
    }
    return viewData?.emptyState ?? { kind: "first-run", headline: "Nothing here yet", line: "", action: null };
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
      return canWrite === false ? "Nothing here yet." : "This is what you sell. Everything else is built on it.";
    }
    const base = `${numberText(rows.length)} service${rows.length === 1 ? "" : "s"}.`;
    if (isFiltered && filtered.length === 0) return `${base} None match what you're filtering by.`;
    return base;
  })();

  // ─── Cell formatting ────────────────────────────────────────────────────────────────────────
  function lengthText(row) {
    return row.duration_minutes != null ? `${row.duration_minutes} min` : "—";
  }
  function priceText(row) {
    if (!hasPriceColumn) return null;
    const amt = row.price_amount_minor;
    if (amt == null) return "—";
    if (Number(amt) === 0) return "Free";
    return formatValue(amt, "money", { currency: row.price_currency });
  }
  function thisYearText(row) {
    const n = row.booked_this_year ?? 0;
    return `${n} ${row.status === "Add-on only" ? "sold" : "booked"}`;
  }
  const STATUS_TONE = { Available: "ok", Hidden: "warn", "Add-on only": "neutral", Archived: "neutral" };
  function statusTone(status) {
    return STATUS_TONE[status] ?? "neutral";
  }
  function initials(name) {
    const words = String(name ?? "").trim().split(/\s+/).filter(Boolean);
    return words.slice(0, 2).map((w) => w[0]).join("").toUpperCase().replace(/[^A-Z0-9]/g, "") || "·";
  }

  // ─── Row actions ───────────────────────────────────────────────────────────────────────────
  async function duplicateOne(row) {
    try {
      const result = await request("/api/items/services/duplicate", { method: "POST", body: { id: row.id } });
      toast.success("Duplicated", { description: `${row.name} (copy)` });
      await load();
      onRefetch?.();
      return result;
    } catch (err) {
      throw err;
    }
  }
  async function setActive(row, active) {
    await api.setItemActive({ itemType: "service", itemId: row.id, active });
    await load();
    onRefetch?.();
  }
  async function archiveOne(row) {
    await api.archiveRecord({ object: "service", id: row.id });
    await load();
    onRefetch?.();
  }
  async function restoreOne(row) {
    await api.restoreRecord({ object: "service", id: row.id });
    await load();
    onRefetch?.();
  }
  function rowActions(row) {
    if (canWrite !== true) return [];
    const actions = [{ id: "duplicate", label: "Duplicate", onRun: () => duplicateOne(row) }];
    actions.push(
      row.active
        ? { id: "stop-selling", label: "Stop selling", onRun: () => setActive(row, false) }
        : { id: "sell-again", label: "Sell again", onRun: () => setActive(row, true) },
    );
    if (row.status === "Archived") {
      actions.push({ id: "restore", label: "Bring back", onRun: () => restoreOne(row) });
    } else {
      actions.push({
        id: "archive", label: "Archive", destructive: true,
        onRun: () => archiveOne(row),
        undo: () => api.restoreRecord({ object: "service", id: row.id }),
      });
    }
    return actions;
  }

  // ─── Selection + bulk ───────────────────────────────────────────────────────────────────────
  function toggleRow(id) {
    const s = new Set(selected);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    setSelected(s);
  }
  function toggleAll() {
    setSelected((filtered.length > 0 && selected.size === filtered.length) ? new Set() : new Set(filtered.map((r) => r.id)));
  }

  // ─── Export ────────────────────────────────────────────────────────────────────────────────
  function toCsv(list) {
    const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const headers = ["Service", "Category", "Length", ...(hasPriceColumn ? ["Price"] : []), "Status", "This year"];
    const lines = [headers.map(escape).join(",")];
    for (const r of list) {
      const cells = [
        r.name, r.category_name ?? "", lengthText(r),
        ...(hasPriceColumn ? [priceText(r)] : []),
        r.status ?? "", thisYearText(r),
      ];
      lines.push(cells.map(escape).join(","));
    }
    return lines.join("\r\n");
  }
  function downloadCsv(list) {
    const blob = new Blob([toCsv(list)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "services.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  function exportFiltered(key) {
    if (key !== "csv") return;
    downloadCsv(filtered);
  }

  // ─── Quick create (rich empty only) ─────────────────────────────────────────────────────────
  const [quickError, setQuickError] = useState(null);

  function parsePriceToMinor(text) {
    const cleaned = String(text ?? "").replace(/[^0-9.]/g, "");
    if (!cleaned) return 0;
    const n = Number(cleaned);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.round(n * 100);
  }

  async function quickSave({ name, price }) {
    setQuickError(null);
    try {
      const result = await api.createService({
        name, durationMinutes: 60, amountMinor: parsePriceToMinor(price), currency: "usd", bookable: true,
      });
      onRefetch?.();
      go(`/items/services/${result.id}`);
    } catch (err) {
      const errMsg = err instanceof ApiError ? err.message : String(err?.message ?? err);
      setQuickError(errMsg);
      throw err;
    }
  }

  // ─── Controls ───────────────────────────────────────────────────────────────────────────────
  const controls = showControls ? (
    <>
      <Input
        className="min-w-52 max-w-72"
        placeholder="Search"
        data-testid="services-search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {categoryOptions.length > 0 && (
        <NativeSelect value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} data-testid="services-filter-category">
          <NativeSelectOption value="all">Category: All</NativeSelectOption>
          {categoryOptions.map((c) => (
            <NativeSelectOption key={c} value={c}>{c}</NativeSelectOption>
          ))}
        </NativeSelect>
      )}
      <ProgramFilter value={programFilter} onChange={setProgramFilter} testId="services-filter-program" />
      <NativeSelect value={bookableFilter} onChange={(e) => setBookableFilter(e.target.value)} data-testid="services-filter-bookable">
        <NativeSelectOption value="all">Bookable: All</NativeSelectOption>
        <NativeSelectOption value="yes">Bookable</NativeSelectOption>
        <NativeSelectOption value="no">Not bookable</NativeSelectOption>
      </NativeSelect>
      {hasPriceColumn && (
        <NativeSelect value={priceFilter} onChange={(e) => setPriceFilter(e.target.value)} data-testid="services-filter-price">
          <NativeSelectOption value="all">Price: All</NativeSelectOption>
          <NativeSelectOption value="free">Free</NativeSelectOption>
          <NativeSelectOption value="priced">Priced</NativeSelectOption>
        </NativeSelect>
      )}
      <div className="flex-1" />
      <ExportMenu formats={[{ key: "csv", label: "CSV", includes: "Every visible column, in view order." }]} onExport={exportFiltered} testId="services-export" />
    </>
  ) : null;

  // ─── Bulk bar ───────────────────────────────────────────────────────────────────────────────
  const bulkActions = [
    {
      id: "archive", label: "Archive", destructive: true,
      run: async (ids) => {
        const results = await Promise.allSettled(ids.map((id) => api.archiveRecord({ object: "service", id })));
        const failed = [];
        results.forEach((r, i) => { if (r.status === "rejected") failed.push({ id: ids[i], reason: r.reason?.message ?? "Could not archive" }); });
        await load();
        onRefetch?.();
        return { changed: ids.length - failed.length, failed };
      },
      undo: async (ids) => {
        await Promise.all(ids.map((id) => api.restoreRecord({ object: "service", id })));
        await load();
        onRefetch?.();
      },
    },
    {
      id: "export", label: "Export",
      run: async (ids) => {
        const set = new Set(ids);
        downloadCsv(filtered.filter((r) => set.has(r.id)));
        return { changed: ids.length, failed: [] };
      },
    },
  ];

  // ★ §13.3 — selection + the bar come from the shared hook. This list keeps its own Archive (with Undo) and Export as extras; the shared hook adds Delete.
  const bulk = useListBulk({
    app, path, rank: app?.nav?.rank ?? null, rows: filtered, onChanged: () => { load(); onRefetch?.(); }, resetKey: viewData,
    extraActions: bulkAllowed ? bulkActions : [], omit: ["archive"],
  });
  const { selected, setSelected } = bulk;
  const bulkBar = bulkAllowed && !isRichEmpty ? bulk.bulkBar : null;

  return (
    <Suspense fallback={<div className="text-mute">Loading…</div>}>
      <ServicesListServicesLedgerTable
        path={path}
        onNavigate={onNavigate}
        go={go}
        viewData={viewData}
        fetchError={fetchError}
        load={load}
        phase={phase}
        rows={rows}
        hasPriceColumn={hasPriceColumn}
        canWrite={canWrite}
        VIEWS={VIEWS}
        activeView={activeView}
        filtered={filtered}
        displayPhase={displayPhase}
        showControls={showControls}
        bulkAllowed={bulkAllowed}
        isRichEmpty={isRichEmpty}
        clearFilters={clearFilters}
        emptyPropFor={emptyPropFor}
        summaryText={summaryText}
        lengthText={lengthText}
        priceText={priceText}
        thisYearText={thisYearText}
        statusTone={statusTone}
        initials={initials}
        rowActions={rowActions}
        selected={selected}
        toggleRow={toggleRow}
        toggleAll={toggleAll}
        quickError={quickError}
        quickSave={quickSave}
        controls={controls}
        bulkBar={bulkBar}
        onViewChange={setActiveView}
        onRefetch={onRefetch}
        bulkActions={bulkActions}
        onBulkClear={() => setSelected(new Set())}
        duplicateOne={duplicateOne}
        setActive={setActive}
        archiveOne={archiveOne}
        restoreOne={restoreOne}
      />
    </Suspense>
  );
}

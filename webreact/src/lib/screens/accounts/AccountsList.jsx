// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R4.016 — AccountsList: rebuild from the frame on the archetype (DecisionModal).
// Ported from webui/src/lib/screens/accounts/AccountsList.svelte (403 lines, 47 of them <style>).
// This screen renders a list of payer accounts with filtering, views, and archive modal.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useContext } from "react";
import { api, ApiError } from "@/lib/api.js";
import { AppStateContext } from "@/lib/app/useAppState.js";
import useListBulk from "@/lib/lists/useListBulk.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import AccountsListAccountsList from "./AccountsListAccountsList.jsx";
import AccountsListAccountsArchiveModal from "./AccountsListAccountsArchiveModal.jsx";
import NewAccountSheet from "./NewAccountSheet.jsx";

export default function AccountsList({ onNavigate = null }) {
  function go(href) {
    if (onNavigate) onNavigate(href);
    else window.location.assign(href);
  }

  const [phase, setPhase] = useState("loading");
  const [error, setError] = useState(null);
  const [groups, setGroups] = useState([]);

  const [search, setSearch] = useState("");
  const [activeView, setActiveView] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetPresetKind, setSheetPresetKind] = useState(null);

  const [archiveTarget, setArchiveTarget] = useState(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState(null);

  // Close archive modal clears the target
  useEffect(() => {
    if (!archiveOpen) setArchiveTarget(null);
  }, [archiveOpen]);

  async function load() {
    setPhase("loading");
    setError(null);
    try {
      const r = await api.payerGroups();
      const groupList = r?.groups ?? [];
      setGroups(groupList);
      setPhase(groupList.length === 0 ? "empty" : "ready");
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setPhase("denied");
        setError(err);
      } else {
        setPhase("error");
        setError(
          err instanceof ApiError
            ? { message: err.message, requestId: err.requestId }
            : { message: String(err?.message ?? err) }
        );
      }
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Both money columns are gated on the same signal
  const moneyVisible = groups.length > 0 && Object.prototype.hasOwnProperty.call(groups[0], "owingMinor");

  const totalPeople = groups.reduce((n, g) => n + (g.covers?.length ?? 0), 0);
  const summary =
    groups.length === 0
      ? "Nobody pays on behalf of anyone else yet."
      : `${groups.length} account${groups.length === 1 ? "" : "s"} pay for ${totalPeople} ` +
        `${totalPeople === 1 ? "person" : "people"} between them.`;

  const VIEW_KIND = { families: "family", employers: "employer", "third-parties": "third_party" };
  const filtered = (() => {
    let rows = groups;
    if (activeView !== "all") rows = rows.filter((g) => g.kind === VIEW_KIND[activeView]);
    if (moneyVisible && statusFilter !== "all") rows = rows.filter((g) => g.state === statusFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((g) =>
        (g.name ?? "").toLowerCase().includes(q) || (g.contactName ?? "").toLowerCase().includes(q)
      );
    }
    return rows;
  })();

  const appState = useContext(AppStateContext);
  const bulk = useListBulk({ app: appState, path: "/accounts/all", rank: appState?.nav?.rank ?? null, rows: filtered, onChanged: load });

  const isFiltered = activeView !== "all" || statusFilter !== "all" || search.trim() !== "";
  const showViews = groups.length > 0;
  const displayPhase = phase === "ready" && filtered.length === 0 ? "empty" : phase;

  function clearFilters() {
    setActiveView("all");
    setStatusFilter("all");
    setSearch("");
  }

  function kindLabel(kind) {
    return kind === "family" ? "Family" : kind === "employer" ? "Employer"
      : kind === "third_party" ? "Third party" : kind;
  }

  function whoWeTalkTo(row) {
    return row.contactName ?? "—";
  }

  function initials(name) {
    const words = String(name ?? "").trim().split(/\s+/).filter(Boolean);
    return words.slice(0, 2).map((w) => w[0]).join("").toUpperCase().replace(/[^A-Z0-9]/g, "") || "·";
  }

  function formatOwing(row) {
    if (!row.owingMinor) return "—";
    const n = row.owingMinor / 100;
    const amt = new Intl.NumberFormat("en-US", { style: "currency", currency: row.currency ?? "USD" }).format(n);
    return `${amt} owing`;
  }

  function openSheet(kind) {
    setSheetPresetKind(kind);
    setSheetOpen(true);
  }

  function closeSheet() {
    setSheetOpen(false);
    setSheetPresetKind(null);
  }

  function onSheetDone(id) {
    closeSheet();
    load();
    if (id) go(`/accounts/${id}`);
  }

  function handleEmptyNavigate(href) {
    if (href === "#new-account:family") {
      openSheet("family");
      return;
    }
    if (href === "#new-account:employer") {
      openSheet("employer");
      return;
    }
    go(href);
  }

  function rowActions(row) {
    return [
      { id: "open", label: "Open", onRun: () => go(`/accounts/${row.id}`) },
      { id: "add-someone", label: "Add someone to it", onRun: () => go(`/accounts/${row.id}`) },
      {
        id: "archive",
        label: "Archive",
        destructive: true,
        onRun: () => {
          setArchiveTarget(row);
          setArchiveError(null);
          setArchiveOpen(true);
        },
      },
    ];
  }

  async function confirmArchive() {
    if (!archiveTarget) return;
    setArchiveBusy(true);
    setArchiveError(null);
    try {
      await api.archivePayerGroup(archiveTarget.id);
      setArchiveOpen(false);
      await load();
    } catch (err) {
      setArchiveError(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setArchiveBusy(false);
    }
  }

  function exportRows(key) {
    if (key !== "csv") return;
    const cols = ["name", "kind", "contactName", "covers", "owingMinor", "state"];
    const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [
      cols.join(","),
      ...filtered.map((r) =>
        cols
          .map((c) => escape(c === "covers" ? (r.covers?.length ?? 0) : r[c]))
          .join(",")
      ),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `accounts-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const controls = phase === "ready" ? (
    <>
      <Input
        type="text"
        placeholder="Search"
        data-testid="accounts-search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="min-w-200 max-w-280"
      />
      {moneyVisible && (
        <select
          className="h-8 px-2.5 py-1 border border-input rounded-lg text-base"
          data-testid="accounts-status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="all">Status: All</option>
          <option value="owes">Status: Owes</option>
          <option value="paid_up">Status: Paid up</option>
        </select>
      )}
      <div className="flex-1"></div>
    </>
  ) : null;

  return (
    <>
      <AccountsListAccountsList
        onNavigate={onNavigate}
        go={go}
        phase={phase}
        error={error}
        activeView={activeView}
        onView={setActiveView}
        moneyVisible={moneyVisible}
        summary={summary}
        filtered={filtered}
        isFiltered={isFiltered}
        showViews={showViews}
        displayPhase={displayPhase}
        clearFilters={clearFilters}
        controls={controls}
        kindLabel={kindLabel}
        whoWeTalkTo={whoWeTalkTo}
        initials={initials}
        formatOwing={formatOwing}
        openSheet={() => openSheet(null)}
        handleEmptyNavigate={handleEmptyNavigate}
        rowActions={rowActions}
        bulk={bulk}
      />

      {sheetOpen && (
        <NewAccountSheet
          presetKind={sheetPresetKind}
          onDone={onSheetDone}
          onCancel={closeSheet}
        />
      )}

      {archiveTarget && (
        <AccountsListAccountsArchiveModal
          open={archiveOpen}
          onOpenChange={setArchiveOpen}
          error={error}
          archiveTarget={archiveTarget}
          archiveBusy={archiveBusy}
          archiveError={archiveError}
          confirmArchive={confirmArchive}
        />
      )}
    </>
  );
}

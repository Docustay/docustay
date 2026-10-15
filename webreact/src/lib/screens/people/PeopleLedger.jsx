// ═══════════════════════════════════════════════════════════════════════════════════════════════
// PeopleLedger — build from specs/mockups/PeopleList.frame.html (and others) on LedgerPage.
// Props: { view, path, rank, onNavigate, onDone } — view is ALREADY-FETCHED list response.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import ProgramFilter, { matchesProgram } from "@/lib/programs/ProgramFilter.jsx";
import { useState, useEffect, lazy, Suspense } from "react";
import { api, ApiError } from "@/lib/api.js";
import LedgerPage from "@/lib/lists/LedgerPage.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import { Badge } from "@/lib/components/ui/badge.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import RowActions from "@/lib/lists/RowActions.jsx";
import useListBulk from "@/lib/lists/useListBulk.jsx";
import ExportMenu from "@/lib/lists/ExportMenu.jsx";
import { formatValue } from "@/lib/format.js";
import { term } from "@/lib/terminology/terms.js";

// R4.009.T1 — lazy-loaded since it's built separately
const PeopleLedgerPeopleLedgerTable = lazy(() =>
  import("./PeopleLedgerPeopleLedgerTable.jsx").catch(() => ({
    default: () => <div data-testid="people-ledger-table-mock" className="text-mute">Table will render once the subtask is built</div>
  }))
);

export default function PeopleLedger({ view = null, path = "/people/all", rank = null, onNavigate = null, onDone = null }) {
  function go(href) {
    if (onNavigate) onNavigate(href);
    else window.location.assign(href);
  }

  // ★★★ SECTION C (the maintainer, pasted brief, 1 Oct 2026) — "rebuild People tabs as Active (default) · Lead
  //   · All · Paused · Former, driven by lifecycle_status, each with an Adult/Adolescent/Parent
  //   filter; remove Archived from People and the sidebar." Each lifecycle tab is still its own
  //   fetched path/query (the predicates are genuinely different, same as before) — the thing that
  //   changes to a pure client-side filter is Adult/Adolescent/Parent, via `roleFilter` below,
  //   using the SAME `tags` field every row already carries (the 29 Sep "tag, not a role" ruling).
  const VIEWS = [
    { key: "/people/active", label: "Active" },
    { key: "/people/leads", label: term("userType.lead") },
    { key: "/people/all", label: "All" },
    { key: "/people/paused", label: "Paused" },
    { key: "/people/former", label: "Former" },
  ];

  const ROLE_FILTERS = [
    { key: "all", label: "All", tag: null },
    { key: "adult", label: term("userType.adult"), tag: "adult" },
    { key: "adolescent", label: term("userType.adolescent"), tag: "adolescent" },
    { key: "parent", label: term("userType.parent"), tag: "parent" },
  ];

  const BULK_PATHS = new Set([
    "/people/all", "/people/clients", "/people/adolescents", "/people/parents", "/people/leads",
    "/people/active", "/people/paused", "/people/former",
  ]);
  const isAdmin = rank === "owner" || rank === "admin";
  const bulkAllowed = isAdmin && BULK_PATHS.has(path);
  const isArchivedView = path === "/people/archived";

  // ★ SECTION C — the three new lifecycle-stage moves staff actually need to use the new tabs:
  //   active ⇄ paused, either → former, former → active. Mirrors the existing "Make them a
  //   client" lead→active action below, which stays unchanged (it is this same machinery).
  const STAGE_LABEL = { active: "Active", paused: "Paused", former: "Former" };
  function stageActionsFor(row) {
    const from = row.lifecycle_status;
    const allowed = { active: ["paused", "former"], paused: ["active", "former"], former: ["active"] }[from] ?? [];
    return allowed.map((to) => ({
      id: `stage-${to}`,
      label: `Move to ${STAGE_LABEL[to]}`,
      onRun: async (r) => { await api.setPersonStage({ personId: r.id, status: to }); onDone?.(); },
    }));
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // THE FETCH PHASE
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const phase = (() => {
    if (view == null) return "loading";
    if (view.denied) return "denied";
    if (view.error) return "error";
    return "ready";
  })();

  const rows = view?.rows ?? [];
  const columns = view?.columns ?? [];
  const statusField = columns.find((c) => c.field === "status" || c.field === "state")?.field ?? null;

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [programFilter, setProgramFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState("all");

  // ★ SECTION C — the role chips reset per lifecycle tab, same as search/status already do.
  useEffect(() => {
    setRoleFilter("all");
  }, [path]);

  const statusValues = statusField ? Array.from(
    new Set(rows.filter((r) => r[statusField] != null).map((r) => r[statusField]))
  ) : [];

  const showRoleFilter = VIEWS.some((v) => v.key === path);

  const filtered = (() => {
    let r = rows;
    const q = search.trim().toLowerCase();
    if (q) {
      r = r.filter((row) =>
        String(row.display_name ?? "").toLowerCase().includes(q) ||
        String(row.email ?? "").toLowerCase().includes(q));
    }
    if (statusField && statusFilter !== "all") {
      r = r.filter((row) => row[statusField] === statusFilter);
    }
    if (programFilter !== "all") r = r.filter((row) => matchesProgram(programFilter, row.program_ids));
    if (showRoleFilter && roleFilter !== "all") {
      r = r.filter((row) => Array.isArray(row.tags) && row.tags.includes(roleFilter));
    }
    return r;
  })();

  // ★ §13.3 — selection and the bulk bar come from the shared hook: Delete everywhere, Restore on the archived tab, and (People rule) "Mark as former"
  //   REPLACES Archive for clients; leads keep Archive. Export stays this list's own extra.
  const CLIENT_PATHS = new Set(["/people/all", "/people/clients", "/people/adolescents", "/people/parents", "/people/active", "/people/paused"]);
  const bulk = useListBulk({
    path, rank, rows: filtered, onChanged: onDone, resetKey: view, omit: ["archive"],
    extraActions: bulkAllowed ? [
      CLIENT_PATHS.has(path)
        ? { id: "former", label: "Mark as former", run: async (ids) => { const r = await api.bulkChangeStagePeople(ids, "former"); onDone?.(); return r; } }
        : { id: "archive", label: "Archive", destructive: true, run: async (ids) => { const r = await api.bulkArchivePeople(ids); onDone?.(); return r; } },
      { id: "export", label: "Export", run: async (ids) => { const r = await api.bulkExportPeople(ids); return { changed: r?.exported ?? (r?.rows?.length ?? ids.length), failed: [] }; } },
    ] : [],
  });
  const { selected, setSelected } = bulk;

  const isFiltered = search.trim() !== "" || statusFilter !== "all" || roleFilter !== "all" || programFilter !== "all";
  const displayPhase = phase === "ready" && filtered.length === 0 ? "empty" : phase;
  const isEveryoneRichEmpty = displayPhase === "empty" && !isFiltered && path === "/people/all";

  function clearFilters() { setSearch(""); setStatusFilter("all"); setRoleFilter("all"); setProgramFilter("all"); }

  function emptyPropFor() {
    if (isFiltered) {
      return {
        kind: "filtered",
        headline: "Nothing matches these filters",
        line: "Try different filters or clear them.",
        action: null,
      };
    }
    return view?.emptyState ?? { kind: "first-run", headline: "Nothing here yet", line: "", action: null };
  }

  // ─── selection ──────────────────────────────────────────────────────────────────────────────────
  function toggleRow(id) {
    const s = new Set(selected);
    if (s.has(id)) s.delete(id); else s.add(id);
    setSelected(s);
  }
  function toggleAll() {
    setSelected((filtered.length > 0 && selected.size === filtered.length)
      ? new Set()
      : new Set(filtered.map((r) => r.id)));
  }

  // ─── number words ───────────────────────────────────────────────────────────────────────────────
  const NUMBER_WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
  function numberText(n) {
    if (typeof n !== "number" || !Number.isFinite(n)) return String(n ?? "0");
    if (Number.isInteger(n) && n >= 0 && n <= 10) return NUMBER_WORDS[n];
    return String(n);
  }

  // ─── the per-path summary sentence ───────────────────────────────────────────────────────────
  const summaryText = (() => {
    const s = view?.summary ?? null;
    if (path === "/people/all") {
      if (!s) return null;
      return `${numberText(s.clients)} clients. ${numberText(s.quiet)} haven't booked in over a month.`;
    }
    if (path === "/people/adolescents") {
      if (!s) return null;
      return `${numberText(s.count)} under 18. Each one has a parent on the account and a teen ` +
        `agreement signed by both.`;
    }
    if (path === "/people/parents") {
      if (!s) return null;
      return `${numberText(s.count)} people who pay for someone else. They see attendance and ` +
        `money, never notes.`;
    }
    if (path === "/people/leads") {
      if (!s) return null;
      const base = `${numberText(s.count)} people who haven't been in yet.`;
      return s.fromBookingPageThisWeek
        ? `${base} ${numberText(s.fromBookingPageThisWeek)} came from your booking page in the last week.`
        : base;
    }
    if (path === "/people/archived") {
      const n = view?.page?.totalCount ?? rows.length;
      return `${numberText(n)} archived.`;
    }
    // ★ SECTION C — the three new lifecycle tabs each just name their own count.
    if (path === "/people/active") {
      if (!s) return null;
      return `${numberText(s.count)} active.`;
    }
    if (path === "/people/paused") {
      if (!s) return null;
      return `${numberText(s.count)} paused.`;
    }
    if (path === "/people/former") {
      if (!s) return null;
      return `${numberText(s.count)} former.`;
    }
    return null;
  })();

  // ─── the Status/State badge ─────────────────────────────────────────────────────────────────────
  const STATUS_BADGE = {
    active: { label: "Active", tone: "neutral" },
    lead: { label: term("userType.lead"), tone: "act" },
    consent_unsigned: { label: "Consent unsigned", tone: "bad" },
    owing: { label: "Owing", tone: "bad" },
    paid_up: { label: "Paid up", tone: "ok" },
  };
  function statusBadge(value) {
    const m = /^quiet_(\d+)_weeks$/.exec(String(value));
    if (m) return { label: `Quiet ${m[1]} weeks`, tone: "warn" };
    return STATUS_BADGE[value] ?? { label: String(value ?? "—"), tone: "neutral" };
  }

  function initials(name) {
    const words = String(name ?? "").trim().split(/\s+/).filter(Boolean);
    return words.slice(0, 2).map((w) => w[0]).join("").toUpperCase().replace(/[^A-Z0-9]/g, "") || "·";
  }

  function rowActions(row) {
    if (isArchivedView) {
      return [
        { id: "open", label: "Open", onRun: () => go(`/record/person/${row.id}`) },
        {
          id: "restore", label: "Bring back",
          onRun: async (r) => { await api.restoreRecord({ object: "person", id: r.id }); onDone?.(); },
        },
      ];
    }
    return [
      { id: "open", label: "Open", onRun: () => go(`/record/person/${row.id}`) },
      // ★ the maintainer, 29 Sep 2026 — "Make them a client" on Lead ROWS, not just the record page. `tags`
      //   carries the row's system tags (people.mjs's TAGS_EXPR) — checked rather than `path ===
      //   "/people/leads"` so the row action works the same from any tab a lead happens to show in.
      ...(Array.isArray(row.tags) && row.tags.includes("lead")
        ? [{
            id: "make-client", label: "Make them a client",
            onRun: async (r) => { await api.setPersonStage({ personId: r.id, status: "active" }); onDone?.(); },
          }]
        : []),
      // ★ SECTION C — active ⇄ paused, either → former, former → active.
      ...stageActionsFor(row),
      {
        id: "archive", label: "Archive", destructive: true,
        onRun: async (r) => { await api.bulkArchivePeople([r.id]); onDone?.(); },
      },
    ];
  }

  // ─── filter-bar Export ───────────────────────────────────────────────────────────────────────
  const EXPORT_FORMATS = [
    { key: "csv", label: "CSV", includes: "Every visible column, in view order." },
  ];
  async function exportFiltered(key) {
    if (key !== "csv") return;
    await api.bulkExportPeople(filtered.map((r) => r.id));
  }

  // ─── QuickCreateRow (Everyone, true first run only) ────────────────────────────────────────
  const [quickName, setQuickName] = useState("");
  const [quickEmail, setQuickEmail] = useState("");
  const [quickBusy, setQuickBusy] = useState(false);
  const [quickError, setQuickError] = useState(null);

  async function quickSave() {
    const name = quickName.trim();
    if (!name) return;
    setQuickBusy(true);
    setQuickError(null);
    try {
      await api.createPerson({ displayName: name, email: quickEmail.trim(), role: "adult_client", invite: false });
      setQuickName("");
      setQuickEmail("");
      onDone?.();
    } catch (err) {
      setQuickError(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setQuickBusy(false);
    }
  }

  // ─── Render controls snippet ─────────────────────────────────────────────────────────────────
  const controls = displayPhase === "ready" ? (
    <>
      <Input
        className="min-w-52 max-w-72"
        placeholder="Search"
        data-testid="people-search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {showRoleFilter && (
        <select
          className="h-8 rounded-lg border border-input bg-surface px-2.5 py-1 text-base text-ink outline-none"
          data-testid="people-role-filter"
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
        >
          {ROLE_FILTERS.map((f) => (
            <option key={f.key} value={f.key}>{f.key === "all" ? "Who: All" : f.label}</option>
          ))}
        </select>
      )}
      {statusField && (
        <select
          className="h-8 rounded-lg border border-input bg-surface px-2.5 py-1 text-base text-ink outline-none"
          data-testid="people-status-filter"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="all">Status: All</option>
          {statusValues.map((v) => (
            <option key={v} value={v}>{statusBadge(v).label}</option>
          ))}
        </select>
      )}
      <ProgramFilter value={programFilter} onChange={setProgramFilter} testId="people-program-filter" />
      <div className="flex-1"></div>
      <ExportMenu formats={EXPORT_FORMATS} onExport={exportFiltered} testId="people-export" />
    </>
  ) : null;

  return (
    <LedgerPage
      title={view?.title ?? "People"}
      summary={(displayPhase === "ready" || displayPhase === "empty") ? summaryText : null}
      primary={{ label: "New client", onClick: () => go(`${path}?new=1`) }}
      headerAction={{ label: "Import", onClick: () => go("/settings/import") }}
      views={VIEWS}
      activeView={path}
      onView={(k) => go(k)}
      controls={controls}
      testId="people-ledger"
    >
      {bulk.bulkBar}

      {isEveryoneRichEmpty ? (
        <div className="rounded-card border border-line bg-surface p-14 text-center" data-state="empty" data-testid="people-empty-rich" role="status">
          <p className="m-0 text-lg font-medium text-ink" data-testid="people-empty-headline">
            Bring your people over, rather than typing them in
          </p>
          <p className="mx-auto mt-1.75 max-w-prose text-control text-mute leading-1.6" data-testid="people-empty-line">
            If you're coming from Mindbody, Vagaro, Boulevard, Practice Better or SimplePractice, we
            already know what their exports look like.
          </p>
          <div className="mt-4.5 flex flex-wrap justify-center gap-2">
            <Button data-testid="people-empty-bring-over" onClick={() => go("/settings/import")}>
              Bring them over
            </Button>
            <Button variant="outline" data-testid="people-empty-add-by-hand" onClick={() => go(`${path}?new=1`)}>
              Add someone by hand
            </Button>
            <Button variant="outline" disabled data-testid="people-empty-have-us-do-it"
                    title="No inbox for this yet.">
              Have us do it
            </Button>
          </div>
          <p className="m-0 mt-1.5 text-meta text-mute" data-testid="people-empty-have-us-do-it-reason">
            No inbox for this yet.
          </p>

          <div className="mt-5 flex flex-wrap justify-center gap-2 border-t border-line-soft pt-5" data-testid="people-quick-create">
            <Input
              placeholder="Name"
              data-testid="people-quick-name"
              value={quickName}
              onChange={(e) => setQuickName(e.target.value)}
            />
            <Input
              placeholder="Email"
              data-testid="people-quick-email"
              value={quickEmail}
              onChange={(e) => setQuickEmail(e.target.value)}
            />
            <Button
              data-testid="people-quick-save"
              disabled={quickBusy}
              onClick={quickSave}
            >
              {quickBusy ? "Saving…" : "Save"}
            </Button>
          </div>
          {quickError && (
            <p className="m-0 mt-2.5 text-control text-danger" role="alert" data-testid="people-quick-error">{quickError}</p>
          )}
        </div>
      ) : (
        <ScreenState
          phase={displayPhase}
          error={phase === "error" ? view?.error : null}
          reason={phase === "denied" ? (view?.error?.message ?? view?.reason ?? null) : null}
          empty={emptyPropFor()}
          onClearFilters={clearFilters}
          onNavigate={go}
        >
          {displayPhase === "ready" && (
            <Suspense fallback={<div className="text-mute">Loading…</div>}>
              <PeopleLedgerPeopleLedgerTable
                view={view}
                path={path}
                onNavigate={onNavigate}
                go={go}
                VIEWS={VIEWS}
                bulkAllowed={bulk.selectable}
                phase={phase}
                columns={columns}
                selected={selected}
                filtered={filtered}
                displayPhase={displayPhase}
                isEveryoneRichEmpty={isEveryoneRichEmpty}
                clearFilters={clearFilters}
                emptyPropFor={emptyPropFor}
                toggleRow={toggleRow}
                toggleAll={toggleAll}
                summaryText={summaryText}
                statusBadge={statusBadge}
                initials={initials}
                rowActions={rowActions}
                quickName={quickName}
                quickEmail={quickEmail}
                quickBusy={quickBusy}
                quickError={quickError}
                quickSave={quickSave}
              />
            </Suspense>
          )}
        </ScreenState>
      )}
    </LedgerPage>
  );
}

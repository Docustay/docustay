// ═══════════════════════════════════════════════════════════════════════════════════════════════
// DocsHome.jsx — Square Contracts rebuild (29 Sep 2026). "Documents — copy Square almost exactly.
// Search, a few filter chips (Status, Template, Date), one black 'New document' button, and a
// table: Recipient · Document · Status with its date · a '…' menu. Nothing else."
// Fetches `/api/list/documents` (src/records/lists/documents.mjs's new descriptor — every copy
// made from a template, Draft through Expired, both builders) ONCE; Status/Template are client-side
// filter chips over that one fetch, matching the established pattern (DocsList.jsx's own Agreements/
// Forms/Retired chips, DocsSent.jsx's own state chips) rather than five separate routes.
// Props: { path, params, app, onNavigate, onRefetch }
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from "react";
import { Settings } from "lucide-react";
import { request, ApiError } from "@/lib/api.js";
import LedgerPage from "@/lib/lists/LedgerPage.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { NativeSelect } from "@/lib/components/ui/native-select.jsx";
import { formatValue } from "@/lib/format.js";
import useListBulk from "@/lib/lists/useListBulk.jsx";
import { BulkHeadCell, BulkRowCell, RowMenuHeadCell, RowMenuCell } from "@/lib/lists/BulkCells.jsx";

const STATUS_TONE = Object.freeze({
  draft: "neutral", sent: "warn", partially_signed: "warn",
  executed: "ok", declined: "bad", expired: "bad", void: "neutral",
});
const STATUS_LABEL = Object.freeze({
  draft: "Draft", sent: "Sent", partially_signed: "Partially signed",
  executed: "Signed", declined: "Declined", expired: "Expired", void: "Void",
});
// ★ Old bookmarks land here with a status query param (routes.js's OLD_DOCUMENT_ADDRESSES) — the
//   old "waiting"/"signed" wording maps onto the real state values this list actually filters by.
const STATUS_FROM_QUERY = Object.freeze({ waiting: "waiting", signed: "executed", declined: "declined", expired: "expired" });

export default function DocsHome({ path = "/documents", params = null, app = null, onNavigate = null, onRefetch = null }) {
  function go(href) { if (onNavigate) onNavigate(href); else window.location.assign(href); }
  function openRecord(row) { go(row.builder === "pdf" ? `/documents/pdf/${row.id}` : `/record/document/${row.id}`); }

  const initialStatus = (() => {
    const q = app?.query?.status;
    return q && STATUS_FROM_QUERY[q] ? STATUS_FROM_QUERY[q] : "all";
  })();
  const initialType = app?.query?.type === "agreements" ? "contract" : app?.query?.type === "forms" ? "form" : "all";

  const [rows, setRows] = useState(null);
  const [fetchError, setFetchError] = useState(null);
  const [fetchDenied, setFetchDenied] = useState(false);
  const [status, setStatus] = useState(initialStatus);
  const [type, setType] = useState(initialType);
  const [search, setSearch] = useState("");

  async function load() {
    setFetchError(null); setFetchDenied(false); setRows(null);
    try {
      const result = await request("/api/list/documents");
      setRows(result.rows ?? []);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setFetchDenied(true);
      setFetchError(err);
    }
  }
  useEffect(() => { load(); }, [app?.refetchSignal]);

  const templateNames = useMemo(() => {
    const names = new Set((rows ?? []).map((r) => r.title));
    return [...names].sort();
  }, [rows]);

  const filtered = useMemo(() => {
    let r = rows ?? [];
    if (status === "waiting") r = r.filter((x) => x.state === "sent" || x.state === "partially_signed");
    else if (status !== "all") r = r.filter((x) => x.state === status);
    if (type !== "all") r = r.filter((x) => x.builder === type);
    const q = search.trim().toLowerCase();
    if (q) r = r.filter((x) => x.title?.toLowerCase().includes(q) || x.subject?.toLowerCase().includes(q));
    return r;
  }, [rows, status, type, search]);

  // §13.3 — selection + bulk Delete come from the shared hook; this screen writes no delete code of its own
  const bulk = useListBulk({ app, path, rank: app?.nav?.rank ?? null, rows: filtered, onChanged: app ? null : load });

  const phase = fetchDenied ? "denied" : fetchError ? "error" : rows === null ? "loading" : "ready";
  const isFiltered = status !== "all" || type !== "all" || search.trim() !== "";
  const displayPhase = phase === "ready" && filtered.length === 0 ? "empty" : phase;

  const summaryText = phase === "ready"
    ? (rows.length === 0 ? null : `${filtered.length} document${filtered.length === 1 ? "" : "s"}.`)
    : null;

  const dateFor = (row) => row.executed_at ?? row.sent_at ?? null;

  const emptyProp = isFiltered
    ? { kind: "filtered", headline: "Nothing matches those filters", line: "Try a different status, template or search.", action: null }
    : { kind: "first-run", headline: "Nothing here yet", line: "Every copy made from a template for one person — drafted, sent, signed, declined or expired.", action: { label: "New document", onClick: () => go("/documents?new=1") } };

  return (
    <LedgerPage
      title="Documents"
      summary={summaryText}
      primary={{ label: "New document", onClick: () => go("/documents?new=1") }}
      headerAction={{ label: "Templates", onClick: () => go("/documents/templates") }}
      testId="docs-home"
      controls={
        <div className="flex flex-wrap items-center gap-2" data-testid="docs-home-filters">
          <Button variant="outline" onClick={() => go("/documents/upload")} data-testid="docs-home-upload">Upload a file</Button>
          <Input className="min-w-[200px] max-w-[280px]" placeholder="Search" data-testid="docs-home-search" aria-label="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
          <NativeSelect value={status} onChange={(e) => setStatus(e.target.value)} data-testid="docs-home-status" aria-label="Filter by status" className="w-auto">
            <option value="all">All statuses</option>
            <option value="draft">Draft</option>
            <option value="waiting">Sent</option>
            <option value="executed">Signed</option>
            <option value="declined">Declined</option>
            <option value="expired">Expired</option>
          </NativeSelect>
          <NativeSelect value={type} onChange={(e) => setType(e.target.value)} data-testid="docs-home-type" aria-label="Filter by template type" className="w-auto">
            <option value="all">All templates</option>
            <option value="contract">Agreements</option>
            <option value="form">Forms</option>
          </NativeSelect>
          {/* ★ Square Contracts rebuild §1 — "Settings leaves the sidebar — behind a gear on the
              Documents page." DocsSettings.jsx itself is unchanged; only its entry point moved. */}
          <Button variant="ghost" size="icon" className="ml-auto" onClick={() => go("/documents/settings")} aria-label="Document settings" data-testid="docs-home-settings-gear">
            <Settings className="size-4" aria-hidden="true" />
          </Button>
        </div>
      }
    >
      <ScreenState
        phase={displayPhase}
        error={phase === "error" ? fetchError : null}
        reason={phase === "denied" ? (fetchError?.message ?? null) : null}
        empty={emptyProp}
        onNavigate={go}
        subject="Documents"
        onRetry={load}
      >
        {displayPhase === "ready" && (
          <>
          {bulk.bulkBar}
          <div className="min-w-0 max-w-full overflow-auto rounded-card border border-line bg-surface" data-testid="docs-home-table">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <BulkHeadCell bulk={bulk} rows={filtered} />
                  <th className="h-9 border-b border-line bg-surface-sunken px-4 py-0 text-left text-caption font-medium text-mute">Recipient</th>
                  <th className="h-9 border-b border-line bg-surface-sunken px-4 py-0 text-left text-caption font-medium text-mute">Document</th>
                  <th className="h-9 border-b border-line bg-surface-sunken px-4 py-0 text-left text-caption font-medium text-mute">Status</th>
                  <RowMenuHeadCell bulk={bulk} />
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.id} className="cursor-pointer hover:bg-paper" data-testid="docs-home-row" data-id={row.id} onClick={() => openRecord(row)}>
                    <BulkRowCell bulk={bulk} id={row.id} />
                    <td className="h-10 border-b border-line-soft px-4 py-0 text-ui">{row.subject ?? "—"}</td>
                    <td className="h-10 border-b border-line-soft px-4 py-0 text-ui">{row.title}</td>
                    <td className="h-10 border-b border-line-soft px-4 py-0 text-ui">
                      <div className="flex items-center gap-2">
                        <StatusBadge label={STATUS_LABEL[row.state] ?? row.state} tone={STATUS_TONE[row.state] ?? "neutral"} />
                        {dateFor(row) && <span className="text-caption text-mute">{formatValue(dateFor(row), "date", { empty: "" })}</span>}
                      </div>
                    </td>
                    <RowMenuCell bulk={bulk} row={row} actions={[]} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </ScreenState>
    </LedgerPage>
  );
}

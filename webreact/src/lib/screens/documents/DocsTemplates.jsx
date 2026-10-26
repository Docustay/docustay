// ═══════════════════════════════════════════════════════════════════════════════════════════════
// DocsTemplates.jsx — Square Contracts rebuild (29 Sep 2026). "Templates — the master copies,
// written once, never sent themselves. Agreements and Forms are a FILTER here, not tabs." Fetches
// `/api/list/documents/templates` (src/records/lists/documents.mjs — both builders, active and
// retired, together) once; Agreement/Form/Retired are client-side filter chips over that one fetch,
// the same pattern DocsHome.jsx's own Status/Template chips use.
// Props: { path, params, app, onNavigate, onRefetch }
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from "react";
import { request, ApiError } from "@/lib/api.js";
import LedgerPage from "@/lib/lists/LedgerPage.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { NativeSelect } from "@/lib/components/ui/native-select.jsx";
import useSharedEngine from "./useSharedEngine.js";
import useListBulk from "@/lib/lists/useListBulk.jsx";
import { BulkHeadCell, BulkRowCell, RowMenuHeadCell, RowMenuCell } from "@/lib/lists/BulkCells.jsx";

export default function DocsTemplates({ path = "/documents/templates", params = null, app = null, onNavigate = null, onRefetch = null }) {
  function go(href) { if (onNavigate) onNavigate(href); else window.location.assign(href); }

  const initialType = app?.query?.type === "agreements" ? "contract" : app?.query?.type === "forms" ? "form" : app?.query?.type === "retired" ? "retired" : "all";

  const shared = useSharedEngine();
  const [rows, setRows] = useState(null);
  const [fetchError, setFetchError] = useState(null);
  const [fetchDenied, setFetchDenied] = useState(false);
  const [type, setType] = useState(initialType);
  const [search, setSearch] = useState("");

  async function load() {
    setFetchError(null); setFetchDenied(false); setRows(null);
    try {
      const result = await request("/api/list/documents/templates");
      setRows(result.rows ?? []);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setFetchDenied(true);
      setFetchError(err);
    }
  }
  useEffect(() => { load(); }, [app?.refetchSignal]);

  const filtered = useMemo(() => {
    let r = rows ?? [];
    if (type === "contract") r = r.filter((x) => x.builder === "contract" && x.active !== false);
    else if (type === "form") r = r.filter((x) => x.builder === "form" && x.active !== false);
    else if (type === "retired") r = r.filter((x) => x.active === false);
    else r = r.filter((x) => x.active !== false);
    const q = search.trim().toLowerCase();
    if (q) r = r.filter((x) => x.name?.toLowerCase().includes(q));
    return r;
  }, [rows, type, search]);

  // §13.3 — selection + bulk Delete come from the shared hook; this screen writes no delete code of its own
  const bulk = useListBulk({ app, path, rank: app?.nav?.rank ?? null, rows: filtered });

  const phase = fetchDenied ? "denied" : fetchError ? "error" : rows === null ? "loading" : "ready";
  const isFiltered = type !== "all" || search.trim() !== "";
  const displayPhase = phase === "ready" && filtered.length === 0 ? "empty" : phase;
  const rowsExist = (rows ?? []).length > 0;

  const summaryText = phase === "ready" && rowsExist ? `${filtered.length} template${filtered.length === 1 ? "" : "s"}.` : null;

  const emptyProp = isFiltered
    ? { kind: "filtered", headline: "Nothing matches those filters", line: "Try a different type or clear the search.", action: null }
    : { kind: "first-run", headline: "Create your first template", line: "The words an agreement is made of, or the questions a form asks.", action: { label: "New template", onClick: () => go("/documents/templates/new") } };

  function stateFor(row) {
    return row.active === false ? { label: "Retired", tone: "neutral" } : { label: "In use", tone: "ok" };
  }

  return (
    <LedgerPage
      title="Templates"
      summary={summaryText}
      primary={{ label: "New template", onClick: () => go("/documents/templates/new") }}
      headerAction={{ label: "Clauses", onClick: () => go("/documents/clauses") }}
      testId="docs-templates"
      controls={
        rowsExist || shared.enabled ? (
          <div className="flex flex-wrap items-center gap-2" data-testid="docs-templates-filters">
            {shared.enabled ? <Button onClick={() => go("/documents/write")} data-testid="dt-write">Write a template</Button> : null}
            {rowsExist ? <>
            <Input className="min-w-[200px] max-w-[280px]" placeholder="Search" data-testid="docs-templates-search" value={search} onChange={(e) => setSearch(e.target.value)} />
            <NativeSelect value={type} onChange={(e) => setType(e.target.value)} data-testid="docs-templates-type" className="w-auto">
              <option value="all">Agreements &amp; Forms</option>
              <option value="contract">Agreements</option>
              <option value="form">Forms</option>
              <option value="retired">Retired</option>
            </NativeSelect>
            <Button variant="outline" onClick={() => go("/documents/templates/pdf")} data-testid="docs-templates-uploaded">Uploaded templates</Button>
            </> : null}
          </div>
        ) : null
      }
    >
      <ScreenState
        phase={displayPhase}
        error={phase === "error" ? fetchError : null}
        reason={phase === "denied" ? (fetchError?.message ?? null) : null}
        empty={emptyProp}
        onNavigate={go}
        subject="Templates"
        onRetry={load}
      >
        {displayPhase === "ready" && (
          <>
          {bulk.bulkBar}
          <div className="overflow-auto rounded-card border border-line bg-surface" data-testid="docs-templates-table">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <BulkHeadCell bulk={bulk} rows={filtered} />
                  <th className="h-9 border-b border-line bg-surface-sunken px-4 py-0 text-left text-caption font-medium text-mute">Template</th>
                  <th className="h-9 border-b border-line bg-surface-sunken px-4 py-0 text-left text-caption font-medium text-mute">Type</th>
                  <th className="h-9 border-b border-line bg-surface-sunken px-4 py-0 text-left text-caption font-medium text-mute">Sent</th>
                  <th className="h-9 border-b border-line bg-surface-sunken px-4 py-0 text-left text-caption font-medium text-mute">State</th>
                  <RowMenuHeadCell bulk={bulk} />
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const state = stateFor(row);
                  return (
                    <tr key={row.id} className="cursor-pointer hover:bg-paper" data-testid="docs-templates-row" data-id={row.id} onClick={() => go(row.builder === "pdf" ? `/documents/templates/pdf/${row.id}` : `/documents/templates/${row.id}`)}>
                      <BulkRowCell bulk={bulk} id={row.id} />
                      <td className="h-10 border-b border-line-soft px-4 py-0 text-ui">{row.name}</td>
                      <td className="h-10 border-b border-line-soft px-4 py-0 text-ui">{row.builder === "form" ? "Form" : row.builder === "pdf" ? "Uploaded file" : "Agreement"}</td>
                      <td className="h-10 border-b border-line-soft px-4 py-0 text-ui font-variant-numeric tabular-nums">{row.sent_instances != null ? `${row.sent_instances} sent` : "—"}</td>
                      <td className="h-10 border-b border-line-soft px-4 py-0 text-ui"><StatusBadge label={state.label} tone={state.tone} /></td>
                      <RowMenuCell bulk={bulk} row={row} />
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </ScreenState>
    </LedgerPage>
  );
}

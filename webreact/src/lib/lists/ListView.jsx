// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ListView — every descriptor-driven list (LIST_VIEWS). Ported from webui/src/lib/lists/ListView.svelte:
// same props, testids and data-* hooks (list-view, data-path, data-rows, list-row, data-id, cell-<field>,
// data-column, data-format, list-select-all, list-select-row-<id>, list-total, list-total-value,
// list-total-mixed, list-empty, list-no-permission), same behaviour:
//   · filter / sort / hidden columns live in the URL (?q, ?sort, ?dir, ?hidden) via replaceState
//   · sorting: header click cycles asc → desc → off; nulls always sink
//   · the six phases through phaseOf(); a network error says "Connection lost"; an `errorWhenEmpty`
//     descriptor turns an empty result into an error (it cannot legitimately be empty)
//   · filtered-to-nothing is its OWN empty kind with "Clear filters"
// Snippet props become React: `actions` and `bulkBar` are nodes; `rowActions(row)` returns a node.
// `selected` was $bindable → `selected` + `onSelectedChange`.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useRef, useState } from "react";
import PageHeader from "./PageHeader.jsx";
import ListControls from "./ListControls.jsx";
import ListSkeleton from "./ListSkeleton.jsx";
import InlineEditCell from "./InlineEditCell.jsx";
import { formatValue } from "@/lib/format.js";
import { usePrograms } from "@/lib/programs/programs.js";
import ProgramFilter, { matchesProgram } from "@/lib/programs/ProgramFilter.jsx";
import { ProgramChips } from "@/lib/programs/ProgramChip.jsx";
import { phaseOf, kindOf } from "@/lib/empty/phase.js";
import { emptyBlockOf } from "@/lib/empty/descriptor.js";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import EmptyState from "@/lib/empty/EmptyState.jsx";
import { Checkbox } from "@/lib/components/ui/checkbox.jsx";
import { Badge } from "@/lib/components/ui/badge.jsx";
import { useBindable } from "@/lib/hooks/useBindable.js";

function compare(a, b, format) {
  if (a === b) return 0;
  if (a == null) return 1;   // nulls sink, in both directions
  if (b == null) return -1;
  if (format === "money" || format === "number") return Number(a) - Number(b);
  if (format === "date" || format === "datetime") return new Date(a) - new Date(b);
  return String(a).localeCompare(String(b));
}
const readParams = () => new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
const TH = "h-(--size-row-head) border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute data-[sticky=true]:sticky data-[sticky=true]:left-0";
const TD = "h-(--size-row) border-b border-hair px-4 text-ui text-ink data-[format=money]:tabular-nums data-[format=number]:tabular-nums data-[sticky=true]:sticky data-[sticky=true]:left-0 data-[sticky=true]:bg-surface";

export default function ListView({
  view, rows = [], path = null, onOpen = null, actions = null, rowActions = null, onPrefetch = null,
  loading = false, error = null, denied = false, notBuilt = false, reason = null, blocked = false, onNavigate = null,
  selectable = false, selected, onSelectedChange, bulkBar = null, editableFields = null, onEditCell = null,
  canWrite = null, noWriteNotice = null, onRetry = null,
}) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const columns = view?.columns ?? [];
  const prefetched = useRef(new Set());
  const [initial] = useState(() => {
    const p = readParams();
    return { q: p.get("q") ?? "", sort: p.get("sort"), dir: p.get("dir") ?? "asc", hidden: new Set((p.get("hidden") ?? "").split(",").filter(Boolean)) };
  });
  const [query, setQuery] = useState(initial.q);
  // ★ QUEUE §4 — a list that carries a program (or programs) column gets a program filter for free; rows narrow client-side, like the text filter.
  const programCol = (view?.columns ?? []).find((c) => c.format === "program" || c.format === "programs") ?? null;
  const programs = usePrograms();
  const [programFilter, setProgramFilter] = useState(() => readParams().get("program") ?? "all");
  const [sortField, setSortField] = useState(initial.sort);
  const [sortDir, setSortDir] = useState(initial.dir);
  const [hidden, setHidden] = useState(initial.hidden);
  const [sel, setSel] = useBindable(selected, onSelectedChange, new Set());
  const [editingCellKey, setEditingCellKey] = useState(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (programFilter !== "all") params.set("program", programFilter);
    if (sortField) { params.set("sort", sortField); if (sortDir !== "asc") params.set("dir", sortDir); }
    const hiddenArray = Array.from(hidden).sort();
    if (hiddenArray.length > 0) params.set("hidden", hiddenArray.join(","));
    const next = params.toString();
    if (next !== window.location.search.slice(1)) {
      window.history.replaceState(window.history.state, "", next ? `${window.location.pathname}?${next}` : window.location.pathname);
    }
  }, [query, sortField, sortDir, hidden, programFilter]);

  const visibleColumns = columns.filter((c) => !hidden.has(c.field));
  const cellText = (row, c) => formatValue(row[c.field], c.format, { empty: "—", currency: c.currency ? row[c.currency] : null });
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = safeRows;
    if (programCol && programFilter !== "all") out = out.filter((r) => matchesProgram(programFilter, r[programCol.field]));
    if (q) out = out.filter((r) => visibleColumns.some((c) => String(cellText(r, c) ?? "").toLowerCase().includes(q)));
    if (sortField) {
      const col = columns.find((c) => c.field === sortField);
      const dir = sortDir === "desc" ? -1 : 1;
      out = [...out].sort((a, b) => dir * compare(a[sortField], b[sortField], col?.format));
    }
    return out;
  }, [safeRows, query, sortField, sortDir, visibleColumns, columns, programCol, programFilter, programs.programs]);

  function toggleSort(field) {
    if (sortField !== field) { setSortField(field); setSortDir("asc"); return; }
    if (sortDir === "asc") setSortDir("desc");
    else { setSortField(null); setSortDir("asc"); }
  }
  function prefetchOnHover(row, event) {
    if (!onPrefetch) return;
    const t = setTimeout(() => { if (!prefetched.current.has(row.id)) { prefetched.current.add(row.id); onPrefetch(row); } }, 350);
    event.currentTarget.addEventListener("mouseleave", () => clearTimeout(t), { once: true });
  }

  const declared = emptyBlockOf(view);
  const faultWhenEmpty = declared.errorWhenEmpty === true && !loading && !error && !denied && !notBuilt && safeRows.length === 0;
  const isNetworkError = error && (error instanceof TypeError || /^(failed to fetch|network|offline|fetch|connection)/i.test(String(error.message)));
  const effectiveError = faultWhenEmpty ? new Error(declared.line || "This list cannot legitimately be empty.") : error;
  const phase = phaseOf({ loading, error: effectiveError, denied, notBuilt, rows: faultWhenEmpty ? undefined : safeRows });
  const filteredToNothing = phase === "ready" && shown.length === 0;
  const emptyKind = kindOf(declared, { filtered: filteredToNothing, blocked });
  const emptyBlock = filteredToNothing
    ? { kind: "filtered", icon: declared.icon ?? null, headline: `Nothing matches “${query}”`, line: `${safeRows.length} ${safeRows.length === 1 ? "row is" : "rows are"} on this screen; the filter matched none of them.`, action: null }
    : emptyKind === "blocked" && declared.blockedAction
      ? { ...declared, kind: "blocked", action: declared.blockedAction, line: declared.blockedLine ?? declared.line }
      : { ...declared, kind: emptyKind };

  const totalAt = view?.totalColumn ? columns.findIndex((c) => c.field === view.totalColumn) : -1;
  const totalCol = totalAt >= 0 ? columns[totalAt] : null;
  const allShownSelected = selectable && shown.length > 0 && shown.every((r) => sel.has(r.id));
  const someShownSelected = selectable && !allShownSelected && shown.some((r) => sel.has(r.id));
  const toggleAllShown = () => { const next = new Set(sel); if (allShownSelected) for (const r of shown) next.delete(r.id); else for (const r of shown) next.add(r.id); setSel(next); };
  const toggleOneSelected = (id) => { const next = new Set(sel); if (next.has(id)) next.delete(id); else next.add(id); setSel(next); };
  const inReadyish = phase === "ready" || phase === "empty";
  const colSpanAll = visibleColumns.length + (rowActions ? 1 : 0) + (selectable ? 1 : 0);

  return (
    <section className="flex flex-col" data-testid="list-view" data-path={path ?? undefined} data-rows={safeRows.length}>
      <PageHeader title={view?.title} count={inReadyish ? shown.length : null} total={query.trim() ? safeRows.length : null}
                  actions={actions && (inReadyish || phase === "not-built") ? actions : null} />
      {phase === "ready" && canWrite === false && noWriteNotice && (
        <p className="mb-3 rounded-sm border border-line bg-surface-2 px-3 py-2 text-meta text-ink-2" data-testid="list-no-permission">{noWriteNotice}</p>
      )}
      {inReadyish && (
        <div className="mb-3.5 flex flex-wrap items-center gap-2">
          {programCol && <ProgramFilter value={programFilter} onChange={setProgramFilter} />}
          <ListControls query={query} onQueryChange={setQuery} columns={columns} hidden={hidden}
                        onToggleColumn={(f) => { const next = new Set(hidden); if (next.has(f)) next.delete(f); else next.add(f); setHidden(next); }}
                        sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
        </div>
      )}
      {selectable && bulkBar && sel.size > 0 && inReadyish && bulkBar}
      {phase === "loading" ? (
        <ListSkeleton columns={view?.columns ?? []} />
      ) : phase === "error" && isNetworkError ? (
        <ScreenState phase="error" empty={view?.emptyState ?? view?.empty} error={new Error("Connection lost — check your internet and try again.")} reason={reason}
                     testIds={{ empty: "list-empty" }} onNavigate={onNavigate} subject={view?.title ?? null} onRetry={onRetry} />
      ) : phase === "error" || phase === "denied" ? (
        <ScreenState phase={phase} empty={view?.emptyState ?? view?.empty} error={effectiveError} reason={reason}
                     testIds={{ empty: "list-empty" }} onNavigate={onNavigate} subject={view?.title ?? null} onRetry={phase === "error" ? onRetry : null} />
      ) : (
        <div className="overflow-auto rounded-card border border-line bg-surface">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {selectable && (
                  <th scope="col" className={`${TH} w-10`} data-column="select">
                    <Checkbox checked={allShownSelected ? true : someShownSelected ? "indeterminate" : false} onCheckedChange={toggleAllShown} aria-label="Select all shown rows" data-testid="list-select-all" />
                  </th>
                )}
                {visibleColumns.map((c, i) => (
                  <th key={c.field} scope="col" className={TH} data-column={c.field} data-format={c.format ?? "text"} data-sticky={i === 0 ? "true" : undefined}
                      aria-sort={sortField === c.field ? (sortDir === "asc" ? "ascending" : "descending") : undefined}>
                    <button type="button" className="inline-flex items-center gap-1 text-caption font-medium text-mute" onClick={() => toggleSort(c.field)}>
                      {c.label}{sortField === c.field && <span aria-hidden="true">{sortDir === "asc" ? "▲" : "▼"}</span>}
                    </button>
                  </th>
                ))}
                {rowActions && <th scope="col" className={TH} data-column="row-actions" data-format="actions">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={row.id} className="last:[&>td]:border-b-0" data-openable={view?.recordType && onOpen ? "true" : undefined} data-id={row.id} data-testid="list-row"
                    onMouseEnter={(e) => prefetchOnHover(row, e)}>
                  {selectable && (
                    <td className={`${TD} w-10`} data-testid="cell-select">
                      <Checkbox checked={sel.has(row.id)} onCheckedChange={() => toggleOneSelected(row.id)} aria-label="Select row" data-testid={`list-select-row-${row.id}`} />
                    </td>
                  )}
                  {visibleColumns.map((c, i) => {
                    const text = cellText(row, c);
                    const opener = i === 0 && view?.recordType && onOpen;
                    const editable = editableFields && editableFields.includes(c.field) && onEditCell;
                    let content;
                    if (opener && editable) {
                      content = editingCellKey === `${row.id}:${c.field}` ? (
                        <InlineEditCell value={row[c.field] ?? ""} displayText={text} startEditing onClose={() => setEditingCellKey(null)} onSave={(v) => onEditCell(row, c.field, v)} testId={`edit-${c.field}-${row.id}`} />
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          <button type="button" className="font-medium text-ink hover:underline" onClick={() => onOpen(view.recordType, row.id)}>{text}</button>
                          <button type="button" className="text-faint hover:text-ink" aria-label={`Edit ${c.label}`} data-testid={`edit-trigger-${c.field}-${row.id}`} onClick={() => setEditingCellKey(`${row.id}:${c.field}`)}>✎</button>
                        </span>
                      );
                    } else if (opener) {
                      content = <button type="button" className="font-medium text-ink hover:underline" onClick={() => onOpen(view.recordType, row.id)}>{text}</button>;
                    } else if (editable) {
                      content = <InlineEditCell value={row[c.field] ?? ""} displayText={text} type={c.format === "enum" ? "select" : c.editType ?? "text"} options={c.editOptions ?? null} onSave={(v) => onEditCell(row, c.field, v)} testId={`edit-${c.field}-${row.id}`} />;
                    } else if (c.format === "programs" || c.format === "program") {
                      content = <ProgramChips ids={c.format === "program" ? [row[c.field]].filter(Boolean) : row[c.field]} />;
                    } else if (c.format === "enum" && !["—", "", null, undefined].includes(text)) {
                      content = <Badge variant="secondary" data-value={String(row[c.field] ?? "")}>{text}</Badge>;
                    } else {
                      content = text;
                    }
                    return <td key={c.field} className={TD} data-testid={`cell-${c.field}`} data-format={c.format ?? "text"} data-sticky={i === 0 ? "true" : undefined}>{content}</td>;
                  })}
                  {rowActions && <td className={TD} data-testid="cell-row-actions" data-format="actions">{rowActions(row)}</td>}
                </tr>
              ))}
            </tbody>
            {shown.length === 0 ? null : view?.totalColumn && view?.total === null && (view?.totalCurrencies?.length ?? 0) > 1 ? (
              <tfoot data-testid="list-total-mixed">
                <tr><td className={`${TD} bg-surface-2`} colSpan={colSpanAll}>No total: this list mixes {view.totalCurrencies.join(" and ")}.</td></tr>
              </tfoot>
            ) : totalCol ? (() => {
              const before = totalAt + (selectable ? 1 : 0);
              const after = visibleColumns.length - totalAt - 1 + (rowActions ? 1 : 0);
              return (
                <tfoot data-testid="list-total">
                  <tr>
                    <td className={`${TD} bg-surface-2`} data-sticky="true" colSpan={before || 1}><strong>Total</strong></td>
                    {before > 0 && (
                      <td className={`${TD} bg-surface-2`} data-format={totalCol.format ?? "text"}>
                        <strong data-testid="list-total-value">{formatValue(typeof view.total === "number" ? view.total : 0, totalCol.format, { empty: "—", currency: view.totalCurrency ?? null })}</strong>
                      </td>
                    )}
                    {after > 0 && <td className={`${TD} bg-surface-2`} colSpan={after}><span className="text-mute">across {shown.length} {shown.length === 1 ? "row" : "rows"}</span></td>}
                  </tr>
                </tfoot>
              );
            })() : null}
          </table>
          {(phase === "empty" || phase === "not-built" || filteredToNothing) && (
            <div className="p-4" data-testid="list-empty">
              <EmptyState kind={emptyBlock.kind} icon={emptyBlock.icon ?? null} headline={emptyBlock.headline ?? ""} line={emptyBlock.line ?? ""} action={emptyBlock.action ?? null}
                          reason={phase === "not-built" ? reason : null} onClearFilters={filteredToNothing ? () => setQuery("") : null} onNavigate={onNavigate} />
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// DataTable — the generic records table. Ported from webui/src/lib/lists/DataTable.svelte: same props
// (`selected` was $bindable → `selected` + `onSelectedChange`), same testids and data-* hooks
// (data-table, data-rows, empty, data-table-select-all, data-table-select-row, list-row-action-*).
// ★ R-49: no TanStack here — the Svelte table has no sorting or paging for it to drive; adding either
//   would be a new feature (R-19). TanStack is installed for the first table that gains one.
// ★ kit2 geometry: 38px header on the surface-2 band, 46px rows, 1px hairlines, 12px card radius.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useRef } from "react";
import { Checkbox } from "@/lib/components/ui/checkbox.jsx";
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from "@/lib/components/ui/context-menu.jsx";
import { useBindable } from "@/lib/hooks/useBindable.js";
import { runAction } from "@/lib/components/kit/runAction.js";

const HIDDEN = (key) => key === "id" || key.endsWith("_id");
function cell(value) {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value instanceof Date) return value.toLocaleString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
const TH = "h-(--size-row-head) border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute";
const TD = "h-(--size-row) border-b border-hair px-4 text-ui text-ink";

export default function DataTable({ title, rows = [], empty, columns = null, selectable = false, selected, onSelectedChange, recentlyChangedIds = new Set(), rowActions = null, onPrefetch = null }) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const [sel, setSel] = useBindable(selected, onSelectedChange, new Set());
  const prefetched = useRef(new Set());
  const allSelected = safeRows.length > 0 && safeRows.every((r) => sel.has(r.id));
  const someSelected = !allSelected && safeRows.some((r) => sel.has(r.id));
  const toggleAll = () => setSel(allSelected ? new Set() : new Set(safeRows.map((r) => r.id)));
  const toggleOne = (id) => { const next = new Set(sel); if (next.has(id)) next.delete(id); else next.add(id); setSel(next); };
  const prefetchOnHover = (row, event) => {
    if (!onPrefetch) return;
    const t = setTimeout(() => { if (!prefetched.current.has(row.id)) { prefetched.current.add(row.id); onPrefetch(row); } }, 350);
    event.currentTarget.addEventListener("mouseleave", () => clearTimeout(t), { once: true });
  };
  const cols = columns ?? (safeRows.length ? Object.keys(safeRows[0]).filter((k) => !HIDDEN(k)).map((k) => ({ key: k, label: k.replace(/_/g, " ").replace(/^./, (ch) => ch.toUpperCase()) })) : []);

  const renderRow = (row, i, extra = {}) => (
    <tr {...extra} key={row.id ?? i} data-recently-changed={recentlyChangedIds.has(row.id) ? "true" : undefined}
        className="data-[recently-changed=true]:bg-brand-soft last:[&>td]:border-b-0" onMouseEnter={(e) => prefetchOnHover(row, e)}>
      {selectable && (
        <td className={`${TD} w-10`}>
          <Checkbox aria-label={`Select row ${i + 1}`} data-testid="data-table-select-row" checked={sel.has(row.id)} onCheckedChange={() => toggleOne(row.id)} onClick={(e) => e.stopPropagation()} />
        </td>
      )}
      {cols.map((c) => <td key={c.key} className={TD}>{cell(row[c.key])}</td>)}
    </tr>
  );

  return (
    <section data-testid="data-table" data-rows={safeRows.length}>
      <h1 className="mb-4.5 text-page-title font-medium text-ink">{title}</h1>
      {safeRows.length === 0 ? (
        <p className="text-ui text-mute" data-testid="empty">{empty}</p>
      ) : (
        <div className="overflow-auto rounded-card border border-line bg-surface">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {selectable && (
                  <th scope="col" className={`${TH} w-10`}>
                    <Checkbox aria-label="Select all rows" data-testid="data-table-select-all" checked={allSelected ? true : someSelected ? "indeterminate" : false} onCheckedChange={toggleAll} />
                  </th>
                )}
                {cols.map((c) => <th key={c.key} scope="col" className={TH}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {safeRows.map((row, i) => {
                const actions = rowActions ? rowActions(row) : [];
                if (!rowActions || actions.length === 0) return renderRow(row, i);
                const primary = actions.filter((a) => !a.destructive).slice(0, 2);
                const overflow = actions.filter((a) => !primary.includes(a));
                const ordinary = overflow.filter((a) => !a.destructive);
                const destructive = overflow.filter((a) => a.destructive);
                return (
                  <ContextMenu key={row.id ?? i}>
                    <ContextMenuTrigger asChild>{renderRow(row, i)}</ContextMenuTrigger>
                    <ContextMenuContent align="end">
                      {ordinary.map((a) => <ContextMenuItem key={a.id} data-testid={`list-row-action-${a.id}`} onSelect={() => runAction(a, row)}>{a.label}</ContextMenuItem>)}
                      {destructive.length > 0 && ordinary.length > 0 && <ContextMenuSeparator />}
                      {destructive.map((a) => <ContextMenuItem key={a.id} data-testid={`list-row-action-${a.id}`} variant="destructive" onSelect={() => runAction(a, row)}>{a.label}</ContextMenuItem>)}
                    </ContextMenuContent>
                  </ContextMenu>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

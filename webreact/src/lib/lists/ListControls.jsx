// ListControls — filter, sort menu, column menu. Ported from webui/src/lib/lists/ListControls.svelte: same
// testids and copy. `query` was $bindable → `query` + `onQueryChange`.
import { ArrowUpDown, Columns3, Funnel } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuCheckboxItem } from "@/lib/components/ui/dropdown-menu.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import { useBindable } from "@/lib/hooks/useBindable.js";
import { ICON_STROKE } from "@/lib/empty/icons.js";

export default function ListControls({ query, onQueryChange, columns = [], hidden = new Set(), onToggleColumn = null, sortField = null, sortDir = "asc", onSort = null }) {
  const [q, setQ] = useBindable(query, onQueryChange, "");
  const visibleCount = columns.filter((c) => !hidden.has(c.field)).length;
  const hasActiveFilter = (q ?? "").trim().length > 0;
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="list-controls">
      <label className="sr-only" htmlFor="ks-list-filter">Filter these rows</label>
      <div className="flex h-(--size-filter) w-70 max-w-full items-center gap-2 rounded-control border border-line bg-surface px-2.75 text-control">
        <Funnel strokeWidth={ICON_STROKE} className="size-4 text-faint" aria-hidden="true" />
        <input id="ks-list-filter" data-testid="list-filter" type="search" value={q ?? ""} onChange={(e) => setQ(e.target.value)}
               placeholder="Filter rows" autoComplete="off" data-active={hasActiveFilter ? "true" : undefined}
               className="min-w-0 flex-1 bg-transparent text-ink outline-none" />
      </div>
      {hasActiveFilter && (
        <button type="button" className="inline-flex h-(--size-filter) items-center gap-1.5 rounded-control border border-brand bg-brand-soft px-3 text-control text-brand"
                data-testid="list-filter-active" onClick={() => setQ("")} aria-label="Clear the active filter">Filtered <span aria-hidden="true">×</span></button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" data-testid="list-sort-trigger" aria-label="Sort"><ArrowUpDown strokeWidth={ICON_STROKE} aria-hidden="true" /> Sort</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" data-testid="list-sort-menu">
          {columns.map((c) => (
            <DropdownMenuItem key={c.field} data-testid={`list-sort-${c.field}`} onSelect={() => onSort?.(c.field)}>
              {c.label}{sortField === c.field && <span aria-hidden="true">{sortDir === "asc" ? " ▲" : " ▼"}</span>}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" data-testid="list-columns-trigger" aria-label="Choose columns"><Columns3 strokeWidth={ICON_STROKE} aria-hidden="true" /> Columns</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" data-testid="list-columns-menu">
          {columns.map((c) => (
            <DropdownMenuCheckboxItem key={c.field} checked={!hidden.has(c.field)} disabled={!hidden.has(c.field) && visibleCount <= 1}
                                      data-testid={`list-column-${c.field}`} onCheckedChange={() => onToggleColumn?.(c.field)}>{c.label}</DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

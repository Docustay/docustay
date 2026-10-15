// ═══════════════════════════════════════════════════════════════════════════════════════════════
// CatalogueDataTable — ITEM 16, 30 Sep 2026. TanStack Table (v9 — a rewrite from the familiar v8
// `useReactTable`/`getCoreRowModel()` API: features are registered up front via `tableFeatures()`,
// then `useTable({ features, columns, data })` builds the instance; see this package's own bundled
// skill docs under node_modules/@tanstack/react-table/skills/) for the Packages/Plans catalogue
// lists: sortable columns (click a header), search (global filter, reuses the existing Input above
// the table), bulk-select (a checkbox column, row-selection state handed back to the caller as a
// Set of ids so a future bulk action has something to act on). "R-49" in lists/DataTable.jsx names
// this as the first table to get TanStack — that generic table has no sorting/paging to justify it;
// this one, with real columns and real rows, does.
//
// Every existing testid PackagesList/PlansList already relied on is preserved exactly
// (`${testIdPrefix}-table`, `-th-<field>`, `-row`, `-cell-<field>-<id>`, `-select-all`,
// `-select-<id>`) — this is a drop-in table renderer, not a new screen contract.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useMemo } from "react";
import {
  tableFeatures, useTable, rowSortingFeature, createSortedRowModel,
  globalFilteringFeature, createFilteredRowModel, flexRender,
} from "@tanstack/react-table";
import { ArrowUp, ArrowDown, ChevronsUpDown } from "lucide-react";
import { Checkbox } from "@/lib/components/ui/checkbox.jsx";

const FEATURES = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  globalFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
});

/** columns: [{ field, label, cell?: (row) => node, sortable?: bool (default true), format? }] */
export default function CatalogueDataTable({
  rows, columns, testIdPrefix, selectable = false, selected, onSelectedChange,
  search = "", extraColumn = null,
}) {
  const [sorting, setSorting] = useState([]);

  const tanColumns = useMemo(() => columns.map((c) => ({
    id: c.field,
    accessorFn: (row) => row[c.field],
    header: c.label,
    enableSorting: c.sortable !== false,
    cell: (ctx) => (c.cell ? c.cell(ctx.row.original) : (ctx.getValue() ?? "—")),
  })), [columns]);

  const table = useTable({
    features: FEATURES,
    data: rows,
    columns: tanColumns,
    getRowId: (row) => String(row.id),
    state: { sorting, globalFilter: search },
    onSortingChange: setSorting,
    globalFilterFn: (row, _colId, filterValue) => {
      const q = String(filterValue ?? "").trim().toLowerCase();
      if (!q) return true;
      return String(row.original.name ?? "").toLowerCase().includes(q);
    },
  });

  const allSelected = selectable && rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleAll = () => onSelectedChange(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  const toggleOne = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    onSelectedChange(next);
  };

  return (
    <div className="overflow-auto rounded-card border border-line bg-surface">
      <table className="w-full border-collapse" data-testid={`${testIdPrefix}-table`}>
        <thead>
          <tr>
            {selectable && (
              <th scope="col" className="h-(--size-row-head) w-10 border-b border-line bg-surface-2 px-4 text-left">
                <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Select all" data-testid={`${testIdPrefix}-select-all`} />
              </th>
            )}
            {table.getHeaderGroups()[0].headers.map((header) => {
              const sortState = header.column.getIsSorted();
              return (
                <th
                  key={header.id}
                  scope="col"
                  className="h-(--size-row-head) border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute"
                  data-testid={`${testIdPrefix}-th-${header.id}`}
                >
                  {header.column.getCanSort() ? (
                    <button
                      type="button"
                      className="flex items-center gap-1 hover:text-ink"
                      onClick={header.column.getToggleSortingHandler()}
                      data-testid={`${testIdPrefix}-th-${header.id}-sort`}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {sortState === "asc" ? <ArrowUp className="size-3" /> : sortState === "desc" ? <ArrowDown className="size-3" /> : <ChevronsUpDown className="size-3 opacity-40" />}
                    </button>
                  ) : (
                    flexRender(header.column.columnDef.header, header.getContext())
                  )}
                </th>
              );
            })}
            {extraColumn && <th scope="col" className="h-(--size-row-head) border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">{extraColumn.label}</th>}
          </tr>
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => {
            const original = row.original;
            return (
              <tr key={original.id} className="last:[&>td]:border-b-0" data-testid={`${testIdPrefix}-row`} data-id={original.id}>
                {selectable && (
                  <td className="h-(--size-row) border-b border-hair px-4">
                    <Checkbox checked={selected.has(original.id)} onCheckedChange={() => toggleOne(original.id)} aria-label={`Select ${original.name}`} data-testid={`${testIdPrefix}-select-${original.id}`} />
                  </td>
                )}
                {row.getAllCells().map((cellCtx) => (
                  <td
                    key={cellCtx.id}
                    className="h-(--size-row) border-b border-hair px-4 text-ui text-ink data-[format=money]:tabular-nums data-[format=number]:tabular-nums"
                    data-testid={`${testIdPrefix}-cell-${cellCtx.column.id}-${original.id}`}
                    data-format={columns.find((c) => c.field === cellCtx.column.id)?.format ?? "text"}
                  >
                    {flexRender(cellCtx.column.columnDef.cell, cellCtx.getContext())}
                  </td>
                ))}
                {extraColumn && <td className="h-(--size-row) border-b border-hair px-4 text-ui text-ink">{extraColumn.cell(original)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

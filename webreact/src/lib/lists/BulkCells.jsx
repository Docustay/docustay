// BulkCells — the three table pieces a CUSTOM list table needs to join the shared bulk system (QUEUE §13.3): a select-all header cell, a per-row
// checkbox cell, and the row menu cell (RowActions adds the shared Delete itself). Pair with `useListBulk`. A screen that renders its own <table>
// adds these cells and `{bulk.bulkBar}`; it writes NO delete / archive / bulk logic of its own.
import { Checkbox } from "@/lib/components/ui/checkbox.jsx";
import RowActions from "@/lib/lists/RowActions.jsx";
import { isUuid } from "@/lib/record/deleteTypes.js";

const TH = "h-9 w-10 border-b border-line bg-surface-sunken px-3 py-0 text-left";
const TD = "h-10 w-10 border-b border-line-soft px-3 py-0";

/** `bulk` = the object `useListBulk` returned; `rows` = the rows currently shown (select-all means THESE, i.e. everything matching the filter). */
export function BulkHeadCell({ bulk, rows }) {
  if (!bulk?.selectable) return null;
  const ids = rows.filter((r) => isUuid(r.id)).map((r) => r.id);
  const all = ids.length > 0 && ids.every((id) => bulk.selected.has(id));
  const some = !all && ids.some((id) => bulk.selected.has(id));
  const toggle = () => { const next = new Set(bulk.selected); if (all) ids.forEach((id) => next.delete(id)); else ids.forEach((id) => next.add(id)); bulk.setSelected(next); };
  return <th scope="col" className={TH} data-column="select"><Checkbox checked={all ? true : some ? "indeterminate" : false} onCheckedChange={toggle} aria-label="Select all shown rows" data-testid="list-select-all" /></th>;
}

export function BulkRowCell({ bulk, id }) {
  if (!bulk?.selectable) return null;
  const toggle = () => { const next = new Set(bulk.selected); if (next.has(id)) next.delete(id); else next.add(id); bulk.setSelected(next); };
  return <td className={TD} data-testid="cell-select" onClick={(e) => e.stopPropagation()}><Checkbox checked={bulk.selected.has(id)} onCheckedChange={toggle} aria-label="Select row" data-testid={`list-select-row-${id}`} /></td>;
}

export function RowMenuHeadCell({ bulk }) {
  return bulk?.selectable ? <th scope="col" className="h-9 border-b border-line bg-surface-sunken px-4 py-0 text-right text-caption font-medium text-mute" data-column="row-actions"><span className="sr-only">Actions</span></th> : null;
}

export function RowMenuCell({ bulk, row, actions = [] }) {
  if (!bulk?.selectable) return null;
  return <td className="h-10 border-b border-line-soft px-3 py-0" data-testid="cell-row-actions" onClick={(e) => e.stopPropagation()}><RowActions row={row} actions={actions} /></td>;
}

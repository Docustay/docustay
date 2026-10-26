// BulkBar — act on the selected rows, report what changed and what failed, retry the failures.
// Ported from webui/src/lib/lists/BulkBar.svelte: same props, testids, cap (100) and copy.
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/lib/components/ui/button.jsx";

const BULK_MAX_ROWS = 100;

export default function BulkBar({ selectedIds = [], actions = [], onClear = null, max = BULK_MAX_ROWS }) {
  const count = selectedIds.length;
  const overCap = count > max;
  const [reports, setReports] = useState({});
  const [values, setValues] = useState({});
  async function run(action, ids, forcedValue) {
    const value = action.valueOptions ? (forcedValue ?? values[action.id]) : undefined;
    if (action.valueOptions && !value) return;
    setReports((r) => ({ ...r, [action.id]: { running: true, result: null, lastIds: ids, lastValue: value } }));
    try {
      const result = await action.run(ids, value);
      setReports((r) => ({ ...r, [action.id]: { running: false, result, lastIds: ids, lastValue: value } }));
      if (result.changed > 0) {
        const description = `${result.changed} item${result.changed !== 1 ? "s" : ""} updated`;
        toast.success(action.label, action.undo ? {
          description, duration: 10000,
          action: { label: "Undo", onClick: async () => {
            try { await action.undo(ids, value); toast.success("Changes undone"); }
            catch (e) { toast.error("Undo failed", { description: e?.message ?? "Could not undo changes" }); }
          } },
        } : { description, duration: 10000 });
      }
    } catch (err) {
      setReports((r) => ({ ...r, [action.id]: { running: false, result: { changed: 0, failed: ids.map((id) => ({ id, reason: err?.message ?? "this did not run" })) }, lastIds: ids, lastValue: value } }));
    }
  }
  function retry(action) {
    const r = reports[action.id];
    if (!r?.result?.failed?.length) return;
    setValues((v) => ({ ...v, [action.id]: r.lastValue }));
    run(action, r.result.failed.map((f) => f.id), r.lastValue);
  }
  if (count === 0) return null;
  return (
    <div className="mb-3 flex flex-col gap-2 rounded-bulk bg-ink px-3.5 py-2.5 text-control text-white" data-testid="list-bulk-bar" role="region" aria-label="Bulk actions">
      <div className="flex flex-wrap items-center gap-3">
        <p className="m-0" data-testid="list-bulk-count">{count} selected</p>
        {overCap ? (
          <p className="m-0" role="alert" data-testid="list-bulk-cap-warning">Bulk actions are capped at {max} rows — {count} are selected. Narrow the selection to act on it.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {actions.map((action) => (
              <span key={action.id} className="flex items-center gap-2">
                {action.valueOptions && (
                  <label>
                    <span className="sr-only">{action.valuePlaceholder ?? action.label}</span>
                    <select className="h-(--size-pill) rounded-sm border border-white/30 bg-transparent px-2 text-meta text-white" value={values[action.id] ?? ""}
                            onChange={(e) => setValues((v) => ({ ...v, [action.id]: e.target.value }))} data-testid={`list-bulk-value-${action.id}`} disabled={reports[action.id]?.running}>
                      <option value="">{action.valuePlaceholder ?? "Choose…"}</option>
                      {action.valueOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </label>
                )}
                <Button type="button" size="sm" variant={action.destructive ? "destructive" : "outline"} className="h-(--size-pill) border-white/30 bg-transparent text-white hover:bg-white/10"
                        data-testid={`list-bulk-action-${action.id}`} disabled={reports[action.id]?.running || (action.valueOptions && !values[action.id])}
                        onClick={() => run(action, selectedIds)}>{reports[action.id]?.running ? "Working…" : action.label}</Button>
              </span>
            ))}
          </div>
        )}
        <Button type="button" size="sm" variant="ghost" className="ml-auto h-(--size-pill) text-white hover:bg-white/10" data-testid="list-bulk-clear" onClick={() => onClear?.()}>Clear selection</Button>
      </div>
      {actions.map((action) => {
        const r = reports[action.id]?.result;
        if (!r) return null;
        return (
          <div key={action.id} className="rounded-sm bg-white/10 px-3 py-2" data-testid={`list-bulk-report-${action.id}`} role="status">
            <p className="m-0"><strong>{action.label}:</strong> {r.changed} changed{r.failed.length ? `, ${r.failed.length} failed` : ""}.</p>
            {r.failed.length > 0 && (
              <>
                <ul className="my-1 pl-5">{r.failed.map((f) => <li key={f.id}>{f.reason}</li>)}</ul>
                <Button type="button" size="sm" variant="outline" className="border-white/30 bg-transparent text-white" data-testid={`list-bulk-retry-${action.id}`} onClick={() => retry(action)}>Retry failed ({r.failed.length})</Button>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

// useListBulk — QUEUE §13.3. ONE place that gives a list its row selection and its bulk bar (Delete · Archive · Restore), for every list
// whose rows are a record type the server can act on. No screen writes bulk code: it passes its `path`, its rows, and any list-specific
// extras; this decides what is offered (Owner/Admin only — the server is the boundary), chunks big selections at the server's cap, and
// reports successes AND refusals through BulkBar. Delete asks the shared "can't be undone" bulk dialog first (counts, what else goes,
// what is skipped and why, what Stripe does).
import { useEffect, useMemo, useState } from "react";
import BulkBar from "@/lib/lists/BulkBar.jsx";
import { api } from "@/lib/api.js";
import { requestBulkDelete } from "@/lib/record/DeleteDialog.jsx";
import { ARCHIVABLE_TYPES, deleteTypeForPath, isArchivedPath, isUuid, mayDelete } from "@/lib/record/deleteTypes.js";

const CHUNK = 100;       // the server's per-request cap (src/records/bulk.mjs BULK_MAX)
const SELECT_MAX = 1000; // the most a person can select; sent as ceil(n/CHUNK) independent requests

export default function useListBulk({ app = null, path, rank, rows = [], extraActions = [], omit = [], onChanged = null, resetKey = null }) {
  const type = deleteTypeForPath(path);
  const may = Boolean(type) && mayDelete(rank);
  const holdsRecords = Array.isArray(rows) && rows.some((r) => isUuid(r?.id));
  const [selected, setSelected] = useState(() => new Set());
  useEffect(() => { setSelected(new Set()); }, [path, app?.refetchSignal, resetKey]);

  const labels = useMemo(() => new Map((rows ?? []).map((r) => [r.id, r.display_name ?? r.name ?? r.title ?? r.label ?? null])), [rows]);
  const labelOf = (id) => labels.get(id) ?? null;
  const refetch = () => { onChanged?.(); if (app) { app.refetchSignal += 1; app.loadCounts?.(); } };

  // one request per CHUNK; every id independent on the server; the failures keep their names so the report says WHICH
  async function run(action, ids) {
    const total = { changed: 0, failed: [] };
    for (let i = 0; i < ids.length; i += CHUNK) {
      const r = await api.bulkRecords({ action, object: type, ids: ids.slice(i, i + CHUNK), confirm: action === "delete" });
      total.changed += r.changed;
      for (const f of r.failed) total.failed.push({ id: f.id, reason: `${labelOf(f.id) ?? "An item"}: ${f.reason}` });
    }
    refetch();
    return total;
  }

  const actions = [...extraActions];
  if (may && ARCHIVABLE_TYPES.includes(type)) {
    if (isArchivedPath(path)) actions.push({ id: "restore", label: "Restore", run: (ids) => run("restore", ids) });
    else if (!omit.includes("archive")) actions.push({ id: "archive", label: "Archive", destructive: true, run: (ids) => run("archive", ids) });
  }
  if (may) {
    actions.push({
      id: "delete", label: "Delete", destructive: true,
      run: async (ids) => {
        const ok = await requestBulkDelete({ object: type, ids, labelOf });
        return ok ? run("delete", ids) : { changed: 0, failed: [] };
      },
    });
  }

  const selectable = (may && holdsRecords) || extraActions.length > 0;
  const bulkBar = selectable ? <BulkBar selectedIds={Array.from(selected)} onClear={() => setSelected(new Set())} actions={actions} max={SELECT_MAX} /> : null;
  return { selectable, selected, setSelected, bulkBar, type };
}

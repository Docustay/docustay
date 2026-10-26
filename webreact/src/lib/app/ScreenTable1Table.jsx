// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE GENERIC LIST (R3.001.T1, Screen.svelte:1246-1266 + the people bulk/row/inline-edit wiring :571-648, :840-915).
// ★ The list's New button and the section's own actions (SectionActions) sit in the header's action slot — a slot
//   filled only when there is something behind it (canAddHere).
// ★ People lists get selection, a row Archive, the bulk bar and inline edits — only where the viewer may bulk-archive
//   (the permission the server checks on /api/people/bulk/archive), never by rank. Every write goes through
//   performWrite (K6a); a refused write is refused here, not sent.
// ★ The bulk/row results are the SERVER's: "N changed, M failed" comes from the route's reply.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useSubscribed } from "@/lib/app/useAppState.js";
import { useEffect, useState } from "react";
import ListView from "@/lib/lists/ListView.jsx";
import RowActions from "@/lib/lists/RowActions.jsx";
import useListBulk from "@/lib/lists/useListBulk.jsx";
import { Button } from "@/lib/components/ui/button";
import { api } from "@/lib/api.js";
import { performWrite, writeDecision } from "@/lib/permissions/write.js";
import { LIFECYCLE_STATUSES } from "@keystone/people/vocab.mjs";
import { fileComponent } from "./lazyScreens.js";
import { PEOPLE_BULK_PATHS } from "./routes.js";

const SectionActions = fileComponent("lib/screens/SectionActions.jsx");
const PEOPLE_EDITABLE_FIELDS = ["display_name", "email", "mobile_phone", "lifecycle_status"];
const STAGE_OPTIONS = LIFECYCLE_STATUSES.map((s) => ({ value: s, label: s }));

function downloadPeopleCsv(rows) {
  const cols = ["display_name", "email", "mobile_phone", "role", "lifecycle_status"];
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  const a = document.createElement("a");
  a.href = url; a.download = `people-export-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  URL.revokeObjectURL(url);
}

/** The inline-edit write for one person field (Screen.svelte:603-616). */
export async function editPersonField(permissions, personId, field, value) {
  if (field === "display_name") return performWrite(permissions, "updatePerson", [{ personId, displayName: value }]);
  if (field === "email") return performWrite(permissions, "updatePerson", [{ personId, email: value }]);
  if (field === "mobile_phone") return performWrite(permissions, "updatePerson", [{ personId, mobilePhone: value || null }]);
  if (field === "lifecycle_status") return performWrite(permissions, "setPersonStage", [{ personId, status: value }]);
  throw new Error(`${field} is not an editable field on this list`);
}

// ★ §13.3 / the maintainer's People rule: for CLIENTS, "Former" replaces "Archived" — so the client lists offer bulk "Mark as former" and no bulk Archive.
//   Leads (not clients) keep Archive. Everything else — Delete, and Archive/Restore on every other archivable list — is the shared useListBulk.
const CLIENT_PEOPLE_PATHS = new Set(["/people/all", "/people/clients", "/people/adolescents", "/people/parents", "/people/active", "/people/paused"]);

export default function ScreenTable1Table({ app, path, onNavigate, data, blocked = false, canAddHere = false, newLabel = "New", rank = null, openSectionNew = false, onDone }) {
  useSubscribed(app);
  const perms = app.permissions;
  const peopleSelectable = PEOPLE_BULK_PATHS.has(path) && !writeDecision(perms, "bulkArchivePeople").hidden;
  const [coachOptions, setCoachOptions] = useState([]);
  useEffect(() => {
    if (!peopleSelectable) { setCoachOptions([]); return; }
    api.teamRoster().then((r) => setCoachOptions((r?.roster?.rows ?? []).map((p) => ({ value: p.id, label: p.display_name ?? p.email ?? p.id })))).catch(() => setCoachOptions([]));
  }, [peopleSelectable]);
  const refetch = () => { app.refetchSignal += 1; };
  const bulk = (method) => async (ids, value) => { const r = await performWrite(perms, method, value === undefined ? [ids] : [ids, value]); refetch(); return r; };

  const clientList = CLIENT_PEOPLE_PATHS.has(path);
  const peopleExtras = peopleSelectable ? [
    ...(clientList ? [{ id: "former", label: "Mark as former", run: bulk("bulkChangeStagePeople"), fixedValue: "former" }] : [{ id: "archive", label: "Archive", destructive: true, run: bulk("bulkArchivePeople") }]),
    { id: "assign", label: `Assign coach`, valueOptions: coachOptions, valuePlaceholder: "Assign to…", run: bulk("bulkAssignPeople") },
    { id: "stage", label: "Change stage", valueOptions: STAGE_OPTIONS, valuePlaceholder: "New stage…", run: bulk("bulkChangeStagePeople") },
    { id: "export", label: "Export", run: async (ids) => { const r = await performWrite(perms, "bulkExportPeople", [ids]); downloadPeopleCsv(r.rows ?? []); return { changed: r.exported ?? (r.rows?.length ?? 0), failed: [] }; } },
  ].map((a) => (a.fixedValue ? { ...a, run: (ids) => a.run(ids, a.fixedValue) } : a)) : [];
  const { selectable, selected, setSelected, bulkBar } = useListBulk({ app, path, rank, rows: data.rows, extraActions: peopleExtras, omit: peopleSelectable ? ["archive"] : [] });

  const actions = (
    <>
      {canAddHere ? <Button data-testid="list-new" onClick={() => onNavigate(`${path}?new=1`)}>{newLabel}</Button> : null}
      <SectionActions path={path} rank={rank} openNew={openSectionNew} onDone={onDone} />
    </>
  );
  // the row menu: People keep their own row Archive; every other list gets the shared Delete from RowActions itself (it asks deleteTypeForPath)
  const rowActions = peopleSelectable
    ? (row) => <RowActions row={row} actions={clientList ? [] : [{ id: "archive", label: "Archive", destructive: true, onRun: async (r) => { await performWrite(perms, "bulkArchivePeople", [[r.id]]); refetch(); } }]} />
    : (selectable ? (row) => <RowActions row={row} actions={[]} /> : null);
  const editable = PEOPLE_BULK_PATHS.has(path);

  return (
    <ListView
      view={data}
      rows={data.rows}
      path={data.path}
      blocked={blocked}
      onOpen={(type, id) => onNavigate(`/record/${type}/${id}`)}
      onNavigate={onNavigate}
      actions={actions}
      rowActions={rowActions}
      selectable={selectable}
      selected={selected}
      onSelectedChange={setSelected}
      bulkBar={bulkBar}
      editableFields={editable ? PEOPLE_EDITABLE_FIELDS : null}
      onEditCell={editable ? async (row, field, value) => { await editPersonField(perms, row.id, field, value); refetch(); } : null}
      canWrite={data.canWrite ?? null}
      noWriteNotice={data.noWriteNotice ?? null}
      onRetry={refetch}
    />
  );
}

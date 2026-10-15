// ProgramsPage — mirrors CategoriesPage.jsx exactly (Programs follow-up brief, 30 Sep 2026, Part 1).
import { useState, useEffect, useCallback } from "react";
import { request, ApiError } from "@/lib/api.js";
import useListBulk from "@/lib/lists/useListBulk.jsx";
import ProgramsPageItemsProgramsTable from "./ProgramsPageItemsProgramsTable.jsx";
import ProgramsPageProgramSheet from "./ProgramsPageProgramSheet.jsx";

const VISIBILITY_VALUES = ["first", "shown", "hidden", "last"];
const VISIBILITY_LABEL = {
  first: "Shown first",
  shown: "Shown",
  hidden: "Hidden — sold alongside, never on its own",
  last: "Shown last",
};

export default function ProgramsPage({ path = null, params = null, app = null, onNavigate = null, onRefetch = null }) {
  const rank = app?.nav?.rank ?? null;
  const isCoach = rank === `coach`;

  const [phase, setPhase] = useState("loading");
  const [error, setError] = useState(null);
  const [rows, setRows] = useState([]);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMode, setSheetMode] = useState("create");
  const [sheetId, setSheetId] = useState(null);
  const [sheetName, setSheetName] = useState("");
  const [sheetVisibility, setSheetVisibility] = useState("shown");
  const [sheetBusy, setSheetBusy] = useState(false);
  const [sheetError, setSheetError] = useState(null);

  const [deleteErrors] = useState({}); // the shared Delete reports its own errors; kept as a prop for the table

  const load = useCallback(async () => {
    setPhase("loading");
    setError(null);
    try {
      const body = await request("/api/items/programs");
      const data = Array.isArray(body?.data) ? body.data : [];
      setRows(data);
      setPhase(data.length === 0 ? "empty" : "ready");
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setPhase("denied");
        setError(err);
      } else {
        setPhase("error");
        setError(err instanceof ApiError
          ? { message: err.message, requestId: err.requestId }
          : { message: String(err?.message ?? err) });
      }
    }
  }, []);

  const openCreate = useCallback(() => {
    setSheetMode("create");
    setSheetId(null);
    setSheetName("");
    setSheetVisibility("shown");
    setSheetError(null);
    setSheetOpen(true);
  }, []);

  const openRename = useCallback((row) => {
    setSheetMode("edit");
    setSheetId(row.id);
    setSheetName(row.name);
    setSheetVisibility(row.visibility);
    setSheetError(null);
    setSheetOpen(true);
  }, []);

  const closeSheet = useCallback(() => {
    if (sheetBusy) return;
    setSheetOpen(false);
  }, [sheetBusy]);

  const submitSheet = useCallback(async (e) => {
    e?.preventDefault?.();
    if (sheetBusy) return;
    if (!sheetName.trim()) {
      setSheetError("a program needs a name");
      return;
    }
    setSheetBusy(true);
    setSheetError(null);
    try {
      if (sheetMode === "create") {
        await request("/api/items/programs", {
          method: "POST", body: { name: sheetName.trim(), visibility: sheetVisibility },
        });
      } else {
        await request("/api/items/programs/update", {
          method: "POST", body: { id: sheetId, name: sheetName.trim(), visibility: sheetVisibility },
        });
      }
      setSheetOpen(false);
      await load();
      onRefetch?.();
    } catch (err) {
      setSheetError(err instanceof ApiError
        ? `${err.message}${err.requestId ? ` (ref ${err.requestId})` : ""}`
        : String(err?.message ?? err));
    } finally {
      setSheetBusy(false);
    }
  }, [sheetBusy, sheetName, sheetMode, sheetId, sheetVisibility, load, onRefetch]);


  const toggleHide = useCallback(async (row) => {
    const nextVisibility = row.visibility === "hidden" ? "shown" : "hidden";
    try {
      await request("/api/items/programs/update", {
        method: "POST", body: { id: row.id, visibility: nextVisibility },
      });
      await load();
      onRefetch?.();
    } catch (err) {
      // RowActions handles the toast
    }
  }, [load, onRefetch]);

  const writePosition = useCallback(async (id, position) => {
    await request("/api/items/programs/update", { method: "POST", body: { id, position } });
  }, []);

  const swapPositions = useCallback(async (idA, posA, idB, posB) => {
    await writePosition(idA, posA);
    await writePosition(idB, posB);
    await load();
    onRefetch?.();
  }, [writePosition, load, onRefetch]);

  const actionsFor = useCallback((row) => {
    if (isCoach) return [];
    const idx = rows.findIndex((r) => r.id === row.id);
    const above = idx > 0 ? rows[idx - 1] : null;
    const below = idx >= 0 && idx < rows.length - 1 ? rows[idx + 1] : null;

    const actions = [{ id: "rename", label: "Rename", onRun: () => openRename(row) }];

    if (above) {
      actions.push({
        id: "move-up", label: "Move up",
        onRun: () => swapPositions(row.id, above.position, above.id, row.position),
        undo: () => swapPositions(row.id, row.position, above.id, above.position),
      });
    }
    if (below) {
      actions.push({
        id: "move-down", label: "Move down",
        onRun: () => swapPositions(row.id, below.position, below.id, row.position),
        undo: () => swapPositions(row.id, row.position, below.id, below.position),
      });
    }

    actions.push({
      id: "hide", label: row.visibility === "hidden" ? "Show" : "Hide",
      onRun: () => toggleHide(row),
    });

    return actions;
  }, [isCoach, rows, openRename, swapPositions, toggleHide]);

  const contentsText = useCallback((row) => {
    const n = (Number(row.services_count) || 0) + (Number(row.packages_count) || 0) + (Number(row.plans_count) || 0);
    return `${n} item${n === 1 ? "" : "s"}`;
  }, []);

  const bulk = useListBulk({ app, path: "/items/programs", rank, rows, onChanged: load });

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (typeof window === "undefined" || isCoach) return;
    const qp = new URLSearchParams(window.location.search);
    if (qp.get("new") === "1") {
      openCreate();
      window.history.replaceState(window.history.state, "", window.location.pathname);
    }
  }, [isCoach, openCreate]);

  return (
    <>
      {bulk.bulkBar}
      <ProgramsPageItemsProgramsTable
        bulk={bulk}
        onNavigate={onNavigate}
        isCoach={isCoach}
        VISIBILITY_LABEL={VISIBILITY_LABEL}
        phase={phase}
        error={error}
        rows={rows}
        openCreate={openCreate}
        deleteErrors={deleteErrors}
        actionsFor={actionsFor}
        contentsText={contentsText}
      />

      {sheetOpen && (
        <ProgramsPageProgramSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          VISIBILITY_VALUES={VISIBILITY_VALUES}
          VISIBILITY_LABEL={VISIBILITY_LABEL}
          sheetMode={sheetMode}
          sheetName={sheetName}
          onSheetNameChange={setSheetName}
          sheetVisibility={sheetVisibility}
          onSheetVisibilityChange={setSheetVisibility}
          sheetBusy={sheetBusy}
          sheetError={sheetError}
          closeSheet={closeSheet}
          submitSheet={submitSheet}
        />
      )}
    </>
  );
}

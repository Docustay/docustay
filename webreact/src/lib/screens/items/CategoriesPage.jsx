import { useState, useEffect, useCallback } from "react";
import { request, ApiError } from "@/lib/api.js";
import useListBulk from "@/lib/lists/useListBulk.jsx";
import { LedgerPage } from "@/lib/components/kit/archetypes/index.js";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import RowActions from "@/lib/lists/RowActions.jsx";
import CategoriesPageItemsCategoriesTable from "./CategoriesPageItemsCategoriesTable.jsx";
import CategoriesPageCategorySheet from "./CategoriesPageCategorySheet.jsx";

const VISIBILITY_VALUES = ["first", "shown", "hidden", "last"];
const VISIBILITY_LABEL = {
  first: "Shown first",
  shown: "Shown",
  hidden: "Hidden — sold alongside, never on its own",
  last: "Shown last",
};

export default function CategoriesPage({ path = null, params = null, app = null, onNavigate = null, onRefetch = null }) {
  const rank = app?.nav?.rank ?? null;
  const isCoach = rank === `coach`;

  // Loading and error state
  const [phase, setPhase] = useState("loading");
  const [error, setError] = useState(null);
  const [rows, setRows] = useState([]);

  // Sheet state
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMode, setSheetMode] = useState("create");
  const [sheetId, setSheetId] = useState(null);
  const [sheetName, setSheetName] = useState("");
  const [sheetVisibility, setSheetVisibility] = useState("shown");
  const [sheetBusy, setSheetBusy] = useState(false);
  const [sheetError, setSheetError] = useState(null);

  // Delete errors
  const [deleteErrors] = useState({}); // the shared Delete reports its own errors; kept as a prop for the table

  // Load data from API
  const load = useCallback(async () => {
    setPhase("loading");
    setError(null);
    try {
      const body = await request("/api/items/categories");
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

  // Sheet handlers - define early so they can be used in effects
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
      setSheetError("a category needs a name");
      return;
    }
    setSheetBusy(true);
    setSheetError(null);
    try {
      if (sheetMode === "create") {
        await request("/api/items/categories", {
          method: "POST", body: { name: sheetName.trim(), visibility: sheetVisibility },
        });
      } else {
        await request("/api/items/categories/update", {
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


  // Toggle hide/show
  const toggleHide = useCallback(async (row) => {
    const nextVisibility = row.visibility === "hidden" ? "shown" : "hidden";
    try {
      await request("/api/items/categories/update", {
        method: "POST", body: { id: row.id, visibility: nextVisibility },
      });
      await load();
      onRefetch?.();
    } catch (err) {
      // RowActions handles the toast
    }
  }, [load, onRefetch]);

  // Position write
  const writePosition = useCallback(async (id, position) => {
    await request("/api/items/categories/update", { method: "POST", body: { id, position } });
  }, []);

  const swapPositions = useCallback(async (idA, posA, idB, posB) => {
    await writePosition(idA, posA);
    await writePosition(idB, posB);
    await load();
    onRefetch?.();
  }, [writePosition, load, onRefetch]);

  // Get actions for a row
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

  const servicesText = useCallback((n) => {
    const count = Number(n) || 0;
    return `${count} service${count === 1 ? "" : "s"}`;
  }, []);

  const bulk = useListBulk({ app, path: "/items/categories", rank, rows, onChanged: load });

  // Load data on mount
  useEffect(() => {
    load();
  }, [load]);

  // Check for "new=1" query param on mount
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
      <CategoriesPageItemsCategoriesTable
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
        servicesText={servicesText}
      />

      {sheetOpen && (
        <CategoriesPageCategorySheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          VISIBILITY_VALUES={VISIBILITY_VALUES}
          VISIBILITY_LABEL={VISIBILITY_LABEL}
          error={error}
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

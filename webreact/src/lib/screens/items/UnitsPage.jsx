// ═══════════════════════════════════════════════════════════════════════════════════════════════
// UnitsPage — build from specs/mockups/ItemsUnits.frame.html on LedgerPage.
// Props: { onNavigate }
// Composed tasks: R5.043.T1 UnitsPageItemsUnitsPageTable, R5.043.M1 UnitsPageItemsUnitsCreateSheet
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useCallback, useContext } from "react";
import { request, ApiError } from "@/lib/api.js";
import { AppStateContext } from "@/lib/app/useAppState.js";
import useListBulk from "@/lib/lists/useListBulk.jsx";
import { newIdempotencyKey } from "@/lib/idempotency.js";
import UnitsPageItemsUnitsPageTable from "./UnitsPageItemsUnitsPageTable.jsx";
import UnitsPageItemsUnitsCreateSheet from "./UnitsPageItemsUnitsCreateSheet.jsx";

export default function UnitsPage({ onNavigate = null }) {
  // ───────────────────────────────────────────────────────────────────────────────────────────
  // PHASE: loading | error | denied | ready
  // ───────────────────────────────────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState("loading");
  const [error, setError] = useState(null);

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // DATA: units from /api/items/units
  // ───────────────────────────────────────────────────────────────────────────────────────────
  const [units, setUnits] = useState([]);

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // LOAD FUNCTION
  // ───────────────────────────────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setPhase("loading");
    setError(null);
    try {
      const r = await request("/api/items/units");
      setUnits(r?.data ?? []);
      setPhase("ready");
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

  useEffect(() => {
    load();
  }, [load]);

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // DERIVED: inUse and available units (filtered and sorted)
  // ───────────────────────────────────────────────────────────────────────────────────────────
  const inUse = [...units]
    .filter((u) => u.active)
    .sort((a, b) => (b.is_default ? 1 : 0) - (a.is_default ? 1 : 0) || a.name.localeCompare(b.name));

  const available = [...units]
    .filter((u) => !u.active)
    .sort((a, b) => a.name.localeCompare(b.name));

  // Shared bulk selection + Delete (Owner/Admin) over every unit on screen (in use + available)
  const bulkApp = useContext(AppStateContext);
  const bulk = useListBulk({ app: bulkApp, path: "/items/units", rank: bulkApp?.nav?.rank ?? null, rows: units, onChanged: load });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // UTILITY: format "X things"
  // ───────────────────────────────────────────────────────────────────────────────────────────
  const thingWord = useCallback((n) => {
    const count = Number.isFinite(n) ? n : 0;
    return `${count} ${count === 1 ? "thing" : "things"}`;
  }, []);

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // PER-UNIT ACTION STATE: setActive (turn on/off a unit)
  // ───────────────────────────────────────────────────────────────────────────────────────────
  const [actionKeys, setActionKeys] = useState({});
  const [actionBusy, setActionBusy] = useState({});
  const [actionErrors, setActionErrors] = useState({});

  const keyFor = useCallback((id) => {
    setActionKeys((prev) => {
      if (!prev[id]) return { ...prev, [id]: newIdempotencyKey() };
      return prev;
    });
    return actionKeys[id] || newIdempotencyKey();
  }, [actionKeys]);

  const clearKey = useCallback((id) => {
    setActionKeys((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const setActive = useCallback(async (unit, active) => {
    if (actionBusy[unit.id]) return;

    setActionBusy((prev) => ({ ...prev, [unit.id]: true }));
    setActionErrors((prev) => {
      const next = { ...prev };
      delete next[unit.id];
      return next;
    });

    try {
      const key = keyFor(unit.id);
      await request("/api/items/units/active", {
        method: "POST",
        body: { id: unit.id, active },
        idempotencyKey: key,
      });
      setUnits((prev) =>
        prev.map((u) => (u.id === unit.id ? { ...u, active } : u))
      );
      clearKey(unit.id);
    } catch (err) {
      setActionErrors((prev) => ({
        ...prev,
        [unit.id]: err instanceof ApiError
          ? { message: err.message, requestId: err.requestId }
          : { message: String(err?.message ?? err) },
      }));
    } finally {
      setActionBusy((prev) => {
        const next = { ...prev };
        delete next[unit.id];
        return next;
      });
    }
  }, [actionBusy, actionKeys, keyFor, clearKey]);

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // CREATE SHEET STATE
  // ───────────────────────────────────────────────────────────────────────────────────────────
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createPlural, setCreatePlural] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [createKey, setCreateKey] = useState(null);

  const openCreate = useCallback(() => {
    setShowCreate(true);
    setCreateName("");
    setCreatePlural("");
    setCreateError(null);
    setCreateKey(null);
  }, []);

  const closeCreate = useCallback(() => {
    if (createBusy) return;
    setShowCreate(false);
    setCreateKey(null);
  }, [createBusy]);

  const submitCreate = useCallback(async () => {
    if (createBusy) return;
    if (!createName.trim() || !createPlural.trim()) {
      setCreateError("A unit needs a name and a plural form.");
      return;
    }

    setCreateBusy(true);
    setCreateError(null);

    const key = createKey || newIdempotencyKey();
    if (!createKey) setCreateKey(key);

    try {
      const created = await request("/api/items/units", {
        method: "POST",
        body: { name: createName.trim(), plural: createPlural.trim() },
        idempotencyKey: key,
      });
      setUnits((prev) => [...prev, {
        id: created.id,
        key: created.key,
        name: created.name,
        plural: created.plural,
        active: created.active,
        is_default: false,
        is_seeded: false,
        in_use: 0,
      }]);
      setShowCreate(false);
      setCreateKey(null);
    } catch (err) {
      setCreateError(err instanceof ApiError
        ? err.message
        : String(err?.message ?? err));
    } finally {
      setCreateBusy(false);
    }
  }, [createBusy, createName, createPlural, createKey]);

  return (
    <>
      {bulk.bulkBar}
      <UnitsPageItemsUnitsPageTable
        bulk={bulk}
        onNavigate={onNavigate}
        phase={phase}
        error={error}
        units={units}
        load={load}
        inUse={inUse}
        available={available}
        thingWord={thingWord}
        actionBusy={actionBusy}
        actionErrors={actionErrors}
        setActive={setActive}
        openCreate={openCreate}
      />

      {showCreate && (
        <UnitsPageItemsUnitsCreateSheet
          open={showCreate}
          onOpenChange={setShowCreate}
          error={error}
          units={units}
          createName={createName}
          createPlural={createPlural}
          createBusy={createBusy}
          createError={createError}
          closeCreate={closeCreate}
          submitCreate={submitCreate}
          onCreateNameChange={setCreateName}
          onCreatePluralChange={setCreatePlural}
        />
      )}
    </>
  );
}

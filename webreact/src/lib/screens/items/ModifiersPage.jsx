// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ModifiersPage — rebuild from specs/mockups/ItemsModifiers.frame.html on EditorPage.
// Props: { data, rank, onNavigate, onDone }
// Subtasks: R5.035.T1 ModifiersPageItemsModifiersTable, R5.035.M1 ModifiersPageItemsModifiersSheet
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useEffect } from "react";
import { request, ApiError } from "@/lib/api.js";
import ModifiersPageItemsModifiersTable from "./ModifiersPageItemsModifiersTable.jsx";
import ModifiersPageItemsModifiersSheet from "./ModifiersPageItemsModifiersSheet.jsx";
import { RANK_ORDER } from "@/lib/permissions/rank.js";
import { toast } from "sonner";
import useListBulk from "@/lib/lists/useListBulk.jsx";

export default function ModifiersPage({ data = null, rank = null, onNavigate = null, onDone = null }) {
  function go(href) {
    if (onNavigate) onNavigate(href);
    else if (typeof window !== "undefined") window.location.assign(href);
  }

  // ── Coach read-only (F06 §2.9 States)
  const isAdmin = (RANK_ORDER.indexOf(rank ?? "") >= RANK_ORDER.indexOf("admin"));

  const rows = data?.rows ?? [];
  const emptyState = data?.emptyState ?? null;
  const phase = rows.length === 0 ? "empty" : "ready";
  const bulk = useListBulk({ path: "/items/modifiers", rank, rows, onChanged: onDone });

  function usedLabel(row) {
    const n = row.used_count ?? 0;
    return n === 0 ? "Nobody picks it" : `${n} ${n === 1 ? "time" : "times"}`;
  }
  function statusLabel(row) {
    return (row.used_count ?? 0) === 0 ? "Nobody picks it" : (row.active ? "On" : "Off");
  }
  function statusTone(row) {
    if ((row.used_count ?? 0) === 0) return "neutral";
    return row.active ? "ok" : "neutral";
  }

  // ── raw modifier fields, for populating the edit sheet
  const [rawModifiers, setRawModifiers] = useState({});
  useEffect(() => {
    let live = true;
    request("/api/items/modifiers").then((r) => {
      if (!live) return;
      const map = {};
      for (const m of r?.data ?? []) map[m.id] = m;
      setRawModifiers(map);
    }).catch(() => { if (live) setRawModifiers({}); });
    return () => { live = false; };
  }, []);

  // ── services, for the "applies: specific services" picker
  const [serviceOptions, setServiceOptions] = useState([]);
  useEffect(() => {
    let live = true;
    request("/api/list/items/services").then((r) => {
      if (!live) return;
      setServiceOptions((r?.rows ?? []).map((s) => ({ id: s.id, name: s.name, program_id: s.program_id ?? null })));
    }).catch(() => { if (live) setServiceOptions([]); });
    return () => { live = false; };
  }, []);

  // ── the practice's own currency, for FieldMoney
  const [currency, setCurrency] = useState(null);
  useEffect(() => {
    if (!isAdmin) return;
    let live = true;
    request("/api/settings/money").then((r) => {
      if (!live) return;
      setCurrency(r?.fields?.find((f) => f.key === "money.currency")?.value ?? null);
    }).catch(() => { if (live) setCurrency(null); });
    return () => { live = false; };
  }, [isAdmin]);

  // ── On/Off toggle → POST /api/items/modifiers/active
  const [toggleBusyId, setToggleBusyId] = useState(null);
  async function toggleActive(row) {
    if (toggleBusyId) return;
    setToggleBusyId(row.id);
    try {
      await request("/api/items/modifiers/active", {
        method: "POST", body: { id: row.id, active: !row.active },
      });
      onDone?.();
      toast.success(!row.active ? `${row.name} turned on` : `${row.name} turned off`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setToggleBusyId(null);
    }
  }

  // ── create/edit sheet
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [name, setName] = useState("");
  const [priceDeltaMinor, setPriceDeltaMinor] = useState(null);
  const [minutesDelta, setMinutesDelta] = useState(null);
  const [applies, setApplies] = useState("all");
  const [serviceIds, setServiceIds] = useState([]);
  const [afterTimeInput, setAfterTimeInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function resetSheetFields() {
    setName("");
    setPriceDeltaMinor(null);
    setMinutesDelta(null);
    setApplies("all");
    setServiceIds([]);
    setAfterTimeInput("");
    setError(null);
  }

  function openCreateSheet() {
    setEditingId(null);
    resetSheetFields();
    setSheetOpen(true);
  }

  function openEditSheet(row) {
    const raw = rawModifiers[row.id];
    setEditingId(row.id);
    setError(null);
    if (raw) {
      setName(raw.name ?? row.name ?? "");
      setPriceDeltaMinor(raw.price_delta_minor ?? null);
      setMinutesDelta(raw.minutes_delta ?? null);
      setApplies(raw.applies ?? "all");
      setServiceIds(Array.isArray(raw.service_ids) ? raw.service_ids : []);
      setAfterTimeInput(raw.after_time ? String(raw.after_time).slice(0, 5) : "");
    } else {
      setName(row.name ?? "");
      setPriceDeltaMinor(undefined);
      setMinutesDelta(undefined);
      setApplies(undefined);
      setServiceIds(undefined);
      setAfterTimeInput("");
    }
    setSheetOpen(true);
  }

  function closeSheet() {
    if (busy) return;
    setSheetOpen(false);
  }

  async function submitSheet(e) {
    e?.preventDefault?.();
    if (busy) return;
    if (!name.trim()) {
      setError("A modifier needs a name.");
      return;
    }
    if (applies === "list" && serviceIds !== undefined && (!serviceIds || serviceIds.length === 0)) {
      setError("Pick at least one service for this add-on to apply to.");
      return;
    }
    setBusy(true);
    setError(null);
    const afterTime = afterTimeInput ? `${afterTimeInput}:00` : null;
    try {
      if (editingId) {
        await request("/api/items/modifiers/update", {
          method: "POST",
          body: {
            id: editingId,
            name: name.trim(),
            priceDeltaMinor, minutesDelta, applies, serviceIds, afterTime,
          },
        });
        toast.success(`${name.trim()} saved`);
      } else {
        await request("/api/items/modifiers", {
          method: "POST",
          body: {
            name: name.trim(),
            priceDeltaMinor: priceDeltaMinor ?? null,
            minutesDelta: minutesDelta ?? null,
            applies: applies ?? "all",
            serviceIds: (applies ?? "all") === "list" ? (serviceIds ?? []) : null,
            afterTime,
            active: true,
          },
        });
        toast.success(`${name.trim()} added`);
      }
      setSheetOpen(false);
      onDone?.();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.requestId ? `${err.message} (Reference: ${err.requestId})` : err.message);
      } else {
        setError(String(err?.message ?? err));
      }
    } finally {
      setBusy(false);
    }
  }

  function rowActions(row) {
    if (!isAdmin) return [];
    return [{ id: "edit", label: "Edit", onRun: () => openEditSheet(row) }];
  }

  return (
    <>
      {bulk.bulkBar}
      <ModifiersPageItemsModifiersTable
        bulk={bulk}
        data={data}
        onNavigate={go}
        go={go}
        isAdmin={isAdmin}
        rows={rows}
        emptyState={emptyState}
        phase={phase}
        usedLabel={usedLabel}
        statusLabel={statusLabel}
        statusTone={statusTone}
        toggleBusyId={toggleBusyId}
        toggleActive={toggleActive}
        openCreateSheet={openCreateSheet}
        rowActions={rowActions}
      />

      {sheetOpen && (
        <ModifiersPageItemsModifiersSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          data={data}
          serviceOptions={serviceOptions}
          currency={currency}
          editingId={editingId}
          name={name}
          onNameChange={setName}
          priceDeltaMinor={priceDeltaMinor}
          onPriceDeltaMinorChange={setPriceDeltaMinor}
          minutesDelta={minutesDelta}
          onMinutesDeltaChange={setMinutesDelta}
          applies={applies}
          onAppliesChange={setApplies}
          serviceIds={serviceIds}
          onServiceIdsChange={setServiceIds}
          afterTimeInput={afterTimeInput}
          onAfterTimeInputChange={setAfterTimeInput}
          busy={busy}
          error={error}
          closeSheet={closeSheet}
          submitSheet={submitSheet}
        />
      )}
    </>
  );
}

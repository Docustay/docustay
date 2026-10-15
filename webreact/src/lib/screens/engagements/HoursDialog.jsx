// ═══════════════════════════════════════════════════════════════════════════════════════════════
// HoursDialog — port of webui/src/lib/screens/engagements/HoursDialog.svelte.
// Manages the form state, API calls, and renders the modal component.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useCallback } from "react";
import { request, ApiError } from "@/lib/api.js";
import HoursDialogModal1Modal from "./HoursDialogModal1Modal.jsx";

/** ★ Display order Monday-first, per the frame — storage order is 0=Sunday…6=Saturday. */
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"
];

const MINUTE_STEP = 15;
const MINUTE_OPTIONS = Array.from(
  { length: (24 * 60) / MINUTE_STEP },
  (_, i) => String(i * MINUTE_STEP)
);

/** Total minutes-from-midnight → "8:00 AM" / "5:30 PM". Pure arithmetic — no Date, no zone. */
function clockLabel(total) {
  const totalNum = Number(total);
  const h24 = Math.floor(totalNum / 60);
  const mm = String(totalNum % 60).padStart(2, "0");
  const period = h24 < 12 ? "AM" : "PM";
  const h12raw = h24 % 12;
  const h12 = h12raw === 0 ? 12 : h12raw;
  return `${h12}:${mm} ${period}`;
}

export default function HoursDialog({
  open = false,
  onOpenChange,
  hostId,
  onClose = null,
  onSaved = null,
  testId = "hours-dialog",
}) {
  const [phase, setPhase] = useState("loading"); // "loading" | "denied" | "error" | "ready"
  const [problem, setProblem] = useState(null);
  const [loaded, setLoaded] = useState(null); // the fetched readHours() shape — the BEFORE state
  /** draft rows, one per dayOfWeek (0..6) — `{dayOfWeek, working, startMinute, endMinute}` */
  const [draftDays, setDraftDays] = useState([]);
  const [busy, setBusy] = useState(false);
  const [wasOpen, setWasOpen] = useState(false);
  const [lastHostId, setLastHostId] = useState(null);

  function buildDraftFrom(days) {
    const byDow = new Map(days.map((d) => [d.dayOfWeek, d.ranges]));
    return [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => {
      const ranges = byDow.get(dayOfWeek) ?? [];
      const first = ranges[0] ?? null;
      return {
        dayOfWeek,
        working: ranges.length > 0,
        startMinute: first?.startMinute ?? 540,
        endMinute: first?.endMinute ?? 1020,
      };
    });
  }

  function loadedRangesFor(dayOfWeek) {
    return loaded?.days?.find((d) => d.dayOfWeek === dayOfWeek)?.ranges ?? [];
  }

  function draftRanges(day) {
    return day.working ? [{ startMinute: day.startMinute, endMinute: day.endMinute }] : [];
  }

  function rangesEqual(a, b) {
    if (a.length !== b.length) return false;
    return a.every((r, i) => r.startMinute === b[i].startMinute && r.endMinute === b[i].endMinute);
  }

  /** ★★ Drives test (a): unchanged week → only Save visible; changed → both. */
  const changed = loaded
    ? draftDays.some((d) => !rangesEqual(draftRanges(d), loadedRangesFor(d.dayOfWeek)))
    : false;

  const listingMismatchText =
    typeof loaded?.listingMismatch === "string"
      ? loaded.listingMismatch
      : (loaded?.listingMismatch?.message ?? null);

  const loadHours = useCallback(async () => {
    if (!hostId) return;
    setPhase("loading");
    setProblem(null);
    try {
      const res = await request(`/api/engagements/hours?hostId=${encodeURIComponent(hostId)}`);
      setLoaded(res);
      setDraftDays(buildDraftFrom(res.days ?? []));
      setPhase("ready");
    } catch (err) {
      setProblem(err);
      setPhase(err instanceof ApiError && err.status === 403 ? "denied" : "error");
    }
  }, [hostId]);

  // ★ Fetch on the closed→open edge only, and again if `hostId` changes while open
  useEffect(() => {
    if (open && (!wasOpen || hostId !== lastHostId)) {
      setLastHostId(hostId);
      loadHours();
    }
    if (!open && wasOpen) {
      onClose?.();
    }
    setWasOpen(open);
  }, [open, hostId, wasOpen, lastHostId, loadHours, onClose]);

  const handleClose = useCallback(() => {
    onOpenChange?.(false);
  }, [onOpenChange]);

  const onDayWorkingChange = useCallback((dow, working) => {
    setDraftDays((prev) => {
      const newDays = [...prev];
      const idx = newDays.findIndex((d) => d.dayOfWeek === dow);
      if (idx >= 0) {
        newDays[idx] = { ...newDays[idx], working };
      }
      return newDays;
    });
  }, []);

  const onDayStartMinuteChange = useCallback((dow, startMinute) => {
    setDraftDays((prev) => {
      const newDays = [...prev];
      const idx = newDays.findIndex((d) => d.dayOfWeek === dow);
      if (idx >= 0) {
        newDays[idx] = { ...newDays[idx], startMinute };
      }
      return newDays;
    });
  }, []);

  const onDayEndMinuteChange = useCallback((dow, endMinute) => {
    setDraftDays((prev) => {
      const newDays = [...prev];
      const idx = newDays.findIndex((d) => d.dayOfWeek === dow);
      if (idx >= 0) {
        newDays[idx] = { ...newDays[idx], endMinute };
      }
      return newDays;
    });
  }, []);

  /** ★★ `fixGoogle` posted ONLY by the second button — drives test (b). */
  const save = useCallback(async (fixGoogle) => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const body = {
        hostId,
        days: draftDays.map((d) => ({ dayOfWeek: d.dayOfWeek, ranges: draftRanges(d) })),
        fixGoogle,
      };
      const res = await request("/api/engagements/hours", { method: "POST", body });
      onSaved?.(res);
      handleClose();
    } catch (err) {
      setProblem(err);
    } finally {
      setBusy(false);
    }
  }, [busy, hostId, draftDays, handleClose, onSaved]);

  return (
    <HoursDialogModal1Modal
      open={open}
      onOpenChange={onOpenChange}
      testId={testId}
      DISPLAY_ORDER={DISPLAY_ORDER}
      DAY_NAMES={DAY_NAMES}
      MINUTE_OPTIONS={MINUTE_OPTIONS}
      clockLabel={clockLabel}
      phase={phase}
      problem={problem}
      draftDays={draftDays}
      busy={busy}
      changed={changed}
      listingMismatchText={listingMismatchText}
      handleClose={handleClose}
      save={save}
      onDayWorkingChange={onDayWorkingChange}
      onDayStartMinuteChange={onDayStartMinuteChange}
      onDayEndMinuteChange={onDayEndMinuteChange}
    />
  );
}

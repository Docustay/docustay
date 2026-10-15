// ═══════════════════════════════════════════════════════════════════════════════════════════════
// BlockTimePopover — port of webui/src/lib/screens/engagements/BlockTimePopover.svelte.
// Ported from `specs/mockups/PopoverBlockDay.frame.html`.
// Manages the form state, API calls, and renders the modal component.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useCallback } from "react";
import { request, ApiError } from "@/lib/api.js";
import { wallClock } from "@/lib/engagements/weekGrid.mjs";
import BlockTimePopoverModal1Modal from "./BlockTimePopoverModal1Modal.jsx";

const WHAT_FOR_OPTIONS = [
  { value: "admin", label: "Notes and admin" },
  { value: "lunch", label: "Lunch" },
  { value: "travel", label: "Travel" },
  { value: "other", label: "Something else" },
];

const REPEAT_OPTIONS = [
  { value: "none", label: "Doesn't repeat" },
  { value: "daily", label: "Every day" },
  { value: "weekdays", label: "Every weekday" },
  { value: "weekly", label: "Every week" },
];

const WEEKDAY_NAMES = [
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
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

function todayISO(zone) {
  const w = wallClock(new Date(), zone);
  return w?.ymd ?? new Date().toISOString().slice(0, 10);
}

/**
 * Mirrors src/booking/slots.mjs's zonedLocalToUtc exactly (server-only, not imported).
 * The same two-pass drift correction, built on wallClock instead of that module's own
 * private wallClockIn. "2026-09-25 12:00 in `zone`" → the real UTC instant.
 */
function zonedLocalToUtc(year, month, day, minutesFromMidnight, tz) {
  const hour = Math.floor(minutesFromMidnight / 60);
  const minute = minutesFromMidnight % 60;
  let ts = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const wantedAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  for (let i = 0; i < 2; i++) {
    const shown = wallClock(new Date(ts), tz);
    if (!shown) break;
    const shownAsUtc = Date.UTC(shown.y, shown.m - 1, shown.d, shown.hour, shown.minute, 0, 0);
    const drift = wantedAsUtc - shownAsUtc;
    if (drift === 0) break;
    ts += drift;
  }
  return new Date(ts);
}

/** "Wednesday 12:00" — the clash's own instant, read in `zone`. */
function clashTimeLabel(startsAt, zone) {
  const w = wallClock(startsAt, zone);
  if (!w) return "";
  return `${WEEKDAY_NAMES[w.weekday]} ${clockLabel(w.hour * 60 + w.minute)}`;
}

export default function BlockTimePopover({
  open = false,
  onOpenChange,
  hostId,
  date = null,
  timeZone = null,
  onClose = null,
  onBlocked = null,
  testId = "block-time-popover",
}) {
  const zone = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  const [phase, setPhase] = useState("form"); // "form" | "confirm"
  const [whatFor, setWhatFor] = useState("admin");
  const [customLabel, setCustomLabel] = useState("");
  const [onDate, setOnDate] = useState("");
  const [startMinuteStr, setStartMinuteStr] = useState("720");
  const [endMinuteStr, setEndMinuteStr] = useState("780");
  const [repeatKind, setRepeatKind] = useState("none");
  const [clashes, setClashes] = useState([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const [wasOpen, setWasOpen] = useState(false);

  // Reset form on closed→open edge
  useEffect(() => {
    if (open && !wasOpen) {
      setPhase("form");
      setWhatFor("admin");
      setCustomLabel("");
      setOnDate(date ?? todayISO(zone));
      setStartMinuteStr("720");
      setEndMinuteStr("780");
      setRepeatKind("none");
      setClashes([]);
      setProblem(null);
      setBusy(false);
    }
    if (!open && wasOpen) {
      onClose?.();
    }
    setWasOpen(open);
  }, [open, date, zone, onClose]);

  const handleClose = useCallback(() => {
    onOpenChange?.(false);
  }, [onOpenChange]);

  const clashLead =
    clashes.length === 1
      ? "One thing is already booked in this window."
      : `${clashes.length} things are already booked in this window.`;

  const clashRest =
    clashes.length === 0
      ? ""
      : `${clashes
          .map(
            (c) =>
              `${c.personName ?? "Someone"}, ${clashTimeLabel(c.startsAt, zone)}`
          )
          .join(" · ")}. Blocking won't cancel it — you'll need to move it yourself, or leave it and block from next week.`;

  const submit = useCallback(async () => {
    if (busy) return;
    setProblem(null);
    const label =
      whatFor === "other"
        ? customLabel.trim()
        : WHAT_FOR_OPTIONS.find((o) => o.value === whatFor)?.label ?? "";
    if (!label) {
      setProblem(new Error("Say what this time is for."));
      return;
    }
    const s = Number(startMinuteStr);
    const e = Number(endMinuteStr);
    if (!(e > s)) {
      setProblem(
        new Error("The end of a blocked window must be after its start.")
      );
      return;
    }

    setBusy(true);
    try {
      const [y, m, d] = onDate.split("-").map(Number);
      const startsAt = zonedLocalToUtc(y, m, d, s, zone);
      const endsAt = zonedLocalToUtc(y, m, d, e, zone);
      const res = await request("/api/engagements/blocks", {
        method: "POST",
        body: {
          hostId,
          label,
          repeat: repeatKind,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
        },
      });
      if (res?.clashes?.length) {
        setClashes(res.clashes);
        setPhase("confirm");
        onBlocked?.(res);
      } else {
        onBlocked?.(res);
        handleClose();
      }
    } catch (err) {
      setProblem(err);
    } finally {
      setBusy(false);
    }
  }, [busy, whatFor, customLabel, startMinuteStr, endMinuteStr, onDate, zone, hostId, onBlocked, handleClose]);

  return (
    <BlockTimePopoverModal1Modal
      open={open}
      onOpenChange={onOpenChange}
      date={date}
      testId={testId}
      WHAT_FOR_OPTIONS={WHAT_FOR_OPTIONS}
      REPEAT_OPTIONS={REPEAT_OPTIONS}
      MINUTE_OPTIONS={MINUTE_OPTIONS}
      clockLabel={clockLabel}
      phase={phase}
      whatFor={whatFor}
      customLabel={customLabel}
      onDate={onDate}
      startMinuteStr={startMinuteStr}
      endMinuteStr={endMinuteStr}
      repeatKind={repeatKind}
      busy={busy}
      problem={problem}
      clashLead={clashLead}
      clashRest={clashRest}
      handleClose={handleClose}
      submit={submit}
      onWhatForChange={setWhatFor}
      onCustomLabelChange={setCustomLabel}
      onDateChange={setOnDate}
      onStartMinuteChange={setStartMinuteStr}
      onEndMinuteChange={setEndMinuteStr}
      onRepeatKindChange={setRepeatKind}
    />
  );
}

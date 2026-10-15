// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R5.014 — CalendarMoveModal. Asks-first drop confirmation for the week-view drag.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useEffect } from "react";
import { request, ApiError } from "@/lib/api.js";
import { wallClock } from "@/lib/engagements/weekGrid.mjs";
import CalendarMoveModalCalendarMoveModal from "./CalendarMoveModalCalendarMoveModal.jsx";

const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function label(instant, timezone) {
  if (!instant) return null;
  const w = wallClock(instant, timezone);
  if (!w) return null;
  const hour12 = ((w.hour + 11) % 12) + 1;
  const minute = w.minute === 0 ? "" : `:${String(w.minute).padStart(2, "0")}`;
  const ampm = w.hour < 12 ? "am" : "pm";
  const time = `${hour12}${minute === "" ? ":00" : minute}`;
  return { ...w, time, text: `${WEEKDAY_NAMES[w.weekday]} ${hour12}${minute}${ampm}` };
}

export default function CalendarMoveModal({
  open = false,
  onOpenChange,
  booking,
  toStartsAt,
  toEndsAt = null,
  clash = null,
  onClose = null,
  onMoved = null,
  timezone = "UTC",
}) {
  const [isOpen, setOpen] = useState(open);
  const [tellClient, setTellClient] = useState(true);
  const [sayWhy, setSayWhy] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Sync external open prop when it changes
  useEffect(() => {
    setOpen(open);
  }, [open]);

  const fromLabel = label(booking?.fromStartsAt, timezone);
  const toLabel = label(toStartsAt, timezone);
  const firstName = booking?.personFirstName ?? "this person";
  const hostName = booking?.hostName ?? `this coach`;
  const sameDay = fromLabel && toLabel && fromLabel.ymd === toLabel.ymd;

  const title = `Move ${firstName} to ${toLabel ? toLabel.time : "the new time"}?`;
  const subtitle = clash
    ? `${toLabel ? toLabel.text : "That time"} isn't free — ${clash.name} is there. Pick another slot.`
    : (fromLabel && toLabel
        ? `From ${fromLabel.text} to ${toLabel.text}${sameDay ? ", same day, same place." : "."}`
        : null);

  function handleOpenChange(newOpen) {
    setOpen(newOpen);
    onOpenChange?.(newOpen);
  }

  function cancel() {
    setOpen(false);
    onClose?.();
  }

  async function submit() {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const res = await request("/api/engagements/bookings/reschedule", {
        method: "POST",
        body: {
          bookingId: booking.id,
          startsAt: toStartsAt,
          endsAt: toEndsAt ?? undefined,
          tellClient,
          note: sayWhy && note.trim() ? note.trim() : null,
        },
      });
      onMoved?.(res);
      setOpen(false);
      onClose?.();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `${err.message}${err.requestId ? ` (ref ${err.requestId})` : ""}`
          : String(err?.message ?? err)
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <CalendarMoveModalCalendarMoveModal
      open={isOpen}
      onOpenChange={handleOpenChange}
      clash={clash}
      label={fromLabel}
      toLabel={toLabel}
      firstName={firstName}
      hostName={hostName}
      title={title}
      subtitle={subtitle}
      tellClient={tellClient}
      onTellClientChange={setTellClient}
      sayWhy={sayWhy}
      onSayWhyChange={setSayWhy}
      note={note}
      onNoteChange={setNote}
      busy={busy}
      error={error}
      cancel={cancel}
      submit={submit}
    />
  );
}

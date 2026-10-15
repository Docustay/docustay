import { useState } from "react";
import { request, ApiError } from "@/lib/api.js";
import CalendarFlagModalCalendarFlagModal from "./CalendarFlagModalCalendarFlagModal.jsx";
import { wallClock } from "@/lib/engagements/weekGrid.mjs";

const OPTIONS = [
  {
    key: "longer_slot",
    label: "Needs a longer slot",
    consequence: "Blocks the time after it so nothing gets booked on top.",
  },
  {
    key: "first_session",
    label: "First session",
    consequence: "Shows on the calendar so whoever takes it knows.",
  },
  {
    key: "be_careful",
    label: "Be careful with this one",
    consequence: "A note only your team sees, on every session with this person.",
  },
  {
    key: "other",
    label: "Something else",
    consequence: "Write your own.",
  },
];

const WEEKDAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

function timeLabel(instant, timezone) {
  if (!instant) return null;
  const w = wallClock(instant, timezone);
  if (!w) return null;
  const hour12 = ((w.hour + 11) % 12) + 1;
  const minute = w.minute === 0 ? ":00" : `:${String(w.minute).padStart(2, "0")}`;
  return `${WEEKDAY_NAMES[w.weekday]} ${hour12}${minute}`;
}

export default function CalendarFlagModal({
  open = false,
  onOpenChange,
  booking,
  onClose = null,
  onFlagged = null,
  timezone = "UTC",
}) {
  const [selected, setSelected] = useState("longer_slot");
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const confirmDisabled = selected === "other" && why.trim().length === 0;

  const personLabel =
    booking?.personFirstName ?? booking?.personName ?? "this person";
  const whenLabel = timeLabel(booking?.startsAt ?? booking?.fromStartsAt, timezone);
  const subtitle = `${personLabel}${
    whenLabel ? `, ${whenLabel}` : ""
  }. A flag is for you and your team — the client never sees it.`;

  function cancel() {
    onOpenChange?.(false);
    onClose?.();
  }

  async function submit() {
    if (busy || confirmDisabled) return;
    setError(null);
    setBusy(true);
    try {
      const res = await request("/api/engagements/bookings/flag", {
        method: "POST",
        body: {
          bookingId: booking.id,
          flag: selected,
          note: why.trim() ? why.trim() : null,
        },
      });
      onFlagged?.(res);
      onOpenChange?.(false);
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
    <CalendarFlagModalCalendarFlagModal
      open={open}
      onOpenChange={onOpenChange}
      OPTIONS={OPTIONS}
      subtitle={subtitle}
      selected={selected}
      onSelect={setSelected}
      why={why}
      onWhyChange={setWhy}
      busy={busy}
      error={error}
      confirmDisabled={confirmDisabled}
      cancel={cancel}
      submit={submit}
    />
  );
}

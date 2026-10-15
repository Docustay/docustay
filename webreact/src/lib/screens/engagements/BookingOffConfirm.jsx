// ═══════════════════════════════════════════════════════════════════════════════════════════════
// BookingOffConfirm — rebuilt from webui/src/lib/screens/engagements/BookingOffConfirm.svelte.
// TASK 13.39 — BOOKINGOFFCONFIRM. Ported from `specs/mockups/SettingsBookingConfirm.frame.html`:
// title, sub-line, four consequence rows, a warn-wash judgment paragraph, Leave it on / Turn it off.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import { request, ApiError } from "@/lib/api.js";
import BookingOffConfirmModal from "./BookingOffConfirmModal.jsx";

export default function BookingOffConfirm({
  open = false,
  onOpenChange = null,
  turnOff = null,
  onCancel = null,
  onConfirmed = null,
  testId = "booking-off-confirm",
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function numberOf(n) {
    return typeof n === "number" ? n : 0;
  }

  const rows = (() => {
    const ahead = numberOf(turnOff?.bookingsAhead);
    const waiting = numberOf(turnOff?.waitlistWaiting);
    const portalStillBooks = turnOff?.portalStillBooks !== false;
    return [
      {
        headline: `${ahead} booking${ahead === 1 ? "" : "s"} already made`,
        detail: "All of them stand. This only stops new ones.",
      },
      {
        headline: "Reserve with Google stops too",
        detail: "And the button on your website, and the Instagram link.",
      },
      portalStillBooks
        ? {
            headline: "Clients in the portal can still book",
            detail: "Unless you turn that off separately.",
          }
        : {
            headline: "Clients in the portal can't book either",
            detail: "booking.client_may_book is already off for this practice.",
          },
      {
        headline: `${waiting} ${waiting === 1 ? "person" : "people"} on the waitlist`,
        detail: "They can't be offered a slot while this is off.",
      },
    ];
  })();

  const judgment = (() => {
    const viaOnline = numberOf(turnOff?.viaOnlineThisYear);
    const thisYear = numberOf(turnOff?.bookingsThisYear);
    return `${viaOnline} of your ${thisYear} booking${thisYear === 1 ? "" : "s"} this year came ` +
      "through it. Turning it off for a fortnight while you're away is sensible; turning it off " +
      "because one person booked badly usually isn't.";
  })();

  function handleCancel() {
    if (busy) return;
    setError(null);
    onCancel?.();
  }

  async function handleConfirm() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await request("/api/settings", {
        method: "POST",
        body: { key: "booking.online_enabled", value: false },
      });
      onConfirmed?.(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <BookingOffConfirmModal
      open={open}
      onOpenChange={onOpenChange}
      onCancel={onCancel}
      testId={testId}
      busy={busy}
      error={error}
      rows={rows}
      judgment={judgment}
      handleCancel={handleCancel}
      handleConfirm={handleConfirm}
    />
  );
}

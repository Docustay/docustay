// SessionsLedgerReassignModal — move a booking to another person, or add another person to it (6 Oct 2026).
// Backend: POST /api/bookings/:id/reassign {hostId, override} · POST /api/bookings/:id/attendees {appUserId} (src/routes/teamBookingAdmin.mjs).
// "Override" puts the person on it even when it falls outside their hours; it never double-books them (the server refuses that).
import { useEffect, useState } from "react";
import { request, ApiError } from "@/lib/api.js";
import DecisionModal from "@/lib/forms/DecisionModal.jsx";

const CAL = { connected: "calendar connected", not_connected: "calendar not connected", needs_attention: "calendar needs reconnecting" };

export default function SessionsLedgerReassignModal({ open, onOpenChange, mode = "reassign", booking, onDone }) {
  const [staff, setStaff] = useState(null);
  const [selected, setSelected] = useState(null);
  const [override, setOverride] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setSelected(null); setOverride(false); setError(null); setStaff(null);
    request("/api/booking/team").then((v) => setStaff(v.staff)).catch((e) => setError(e instanceof ApiError ? e.message : String(e?.message ?? e)));
  }, [open]);

  async function confirm() {
    if (!selected || !booking) return;
    setBusy(true); setError(null);
    try {
      if (mode === "reassign") await request(`/api/bookings/${booking.id}/reassign`, { method: "POST", body: { hostId: selected, override } });
      else await request(`/api/bookings/${booking.id}/attendees`, { method: "POST", body: { appUserId: selected } });
      onOpenChange?.(false); onDone?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally { setBusy(false); }
  }

  const options = (staff ?? []).map((u) => ({
    key: u.id, label: u.name,
    consequence: `${u.needs.length ? `Missing: ${u.needs.join(", ")}. ` : ""}${CAL[u.calendar] ?? ""}`.trim() || "Free to take it.",
  }));
  return (
    <DecisionModal
      open={open} onOpenChange={onOpenChange}
      title={mode === "reassign" ? `Move ${booking?.who || "this"} session to someone else?` : "Add someone to this session?"}
      subtitle={mode === "reassign" ? "The time stays the same. The person it moves to is told." : "They are added to the session and told."}
      options={options} selected={selected} onSelect={setSelected}
      toggle={mode === "reassign" ? { label: "Override their hours", why: "Use when it falls outside their usual hours. They still can't be double-booked.", checked: override, onToggle: setOverride } : null}
      cancelLabel="Leave it" confirmLabel={mode === "reassign" ? "Move it" : "Add them"}
      busy={busy} confirmDisabled={!selected || staff === null} error={error}
      onCancel={() => onOpenChange?.(false)} onConfirm={confirm}
      testId="sessions-reassign-modal"
    />
  );
}

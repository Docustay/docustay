import { useState, useEffect } from "react";
import { api } from "@/lib/api.js";
import OfferTimeSheetSheet from "./OfferTimeSheetSheet.jsx";

export default function OfferTimeSheet({ entry, hosts = [], myAppUserId = null, onCancel = null, onOffered = null }) {
  const [open, setOpen] = useState(true);

  const hostOptions = hosts.length > 0 ? hosts : myAppUserId ? [{ id: myAppUserId, displayName: "You" }] : [];

  const [hostId, setHostId] = useState(entry?.hostId ?? myAppUserId ?? "");
  const [date, setDate] = useState(todayLocal());
  const [slots, setSlots] = useState([]);
  const [slotsPhase, setSlotsPhase] = useState("idle"); // idle | loading | ready | error
  const [slotsError, setSlotsError] = useState(null);
  const [chosen, setChosen] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function todayLocal() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  async function loadSlots() {
    if (!hostId) {
      setSlots([]);
      setSlotsPhase("idle");
      return;
    }
    setSlotsPhase("loading");
    setSlotsError(null);
    setChosen(null);
    try {
      const res = await api.slots({ hostId, date, serviceId: entry?.serviceId ?? null });
      setSlots(Array.isArray(res) ? res : []);
      setSlotsPhase("ready");
    } catch (err) {
      setSlots([]);
      setSlotsPhase("error");
      setSlotsError(err instanceof Error ? err.message : String(err?.message ?? err));
    }
  }

  useEffect(() => {
    loadSlots();
  }, [hostId, date]);

  function localTimeLabel(slot) {
    if (slot.localTime) return slot.localTime;
    const d = new Date(slot.startsAt);
    return Number.isNaN(d.getTime()) ? "—" : d.toISOString().slice(11, 16);
  }

  return (
    <OfferTimeSheetSheet
      open={open}
      onOpenChange={setOpen}
      entry={entry}
      hosts={hosts}
      onCancel={onCancel}
      testId="offer-time-sheet"
      hostOptions={hostOptions}
      hostId={hostId}
      setHostId={setHostId}
      date={date}
      setDate={setDate}
      slots={slots}
      slotsPhase={slotsPhase}
      slotsError={slotsError}
      chosen={chosen}
      setChosen={setChosen}
      busy={busy}
      setBusy={setBusy}
      error={error}
      setError={setError}
      localTimeLabel={localTimeLabel}
      onOffered={onOffered}
    />
  );
}

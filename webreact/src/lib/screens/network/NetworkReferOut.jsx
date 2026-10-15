// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R4.020 — NetworkReferOut: port faithfully
// Ported from webui/src/lib/screens/network/NetworkReferOut.svelte (239 lines, 17 of them <style>).
// Markup/data/handlers are ported; <style> blocks are NOT ported (styling comes from kit components + tokens only).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useEffect } from "react";
import { api, ApiError, request } from "@/lib/api.js";
import { toast } from "sonner";
import NetworkReferOutNetworkReferOutModal from "./NetworkReferOutNetworkReferOutModal.jsx";

export default function NetworkReferOut({ open = true, partyId = null, partyName = null, onCancel = null, onDone = null }) {
  const [personId, setPersonId] = useState("");
  const [selectedPartyId, setSelectedPartyId] = useState(partyId ?? "");
  const [reason, setReason] = useState("");
  const [toldPerson, setToldPerson] = useState(false);
  const [copyPerson, setCopyPerson] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [reasonError, setReasonError] = useState(null);

  // Fetch people options
  const [peopleOptions, setPeopleOptions] = useState([]);
  useEffect(() => {
    let live = true;
    request("/api/list/people/all")
      .then((r) => {
        if (!live) return;
        setPeopleOptions(
          (r?.rows ?? []).map((p) => ({
            value: p.id,
            label: p.display_name ?? p.email ?? p.id,
          }))
        );
      })
      .catch(() => {
        if (live) setPeopleOptions([]);
      });
    return () => {
      live = false;
    };
  }, []);

  // Fetch party options
  const [partyOptions, setPartyOptions] = useState([]);
  useEffect(() => {
    let live = true;
    api
      .networkParties()
      .then((r) => {
        if (!live) return;
        setPartyOptions((r?.rows ?? []).map((p) => ({ value: p.id, label: p.name })));
      })
      .catch(() => {
        if (live) setPartyOptions([]);
      });
    return () => {
      live = false;
    };
  }, []);

  const personLabel = peopleOptions.find((o) => o.value === personId)?.label ?? null;
  const partyLabel = partyOptions.find((o) => o.value === selectedPartyId)?.label ?? partyName ?? "them";

  const title = personLabel
    ? `Refer ${personLabel} to ${partyLabel}`
    : `Refer someone to ${partyLabel}`;

  function messageOf(err) {
    return err instanceof ApiError ? err.message : String(err?.message ?? err);
  }

  async function confirm() {
    if (busy) return;
    setReasonError(null);
    setError(null);

    if (!reason.trim()) {
      setReasonError("Say why — the partner reads this first.");
      return;
    }
    if (!personId) {
      setError("Choose who you're referring.");
      return;
    }
    if (!selectedPartyId) {
      setError("Choose who you're referring to.");
      return;
    }

    setBusy(true);
    try {
      const result = await api.referOut({
        personId,
        partyId: selectedPartyId,
        reason: reason.trim(),
        copyPerson,
        toldPerson,
      });
      const who = personLabel ?? "them";
      toast.success(
        `Referred. ${partyLabel} has it${result?.copied ? `, and ${who} was copied in.` : "."}`
      );
      onDone?.();
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        setReasonError(err.message);
      } else {
        setError(messageOf(err));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <NetworkReferOutNetworkReferOutModal
      open={open}
      onOpenChange={() => {}}
      onCancel={onCancel}
      personId={personId}
      onPersonIdChange={setPersonId}
      selectedPartyId={selectedPartyId}
      onSelectedPartyIdChange={setSelectedPartyId}
      reason={reason}
      onReasonChange={setReason}
      toldPerson={toldPerson}
      onToldPersonChange={setToldPerson}
      copyPerson={copyPerson}
      onCopyPersonChange={setCopyPerson}
      busy={busy}
      error={error}
      reasonError={reasonError}
      peopleOptions={peopleOptions}
      partyOptions={partyOptions}
      personLabel={personLabel}
      partyLabel={partyLabel}
      title={title}
      confirm={confirm}
    />
  );
}

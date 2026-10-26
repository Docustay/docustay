// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R4.017 — NewAccountSheet: port faithfully from
// webui/src/lib/screens/accounts/NewAccountSheet.svelte:1-257 (whole component).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useEffect } from "react";
import { api, ApiError, request } from "@/lib/api.js";
import NewAccountSheetNewAccountSheet from "./NewAccountSheetNewAccountSheet.jsx";

const KIND_VALUES = ["family", "employer", "third_party"];
const KIND_OPTIONS = [
  { value: "family", label: "Family" },
  { value: "employer", label: "Employer" },
  { value: "third_party", label: "Third party" },
];
const KIND_HINT = {
  family: "A parent or family paying for one or more people.",
  employer: null,
  third_party: "A programme or agency. Usually invoiced monthly, by arrangement.",
};

export default function NewAccountSheet({ presetKind = null, onDone = null, onCancel = null }) {
  const [kind, setKind] = useState(KIND_VALUES.includes(presetKind) ? presetKind : "family");
  const [name, setName] = useState("");
  const [billingNote, setBillingNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const [contactId, setContactId] = useState("");
  const [contactCreateName, setContactCreateName] = useState("");
  const [contactCreateBusy, setContactCreateBusy] = useState(false);

  const [memberPick, setMemberPick] = useState("");
  const [members, setMembers] = useState([]);
  const [memberCreateName, setMemberCreateName] = useState("");
  const [memberCreateBusy, setMemberCreateBusy] = useState(false);

  const [peopleOptions, setPeopleOptions] = useState([]);
  useEffect(() => {
    let live = true;
    request("/api/list/people/all").then((r) => {
      if (!live) return;
      setPeopleOptions((r?.rows ?? [])
        .map((p) => ({ value: p.id, label: p.display_name ?? p.email ?? p.id })));
    }).catch(() => { if (live) setPeopleOptions([]); });
    return () => { live = false; };
  }, []);

  const memberOptions = peopleOptions.filter((o) => !members.some((m) => m.id === o.value));

  async function createContactInline() {
    const displayName = contactCreateName.trim();
    if (!displayName || contactCreateBusy) return;
    setContactCreateBusy(true);
    setError(null);
    try {
      const created = await api.createPerson({ displayName, role: "parent", invite: false });
      setPeopleOptions([{ value: created.id, label: displayName }, ...peopleOptions]);
      setContactId(created.id);
      setContactCreateName("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setContactCreateBusy(false);
    }
  }

  function addMember(v) {
    if (!v || members.some((m) => m.id === v)) { setMemberPick(""); return; }
    const opt = peopleOptions.find((o) => o.value === v);
    setMembers([...members, { id: v, label: opt?.label ?? v }]);
    setMemberPick("");
  }

  function removeMember(id) {
    setMembers(members.filter((m) => m.id !== id));
  }

  async function createMemberInline() {
    const displayName = memberCreateName.trim();
    if (!displayName || memberCreateBusy) return;
    setMemberCreateBusy(true);
    setError(null);
    try {
      const created = await api.createPerson({ displayName, role: "adult_client", invite: false });
      setPeopleOptions([{ value: created.id, label: displayName }, ...peopleOptions]);
      setMembers([...members, { id: created.id, label: displayName }]);
      setMemberCreateName("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setMemberCreateBusy(false);
    }
  }

  async function submit(e) {
    e?.preventDefault?.();
    if (busy) return;
    if (!name.trim()) { setError("Name is required — a payer group must have a label."); return; }
    setBusy(true);
    setError(null);
    try {
      const created = await api.createPayerGroup({
        name: name.trim(),
        kind,
        contactUserId: contactId || undefined,
        billingNote: kind === "third_party" && billingNote.trim() ? billingNote.trim() : undefined,
        memberPersonIds: members.map((m) => m.id),
      });
      onDone?.(created.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <NewAccountSheetNewAccountSheet
      KIND_OPTIONS={KIND_OPTIONS}
      KIND_HINT={KIND_HINT}
      onCancel={onCancel}
      kind={kind}
      setKind={setKind}
      name={name}
      setName={setName}
      billingNote={billingNote}
      setBillingNote={setBillingNote}
      busy={busy}
      error={error}
      contactId={contactId}
      setContactId={setContactId}
      contactCreateName={contactCreateName}
      setContactCreateName={setContactCreateName}
      contactCreateBusy={contactCreateBusy}
      memberPick={memberPick}
      setMemberPick={setMemberPick}
      members={members}
      memberCreateName={memberCreateName}
      setMemberCreateName={setMemberCreateName}
      memberCreateBusy={memberCreateBusy}
      peopleOptions={peopleOptions}
      memberOptions={memberOptions}
      createContactInline={createContactInline}
      addMember={addMember}
      removeMember={removeMember}
      createMemberInline={createMemberInline}
      submit={submit}
    />
  );
}

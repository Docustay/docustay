// ═══════════════════════════════════════════════════════════════════════════════════════════════
// PersonMoreActions — P3.U22 (S2). The person record's "…" menu: seven writes, each opening its own
// SideSheet (Remove sample data opens a destructive DecisionModal instead). No Svelte source: the
// menu items, order and every text run come from specs/mockups/PeopleRecordMoreActions.frame.html's
// own menu (quoted verbatim below); the per-write behaviour comes from that frame's generated "What
// every control on this frame does" block (§3.3/§3.4) and CONTRACTS.md §4/§10.
//
// The frame's menu, in order (PeopleRecordMoreActions.frame.html):
//   "Assign to a team member" · "Set consent status" · "Add a guardian" · "Remove guardian" ·
//   "Set next step" · "Add an attachment" · —separator— · "Remove sample data" (danger)
//
// ★★★ EVERY ITEM IS GATED ON ITS OWN ROUTE'S REAL DECLARATION (routePermissions.json), never a
//     softer rule invented here (InvoiceActionsMenu.jsx's own rule, same file class):
//   · assign / consent-status / next-step / attachment / samples-remove → `person.edit` (a GRANT,
//     scope-checked against `ownerId`) — HIDDEN when refused (useWrite's `hidden`).
//   · add-guardian / remove-guardian → the named action `person.create` (routePermissions.json;
//     src/permissions/defaults.mjs COACH_ACTIONS includes it) — a Coach keeps these regardless of
//     whose caseload the person is on; ownerId plays no part in an action-kind declaration.
// ★★★ `ownerId` IS THE TARGET ROW'S OWNER, NOT THE ROW'S OWN ID (src/permissions/ownership.mjs:32-36:
//     `clients: the assigned coach. staff: themselves.` — `person.ownerUserId`). Passing the
//     person's own id here (as a same-named sibling in this directory does for its own writes) would
//     make every "owned"-scope check compare the wrong two ids.
// ★★★ Remove sample data is TENANT-WIDE (api.js `removeSamples()` takes no personId at all — it
//     archives every sample record in the practice, not only this one). So it asks for `person.edit`
//     with NO ownerId — which only an "everything"-scope grant (Owner/Admin) can ever satisfy; a
//     Coach's "owned" scope has no owner to compare against and is correctly always refused.
// ★★★ A guardian link is FOR AN ADOLESCENT RECORD ONLY (src/people/guardians.mjs `linkGuardian`:
//     "the child must be an adolescent_client" — enforced server-side). That is a PREREQUISITE about
//     the record, not a permission, so on a person who is not `adolescent_client` the two guardian
//     items render DISABLED WITH THE REASON (the maintainer's rule: a permission hides, a prerequisite disables).
// ★ Pickers reuse EXISTING api.view(...) list reads, the StartSubscriptionSheet.jsx idiom
//   (`api.view("/items/plans")`): `/people/team` for "Assign to a team member", `/people/parents`
//   for "Add a guardian". "Remove guardian" has no read of "this child's own guardians" anywhere —
//   `/people/parents`'s own rows already carry `child_links` (an undeclared field, selected in SQL
//   and so present on the JSON row same as PersonMoney.frame.html's task note on undeclared fields
//   — routes/index.mjs's `/api/list/*` handler serialises every SQL column, not only the declared
//   ones), so this reuses that SAME read, filtered client-side to the rows naming this child.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { Ellipsis } from "lucide-react";
import { Button } from "@/lib/components/ui/button.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { Skeleton } from "@/lib/components/ui/skeleton.jsx";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/lib/components/ui/dropdown-menu.jsx";
import SideSheet from "@/lib/forms/SideSheet.jsx";
import DecisionModal from "@/lib/forms/DecisionModal.jsx";
import DisabledWithReason from "@/lib/forms/DisabledWithReason.jsx";
import SheetRow from "@/lib/components/kit/SheetRow.jsx";
import Combobox from "@/lib/components/kit/Combobox.jsx";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";
import WriteButton from "@/lib/permissions/WriteButton.jsx";
import { useWrite } from "@/lib/permissions/useWrite.js";
import { api } from "@/lib/api.js";
import { ICON_STROKE } from "@/lib/empty/icons.js";

const GUARDIAN_ONLY_REASON = "Guardians are for an adolescent client's record only.";

const CONSENT_OPTIONS = [
  { value: "not_started", label: "Not started" },
  { value: "waiting", label: "Waiting" },
  { value: "granted", label: "Granted" },
  { value: "declined", label: "Declined" },
];
const CONSENT_TONE = { not_started: "neutral", waiting: "warn", granted: "ok", declined: "bad" };
const CONSENT_LABEL = Object.fromEntries(CONSENT_OPTIONS.map((o) => [o.value, o.label]));

/** write.error is an ApiError — the server's own message, plus its request id (house style — see
 *  InvoiceActionsMenu.jsx/PersonMoneyBlock.jsx's own `writeErrorNode`). */
function writeErrorNode(error) {
  if (!error) return null;
  return (
    <>
      {error.message}
      {error.requestId && (
        <>
          {" "}
          <span className="text-meta text-mute">Reference {error.requestId} — nothing changed.</span>
        </>
      )}
    </>
  );
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** One menu row: hidden → nothing; blocked → disabled with its reason; else the active item. */
function ActionItem({ testId, label, write, onSelect, variant = "default" }) {
  if (write.hidden) return null;
  if (write.blocked) {
    return (
      <DisabledWithReason disabled reason={write.blocked.reason} testId={`${testId}-blocked`}>
        {({ describedBy }) => (
          <DropdownMenuItem data-testid={testId} variant={variant} disabled aria-describedby={describedBy}
                             onSelect={(e) => e.preventDefault()}>
            {label}
          </DropdownMenuItem>
        )}
      </DisabledWithReason>
    );
  }
  return (
    <DropdownMenuItem data-testid={testId} variant={variant} onSelect={onSelect}>{label}</DropdownMenuItem>
  );
}

const SHEET_FOOTER_CLASS = "sticky bottom-0 flex shrink-0 justify-end gap-2.5 border-t border-line bg-surface px-5.5 py-4";

/** "Assign to a team member" — assignPeople({personId, ownerUserId}); ownerUserId: null unassigns. */
function AssignSheet({ person, open, write, onOpenChange, onDone }) {
  const [ownerUserId, setOwnerUserId] = useState("");
  const [team, setTeam] = useState({ loading: false, error: null, data: [] });

  useEffect(() => {
    if (!open) return;
    setOwnerUserId(person?.ownerUserId ?? "");
    setTeam({ loading: true, error: null, data: [] });
    api.view("/people/team")
      .then((r) => setTeam({ loading: false, error: null, data: r?.data?.rows ?? [] }))
      .catch((err) => setTeam({ loading: false, error: err, data: [] }));
  }, [open, person?.id]);

  if (!open) return null;

  async function handleSave() {
    try {
      await write.run({ personId: person.id, ownerUserId: ownerUserId || null });
      onDone?.();
    } catch {
      // write.error renders inline below — the sheet stays open.
    }
  }

  const options = [{ value: "", label: "Unassigned" }, ...team.data.map((m) => ({ value: m.id, label: m.display_name }))];

  return (
    <SideSheet title="Assign to a team member" testId="person-assign-sheet" busy={write.busy}
               error={writeErrorNode(write.error)} onCancel={() => onOpenChange(false)}
               footer={(
                 <footer className={SHEET_FOOTER_CLASS}>
                   <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={write.busy}>Cancel</Button>
                   <WriteButton write={write} testId="person-assign-save" onClick={handleSave} busyLabel="Saving…">Assign</WriteButton>
                 </footer>
               )}>
      <SheetRow label="Team member">
        {team.loading ? (
          <Skeleton className="h-9 w-full" data-testid="person-assign-loading" />
        ) : team.error ? (
          <ErrorPanel error={team.error} subject="Team members" testId="person-assign-error" />
        ) : (
          <Combobox testId="person-assign-picker" value={ownerUserId} options={options} onValueChange={setOwnerUserId} emptyText="No team members yet." />
        )}
      </SheetRow>
    </SideSheet>
  );
}

/** "Set consent status" — setConsentStatus({personId, consentStatus}); adolescent only, server-enforced. */
function ConsentSheet({ person, open, write, onOpenChange, onDone }) {
  const [status, setStatus] = useState("not_started");

  useEffect(() => {
    if (!open) return;
    setStatus(person?.consentStatus ?? "not_started");
  }, [open, person?.id]);

  if (!open) return null;

  async function handleSave() {
    try {
      await write.run({ personId: person.id, consentStatus: status });
      onDone?.();
    } catch {
      // write.error renders inline below — the sheet stays open.
    }
  }

  const current = person?.consentStatus ?? "not_started";

  return (
    <SideSheet title="Set consent status" testId="person-consent-status-sheet" busy={write.busy}
               error={writeErrorNode(write.error)} onCancel={() => onOpenChange(false)}
               footer={(
                 <footer className={SHEET_FOOTER_CLASS}>
                   <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={write.busy}>Cancel</Button>
                   <WriteButton write={write} testId="person-consent-status-save" onClick={handleSave} busyLabel="Saving…">Save</WriteButton>
                 </footer>
               )}>
      <SheetRow label="Current">
        <StatusBadge tone={CONSENT_TONE[current] ?? "neutral"} label={CONSENT_LABEL[current] ?? current} testId="person-consent-status-current" />
      </SheetRow>
      <SheetRow label="New status">
        <Combobox testId="person-consent-status-picker" value={status} options={CONSENT_OPTIONS} onValueChange={setStatus} />
      </SheetRow>
    </SideSheet>
  );
}

/** "Add a guardian" — addGuardian({childUserId, guardianUserId, relationship}). Picker: /people/parents. */
function AddGuardianSheet({ person, open, write, onOpenChange, onDone }) {
  const [guardianUserId, setGuardianUserId] = useState(null);
  const [relationship, setRelationship] = useState("parent");
  const [parents, setParents] = useState({ loading: false, error: null, data: [] });

  useEffect(() => {
    if (!open) return;
    setGuardianUserId(null);
    setRelationship("parent");
    setParents({ loading: true, error: null, data: [] });
    api.view("/people/parents")
      .then((r) => setParents({ loading: false, error: null, data: r?.data?.rows ?? [] }))
      .catch((err) => setParents({ loading: false, error: err, data: [] }));
  }, [open, person?.id]);

  if (!open || write.hidden) return null;

  async function handleSave() {
    if (write.blocked || !guardianUserId) return;
    try {
      await write.run({ childUserId: person.id, guardianUserId, relationship: relationship.trim() || "parent" });
      onDone?.();
    } catch {
      // write.error renders inline below — the sheet stays open.
    }
  }

  const options = parents.data.map((p) => ({ value: p.id, label: p.display_name }));

  return (
    <SideSheet title="Add a guardian" testId="person-add-guardian-sheet" busy={write.busy}
               error={writeErrorNode(write.error)} onCancel={() => onOpenChange(false)}
               footer={(
                 <footer className={SHEET_FOOTER_CLASS}>
                   <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={write.busy}>Cancel</Button>
                   <WriteButton write={write} testId="person-add-guardian-save" onClick={handleSave} disabled={!guardianUserId} busyLabel="Adding…">Add guardian</WriteButton>
                 </footer>
               )}>
      <SheetRow label="Guardian" required>
        {parents.loading ? (
          <Skeleton className="h-9 w-full" data-testid="person-add-guardian-loading" />
        ) : parents.error ? (
          <ErrorPanel error={parents.error} subject="Parents" testId="person-add-guardian-error" />
        ) : (
          <Combobox testId="person-add-guardian-picker" value={guardianUserId} options={options} onValueChange={setGuardianUserId} emptyText="No parents on file yet." />
        )}
      </SheetRow>
      <SheetRow label="Relationship">
        <Input data-testid="person-add-guardian-relationship" value={relationship} placeholder="parent" onChange={(e) => setRelationship(e.target.value)} />
      </SheetRow>
    </SideSheet>
  );
}

/** "Remove guardian" — removeGuardian({childUserId, guardianUserId}). Picker: the SAME /people/parents
 *  read as Add a guardian, filtered to the rows whose own `child_links` name this child. */
function RemoveGuardianSheet({ person, open, write, onOpenChange, onDone }) {
  const [guardianUserId, setGuardianUserId] = useState(null);
  const [guardians, setGuardians] = useState({ loading: false, error: null, data: [] });

  useEffect(() => {
    if (!open) return;
    setGuardianUserId(null);
    setGuardians({ loading: true, error: null, data: [] });
    api.view("/people/parents")
      .then((r) => {
        const rows = r?.data?.rows ?? [];
        const linked = rows.filter((row) => (row.child_links ?? []).some((c) => c.id === person?.id));
        setGuardians({ loading: false, error: null, data: linked });
      })
      .catch((err) => setGuardians({ loading: false, error: err, data: [] }));
  }, [open, person?.id]);

  if (!open || write.hidden) return null;

  async function handleSave() {
    if (write.blocked || !guardianUserId) return;
    try {
      await write.run({ childUserId: person.id, guardianUserId });
      onDone?.();
    } catch {
      // write.error renders inline below — the sheet stays open.
    }
  }

  const options = guardians.data.map((g) => ({ value: g.id, label: g.display_name }));

  return (
    <SideSheet title="Remove guardian" testId="person-remove-guardian-sheet" busy={write.busy}
               error={writeErrorNode(write.error)} onCancel={() => onOpenChange(false)}
               footer={(
                 <footer className={SHEET_FOOTER_CLASS}>
                   <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={write.busy}>Cancel</Button>
                   <WriteButton write={write} testId="person-remove-guardian-save" onClick={handleSave} disabled={!guardianUserId} busyLabel="Removing…">Remove</WriteButton>
                 </footer>
               )}>
      <SheetRow label="Guardian" required>
        {guardians.loading ? (
          <Skeleton className="h-9 w-full" data-testid="person-remove-guardian-loading" />
        ) : guardians.error ? (
          <ErrorPanel error={guardians.error} subject="Guardians" testId="person-remove-guardian-error" />
        ) : options.length === 0 ? (
          <p className="m-0 text-field text-mute" data-testid="person-remove-guardian-empty">No guardians linked yet.</p>
        ) : (
          <Combobox testId="person-remove-guardian-picker" value={guardianUserId} options={options} onValueChange={setGuardianUserId} />
        )}
      </SheetRow>
    </SideSheet>
  );
}

/** "Set next step" — setLeadNextStep({personId, nextStep}). Free text, staff-set. */
function NextStepSheet({ person, open, write, onOpenChange, onDone }) {
  const [nextStep, setNextStep] = useState("");

  useEffect(() => {
    if (!open) return;
    setNextStep(person?.leadNextStep ?? "");
  }, [open, person?.id]);

  if (!open) return null;

  async function handleSave() {
    try {
      await write.run({ personId: person.id, nextStep: nextStep.trim() });
      onDone?.();
    } catch {
      // write.error renders inline below — the sheet stays open.
    }
  }

  return (
    <SideSheet title="Set next step" testId="person-next-step-sheet" busy={write.busy}
               error={writeErrorNode(write.error)} onCancel={() => onOpenChange(false)}
               footer={(
                 <footer className={SHEET_FOOTER_CLASS}>
                   <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={write.busy}>Cancel</Button>
                   <WriteButton write={write} testId="person-next-step-save" onClick={handleSave} busyLabel="Saving…">Save</WriteButton>
                 </footer>
               )}>
      <SheetRow label="Next step">
        <Input data-testid="person-next-step-input" value={nextStep} placeholder="e.g. Follow up Thursday" onChange={(e) => setNextStep(e.target.value)} />
      </SheetRow>
    </SideSheet>
  );
}

/** "Add an attachment" — addPersonAttachment(personId, {filename, fileData (base64), contentType}). */
function AttachmentSheet({ person, open, write, onOpenChange, onDone }) {
  const [file, setFile] = useState(null);

  useEffect(() => { if (!open) setFile(null); }, [open]);

  if (!open) return null;

  async function handleSave() {
    if (!file) return;
    try {
      const fileData = await readFileAsBase64(file);
      await write.run(person.id, { filename: file.name, fileData, contentType: file.type || undefined });
      onDone?.();
    } catch {
      // write.error renders inline below — the sheet stays open.
    }
  }

  return (
    <SideSheet title="Add an attachment" testId="person-add-attachment-sheet" busy={write.busy}
               error={writeErrorNode(write.error)} onCancel={() => onOpenChange(false)}
               footer={(
                 <footer className={SHEET_FOOTER_CLASS}>
                   <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={write.busy}>Cancel</Button>
                   <WriteButton write={write} testId="person-add-attachment-save" onClick={handleSave} disabled={!file} busyLabel="Uploading…">Upload</WriteButton>
                 </footer>
               )}>
      <SheetRow label="File" required>
        <Input type="file" data-testid="person-add-attachment-file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </SheetRow>
      {file && <p className="m-0 mt-2 text-meta text-mute" data-testid="person-add-attachment-filename">{file.name}</p>}
    </SideSheet>
  );
}

/**
 * @param person — the host screen's person record:
 *   { id, name, role, ownerUserId (the assigned coach — clients; the person's own id — staff, since
 *     a staff row owns itself), consentStatus ('not_started'|'waiting'|'granted'|'declined'|null),
 *     leadNextStep (string|null) }
 * @param onChanged — called after any write succeeds, so the host screen can refetch the record.
 */
export default function PersonMoreActions({ person, onChanged }) {
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState(null); // "assign" | "consent" | "add-guardian" | "remove-guardian" | "next-step" | "attachment" | null
  const [confirmSamples, setConfirmSamples] = useState(false);

  // ★ Hooks run unconditionally (Rules of Hooks), even while `person` has not loaded yet — the "not
  //   loaded" render below comes AFTER every useWrite has already run (InvoiceActionsMenu.jsx's rule).
  const personId = person?.id ?? null;
  const ownerId = person?.ownerUserId ?? null;
  const isAdolescent = person?.role === "adolescent_client";
  const guardianBlockedReason = !isAdolescent ? GUARDIAN_ONLY_REASON : null;

  const assign = useWrite("assignPeople", { ownerId });
  const consent = useWrite("setConsentStatus", { ownerId });
  const addGuardianWrite = useWrite("addGuardian", { ownerId, blockedReason: guardianBlockedReason });
  const removeGuardianWrite = useWrite("removeGuardian", { ownerId, blockedReason: guardianBlockedReason });
  const nextStep = useWrite("setLeadNextStep", { ownerId });
  const attachment = useWrite("addPersonAttachment", { ownerId });
  // ★ NO ownerId — removeSamples is tenant-wide (api.js `removeSamples()` takes no personId), so
  //   only an "everything"-scope grant (Owner/Admin) can ever satisfy `person.edit` here.
  const removeSamplesWrite = useWrite("removeSamples");

  if (!person) {
    return (
      <Button variant="ghost" size="icon-sm" disabled aria-busy="true" data-testid="person-more-actions" aria-label="Person actions">
        <Ellipsis strokeWidth={ICON_STROKE} aria-hidden="true" />
      </Button>
    );
  }

  const close = () => setOpen(false);
  const closeSheet = () => setSheet(null);
  const onDone = () => { closeSheet(); onChanged?.(); };

  const allHidden = assign.hidden && consent.hidden && addGuardianWrite.hidden && removeGuardianWrite.hidden
    && nextStep.hidden && attachment.hidden && removeSamplesWrite.hidden;

  async function confirmRemoveSamples() {
    try {
      await removeSamplesWrite.run();
      setConfirmSamples(false);
      onChanged?.();
    } catch {
      // removeSamplesWrite.error renders inline below — the confirm stays open.
    }
  }

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" data-testid="person-more-actions" aria-label="Person actions">
            <Ellipsis strokeWidth={ICON_STROKE} aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {allHidden ? (
            <p className="m-0 px-2.5 py-2 text-meta text-mute" data-testid="person-more-actions-empty">Nothing you can do here.</p>
          ) : (
            <>
              <ActionItem testId="person-assign" label="Assign to a team member" write={assign}
                          onSelect={() => { close(); setSheet("assign"); }} />
              <ActionItem testId="person-consent-status" label="Set consent status" write={consent}
                          onSelect={() => { close(); setSheet("consent"); }} />
              <ActionItem testId="person-add-guardian" label="Add a guardian" write={addGuardianWrite}
                          onSelect={() => { close(); setSheet("add-guardian"); }} />
              <ActionItem testId="person-remove-guardian" label="Remove guardian" write={removeGuardianWrite}
                          onSelect={() => { close(); setSheet("remove-guardian"); }} />
              <ActionItem testId="person-next-step" label="Set next step" write={nextStep}
                          onSelect={() => { close(); setSheet("next-step"); }} />
              <ActionItem testId="person-add-attachment" label="Add an attachment" write={attachment}
                          onSelect={() => { close(); setSheet("attachment"); }} />
              {!removeSamplesWrite.hidden && <DropdownMenuSeparator />}
              <ActionItem testId="person-remove-samples" label="Remove sample data" write={removeSamplesWrite}
                          variant="destructive" onSelect={() => { close(); setConfirmSamples(true); }} />
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AssignSheet person={person} open={sheet === "assign"} write={assign} onOpenChange={(v) => { if (!v) closeSheet(); }} onDone={onDone} />
      <ConsentSheet person={person} open={sheet === "consent"} write={consent} onOpenChange={(v) => { if (!v) closeSheet(); }} onDone={onDone} />
      <AddGuardianSheet person={person} open={sheet === "add-guardian"} write={addGuardianWrite} onOpenChange={(v) => { if (!v) closeSheet(); }} onDone={onDone} />
      <RemoveGuardianSheet person={person} open={sheet === "remove-guardian"} write={removeGuardianWrite} onOpenChange={(v) => { if (!v) closeSheet(); }} onDone={onDone} />
      <NextStepSheet person={person} open={sheet === "next-step"} write={nextStep} onOpenChange={(v) => { if (!v) closeSheet(); }} onDone={onDone} />
      <AttachmentSheet person={person} open={sheet === "attachment"} write={attachment} onOpenChange={(v) => { if (!v) closeSheet(); }} onDone={onDone} />

      <DecisionModal
        open={confirmSamples}
        onOpenChange={(v) => { if (!v) setConfirmSamples(false); }}
        title="Remove sample data?"
        rows={[{
          headline: "Every sample record in the practice is archived — not only this person.",
          detail: "This can't be undone from here. The activity line will name who removed it.",
        }]}
        cancelLabel="Keep sample data"
        confirmLabel="Remove sample data"
        danger
        busy={removeSamplesWrite.busy}
        error={writeErrorNode(removeSamplesWrite.error)}
        onCancel={() => setConfirmSamples(false)}
        onConfirm={confirmRemoveSamples}
        testId="person-remove-samples-confirm"
      />
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// A3.2 — THE THREE PERSON WRITES THAT HAD NO CONTROL. **STAGE · INVITE · RANK.**
//
// ★★★ THE SURFACE PER ROUTE IS RULED, AND EACH ONE IS A DIFFERENT SHAPE FOR A REASON:
//   · STAGE   → a POPOVER. Four values, chosen often, no consequence beyond the move itself.
//   · INVITE  → a DIALOG. One decision, one audience, and a sentence that has to be read.
//   · RANK    → a DROPDOWN. A menu of four, admin-only, and it is not a form.
//
// ★★ `setLifecycleStatus` HAD **NO CLIENT METHOD AT ALL** before A3.2 — the write that moves a
//    person from lead to active to former has been live and callerless. It is the core of any
//    CRM pipeline and there was no way to reach it from a browser.
//
// ★★★ THE RANK CONTROL IS ADMIN-ONLY AND THE SERVER IS THE BOUNDARY. `/api/people/staff-role`
//     carries `minRank: "admin"`; hiding the control is a PAYLOAD decision that stops the product
//     promising what it would refuse. **Both are true at once** — §K3.
//
// ★ EVERY VOCABULARY IS IMPORTED FROM THE SERVER, NEVER RETYPED. `LIFECYCLE_STATUSES` and
//   `STAFF_ROLES` are the closed sets `writes.mjs` validates against; a fifth value typed here
//   would be refused by the database — the right outcome discovered in the wrong place.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api.js";
import { RANK_ORDER } from "@/lib/permissions/rank.js";
import { Button } from "@/lib/components/ui/button.jsx";
// ★ `$keystone/...` is a backend-only alias (src/) — the frontend bundle cannot import across that
//   boundary. Mirrors src/people/vocab.mjs's own exports exactly.
const LIFECYCLE_STATUSES = Object.freeze(["lead", "active", "paused", "former"]);
const STAFF_ROLES = Object.freeze(["member", "admin", "owner"]);
import DisabledWithReason from "@/lib/forms/DisabledWithReason.jsx";
import MergeDialog from "./MergeDialog.jsx";
import PersonActionsPopover1Popover from "./PersonActionsPopover1Popover.jsx";
import PersonActionsMenu2Menu from "./PersonActionsMenu2Menu.jsx";
import PersonActionsPopover3Popover from "./PersonActionsPopover3Popover.jsx";
import PersonActionsPersonInviteSheet from "./PersonActionsPersonInviteSheet.jsx";

// ★★ THE WORDS A PERSON READS, BESIDE THE VALUES THE SERVER STORES. The stored value is the
//    vocabulary`s own; the label is what a coach understands. Never the identifier on screen.`
const STAGE_LABEL = {
  lead: "Lead",
  active: "Active",
  paused: "Paused",
  former: "Former",
};
const STAGE_MEANING = {
  lead: "In conversation, not yet working with you.",
  active: "Currently working with you.",
  paused: "Taking a break, expected back.",
  former: "No longer working with you.",
};
const RANK_LABEL = {
  coach: `Coach`,
  admin: "Admin",
  super_admin: "Super admin",
  super_admin_1: "Super Admin 1",
};

export default function PersonActions({ person = null, rank = null, onDone = null }) {
  const isAdmin = RANK_ORDER.indexOf(rank ?? "") >= RANK_ORDER.indexOf("admin");

  // ★ A person's stage only means something for the people a practice has a relationship with.
  //   Staff are colleagues, not leads, and offering them a pipeline is a category error.
  const isStaff = person?.role === "staff";

  // State management
  const [stageOpen, setStageOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [tagsInput, setTagsInput] = useState("");
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeSearch, setMergeSearch] = useState("");
  const [mergeOptions, setMergeOptions] = useState([]);
  const [selectedMergeId, setSelectedMergeId] = useState(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);

  // ★ Debounced-by-effect search over /api/list/people/all for merge duplicate picker
  useEffect(() => {
    const q = mergeSearch.trim();
    if (!mergeOpen || q.length < 2) {
      setMergeOptions([]);
      return;
    }
    let live = true;
    const t = setTimeout(async () => {
      try {
        const r = await api.request(`/api/list/people/all?limit=8`);
        if (!live) return;
        const needle = q.toLowerCase();
        setMergeOptions(
          (r?.rows ?? [])
            .filter((p) => p.id !== person.id && (p.display_name ?? "").toLowerCase().includes(needle))
            .map((p) => ({ value: p.id, label: p.display_name ?? p.email ?? p.id }))
        );
      } catch {
        if (live) setMergeOptions([]);
      }
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [mergeSearch, mergeOpen, person?.id]);

  async function run(fn) {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      await fn();
      setStageOpen(false);
      setInviteOpen(false);
      setTagsOpen(false);
      setMergeOpen(false);
      setReason("");
      setTagsInput("");
      setMergeSearch("");
      setMergeOptions([]);
      setSelectedMergeId(null);
      onDone?.();
    } catch (err) {
      // ★★ THE SERVER'S OWN SENTENCE. `setStaffRole` refuses a non-staff person and
      //    `setLifecycleStatus` names the four it accepts — both are better than anything written
      //    here, and both name the rule that actually said no.
      setProblem(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  }

  const setStage = (status) =>
    run(() =>
      api.setPersonStage({ personId: person.id, status, reason: reason.trim() || undefined })
    );
  const setRank = (staffRole) =>
    run(() => api.setStaffRole({ personId: person.id, staffRole }));
  // ★ F632 FIX (task 8.14b) — calls the RESEND method, not the create one. `api.resendInvitePerson`
  //   posts to the SAME route `api.invitePerson` does (`POST /api/people/invite`), told which person
  //   to resend to instead of who to create; the server looks the person up itself by `personId`, so
  //   `email`/`displayName`/`staffRole` are no longer sent.
  const resendInvite = () => run(() => api.resendInvitePerson({ personId: person.id }));

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ the maintainer, 29 Sep 2026 — "Client portal invites — never built." The button, the sheet, the
  //     mint-and-send server side (createInvite/sendInviteEmail) all already existed for STAFF
  //     (task 8.6/8.10/8.12) — the gap was entirely that this block above was `isStaff && isAdmin`
  //     only. Extended here, not rebuilt: same `resendInvite` call for the first two states
  //     (the server does not distinguish "first send" from "resend" — F632), a NEW call
  //     (`api.sendPortalLink`) for the third. No admin gate — migration 0226 already grants a
  //     COACH `team.invite`, specifically so a coach can invite their own client.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  const isClient = person?.role === "adult_client" || person?.role === "adolescent_client";
  const isTeen = person?.role === "adolescent_client";
  // ★ An adolescent has no portal session of their own (appHome.mjs/appProfile.mjs both dispatch
  //   on the GUARDIAN'S session) — every state below reads as "the family's", via the parent.
  const clientInviteMode =
    person?.portal_status === "active" ? "portal_link" :
    (person?.portal_status === "invited" || person?.portal_status === "bounced") ? "resend" :
    "invite";
  const clientInviteBlocked = isTeen && !person?.has_parent_linked;
  const clientInviteLabel = {
    invite: "Send portal invite", resend: "Resend invite", portal_link: "Send portal link",
  }[clientInviteMode];
  const sendClientInvite = () =>
    run(() =>
      clientInviteMode === "portal_link"
        ? api.sendPortalLink({ personId: person.id })
        : api.resendInvitePerson({ personId: person.id })
    );

  // ★★★ the maintainer, 29 Sep 2026 — "Make them a client" — the other dropped-message control, on a Lead.
  //   Same write the Stage popover's "Active" option already calls; this is the one-click version
  //   named on the row/record for the single most common stage move, without opening the popover.
  const isLead = person?.lifecycle_status === "lead";
  const makeClient = () => run(() => api.setPersonStage({ personId: person.id, status: "active" }));

  // ★ Tags editor — comma-separated text input, same pattern as PersonForm
  const openTagsEditor = () => {
    setTagsInput((person.tags ?? []).join(", "));
    setTagsOpen(true);
  };
  const saveTags = () =>
    run(() => {
      const newTags = tagsInput
        .trim()
        ? tagsInput
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
        : [];
      return api.updatePerson({ personId: person.id, tags: newTags });
    });

  if (!person) return null;

  return (
    <>
      {!isStaff && (
        <PersonActionsPopover1Popover
          open={stageOpen}
          onOpenChange={setStageOpen}
          person={person}
          STAGE_LABEL={STAGE_LABEL}
          STAGE_MEANING={STAGE_MEANING}
          reason={reason}
          busy={busy}
          problem={problem}
          setStage={setStage}
        />
      )}

      {/* ★★★ the maintainer, 29 Sep 2026 — "Make them a client": one click off a Lead, no popover. */}
      {!isStaff && isLead && (
        <Button
          type="button"
          variant="outline"
          data-testid="person-make-client-trigger"
          disabled={busy}
          onClick={() => run(makeClient)}
        >
          Make them a client
        </Button>
      )}

      {/* ★★★ the maintainer, 29 Sep 2026 — THE CLIENT PORTAL INVITE CONTROL. Three states, one button, same
          sheet the staff path below already built (extended, not duplicated — see its own header
          for the mode/isTeen/ttlDays props this adds). */}
      {isClient && (
        <>
          <DisabledWithReason
            disabled={clientInviteBlocked}
            reason="Link a parent before sending a portal invite."
            testId="person-invite-trigger-disabled"
          >
            {({ disabled, describedBy }) => (
              <Button
                type="button"
                data-testid="person-invite-trigger"
                disabled={disabled}
                aria-describedby={disabled ? describedBy : undefined}
                onClick={() => {
                  setProblem(null);
                  setInviteOpen(true);
                }}
              >
                {clientInviteLabel}
              </Button>
            )}
          </DisabledWithReason>
          <PersonActionsPersonInviteSheet
            open={inviteOpen}
            onOpenChange={setInviteOpen}
            person={person}
            busy={busy}
            problem={problem}
            resendInvite={sendClientInvite}
            mode={clientInviteMode}
            isTeen={isTeen}
            ttlDays={30}
          />
        </>
      )}

      {isStaff && isAdmin && (
        <>
          <PersonActionsMenu2Menu
            open={stageOpen}
            onOpenChange={setStageOpen}
            person={person}
            rank={rank}
            RANK_LABEL={RANK_LABEL}
            busy={busy}
            setRank={setRank}
          />

          {/* ★ Only for somebody who cannot sign in yet. Offering "invite" to a person who already has
             a login is a control with nothing to do. */}
          {!person.firebase_uid && (
            <>
              <Button
                type="button"
                data-testid="person-invite-trigger"
                onClick={() => {
                  setProblem(null);
                  setInviteOpen(true);
                }}
              >
                Invite again
              </Button>
              <PersonActionsPersonInviteSheet
                open={inviteOpen}
                onOpenChange={setInviteOpen}
                person={person}
                busy={busy}
                problem={problem}
                resendInvite={resendInvite}
              />
            </>
          )}
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════════════════════
         TAGS EDITOR — A SIMPLE TEXT INPUT FOR COMMA-SEPARATED TAGS. Same pattern as PersonForm.
      ═══════════════════════════════════════════════════════════════════════════════════════ */}
      <PersonActionsPopover3Popover
        open={tagsOpen}
        onOpenChange={setTagsOpen}
        busy={busy}
        problem={problem}
        tagsInput={tagsInput}
        setTagsInput={setTagsInput}
        openTagsEditor={openTagsEditor}
        saveTags={saveTags}
      />

      {/* ═══════════════════════════════════════════════════════════════════════════════════════
         ★★★ TASK 12.25 — THE MERGE TRIGGER. `record.archive` (the route's own authorisation,
             `src/routes/writes.mjs:238-262`) is owner/admin-only and carries NO `isStaff` condition —
             a duplicate CLIENT is at least as common as a duplicate staff record, so this button is
             gated on `isAdmin` alone, not nested inside the staff-only block above. Hiding it here is
             a payload decision; the server still refuses the same request from a coach.
      ═══════════════════════════════════════════════════════════════════════════════════════ */}
      {isAdmin && (
        <>
          <Button
            type="button"
            data-testid="person-merge-trigger"
            onClick={() => {
              setProblem(null);
              setMergeOpen(true);
            }}
          >
            Merge duplicate
          </Button>

          {mergeOpen && !selectedMergeId && (
            <div className="fixed inset-0 z-100 flex items-center justify-center">
              <div
                className="absolute inset-0 bg-scrim cursor-pointer"
                onClick={() => {
                  setMergeOpen(false);
                  setMergeSearch("");
                  setMergeOptions([]);
                }}
              />
              <div className="relative bg-surface border border-line rounded-lg shadow-overlay w-(100%-48px) max-w-[420px] p-5 flex flex-col gap-3">
                <h3 className="m-0 text-sm font-semibold">Find the duplicate to merge with</h3>
                <input
                  type="text"
                  className="w-full h-9 px-3 border border-line rounded-sm bg-surface text-sm font-400 font-inter"
                  placeholder="Search by name or email…"
                  value={mergeSearch}
                  onChange={(e) => setMergeSearch(e.target.value)}
                  autoFocus
                  data-testid="person-merge-search"
                />
                {mergeOptions.length > 0 && (
                  <div className="flex flex-col gap-1 max-h-[250px] overflow-y-auto">
                    {mergeOptions.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className="text-left px-3 py-2 border border-transparent rounded-sm bg-none cursor-pointer font-inherit text-ink hover:bg-surface-sunken hover:border-line"
                        onClick={() => setSelectedMergeId(option.value)}
                        data-testid={`person-merge-option-${option.value}`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                )}
                {mergeSearch.length > 0 && mergeOptions.length === 0 && (
                  <p className="text-center py-3 text-sm text-mute">No people found</p>
                )}
              </div>
            </div>
          )}

          {/* ★★★ TASK 12.25 — `survivorId={person.id}`: whichever record this trigger was opened FROM is
              always the one kept. So "onDone navigates to the survivor" needs no navigation call here —
              `person.id` IS already the survivor, this IS the survivor's own record page, and the parent's
              `onDone` (Screen.svelte's `done(app, path)`, wired at the `PersonActions` mount) reloads that
              SAME path. Staying put on a page that is already the survivor's is what "navigates to the
              survivor" means for a trigger that can only ever be opened from the record being kept. */}
          {selectedMergeId && (
            <MergeDialog
              survivorId={person.id}
              loserId={selectedMergeId}
              onDone={() => {
                setSelectedMergeId(null);
                setMergeOpen(false);
                onDone?.();
              }}
              onCancel={() => setSelectedMergeId(null)}
            />
          )}
        </>
      )}
    </>
  );
}
